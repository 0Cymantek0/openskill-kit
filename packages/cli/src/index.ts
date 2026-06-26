#!/usr/bin/env node
import { Command, Option } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  appendEvent,
  applyPreferenceReview,
  compileBehaviorLayer,
  draftSkill,
  evaluateSkill,
  explainPreference,
  exportProjectBehaviorPack,
  exportEncryptedProjectBehaviorPack,
  extractSignals,
  evolveSkill,
  explainAdaptiveStatus,
  getAdaptiveStatus,
  explainPreferenceWithEvidence,
  installAgentHooks,
  installInstructionManifests,
  uninstallInstructionManifests,
  initAdaptiveProject,
  initOpenWorldTask,
  importProjectBehaviorPack,
  importEncryptedProjectBehaviorPack,
  installSkill,
  inspectProjectBehaviorPack,
  loadSkillPackage,
  buildReviewQueue,
  proposeSemanticPreference,
  retrieveRelevantPreferences,
  auditOpenWorldLeakage,
  buildVirtualSuiteFromAnchors,
  draftAnchorFromOpenWorldSource,
  ingestLocalOpenWorldSource,
  renderOpenWorldTaskReport,
  readOpenWorldTask,
  runOpenWorldPython,
  runAgentDoctor,
  runLifecycleOnce,
  readRegistry,
  readCalibrationReport,
  readEvidenceCards,
  runBehaviorEval,
  runBehaviorCompareEval,
  runExternalAgentEval,
  runDoctor,
  runFullDoctor,
  resetProjectState,
  pruneProjectState,
  archiveProjectState,
  compactProjectState,
  scanSkillPath,
  signProjectBehaviorPack,
  diffProjectBehaviorPacks,
  uninstallSkill,
  updatePreferenceGraph,
  writeOpenWorldLeakageAudit,
  verifyProjectBehaviorPack,
  verifySkill,
  CompileTargets,
  type CompileTarget,
  type InstallTarget
} from "@openskill-kit/core";

const program = new Command();

program
  .name("openskill-kit")
  .description("OpenSkillKit adaptive project behavior layer")
  .version("0.1.0");

program.command("version")
  .description("Print version")
  .action(() => {
    console.log("0.1.0");
  });

program.command("init")
  .description("Create local Adaptive Skill Graph project state")
  .option("--project-name <name>", "Project display name")
  .option("--force", "Rewrite adaptive config")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await initAdaptiveProject({ projectRoot: process.cwd(), projectName: options.projectName, force: options.force === true });
    output(options.json, result, `${result.status} ${result.configPath}`);
  });

program.command("status")
  .description("Show Adaptive Skill Graph status")
  .option("--explain", "Explain what system knows and next actions")
  .option("--json", "Print JSON")
  .action(async (options) => {
    if (options.explain === true) {
      const explained = await explainAdaptiveStatus(process.cwd());
      output(options.json, explained, explained.nextActions.join("\n"));
      return;
    }
    const status = await getAdaptiveStatus(process.cwd());
    output(options.json, status, `Initialized: ${status.initialized}\nEvents: ${status.eventCount}\nSignals: ${status.signalCount}\nActive preferences: ${status.activePreferenceCount}\nCandidates: ${status.candidateCount}`);
  });

program.command("doctor")
  .description("Check local environment and install targets")
  .option("--full", "Check adaptive config, hooks, MCP config, pack, registry, and stale graph state")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const report = options.full === true ? await runFullDoctor(process.cwd()) : await runDoctor(process.cwd());
    output(options.json, report, `Doctor ${report.status}: ${report.checks.length} checks`);
    process.exitCode = report.status === "fail" ? 1 : 0;
  });

const openworld = program.command("openworld")
  .description("Manage local-only OpenWorld evolution scaffold artifacts");

openworld.command("init-task")
  .description("Create an OpenWorld task record under .openskill-kit/openworld")
  .requiredOption("--title <title>", "Task title")
  .requiredOption("--prompt <prompt>", "Task prompt")
  .option("--task-type <type>", "Task type", "general")
  .option("--language <language>", "Task language", collectOption, [])
  .option("--path <path>", "Relevant project path", collectOption, [])
  .option("--forbidden-identifier <value>", "Hidden oracle or benchmark identifier to block", collectOption, [])
  .option("--forbidden-path <path>", "Hidden oracle path to block", collectOption, [])
  .option("--allow-web", "Mark future web retrieval as allowed")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await initOpenWorldTask(process.cwd(), {
      title: options.title,
      prompt: options.prompt,
      taskType: options.taskType,
      languages: options.language,
      paths: options.path,
      forbiddenIdentifiers: options.forbiddenIdentifier,
      forbiddenPaths: options.forbiddenPath,
      allowWeb: options.allowWeb === true
    });
    output(options.json, result, `OpenWorld task ${result.task.id}\n${result.taskPath}`);
  });

openworld.command("leakage-check")
  .description("Scan OpenWorld queries, paths, or content for hidden-oracle leakage")
  .option("--task-id <id>", "Task id", "manual")
  .option("--query <query>", "Query text to scan", collectOption, [])
  .option("--content <content>", "Content text to scan", collectOption, [])
  .option("--path <path>", "Path text to scan", collectOption, [])
  .option("--forbidden-identifier <value>", "Identifier to block", collectOption, [])
  .option("--forbidden-path <path>", "Path to block", collectOption, [])
  .option("--write", "Write audit artifact")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const task = {
      id: options.taskId,
      forbiddenIdentifiers: options.forbiddenIdentifier,
      forbiddenPaths: options.forbiddenPath
    };
    const inputs = [
      ...options.query.map((value: string, index: number) => ({ source: `query-${index + 1}`, surface: "query" as const, value })),
      ...options.content.map((value: string, index: number) => ({ source: `content-${index + 1}`, surface: "content" as const, value })),
      ...options.path.map((value: string, index: number) => ({ source: `path-${index + 1}`, surface: "path" as const, value }))
    ];
    const audit = auditOpenWorldLeakage(inputs, task);
    const auditPath = options.write === true ? await writeOpenWorldLeakageAudit(process.cwd(), audit) : undefined;
    output(options.json, { audit, auditPath }, `${audit.status}: ${audit.findings.length} finding(s)${auditPath ? `\n${auditPath}` : ""}`);
    process.exitCode = audit.status === "blocked" ? 1 : 0;
  });

