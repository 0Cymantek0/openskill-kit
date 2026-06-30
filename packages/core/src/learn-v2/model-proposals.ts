import { promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../storage/atomic.js";
import { mergeLearnV2ConceptCards } from "./concepts.js";
import {
  buildLearnV2EpisodeLearningBundle,
  parseLearnV2LlmConceptExtractionOutput,
  renderLearnV2ConceptExtractionPrompt,
  validateLearnV2LlmConceptExtractionOutput
} from "./extract.js";
import { readLearnV2ConceptStore, writeLearnV2ConceptStore } from "./store.js";
import { type LearnV2BehaviorAtom, type LearnV2TaskEpisode } from "./schemas.js";

export interface LearnV2EpisodeStore {
  schemaVersion: "openskill-kit.learn-v2.episode-store.v1";
  updatedAt: string;
  episodes: LearnV2TaskEpisode[];
}

export interface LearnV2ModelRequest {
  episodeId: string;
  bundlePath: string;
  promptPath: string;
  outputSchema: "openskill-kit.learn-v2.llm-concept-extraction-output.v1";
}

export interface LearnV2ModelRequestResult {
  schemaVersion: "openskill-kit.learn-v2.model-request-result.v1";
  generatedAt: string;
  requestCount: number;
  requests: LearnV2ModelRequest[];
  instructions: string[];
}

export interface LearnV2ModelProposalApplyResult {
  schemaVersion: "openskill-kit.learn-v2.model-proposal-apply-result.v1";
  appliedAt: string;
  outputFiles: string[];
  atomCount: number;
  rejected: Array<{ outputPath: string; id: string; reason: string; detail?: string }>;
  conceptCount: number;
  conceptStorePath: string;
}

export async function writeLearnV2EpisodeStore(rootInput: string, episodes: LearnV2TaskEpisode[], now = new Date()): Promise<string> {
  const root = path.resolve(rootInput);
  const store: LearnV2EpisodeStore = {
    schemaVersion: "openskill-kit.learn-v2.episode-store.v1",
    updatedAt: now.toISOString(),
    episodes
  };
  const file = learnV2EpisodeStorePath(root);
  await writeJsonAtomic(file, store);
  return file;
}

export async function readLearnV2EpisodeStore(rootInput: string): Promise<LearnV2EpisodeStore> {
  const root = path.resolve(rootInput);
  const text = await fs.readFile(learnV2EpisodeStorePath(root), "utf8");
  return JSON.parse(text) as LearnV2EpisodeStore;
}

export async function writeLearnV2ModelRequests(rootInput: string, episodes?: LearnV2TaskEpisode[], now = new Date()): Promise<LearnV2ModelRequestResult> {
  const root = path.resolve(rootInput);
  const sourceEpisodes = episodes ?? (await readLearnV2EpisodeStore(root)).episodes;
  await pruneStaleModelRequestDirs(root, new Set(sourceEpisodes.map((episode) => episode.id)));
  const requests: LearnV2ModelRequest[] = [];
  for (const episode of sourceEpisodes) {
    const bundle = buildLearnV2EpisodeLearningBundle(episode);
    const prompt = renderLearnV2ConceptExtractionPrompt(bundle);
    const dir = path.join(root, ".openskill-kit", "learn-v2", "model-requests", episode.id);
    const bundlePath = path.join(dir, "episode-learning-bundle.json");
    const promptPath = path.join(dir, "concept-extraction-prompt.md");
    await writeJsonAtomic(bundlePath, bundle);
    await fs.writeFile(promptPath, prompt, "utf8");
    requests.push({
      episodeId: episode.id,
      bundlePath,
      promptPath,
      outputSchema: "openskill-kit.learn-v2.llm-concept-extraction-output.v1"
    });
  }
  return {
    schemaVersion: "openskill-kit.learn-v2.model-request-result.v1",
    generatedAt: now.toISOString(),
    requestCount: requests.length,
    requests,
    instructions: [
      "Give each prompt to an OpenCode-configured concept-extractor agent.",
      "Save the agent's strict JSON response to a local file.",
      "Apply responses with the Learn v2 model proposal ingestion command/tool.",
      "Do not paste raw vault content into prompts or responses."
    ]
  };
}

export async function applyLearnV2ModelProposalOutputs(
  rootInput: string,
  outputPathsInput: string[],
  now = new Date()
): Promise<LearnV2ModelProposalApplyResult> {
  const root = path.resolve(rootInput);
  const episodeStore = await readLearnV2EpisodeStore(root);
  const episodesById = new Map(episodeStore.episodes.map((episode) => [episode.id, episode]));
  const atoms: LearnV2BehaviorAtom[] = [];
  const rejected: LearnV2ModelProposalApplyResult["rejected"] = [];
  const outputFiles = outputPathsInput.map((file) => path.resolve(root, file));
  for (const outputPath of outputFiles) {
    const text = await fs.readFile(outputPath, "utf8").catch((error: unknown) => {
      rejected.push({ outputPath, id: "file", reason: "read-failed", detail: error instanceof Error ? error.message : String(error) });
      return undefined;
    });
    if (text === undefined) continue;
    const parsed = safeParseModelOutput(text, outputPath, rejected);
    if (!parsed) continue;
    const episodeId = inferEpisodeIdForOutput(outputPath, episodesById);
    const episode = episodesById.get(episodeId);
    if (!episode) {
      for (const [index] of parsed.atoms.entries()) rejected.push({ outputPath, id: `llm_atom_${index}`, reason: "no-matching-episode" });
      continue;
    }
    const result = validateLearnV2LlmConceptExtractionOutput(episode, parsed);
    atoms.push(...result.atoms);
    rejected.push(...result.rejected.map((item) => ({ outputPath, ...item })));
  }
  const concepts = mergeLearnV2ConceptCards(atoms, now);
  const existing = await readLearnV2ConceptStore(root, now).catch(() => undefined);
  const store = await writeLearnV2ConceptStore(root, [...(existing?.cards ?? []), ...concepts], now);
  return {
    schemaVersion: "openskill-kit.learn-v2.model-proposal-apply-result.v1",
    appliedAt: now.toISOString(),
    outputFiles,
    atomCount: atoms.length,
    rejected,
    conceptCount: store.cards.length,
    conceptStorePath: path.join(root, ".openskill-kit", "learn-v2", "concepts", "store.json")
  };
}

export function learnV2EpisodeStorePath(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "episodes", "store.json");
}