openworld.command("plan")
  .description("Run Python OpenWorld scaffold planning with leakage enforcement")
  .requiredOption("--title <title>", "Task title")
  .requiredOption("--prompt <prompt>", "Task prompt")
  .option("--task-type <type>", "Task type", "general")
  .option("--allow-web", "Mark future web retrieval as allowed")
  .option("--forbidden-identifier <value>", "Identifier to block", collectOption, [])
  .option("--forbidden-path <path>", "Path to block", collectOption, [])
  .option("--timeout-ms <number>", "Python timeout", parseIntegerOption, 30000)
  .option("--json", "Print JSON")
  .action(async (options) => {
    const args = [
      "plan-task",
      "--title", options.title,
      "--prompt", options.prompt,
      "--task-type", options.taskType,
      ...(options.allowWeb === true ? ["--allow-web"] : []),
      ...flatRepeat("--forbidden-identifier", options.forbiddenIdentifier),
      ...flatRepeat("--forbidden-path", options.forbiddenPath)
    ];
    const result = await runOpenWorldPython({ projectRoot: process.cwd(), args, timeoutMs: options.timeoutMs });
    output(options.json, result.result, "OpenWorld plan written");
  });

openworld.command("research")
  .description("Ingest one project-local source file for an OpenWorld task")
  .requiredOption("--task-id <id>", "Task id")
  .requiredOption("--file <path>", "Project-local source file")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await ingestLocalOpenWorldSource(process.cwd(), options.taskId, options.file);
    output(options.json, result, `OpenWorld source ${result.source.id}\n${result.sourcePath}`);
  });

openworld.command("anchors")
  .description("Draft an Anchor Card from a cached OpenWorld source")
  .requiredOption("--task-id <id>", "Task id")
  .requiredOption("--source-id <id>", "Source id")
  .option("--claim <text>", "Override extracted claim")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await draftAnchorFromOpenWorldSource(process.cwd(), options.taskId, options.sourceId, options.claim);
    output(options.json, result, `OpenWorld anchor ${result.anchor.id}\n${result.anchorPath}`);
  });

openworld.command("build-verifier")
  .description("Draft a visible/holdout virtual verifier suite from Anchor Cards")
  .requiredOption("--task-id <id>", "Task id")
  .requiredOption("--anchor-id <id>", "Anchor id", collectOption, [])
  .option("--json", "Print JSON")
  .action(async (options) => {
    const anchors = await Promise.all(options.anchorId.map(async (id: string) => {
      const file = path.join(process.cwd(), ".openskill-kit", "openworld", "tasks", options.taskId, "anchors", `${id}.json`);
      return JSON.parse(await fs.readFile(file, "utf8"));
    }));
    const result = await buildVirtualSuiteFromAnchors(process.cwd(), options.taskId, anchors);
    output(options.json, result, `OpenWorld virtual suite ${result.suite.id}\n${result.suitePath}`);
  });

openworld.command("report")
  .description("Render a Markdown report for an OpenWorld task")
  .requiredOption("--task-id <id>", "Task id")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const task = await readOpenWorldTask(process.cwd(), options.taskId);
    const markdown = renderOpenWorldTaskReport({ task });
    output(options.json, { task, markdown }, markdown);
  });

const agent = program.command("agent")
  .description("Inspect and install local agent adapters");

agent.command("doctor")
  .description("Check adaptive agent hook readiness")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const report = await runAgentDoctor(process.cwd());
    output(options.json, report, `Agent doctor ${report.status}: ${report.checks.length} checks`);
    process.exitCode = report.status === "fail" ? 1 : 0;
  });

agent.command("install-hooks")
  .description("Install generated lifecycle hook config for a local agent target")
  .requiredOption("--target <target>", "project|global")
  .option("--dry-run", "Plan without writing")
  .option("--yes", "Non-interactive approval")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await installAgentHooks({
      projectRoot: process.cwd(),
      target: parseAgentHookTarget(options.target),
      dryRun: options.dryRun === true,
      yes: options.yes === true
    });
    output(options.json, result, result.messages.join("\n"));
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

agent.command("install-manifests")
  .description("Install managed AGENTS.md, CLAUDE.md, and path-scoped rules")
  .option("--target <target>", "project", "project")
  .option("--dry-run", "Plan without writing")
  .option("--yes", "Non-interactive approval")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await installInstructionManifests(process.cwd(), {
      target: parseManifestTarget(options.target),
      dryRun: options.dryRun === true,
      yes: options.yes === true
    });
    output(options.json, result, result.messages.join("\n"));
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

agent.command("uninstall-manifests")
  .description("Remove managed AGENTS.md, CLAUDE.md, and generated path-scoped rules")
  .option("--target <target>", "project", "project")
  .option("--dry-run", "Plan without writing")
  .option("--yes", "Non-interactive approval")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await uninstallInstructionManifests(process.cwd(), {
      target: parseManifestTarget(options.target),
      dryRun: options.dryRun === true,
      yes: options.yes === true
    });
    output(options.json, result, result.messages.join("\n"));
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

program.command("draft")
  .description("Draft a deterministic local skill")
  .argument("<topic>", "Skill topic")
  .option("--no-llm", "Do not use LLM provider", true)
  .option("--evidence-file <path>", "Add a local evidence file to the ledger", collectOption, [])
  .option("--evidence-url <url>", "Fetch an explicit HTTP(S) evidence URL", collectOption, [])
  .option("--json", "Print JSON")
  .action(async (topic, options) => {
    const result = await draftSkill({ topic, projectRoot: process.cwd(), noLlm: options.llm === false, evidenceFiles: options.evidenceFile, evidenceUrls: options.evidenceUrl });
    output(options.json, result, `Drafted ${result.skillName} at ${result.skillDir}`);
  });

program.command("observe")
  .description("Record an adaptive lifecycle event")
  .option("--event <path>", "JSON event file")
  .option("--type <eventType>", "Event type", "user-prompt-submit")
  .option("--text <text>", "Event text")
  .option("--session <id>", "Session id", "manual-session")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const fileEvent = options.event ? JSON.parse(await fs.readFile(path.resolve(options.event), "utf8")) : {};
    const result = await appendEvent(process.cwd(), {
      ...fileEvent,
      sessionId: fileEvent.sessionId ?? options.session,
      eventType: fileEvent.eventType ?? options.type,
      source: fileEvent.source ?? { adapter: "cli" },
      normalized: fileEvent.normalized ?? { text: options.text ?? fileEvent.intent ?? "" },
      intent: fileEvent.intent ?? options.text,
      privacy: fileEvent.privacy ?? { redacted: false, rawStored: false, containsUserText: Boolean(options.text), containsCode: false }
    });
    output(options.json, result, `Recorded ${result.event.id}`);
  });

program.command("learn")
  .description("Learn adaptive preferences, or draft a legacy skill when topic is supplied")
  .argument("[topic]", "Legacy skill topic")
  .addOption(new Option("--no-llm", "Legacy draft mode only").default(true).hideHelp())
  .addOption(new Option("--evidence-file <path>", "Legacy draft mode evidence file").argParser(collectOption).default([]).hideHelp())
  .addOption(new Option("--evidence-url <url>", "Legacy draft mode evidence URL").argParser(collectOption).default([]).hideHelp())
  .option("--json", "Print JSON")
  .action(async (topic, options) => {
    if (topic) {
      const result = await draftSkill({ topic, projectRoot: process.cwd(), noLlm: options.llm === false, evidenceFiles: options.evidenceFile, evidenceUrls: options.evidenceUrl });
      output(options.json, result, `Drafted ${result.skillName} at ${result.skillDir}`);
      return;
    }
    const signals = await extractSignals(process.cwd());
    const graph = await updatePreferenceGraph(process.cwd());
    output(options.json, { signals, graph }, `Learned ${signals.signalCount} signal(s)\nCandidates: ${graph.candidateCount}`);
  });

program.command("review")
  .description("Review or apply candidate preferences")
  .option("--queue", "Write rich review queue artifacts")
  .option("--tui", "Open terminal review queue")
  .option("--activate <id>", "Activate preference id", collectOption, [])
  .option("--reject <id>", "Reject preference id", collectOption, [])
  .option("--lock <id>", "Lock preference id", collectOption, [])
  .option("--demote <id>", "Move active or locked preference back to candidate", collectOption, [])
  .option("--promote <id>", "Promote preference scope to user", collectOption, [])
  .option("--promote-global <id>", "Promote preference scope to global when config allows", collectOption, [])
  .option("--edit <id>", "Edit one preference id")
  .option("--statement <text>", "Edited statement text")
  .option("--category <category>", "Edited category")
  .option("--scope <level>", "Edited scope level")
  .option("--path <path>", "Edited scope path", collectOption, [])
  .option("--confidence <number>", "Edited confidence 0..1", parseFloatOption)
  .option("--merge-into <id>", "Merge sources into target preference id")
  .option("--merge-source <id>", "Merged source preference id", collectOption, [])
  .option("--split <id>", "Split one preference id into new candidate statements")
  .option("--split-statement <text>", "Split child statement", collectOption, [])
  .option("--activate-all", "Activate all candidates")
  .option("--json", "Print JSON")
  .action(async (options) => {
    if (options.tui === true) {
      const result = await runReviewTui(process.cwd());
      output(options.json, result, result.messages.join("\n"));
      return;
    }
    if (options.queue === true) {
      const queue = await buildReviewQueue(process.cwd());
      output(options.json, queue, `Review queue: ${queue.candidateCount} candidate(s), ${queue.proposals.length} proposal(s)\n${queue.markdownPath}`);
      return;
    }
    const graph = await applyPreferenceReview(process.cwd(), {
      activate: options.activate,
      reject: options.reject,
      lock: options.lock,
      demote: options.demote,
      promote: options.promote,
      promoteGlobal: options.promoteGlobal,
      activateAll: options.activateAll === true,
      edits: options.edit ? [{
        id: options.edit,
        statement: options.statement,
        category: options.category,
        scope: options.scope ? { level: options.scope, paths: options.path } : undefined,
        confidence: options.confidence
      }] : undefined,
      merges: options.mergeInto && options.mergeSource.length ? [{ targetId: options.mergeInto, sourceIds: options.mergeSource, statement: options.statement }] : undefined,
      splits: options.split && options.splitStatement.length ? [{ id: options.split, statements: options.splitStatement }] : undefined
    });
    const pending = graph.nodes.filter((node) => node.status === "candidate" || node.status === "conflict");
    output(options.json, graph, pending.length ? pending.map((node) => `${node.id} ${node.status} ${node.statement}`).join("\n") : "No pending preferences");
  });