export function learnV2ModelRequestsRoot(root: string): string {
  return path.join(root, ".openskill-kit", "learn-v2", "model-requests");
}

function safeParseModelOutput(
  text: string,
  outputPath: string,
  rejected: LearnV2ModelProposalApplyResult["rejected"]
): ReturnType<typeof parseLearnV2LlmConceptExtractionOutput> | undefined {
  try {
    return parseLearnV2LlmConceptExtractionOutput(text);
  } catch (error) {
    rejected.push({ outputPath, id: "file", reason: "invalid-json-or-schema", detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

async function pruneStaleModelRequestDirs(root: string, currentEpisodeIds: Set<string>): Promise<void> {
  const requestRoot = learnV2ModelRequestsRoot(root);
  const entries = await fs.readdir(requestRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !currentEpisodeIds.has(entry.name))
    .map((entry) => fs.rm(path.join(requestRoot, entry.name), { recursive: true, force: true })));
}

function inferEpisodeIdForOutput(outputPath: string, episodesById: Map<string, LearnV2TaskEpisode>): string {
  const normalized = outputPath.replace(/\\/g, "/");
  for (const id of episodesById.keys()) {
    if (normalized.includes(id)) return id;
  }
  const basename = path.basename(outputPath, path.extname(outputPath));
  if (episodesById.has(basename)) return basename;
  return episodesById.size === 1 ? [...episodesById.keys()][0]! : basename;
}