program.command("propose")
  .description("Submit a structured semantic preference proposal")
  .requiredOption("--session <id>", "Source session id")
  .requiredOption("--statement <text>", "Preference statement")
  .requiredOption("--category <category>", "Preference category")
  .option("--scope <level>", "Scope level", "project")
  .option("--path <path>", "Scoped path", collectOption, [])
  .requiredOption("--evidence-event <id>", "Evidence event id", collectOption, [])
  .option("--evidence-quote <text>", "Evidence quote")
  .option("--counter-event <id>", "Counterevidence event id", collectOption, [])
  .option("--confidence <number>", "Confidence 0..1", parseFloatOption, 0.7)
  .option("--risk <risk>", "low|medium|high", "medium")
  .option("--target <target>", "Suggested compile target", collectOption, [])
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await proposeSemanticPreference(process.cwd(), {
      schemaVersion: "openskill-kit.semantic-proposal.v1",
      sessionId: options.session,
      statement: options.statement,
      category: options.category,
      scope: { level: options.scope, paths: options.path },
      evidence: options.evidenceEvent.map((eventId: string) => ({ eventId, quote: options.evidenceQuote })),
      counterevidence: options.counterEvent.map((eventId: string) => ({ eventId })),
      confidence: options.confidence,
      risk: options.risk,
      suggestedCompileTargets: options.target.length ? options.target : undefined
    });
    output(options.json, result, `Proposed ${result.proposal.id}\nSignal: ${result.signal.id}`);
  });

program.command("compile")
  .description("Compile active preferences into context pack, skill, hooks, and MCP config")
  .option("--target <target>", "Compile one target; repeat for several", collectOption, [])
  .option("--json", "Print JSON")
  .action(async (options) => {
    const targets = options.target.length ? options.target.map(parseCompileTarget) : undefined;
    const result = await compileBehaviorLayer(process.cwd(), { targets });
    output(options.json, result, [
      `Compiled behavior layer: ${result.compiledTargets.join(", ")}`,
      result.contextPackPath ? `Context: ${result.contextPackPath}` : undefined,
      result.skillPaths.length ? `Skill: ${result.skillPaths.join(", ")}` : undefined,
      result.manifestPaths.length ? `Manifests: ${result.manifestPaths.join(", ")}` : undefined
    ].filter(Boolean).join("\n"));
  });

program.command("explain")
  .description("Explain preference evidence by id")
  .argument("<id>", "Preference id")
  .option("--evidence", "Include sanitized evidence cards")
  .option("--json", "Print JSON")
  .action(async (id, options) => {
    if (options.evidence === true) {
      const explained = await explainPreferenceWithEvidence(process.cwd(), id);
      if (!explained) throw new Error(`Preference not found: ${id}`);
      output(options.json, explained, [
        explained.node.id,
        explained.node.statement,
        `Confidence: ${explained.node.confidence}`,
        `Evidence cards: ${explained.cards.map((card) => card.id).join(", ") || "none"}`
      ].join("\n"));
      return;
    }
    const node = await explainPreference(process.cwd(), id);
    if (!node) throw new Error(`Preference not found: ${id}`);
    output(options.json, node, `${node.id}\n${node.statement}\nConfidence: ${node.confidence}\nEvidence: ${node.evidence.map((item) => item.signalId).join(", ")}`);
  });

program.command("prefs")
  .description("Return ranked active preferences for a task or path")
  .option("--query <text>", "Task or question text")
  .option("--path <path>", "Changed or inspected path", collectOption, [])
  .option("--category <category>", "Preference category", collectOption, [])
  .option("--limit <number>", "Maximum preferences", parseIntegerOption, 12)
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await retrieveRelevantPreferences({
      projectRoot: process.cwd(),
      query: options.query,
      paths: options.path,
      categories: options.category,
      limit: options.limit
    });
    output(options.json, result, result.compactMarkdown);
  });

program.command("calibration")
  .description("Show review calibration reliability by category and extractor")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const report = await readCalibrationReport(process.cwd()).catch(() => undefined);
    if (!report) {
      output(options.json, { schemaVersion: "openskill-kit.calibration.v1", categories: {}, extractors: {} }, "No calibration data yet. Review candidates to build reliability stats.");
      return;
    }
    const lines = [
      "Categories:",
      ...Object.entries(report.categories).map(([name, bucket]) => `- ${name}: ${bucket.reliability} (${bucket.accepted + bucket.locked} accepted, ${bucket.rejected + bucket.demoted} rejected/demoted)`),
      "Extractors:",
      ...Object.entries(report.extractors).map(([name, bucket]) => `- ${name}: ${bucket.reliability} (${bucket.accepted + bucket.locked} accepted, ${bucket.rejected + bucket.demoted} rejected/demoted)`)
    ];
    output(options.json, report, lines.join("\n"));
  });

program.command("pack")
  .description("Export a shareable Project Behavior Pack")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await exportProjectBehaviorPack(process.cwd());
    output(options.json, result, `Exported pack ${result.packPath}`);
  });

const sync = program.command("sync")
  .description("Export or import encrypted privacy-safe behavior packs");

sync.command("export")
  .description("Export an encrypted Project Behavior Pack envelope")
  .option("--output <path>", "Encrypted output path")
  .option("--passphrase <text>", "Encryption passphrase")
  .option("--passphrase-file <path>", "Read encryption passphrase from file")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await exportEncryptedProjectBehaviorPack(process.cwd(), {
      outputPath: options.output,
      passphrase: await resolvePassphrase(options)
    });
    output(options.json, result, `Encrypted pack: ${result.encryptedPath}\nFiles: ${result.fileCount}`);
  });

sync.command("import")
  .description("Decrypt and import a Project Behavior Pack envelope")
  .argument("<encrypted-path>", "Encrypted pack JSON")
  .option("--passphrase <text>", "Encryption passphrase")
  .option("--passphrase-file <path>", "Read encryption passphrase from file")
  .option("--yes", "Apply import")
  .option("--review", "Write an import review artifact")
  .option("--trust-hooks", "Import hook files too")
  .option("--max-changed-files <number>", "Block import if changed file count exceeds this number", parseIntegerOption)
  .option("--json", "Print JSON")
  .action(async (encryptedPath, options) => {
    const result = await importEncryptedProjectBehaviorPack(process.cwd(), encryptedPath, {
      passphrase: await resolvePassphrase(options),
      dryRun: options.yes !== true,
      trustHooks: options.trustHooks === true,
      review: options.review === true,
      maxChangedFiles: options.maxChangedFiles
    });
    output(options.json, result, `${result.status}: ${result.files.length} file(s)${result.reviewPath ? `\nReview: ${result.reviewPath}` : ""}`);
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

program.command("verify-pack")
  .description("Verify a Project Behavior Pack manifest and hashes")
  .argument("<pack-path>", "Pack directory")
  .option("--json", "Print JSON")
  .action(async (packPath, options) => {
    const result = await verifyProjectBehaviorPack(packPath);
    output(options.json, result, `${result.status}: ${result.issues.join("; ") || "pack verified"}`);
    process.exitCode = result.status === "fail" ? 1 : 0;
  });

program.command("inspect-pack")
  .description("Inspect a Project Behavior Pack manifest, privacy, and signature")
  .argument("<pack-path>", "Pack directory")
  .option("--json", "Print JSON")
  .action(async (packPath, options) => {
    const result = await inspectProjectBehaviorPack(packPath);
    output(options.json, result, `${result.status}: ${result.fileCount} file(s), signature ${result.signature.status}`);
    process.exitCode = result.status === "fail" ? 1 : 0;
  });

program.command("diff-pack")
  .description("Diff two Project Behavior Packs by manifest hashes")
  .argument("<left-pack-path>", "Left pack directory")
  .argument("<right-pack-path>", "Right pack directory")
  .option("--json", "Print JSON")
  .action(async (leftPackPath, rightPackPath, options) => {
    const result = await diffProjectBehaviorPacks(leftPackPath, rightPackPath);
    output(options.json, result, `Added: ${result.added.length}\nRemoved: ${result.removed.length}\nChanged: ${result.changed.length}`);
  });

program.command("sign-pack")
  .description("Sign a Project Behavior Pack with a local Ed25519 key")
  .argument("<pack-path>", "Pack directory")
  .option("--key-dir <path>", "Signing key directory")
  .option("--json", "Print JSON")
  .action(async (packPath, options) => {
    const result = await signProjectBehaviorPack(packPath, options.keyDir);
    output(options.json, result, `Signed pack ${result.packPath}\nPublic key: ${result.publicKeyPath}`);
  });

program.command("import-pack")
  .description("Import a Project Behavior Pack")
  .argument("<pack-path>", "Pack directory")
  .option("--dry-run", "Plan without writing", true)
  .option("--review", "Write an import review artifact")
  .option("--yes", "Apply import")
  .option("--trust-hooks", "Import hook files too")
  .option("--max-changed-files <number>", "Block import if changed file count exceeds this number", parseIntegerOption)
  .option("--json", "Print JSON")
  .action(async (packPath, options) => {
    const result = await importProjectBehaviorPack(process.cwd(), packPath, { dryRun: options.yes !== true, trustHooks: options.trustHooks === true, review: options.review === true, maxChangedFiles: options.maxChangedFiles });
    output(options.json, result, `${result.status}: ${result.files.length} file(s)${result.reviewPath ? `\nReview: ${result.reviewPath}` : ""}`);
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

program.command("apply-pack")
  .description("Apply a verified Project Behavior Pack when --yes is supplied")
  .argument("<pack-path>", "Pack directory")
  .option("--yes", "Apply import")
  .option("--trust-hooks", "Import hook files too")
  .option("--review", "Write an import review artifact")
  .option("--max-changed-files <number>", "Block import if changed file count exceeds this number", parseIntegerOption)
  .option("--json", "Print JSON")
  .action(async (packPath, options) => {
    const result = await importProjectBehaviorPack(process.cwd(), packPath, { dryRun: options.yes !== true, trustHooks: options.trustHooks === true, review: options.review !== false, maxChangedFiles: options.maxChangedFiles });
    output(options.json, result, `${result.status}: ${result.files.length} file(s)${result.reviewPath ? `\nReview: ${result.reviewPath}` : ""}`);
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

program.command("eval")
  .description("Run deterministic behavior adherence evals")
  .option("--scenarios <path>", "Scenario JSON file")
  .option("--compare-baseline", "Compare baseline replay against OpenSkillKit behavior")
  .option("--mode <mode>", "replay|agent-ab|external-agent", "replay")
  .option("--agent-command <path>", "External agent command for external-agent mode")
  .option("--agent-arg <arg>", "External agent command argument; prompt path is appended", collectOption, [])
  .option("--dry-run", "For external-agent mode, write prompts without executing")
  .option("--json", "Print JSON")
  .action(async (options) => {
    if (options.compareBaseline === true || options.mode === "agent-ab") {
      const result = await runBehaviorCompareEval({ projectRoot: process.cwd(), scenariosPath: options.scenarios });
      output(options.json, result, `Eval compare ${result.status}: improvement ${result.improvement}\nReport: ${result.artifacts.markdown}`);
      process.exitCode = result.status === "fail" ? 1 : 0;
      return;
    }
    if (options.mode === "external-agent") {
      const result = await runExternalAgentEval({
        projectRoot: process.cwd(),
        scenariosPath: options.scenarios,
        agentCommand: options.agentCommand,
        agentArgs: options.agentArg,
        dryRun: options.dryRun === true || !options.agentCommand
      });
      output(options.json, result, `External agent eval ${result.status}: ${result.mode}\nReport: ${result.artifacts.markdown}`);
      process.exitCode = result.status === "fail" ? 1 : 0;
      return;
    }
    if (options.mode !== "replay") throw new Error(`Invalid eval mode: ${options.mode}`);
    const result = await runBehaviorEval({ projectRoot: process.cwd(), scenariosPath: options.scenarios });
    output(options.json, result, `Eval ${result.status}: adherence ${result.adherence}\nReport: ${result.artifacts.markdown}`);
    process.exitCode = result.status === "fail" ? 1 : 0;
  });

program.command("daemon")
  .description("Run one autonomous lifecycle cycle, or watch repeatedly when --watch is set")
  .option("--watch", "Keep running on an interval")
  .option("--interval-ms <number>", "Watch interval in milliseconds", parseIntegerOption, 30000)
  .option("--max-events <number>", "Maximum recent events to summarize", parseIntegerOption, 250)
  .option("--compile-safe", "Compile active preferences when no conflicts exist")
  .option("--json", "Print JSON")
  .action(async (options) => {
    if (options.watch === true) {
      await runLifecycleWatch(options);
      return;
    }
    const result = await runLifecycleOnce({ projectRoot: process.cwd(), maxEvents: options.maxEvents, compileSafe: options.compileSafe === true });
    output(options.json, result, `Lifecycle run: ${result.processedEventCount} event(s), ${result.highValueEvents.length} high-value event(s), ${result.graph.candidateCount} candidate(s)`);
  });

program.command("watch")
  .description("Alias for one autonomous lifecycle cycle")
  .option("--max-events <number>", "Maximum recent events to summarize", parseIntegerOption, 250)
  .option("--compile-safe", "Compile active preferences when no conflicts exist")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await runLifecycleOnce({ projectRoot: process.cwd(), maxEvents: options.maxEvents, compileSafe: options.compileSafe === true });
    output(options.json, result, `Lifecycle run: ${result.processedEventCount} event(s), ${result.highValueEvents.length} high-value event(s), ${result.graph.candidateCount} candidate(s)`);
  });

program.command("reset")
  .description("Reset selected local adaptive state")
  .option("--scope <scope>", "events|signals|reviews|runtime|compiled|installs", collectOption, [])
  .option("--yes", "Apply reset")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const scopes = options.scope.length ? options.scope : ["events", "signals", "reviews", "runtime"];
    const result = await resetProjectState(process.cwd(), scopes, { yes: options.yes === true });
    output(options.json, result, result.messages.join("\n"));
  });

program.command("prune")
  .description("Prune old local run artifacts")
  .option("--keep-runs <number>", "Newest eval runs to keep", parseIntegerOption, 5)
  .option("--yes", "Apply prune")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await pruneProjectState(process.cwd(), { keepRuns: options.keepRuns, yes: options.yes === true });
    output(options.json, result, result.messages.join("\n"));
  });

program.command("archive")
  .description("Archive private event/signal/review/runtime state")
  .option("--yes", "Apply archive")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await archiveProjectState(process.cwd(), { yes: options.yes === true });
    output(options.json, result, result.messages.join("\n"));
  });

program.command("compact")
  .description("Write compact project state summary")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await compactProjectState(process.cwd());
    output(options.json, result, result.messages.join("\n"));
  });

program.command("evolve")
  .description("Draft and verify a skill through the local evolution loop")
  .argument("<topic>", "Skill topic")
  .option("--no-llm", "Do not use LLM provider", true)
  .option("--evidence-file <path>", "Add a local evidence file to the ledger", collectOption, [])
  .option("--evidence-url <url>", "Fetch an explicit HTTP(S) evidence URL", collectOption, [])
  .option("--max-rounds <number>", "Maximum deterministic evolution rounds", parseIntegerOption)
  .option("--run-repo-checks", "Execute repository command checks during evolution")
  .option("--json", "Print JSON")
  .action(async (topic, options) => {
    const result = await evolveSkill({ topic, projectRoot: process.cwd(), noLlm: options.llm === false, evidenceFiles: options.evidenceFile, evidenceUrls: options.evidenceUrl, maxRounds: options.maxRounds, runRepoChecks: options.runRepoChecks === true });
    output(options.json, result, `evolve ${result.status}: ${result.skillName}\nRun: ${result.runDir}`);
    process.exitCode = result.status === "needs-refinement" ? 1 : 0;
  });

program.command("audit")
  .description("Run safety scanner against a skill package")
  .argument("<skill-path>", "Skill directory or SKILL.md")
  .option("--json", "Print JSON")
  .action(async (skillPath, options) => {
    const report = await scanSkillPath(skillPath);
    output(options.json, report, `Audit ${report.status}: ${report.findings.length} finding(s), score ${report.score}`);
    process.exitCode = report.status === "fail" ? 1 : 0;
  });

program.command("test")
  .description("Validate and verify a skill package")
  .argument("<skill-path>", "Skill directory or SKILL.md")
  .option("--run-repo-checks", "Execute repository command checks from verifier pack")
  .option("--json", "Print JSON")
  .action(async (skillPath, options) => {
    const reportDir = path.join(".openskill-kit", "reports", path.basename(path.resolve(skillPath)));
    const report = await verifySkill(skillPath, reportDir, undefined, { runRepoChecks: options.runRepoChecks === true });
    output(options.json, report, `Verifier ${report.status}: safety ${report.scores.safety}, structure ${report.scores.structure}\nReport: ${report.reportPath ?? reportDir}`);
    process.exitCode = report.status === "fail" ? 1 : 0;
  });

program.command("evaluate")
  .description("Write a leakage-aware evaluation report for a skill package")
  .argument("<skill-path>", "Skill directory or SKILL.md")
  .option("--run-repo-checks", "Execute repository command checks from verifier pack")
  .option("--json", "Print JSON")
  .action(async (skillPath, options) => {
    const report = await evaluateSkill(skillPath, { runRepoChecks: options.runRepoChecks === true });
    output(options.json, report, `Evaluation ${report.status}: verifier ${report.verifierStatus}, leakage ${report.leakageStatus}\nReport: ${report.artifacts.evaluation}`);
    process.exitCode = report.status === "fail" ? 1 : 0;
  });

program.command("install")
  .description("Install a skill to an agent target")
  .argument("[skill-path]", "Skill directory or SKILL.md; defaults to compiled project behavior skill")
  .requiredOption("--target <target>", "local-project|local-global|agents-project|agents-global")
  .option("--dry-run", "Plan without writing")
  .option("--yes", "Non-interactive approval")
  .option("--no-tui", "Accepted for non-interactive environments")
  .option("--allow-critical-risk", "Allow install despite critical scanner findings")
  .option("--json", "Print JSON")
  .action(async (skillPath, options) => {
    const resolvedSkillPath = skillPath ?? path.join(process.cwd(), ".openskill-kit", "compiled", "skills", "project-behavior");
    const result = await installSkill({
      skillPath: resolvedSkillPath,
      target: parseTarget(options.target),
      projectRoot: process.cwd(),
      dryRun: options.dryRun,
      yes: options.yes,
      allowCriticalRisk: options.allowCriticalRisk
    });
    output(options.json, result, result.messages.join("\n"));
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

program.command("uninstall")
  .description("Remove a skill from an agent target")
  .argument("<skill-name>", "Skill name")
  .requiredOption("--target <target>", "local-project|local-global|agents-project|agents-global")
  .option("--dry-run", "Plan without writing")
  .option("--yes", "Non-interactive approval")
  .option("--no-tui", "Accepted for non-interactive environments")
  .option("--json", "Print JSON")
  .action(async (skillName, options) => {
    const result = await uninstallSkill({
      skillName,
      target: parseTarget(options.target),
      projectRoot: process.cwd(),
      dryRun: options.dryRun
    });
    output(options.json, result, result.messages.join("\n"));
  });

program.command("list")
  .description("List local registry entries")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const registry = await readRegistry(process.cwd());
    output(options.json, registry, registry.skills.map((skill) => `${skill.name} ${skill.status}`).join("\n") || "No skills registered");
  });

program.command("inspect")
  .description("Inspect a skill by path")
  .argument("<skill-name-or-path>", "Skill path or registered name")
  .option("--json", "Print JSON")
  .action(async (value, options) => {
    const candidatePath = await resolveSkillArg(value);
    const pkg = await loadSkillPackage(candidatePath);
    output(options.json, pkg, `${pkg.manifest.name}: ${pkg.manifest.description}\n${pkg.root}`);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function output(json: boolean | undefined, data: unknown, text: string): void {
  if (json) console.log(JSON.stringify(sanitizeForOutput(data), null, 2));
  else console.log(sanitizeText(text));
}

function parseTarget(value: string): InstallTarget {
  const legacyProject = ["open", "code-project"].join("");
  const legacyGlobal = ["open", "code-global"].join("");
  const normalized = value === legacyProject ? "local-project" : value === legacyGlobal ? "local-global" : value;
  const targets = new Set(["local-project", "local-global", "agents-project", "agents-global"]);
  if (!targets.has(normalized)) throw new Error(`Invalid target: ${value}`);
  return normalized as InstallTarget;
}

function parseAgentHookTarget(value: string): "project" | "global" {
  if (value === "project" || value === "global") return value;
  throw new Error(`Invalid agent hook target: ${value}`);
}

function parseManifestTarget(value: string): "project" {
  if (value === "project") return value;
  throw new Error(`Invalid manifest target: ${value}`);
}

function parseCompileTarget(value: string): CompileTarget {
  if ((CompileTargets as readonly string[]).includes(value)) return value as CompileTarget;
  throw new Error(`Invalid compile target: ${value}. Expected one of: ${CompileTargets.join(", ")}`);
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function flatRepeat(flag: string, values: string[]): string[] {
  return values.flatMap((value) => [flag, value]);
}

function parseIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function parseFloatOption(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

async function resolvePassphrase(options: { passphrase?: string; passphraseFile?: string }): Promise<string> {
  const value = options.passphraseFile
    ? await fs.readFile(path.resolve(options.passphraseFile), "utf8").then((text) => text.trim())
    : options.passphrase;
  if (!value) throw new Error("Passphrase required. Use --passphrase-file or --passphrase.");
  if (value.length < 8) throw new Error("Passphrase must be at least 8 characters.");
  return value;
}

async function resolveSkillArg(value: string): Promise<string> {
  if (value.includes("/") || value.includes("\\") || value.endsWith(".md")) return value;
  const registry = await readRegistry(process.cwd());
  const found = registry.skills.find((skill) => skill.name === value);
  if (!found) throw new Error(`Skill not found in registry: ${value}`);
  return found.sourcePath;
}

async function runLifecycleWatch(options: { intervalMs: number; maxEvents: number; compileSafe?: boolean; json?: boolean }): Promise<void> {
  while (true) {
    const result = await runLifecycleOnce({ projectRoot: process.cwd(), maxEvents: options.maxEvents, compileSafe: options.compileSafe === true });
    output(options.json, result, `Lifecycle run: ${result.processedEventCount} event(s), ${result.highValueEvents.length} high-value event(s), ${result.graph.candidateCount} candidate(s)`);
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

async function runReviewTui(projectRoot: string): Promise<{ schemaVersion: "openskill-kit.review-tui.v1"; reviewed: number; messages: string[] }> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let reviewed = 0;
  const messages: string[] = [];
  try {
    while (true) {
      const queue = await buildReviewQueue(projectRoot);
      const candidates = queue.candidates;
      printReviewScreen(candidates);
      const answer = (await rl.question("review> ")).trim();
      if (answer === "q" || answer === "quit" || answer === "exit") break;
      if (answer === "w" || answer === "write") {
        messages.push(`Review queue written: ${queue.markdownPath}`);
        break;
      }
      if (answer === "?" || answer === "help") {
        printReviewHelp();
        continue;
      }
      if (answer === "c" || answer === "calibration") {
        await printCalibrationDashboard(projectRoot);
        continue;
      }
      const inspectMatch = /^(e|evidence|p|preview)\s+(\d+)$/i.exec(answer);
      if (inspectMatch) {
        const index = Number.parseInt(inspectMatch[2]!, 10) - 1;
        const node = candidates[index];
        if (!node) {
          console.log(`No candidate #${index + 1}`);
          continue;
        }
        if (inspectMatch[1]!.toLowerCase().startsWith("p")) printCompilePreview(node);
        else await printEvidencePreview(projectRoot, node);
        continue;
      }
      const match = /^(a|activate|r|reject|l|lock|d|demote)\s+(\d+)$/i.exec(answer);
      if (!match) {
        console.log("Use: a 1, r 1, l 1, d 1, e 1, p 1, c, w, q, ?");
        continue;
      }
      const index = Number.parseInt(match[2]!, 10) - 1;
      const node = candidates[index];
      if (!node) {
        console.log(`No candidate #${index + 1}`);
        continue;
      }
      const command = match[1]!.toLowerCase();
      const action = command.startsWith("a") ? { activate: [node.id] }
        : command.startsWith("r") ? { reject: [node.id] }
          : command.startsWith("l") ? { lock: [node.id] }
            : { demote: [node.id] };
      await applyPreferenceReview(projectRoot, action);
      reviewed += 1;
      messages.push(`${Object.keys(action)[0]} ${node.id}`);
    }
  } finally {
    rl.close();
  }
  return { schemaVersion: "openskill-kit.review-tui.v1", reviewed, messages: messages.length ? messages : ["Review TUI closed without changes"] };
}

function printReviewScreen(candidates: Array<{ id: string; status: string; category: string; confidence: number; statement: string; scope: { level: string; paths: string[] } }>): void {
  console.clear();
  console.log("OpenSkillKit Review");
  console.log("===================");
  if (!candidates.length) {
    console.log("No candidate or conflict preferences.");
    console.log("q quit");
    return;
  }
  for (const [index, node] of candidates.entries()) {
    const scope = node.scope.paths.length ? `${node.scope.level}:${node.scope.paths.join(",")}` : node.scope.level;
    console.log(`${index + 1}. [${node.status}] ${node.category} ${node.confidence} ${scope}`);
    console.log(`   ${node.statement}`);
  }
  console.log("");
  console.log("a N activate | r N reject | l N lock | d N demote | e N evidence | p N preview | c calibration | w write queue | q quit | ? help");
}

function printReviewHelp(): void {
  console.log("Commands:");
  console.log("  a 1  activate candidate 1");
  console.log("  r 1  reject candidate 1");
  console.log("  l 1  lock candidate 1");
  console.log("  d 1  demote candidate 1");
  console.log("  e 1  show sanitized evidence cards for candidate 1");
  console.log("  p 1  show compile/privacy preview for candidate 1");
  console.log("  c    show calibration reliability dashboard");
  console.log("  w    write review queue artifacts and exit");
  console.log("  q    quit");
}

async function printEvidencePreview(projectRoot: string, node: { id: string; evidence: Array<{ signalId: string; eventIds: string[]; cardIds?: string[]; quote?: string; command?: string }> }): Promise<void> {
  const cards = await readEvidenceCards(projectRoot, node.evidence.flatMap((item) => item.cardIds ?? []));
  console.log("");
  console.log(`Evidence for ${node.id}`);
  console.log("----------------");
  if (!cards.length) {
    for (const item of node.evidence) {
      console.log(`- signal ${item.signalId}; events ${item.eventIds.join(", ")}`);
      if (item.quote) console.log(`  quote: ${sanitizeText(item.quote)}`);
      if (item.command) console.log(`  command: ${sanitizeText(item.command)}`);
    }
    return;
  }
  for (const card of cards) {
    console.log(`- ${card.id} ${card.kind} ${card.privacyClass} ${card.hash}`);
    console.log(`  ${sanitizeText(card.summary)}`);
    if (card.paths.length) console.log(`  paths: ${card.paths.map(sanitizeText).join(", ")}`);
    if (card.commands.length) console.log(`  commands: ${card.commands.map(sanitizeText).join(", ")}`);
    if (card.quote) console.log(`  quote: ${sanitizeText(card.quote).slice(0, 240)}`);
    if (card.privacy.redacted) console.log(`  redacted: ${card.privacy.matches.join(", ") || "yes"}`);
  }
}

function printCompilePreview(node: { id: string; strength?: string; privacy?: { class: string; rationale: string }; compileTargets?: string[]; lifecycle?: { state: string }; scope: { level: string; paths: string[] } }): void {
  console.log("");
  console.log(`Compile preview for ${node.id}`);
  console.log("---------------------------");
  console.log(`strength: ${node.strength ?? "not inferred"}`);
  console.log(`privacy: ${node.privacy?.class ?? "not inferred"}`);
  if (node.privacy?.rationale) console.log(`privacy rationale: ${node.privacy.rationale}`);
  console.log(`targets: ${node.compileTargets?.join(", ") || "not inferred"}`);
  console.log(`lifecycle: ${node.lifecycle?.state ?? "candidate"}`);
  console.log(`scope: ${node.scope.level}${node.scope.paths.length ? ` (${node.scope.paths.join(", ")})` : ""}`);
}

async function printCalibrationDashboard(projectRoot: string): Promise<void> {
  const report = await readCalibrationReport(projectRoot).catch(() => undefined);
  console.log("");
  console.log("Calibration");
  console.log("-----------");
  if (!report) {
    console.log("No calibration data yet.");
    return;
  }
  printCalibrationSection("Categories", report.categories);
  printCalibrationSection("Extractors", report.extractors);
  printCalibrationSection("Scopes", report.scopes);
  printCalibrationSection("Evidence", report.evidenceKinds);
  printCalibrationSection("Privacy", report.privacyClasses);
  printCalibrationSection("Evals", report.evalOutcomes);
}

function printCalibrationSection(title: string, buckets: Record<string, { accepted: number; locked: number; rejected: number; demoted: number; reliability: number }>): void {
  const entries = Object.entries(buckets).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`${title}:`);
  if (!entries.length) {
    console.log("  none");
    return;
  }
  for (const [name, bucket] of entries.slice(0, 8)) {
    console.log(`  ${name}: ${bucket.reliability} (+${bucket.accepted + bucket.locked}/-${bucket.rejected + bucket.demoted})`);
  }
}

function sanitizeForOutput(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForOutput(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeForOutput(nested)]));
  }
  return value;
}

function sanitizeText(value: string): string {
  const cwd = process.cwd();
  return value
    .replaceAll(cwd, ".")
    .replaceAll(path.normalize(cwd), ".");
}
