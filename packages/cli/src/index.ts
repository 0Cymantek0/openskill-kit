#!/usr/bin/env node
import { Command, Option } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  appendEvent,
  applyPreferenceReview,
  applyWorkflowReview,
  attachAgentPlugin,
  compileBehaviorLayer,
  detectAgentEnvironment,
  draftSkill,
  evaluateSkill,
  explainPreference,
  exportProjectBehaviorPack,
  exportEncryptedProjectBehaviorPack,
  extractSignals,
  evolveSkill,
  explainAdaptiveStatus,
  getAdaptiveStatus,
  getAgentTaskContext,
  finishAgentTask,
  explainPreferenceWithEvidence,
  installAgentHooks,
  getAgentPluginAttachStatus,
  installInstructionManifests,
  uninstallInstructionManifests,
  initAdaptiveProject,
  initOpenWorldTask,
  importProjectBehaviorPack,
  importEncryptedProjectBehaviorPack,
  importInteractionSource,
  installSkill,
  inspectProjectBehaviorPack,
  loadSkillPackage,
  buildReviewQueue,
  buildOpenWorldEvalReport,
  buildOpenWorldHiddenOracleHarness,
  proposeSemanticPreference,
  retrieveRelevantPreferences,
  auditOpenWorldLeakage,
  buildVirtualSuiteFromAnchors,
  assessOpenWorldVerifierQuality,
  draftAnchorFromOpenWorldSource,
  buildOpenWorldRetrievalAdapters,
  executeOpenWorldResearchPlan,
  generateOpenWorldCandidateSkill,
  ingestLocalOpenWorldSource,
  ingestWebOpenWorldSource,
  planOpenWorldResearch,
  readOpenWorldTask,
  buildOpenWorldTaskReport,
  readOpenWorldSourceIndex,
  readOpenWorldTrustCache,
  promoteOpenWorldRunToReview,
  routeBehavior,
  runOpenWorldCandidateRepairLoop,
  runOpenWorldRefinement,
  runVirtualTestSuite,
  runOpenWorldPython,
  runOpenWorldDoctor,
  mineWorkflowGraph,
  readProjectConfig,
  readWorkflowGraph,
  renderWorkflowGraph,
  runAgentDoctor,
  runLifecycleOnce,
  readRegistry,
  readCalibrationReport,
  readInteractionImportRuns,
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
  AgentPluginAttachHosts,
  type CompileTarget,
  type AgentPluginAttachHost,
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
    output(options.json, status, [
      `Initialized: ${status.initialized}`,
      `Events: ${status.eventCount}`,
      `Signals: ${status.signalCount}`,
      `Active preferences: ${status.activePreferenceCount}`,
      `Staged preferences: ${status.stagedPreferenceCount}`,
      `Active workflows: ${status.activeWorkflowCount}`,
      `Staged workflows: ${status.stagedWorkflowCount}`,
      `Pending review: ${status.pendingReviewCount}`,
      `Plugin ready: ${status.compiled.plugin}`,
      `Plugin: ${status.compiled.pluginStatus.pluginDir}`,
      status.compiled.plugin
        ? [
          `Plugin MCP: ${status.compiled.pluginStatus.mcpServerCommand}`,
          `Plugin commands: ${status.compiled.pluginStatus.commands.length}`,
          `Plugin command map: ${status.compiled.pluginStatus.commandMapPath}`,
          `Plugin host attached: ${status.compiled.pluginAttachment.attached}`,
          `Plugin host status: ${status.compiled.pluginAttachment.hosts.map((host) => `${host.host}=${host.status}`).join(", ")}`
        ].join("\n")
        : status.compiled.pluginStatus.integrityIssues.length
          ? `Plugin integrity issues: ${status.compiled.pluginStatus.integrityIssues.join("; ")}`
          : `Plugin missing: ${status.compiled.pluginStatus.missing.join(", ")}`
    ].join("\n"));
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

program.command("detect")
  .description("Detect project and optional user agent surfaces without importing private logs")
  .option("--include-user-surfaces", "Include user/global agent surfaces as metadata-only records")
  .option("--include-sensitive-preview", "Allow content metadata inspection for sensitive/user surfaces")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await detectAgentEnvironment(process.cwd(), {
      includeUserSurfaces: options.includeUserSurfaces === true,
      includeSensitivePreview: options.includeSensitivePreview === true
    });
    output(options.json, result, [
      `Detected ${result.summary.total} agent surface(s)`,
      `Managed-block writable: ${result.summary.writableManagedBlocks}`,
      `Preview-only: ${result.summary.previewOnly}`,
      `Metadata-only: ${result.summary.metadataOnly}`,
      `Issues: ${result.summary.issueCount} (${result.summary.warningCount} warning)`,
      result.artifacts.reportPath ? `Report: ${result.artifacts.reportPath}` : undefined
    ].filter(Boolean).join("\n"));
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

openworld.command("source-plan")
  .description("Plan leakage-audited local source candidates and sanitized OpenWorld research queries")
  .requiredOption("--task-id <id>", "Task id")
  .option("--query <text>", "Extra task query")
  .option("--path <path>", "Restrict candidate discovery to project path", collectOption, [])
  .option("--max-candidates <number>", "Maximum source candidates", parseIntegerOption, 8)
  .option("--max-files <number>", "Maximum files to scan", parseIntegerOption, 250)
  .option("--no-autonomous-web-candidates", "Do not add deterministic docs/repo web candidates")
  .option("--no-write", "Do not write the plan artifact")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await planOpenWorldResearch(process.cwd(), options.taskId, {
      query: options.query,
      paths: options.path,
      maxCandidates: options.maxCandidates,
      maxFilesScanned: options.maxFiles,
      includeAutonomousWebCandidates: options.autonomousWebCandidates !== false,
      write: options.write !== false
    });
    output(options.json, result, [
      `OpenWorld source plan ${result.id}`,
      `Candidates: ${result.summary.candidateCount} (${result.summary.recommendedCount} recommended, ${result.summary.blockedCount} blocked)`,
      result.planPath ? `Plan: ${result.planPath}` : undefined,
      result.leakageAuditPath ? `Leakage audit: ${result.leakageAuditPath}` : undefined,
      ...result.recommendedNextCommands.slice(0, 6)
    ].filter(Boolean).join("\n"));
  });

openworld.command("retrieval-adapters")
  .description("List OpenWorld retrieval adapters, gates, limits, and safeguards for a task")
  .requiredOption("--task-id <id>", "Task id")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const task = await readOpenWorldTask(process.cwd(), options.taskId);
    const adapters = buildOpenWorldRetrievalAdapters(task);
    output(options.json, { schemaVersion: "openskill-kit.openworld-retrieval-adapters.v1", taskId: task.id, adapters }, adapters
      .map((adapter) => `${adapter.id} ${adapter.status} network=${adapter.networkAccess}${adapter.timeoutMs ? ` timeoutMs=${adapter.timeoutMs}` : ""}${adapter.maxBytes ? ` maxBytes=${adapter.maxBytes}` : ""}`)
      .join("\n"));
  });

openworld.command("execute-source-plan")
  .description("Execute a leakage-audited OpenWorld source plan by ingesting recommended local sources and explicit vetted URLs")
  .requiredOption("--task-id <id>", "Task id")
  .option("--plan-id <id>", "Research plan id; defaults to latest plan")
  .option("--include-available", "Also ingest available non-recommended local candidates")
  .option("--max-local <number>", "Maximum local sources to ingest", parseIntegerOption, 5)
  .option("--include-autonomous-web", "Fetch deterministic docs/repo candidates from the source plan")
  .option("--max-autonomous-web <number>", "Maximum autonomous web candidates to fetch", parseIntegerOption, 3)
  .option("--url <url>", "Explicit HTTP(S) source URL to register", collectOption, [])
  .option("--title <title>", "Title for explicit URL, aligned by order with --url", collectOption, [])
  .option("--content-file <path>", "Cached text for explicit URL, aligned by order with --url", collectOption, [])
  .option("--timeout-ms <number>", "Fetch timeout for explicit URLs without content files", parseIntegerOption, 12000)
  .option("--max-bytes <number>", "Maximum fetched text size", parseIntegerOption, 1000000)
  .option("--dry-run", "Show planned ingestion without writing source artifacts")
  .option("--no-write", "Do not write execution artifact")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const explicitWebSources = await Promise.all(options.url.map(async (url: string, index: number) => ({
      url,
      title: options.title[index],
      content: options.contentFile[index] ? await fs.readFile(path.resolve(options.contentFile[index]), "utf8") : undefined,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes
    })));
    const result = await executeOpenWorldResearchPlan(process.cwd(), options.taskId, {
      planId: options.planId,
      includeAvailable: options.includeAvailable === true,
      maxLocalSources: options.maxLocal,
      includeAutonomousWeb: options.includeAutonomousWeb === true,
      maxAutonomousWebSources: options.maxAutonomousWeb,
      explicitWebSources,
      dryRun: options.dryRun === true,
      write: options.write !== false
    });
    output(options.json, result, [
      `OpenWorld research execution ${result.execution.id}: ${result.execution.status}`,
      `Ingested: ${result.execution.summary.ingestedCount}`,
      `Skipped: ${result.execution.summary.skippedCount}`,
      `Errors: ${result.execution.summary.errorCount}`,
      result.execution.executionPath ? `Execution: ${result.execution.executionPath}` : undefined,
      result.execution.markdownPath ? `Report: ${result.execution.markdownPath}` : undefined
    ].filter(Boolean).join("\n"));
    process.exitCode = result.execution.status === "blocked" ? 1 : 0;
  });

openworld.command("fetch-source")
  .description("Fetch or register an explicit web source for an OpenWorld task")
  .requiredOption("--task-id <id>", "Task id")
  .requiredOption("--url <url>", "HTTP(S) source URL")
  .option("--title <title>", "Source title")
  .option("--content-file <path>", "Use local text content instead of network fetch")
  .option("--timeout-ms <number>", "Fetch timeout", parseIntegerOption, 12000)
  .option("--max-bytes <number>", "Maximum fetched text size", parseIntegerOption, 1000000)
  .option("--json", "Print JSON")
  .action(async (options) => {
    const content = options.contentFile ? await fs.readFile(path.resolve(options.contentFile), "utf8") : undefined;
    const result = await ingestWebOpenWorldSource(process.cwd(), options.taskId, {
      url: options.url,
      title: options.title,
      content,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes
    });
    output(options.json, result, `OpenWorld source ${result.source.id}\n${result.sourcePath}`);
  });

openworld.command("sources")
  .description("List OpenWorld source index and trust cache")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const index = await readOpenWorldSourceIndex(process.cwd());
    const trust = await readOpenWorldTrustCache(process.cwd());
    output(options.json, { index, trust }, index.entries.length
      ? index.entries.map((entry) => `${entry.sourceId} ${entry.kind} trust=${entry.trustScore} ${entry.uri}`).join("\n")
      : "No OpenWorld sources indexed");
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

openworld.command("candidate-skill")
  .description("Generate a review-only OpenWorld candidate skill from Anchor Cards")
  .requiredOption("--task-id <id>", "Task id")
  .requiredOption("--anchor-id <id>", "Anchor id", collectOption, [])
  .option("--suite-id <id>", "Related virtual suite id", collectOption, [])
  .option("--name <name>", "Candidate skill name")
  .option("--no-write", "Do not write candidate artifacts")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await generateOpenWorldCandidateSkill(process.cwd(), options.taskId, {
      anchorIds: options.anchorId,
      suiteIds: options.suiteId,
      name: options.name,
      write: options.write !== false
    });
    output(options.json, result, [
      `OpenWorld candidate skill ${result.candidate.id}: ${result.candidate.status}`,
      `Skill: ${result.candidate.skillName}`,
      `Anchors: ${result.candidate.anchorIds.length}`,
      `Safety: ${result.candidate.safety.status} ${result.candidate.safety.score}`,
      result.candidate.artifacts.skillPath ? `SKILL.md: ${result.candidate.artifacts.skillPath}` : undefined,
      result.candidate.artifacts.candidatePath ? `Candidate: ${result.candidate.artifacts.candidatePath}` : undefined
    ].filter(Boolean).join("\n"));
    process.exitCode = result.candidate.status === "blocked" ? 1 : 0;
  });

openworld.command("repair-candidate")
  .description("Run a local sandbox repair loop for an OpenWorld candidate skill revision")
  .requiredOption("--task-id <id>", "Task id")
  .requiredOption("--candidate-id <id>", "Candidate skill id")
  .option("--suite-id <id>", "Related virtual suite id")
  .option("--failure-type <type>", "Failure type to record")
  .option("--note <text>", "Repair diagnosis note", collectOption, [])
  .option("--sandbox <mode>", "local-process|docker", "local-process")
  .option("--docker-image <image>", "Docker image for --sandbox docker")
  .option("--max-rounds <number>", "Maximum repair rounds", parseIntegerOption, 1)
  .option("--timeout-ms <number>", "Probe timeout", parseIntegerOption, 30000)
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await runOpenWorldCandidateRepairLoop(process.cwd(), options.taskId, {
      candidateSkillId: options.candidateId,
      suiteId: options.suiteId,
      failureType: options.failureType,
      notes: options.note,
      sandboxMode: parseSandboxMode(options.sandbox),
      dockerImage: options.dockerImage,
      maxRounds: options.maxRounds,
      timeoutMs: options.timeoutMs
    });
    output(options.json, result, `OpenWorld candidate repair ${result.run.status}: ${result.run.rounds.length} round(s)\n${result.run.artifacts.repairRunPath ?? result.repairRunPath}`);
    process.exitCode = result.run.status === "passed" ? 0 : 1;
  });

openworld.command("run-verifier")
  .description("Run an executable OpenWorld virtual verifier suite in the local sandbox")
  .requiredOption("--task-id <id>", "Task id")
  .requiredOption("--suite-id <id>", "Virtual test suite id")
  .option("--split <split>", "visible|holdout|all", "visible")
  .option("--sandbox <mode>", "local-process|docker", "local-process")
  .option("--docker-image <image>", "Docker image for --sandbox docker")
  .option("--timeout-ms <number>", "Per-case timeout", parseIntegerOption, 30000)
  .option("--json", "Print JSON")
  .action(async (options) => {
    const split = parseVerifierSplit(options.split);
    const result = await runVirtualTestSuite(process.cwd(), options.taskId, options.suiteId, {
      split,
      sandboxMode: parseSandboxMode(options.sandbox),
      dockerImage: options.dockerImage,
      timeoutMs: options.timeoutMs
    });
    output(options.json, result, `OpenWorld verifier ${result.suiteId} ${result.split}: ${result.summary.pass} pass, ${result.summary.fail} fail, ${result.summary.blocked} blocked, ${result.summary.timeout} timeout, ${result.summary.skipped} skipped\n${result.resultPath ?? ""}`);
    process.exitCode = result.summary.fail || result.summary.blocked || result.summary.timeout ? 1 : 0;
  });

openworld.command("verifier-quality")
  .description("Score an OpenWorld verifier suite for traceability, determinism, holdout coverage, and leakage metadata")
  .requiredOption("--task-id <id>", "Task id")
  .requiredOption("--suite-id <id>", "Virtual test suite id")
  .option("--no-write", "Do not write report artifacts")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await assessOpenWorldVerifierQuality(process.cwd(), options.taskId, options.suiteId, {
      write: options.write !== false
    });
    output(options.json, result, [
      `OpenWorld verifier quality ${result.report.status}`,
      `Cases: ${result.report.metrics.caseCount}; holdout: ${result.report.metrics.holdoutCount}`,
      `Traceability: ${Math.round(result.report.metrics.traceabilityScore * 1000) / 10}%`,
      `Determinism: ${Math.round(result.report.metrics.determinismScore * 1000) / 10}%`,
      result.report.reportPath ? `Report: ${result.report.reportPath}` : undefined,
      result.report.markdownPath ? `Markdown: ${result.report.markdownPath}` : undefined
    ].filter(Boolean).join("\n"));
    process.exitCode = result.report.status === "fail" ? 1 : 0;
  });

openworld.command("refine")
  .description("Run bounded OpenWorld visible refinement and final holdout check")
  .requiredOption("--task-id <id>", "Task id")
  .requiredOption("--suite-id <id>", "Virtual test suite id")
  .option("--candidate-id <id>", "Candidate skill id to associate with refinement and revise on visible failure")
  .option("--sandbox <mode>", "local-process|docker", "local-process")
  .option("--docker-image <image>", "Docker image for --sandbox docker")
  .option("--max-rounds <number>", "Maximum visible refinement rounds", parseIntegerOption, 3)
  .option("--timeout-ms <number>", "Per-case timeout", parseIntegerOption, 30000)
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await runOpenWorldRefinement(process.cwd(), options.taskId, options.suiteId, {
      maxRounds: options.maxRounds,
      timeoutMs: options.timeoutMs,
      candidateSkillId: options.candidateId,
      sandboxMode: parseSandboxMode(options.sandbox),
      dockerImage: options.dockerImage
    });
    output(options.json, result, `OpenWorld refinement ${result.status}: ${result.rounds.length} round(s)\n${path.join(".openskill-kit", "evolution", "runs", result.id, "run.json")}`);
    process.exitCode = result.status === "passed" ? 0 : 1;
  });

openworld.command("eval-report")
  .description("Write an OpenWorld evaluation report for an EvolutionRun")
  .requiredOption("--run-id <id>", "OpenWorld evolution run id")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await buildOpenWorldEvalReport(process.cwd(), options.runId);
    output(options.json, result, `OpenWorld eval ${result.report.status}: ${result.report.proofLevel}\n${result.reportPath}\n${result.markdownPath}`);
    process.exitCode = result.report.status === "fail" ? 1 : 0;
  });

openworld.command("hidden-oracle-harness")
  .description("Write a static denied-path hidden-oracle harness report without reading oracle contents")
  .requiredOption("--task-id <id>", "Task id")
  .option("--suite-id <id>", "Verifier suite id")
  .option("--denied-path <path>", "Extra denied oracle path to hash and scan for", collectOption, [])
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await buildOpenWorldHiddenOracleHarness(process.cwd(), options.taskId, {
      suiteId: options.suiteId,
      deniedPaths: options.deniedPath
    });
    output(options.json, result, `OpenWorld hidden-oracle harness ${result.harness.status}: ${result.harness.proofLevel}\n${result.harnessPath}\n${result.markdownPath}`);
    process.exitCode = result.harness.status === "fail" ? 1 : 0;
  });

openworld.command("promote-review")
  .description("Create a review-only preference proposal from a passed OpenWorld run")
  .requiredOption("--run-id <id>", "OpenWorld evolution run id")
  .option("--statement <text>", "Override generated proposal statement")
  .option("--category <category>", "Override proposal category")
  .option("--dry-run", "Plan without writing event/proposal")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await promoteOpenWorldRunToReview(process.cwd(), options.runId, {
      statement: options.statement,
      category: options.category,
      dryRun: options.dryRun === true
    });
    output(options.json, result, result.messages.join("\n"));
  });

openworld.command("report")
  .description("Render a Markdown report for an OpenWorld task with collected artifacts")
  .requiredOption("--task-id <id>", "Task id")
  .option("--write", "Write report to the task reports directory")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await buildOpenWorldTaskReport(process.cwd(), options.taskId, { write: options.write === true });
    output(options.json, result, options.write === true && result.markdownPath ? `OpenWorld task report written\n${result.markdownPath}` : result.markdown);
  });

openworld.command("doctor")
  .description("Explain current OpenWorld scaffold capabilities and missing paper-level pieces")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const report = await runOpenWorldDoctor(process.cwd());
    output(options.json, report, [
      `OpenWorld doctor ${report.status}: ${report.capabilities.length} capabilities`,
      ...report.capabilities.map((capability) => `${capability.status}: ${capability.name}`)
    ].join("\n"));
    process.exitCode = report.status === "fail" ? 1 : 0;
  });

const agent = program.command("agent")
  .description("Inspect and install local agent adapters");

agent.command("doctor")
  .description("Check adaptive agent hook readiness")
  .option("--deep", "Also run agent environment detection")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const report = await runAgentDoctor(process.cwd());
    if (options.deep === true) {
      const detection = await detectAgentEnvironment(process.cwd());
      output(options.json, { report, detection }, `Agent doctor ${report.status}: ${report.checks.length} checks\nDetected ${detection.summary.total} agent surface(s)`);
      process.exitCode = report.status === "fail" ? 1 : 0;
      return;
    }
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

agent.command("attach-plugin")
  .description("Preview or write host MCP config for the compiled OpenSkillKit plugin")
  .option("--host <host>", "codex|claude-code|cursor|generic-mcp", "generic-mcp")
  .option("--dry-run", "Plan without writing")
  .option("--yes", "Non-interactive approval")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await attachAgentPlugin(process.cwd(), {
      host: parseAgentPluginAttachHost(options.host),
      dryRun: options.dryRun === true,
      yes: options.yes === true
    });
    output(options.json, result, result.messages.join("\n"));
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

agent.command("plugin-status")
  .description("Show compiled plugin host attachment health")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await getAgentPluginAttachStatus(process.cwd());
    output(options.json, result, [
      `Plugin host attached: ${result.attached}`,
      `Plugin host status: ${result.hosts.map((host) => `${host.host}=${host.status}`).join(", ")}`,
      `Plugin attach receipts: ${result.receiptCount}`,
      ...result.nextActions
    ].join("\n"));
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
    output(options.json, { signals, graph }, `Learned ${signals.signalCount} signal(s)\nPending review: ${graph.candidateCount}`);
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
  .option("--workflow-activate <id>", "Activate workflow candidate id", collectOption, [])
  .option("--workflow-reject <id>", "Reject workflow candidate id", collectOption, [])
  .option("--workflow-lock <id>", "Lock workflow candidate id", collectOption, [])
  .option("--workflow-demote <id>", "Move active or locked workflow back to candidate", collectOption, [])
  .option("--workflow-activate-all", "Activate all workflow candidates")
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
    const workflowReview = options.workflowActivate.length || options.workflowReject.length || options.workflowLock.length || options.workflowDemote.length || options.workflowActivateAll === true
      ? await applyWorkflowReview(process.cwd(), {
        activate: options.workflowActivate,
        reject: options.workflowReject,
        lock: options.workflowLock,
        demote: options.workflowDemote,
        activateAll: options.workflowActivateAll === true
      })
      : undefined;
    const pending = graph.nodes.filter((node) => node.status === "candidate" || node.status === "staged" || node.status === "conflict");
    output(options.json, workflowReview ? { preferences: graph, workflows: workflowReview } : graph, [
      pending.length ? pending.map((node) => `${node.id} ${node.status} ${node.statement}`).join("\n") : "No pending preferences",
      workflowReview ? `Workflow review updated ${workflowReview.reviewedCount} node(s)` : undefined
    ].filter(Boolean).join("\n"));
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
  .option("--include-staged-preview", "Also write review-only staged preference preview")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const targets = options.target.length ? options.target.map(parseCompileTarget) : undefined;
    const result = await compileBehaviorLayer(process.cwd(), { targets, includeStagedPreview: options.includeStagedPreview === true });
    output(options.json, result, [
      `Compiled behavior layer: ${result.compiledTargets.join(", ")}`,
      result.contextPackPath ? `Context: ${result.contextPackPath}` : undefined,
      result.skillPaths.length ? `Skill: ${result.skillPaths.join(", ")}` : undefined,
      result.manifestPaths.length ? `Manifests: ${result.manifestPaths.join(", ")}` : undefined,
      result.pluginManifestPath ? `Plugin: ${result.pluginManifestPath}` : undefined,
      result.stagedPreviewPath ? `Staged preview: ${result.stagedPreviewPath}` : undefined
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

program.command("route")
  .description("Plan whether a task should use local behavior, project evidence, review, or OpenWorld research")
  .option("--query <text>", "Task or question text")
  .option("--path <path>", "Relevant path", collectOption, [])
  .option("--changed-file <path>", "Changed file", collectOption, [])
  .option("--command <command>", "Relevant command", collectOption, [])
  .option("--json", "Print JSON")
  .action(async (options) => {
    const plan = await routeBehavior({
      projectRoot: process.cwd(),
      query: options.query,
      paths: options.path,
      changedFiles: options.changedFile,
      commands: options.command
    });
    output(options.json, plan, [
      `Route: ${plan.decision}`,
      `Risk: ${plan.risk.level}`,
      `Local coverage: ${plan.localCoverage}`,
      `Novelty: ${plan.novelty.score}`,
      `Trace: ${plan.tracePath}`,
      ...plan.reasons
    ].join("\n"));
  });

program.command("context")
  .description("Return one-shot agent task context: route, relevant behavior, plugin health, and next actions")
  .option("--query <text>", "Task or question text")
  .option("--path <path>", "Relevant path", collectOption, [])
  .option("--changed-file <path>", "Changed file", collectOption, [])
  .option("--command <command>", "Relevant command", collectOption, [])
  .option("--limit <number>", "Maximum preferences", parseIntegerOption, 8)
  .option("--json", "Print JSON")
  .action(async (options) => {
    const context = await getAgentTaskContext({
      projectRoot: process.cwd(),
      query: options.query,
      paths: options.path,
      changedFiles: options.changedFile,
      commands: options.command,
      limit: options.limit
    });
    output(options.json, context, context.compactMarkdown);
  });

program.command("finish-task")
  .description("Record safe task outcome evidence, run learning, and return review next actions for a coding harness")
  .requiredOption("--summary <text>", "Short safe summary of what happened; no raw prompts, raw diffs, secrets, or hidden answers")
  .option("--session <id>", "Session id", "agent-task")
  .option("--outcome <outcome>", "completed|accepted|rejected|edited", "completed")
  .option("--file <path>", "Touched file path", collectOption, [])
  .option("--command <command>", "Verification or tool command", collectOption, [])
  .option("--command-status <status>", "pass|fail|blocked|timeout|unknown", "unknown")
  .option("--no-learn", "Record events without running learning")
  .option("--compile-safe", "Compile active behavior only when lifecycle sees no conflicts")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await finishAgentTask({
      projectRoot: process.cwd(),
      sessionId: options.session,
      summary: options.summary,
      outcome: parseTaskOutcome(options.outcome),
      files: options.file,
      commands: options.command,
      commandStatus: parseCommandStatus(options.commandStatus),
      learn: options.learn !== false,
      compileSafe: options.compileSafe === true
    });
    output(options.json, result, [
      `Finished task: ${result.outcome}`,
      `Session: ${result.sessionId}`,
      `Events: ${result.eventIds.length}`,
      result.lifecycle ? `Signals: ${result.lifecycle.signals.signalCount}` : "Learning skipped",
      result.review ? `Pending review: ${result.review.pendingPreferenceCount + result.review.pendingWorkflowCount}` : undefined,
      ...result.nextActions
    ].filter(Boolean).join("\n"));
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

const interactions = program.command("interactions")
  .description("Import privacy-safe cross-agent interaction evidence");

interactions.command("import")
  .description("Preview or import a session/export file into redacted OpenSkillKit events")
  .argument("<source-path>", "JSON, JSONL, markdown, or text export file")
  .option("--adapter <name>", "Source adapter name", "manual-import")
  .option("--agent-name <name>", "Source agent name")
  .option("--max-events <number>", "Maximum parsed events to append", parseIntegerOption, 200)
  .option("--allow-duplicate", "Allow importing a source hash that was already imported")
  .option("--yes", "Append parsed events; default is dry-run")
  .option("--json", "Print JSON")
  .action(async (sourcePath, options) => {
    const result = await importInteractionSource(process.cwd(), sourcePath, {
      adapter: options.adapter,
      agentName: options.agentName,
      maxEvents: options.maxEvents,
      allowDuplicate: options.allowDuplicate === true,
      dryRun: options.yes !== true
    });
    output(options.json, result, `${result.status}: parsed ${result.parsedEventCount}, appended ${result.appendedEventCount}\nReport: ${result.artifacts.markdownPath}`);
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

interactions.command("imports")
  .description("List interaction import runs")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const runs = await readInteractionImportRuns(process.cwd());
    output(options.json, { schemaVersion: "openskill-kit.interaction-import-runs.v1", runs }, runs.length ? runs.map((run) => `${run.id} ${run.status} parsed=${run.parsedEventCount} appended=${run.appendedEventCount} ${run.source.adapter}`).join("\n") : "No interaction imports");
  });

const workflows = program.command("workflows")
  .description("Inspect review-safe Workflow Graph candidates");

workflows.command("mine")
  .description("Mine repeated command/test sequences into workflow candidates")
  .option("--min-occurrences <number>", "Minimum repeated sessions before candidate", parseIntegerOption, 2)
  .option("--max-sequence-length <number>", "Maximum commands per workflow sequence", parseIntegerOption, 6)
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await mineWorkflowGraph({
      projectRoot: process.cwd(),
      minOccurrences: options.minOccurrences,
      maxSequenceLength: options.maxSequenceLength
    });
    output(options.json, result, result.messages.join("\n"));
  });

workflows.command("list")
  .description("Render the current Workflow Graph")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const config = await readProjectConfig(process.cwd());
    const graph = await readWorkflowGraph(process.cwd(), config.projectId, new Date());
    output(options.json, graph, renderWorkflowGraph(graph));
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

function parseAgentPluginAttachHost(value: string): AgentPluginAttachHost {
  if ((AgentPluginAttachHosts as readonly string[]).includes(value)) return value as AgentPluginAttachHost;
  throw new Error(`Invalid agent plugin attach host: ${value}. Expected one of: ${AgentPluginAttachHosts.join(", ")}`);
}

function parseCompileTarget(value: string): CompileTarget {
  if ((CompileTargets as readonly string[]).includes(value)) return value as CompileTarget;
  throw new Error(`Invalid compile target: ${value}. Expected one of: ${CompileTargets.join(", ")}`);
}

function parseTaskOutcome(value: string): "completed" | "accepted" | "rejected" | "edited" {
  if (value === "completed" || value === "accepted" || value === "rejected" || value === "edited") return value;
  throw new Error(`Invalid task outcome: ${value}. Expected completed, accepted, rejected, or edited.`);
}

function parseCommandStatus(value: string): "pass" | "fail" | "blocked" | "timeout" | "unknown" {
  if (value === "pass" || value === "fail" || value === "blocked" || value === "timeout" || value === "unknown") return value;
  throw new Error(`Invalid command status: ${value}. Expected pass, fail, blocked, timeout, or unknown.`);
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

function parseVerifierSplit(value: string): "visible" | "holdout" | "all" {
  if (value === "visible" || value === "holdout" || value === "all") return value;
  throw new Error(`Invalid verifier split: ${value}. Expected visible, holdout, or all.`);
}

function parseSandboxMode(value: string): "local-process" | "docker" {
  if (value === "local-process" || value === "docker") return value;
  throw new Error(`Invalid sandbox mode: ${value}. Expected local-process or docker.`);
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
      const workflowCandidates = queue.workflowCandidates;
      printReviewScreen(candidates, workflowCandidates);
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
      const workflowMatch = /^(wa|workflow-activate|wr|workflow-reject|wl|workflow-lock|wd|workflow-demote)\s+(\d+)$/i.exec(answer);
      if (workflowMatch) {
        const index = Number.parseInt(workflowMatch[2]!, 10) - 1;
        const workflow = workflowCandidates[index];
        if (!workflow) {
          console.log(`No workflow candidate w${index + 1}`);
          continue;
        }
        const command = workflowMatch[1]!.toLowerCase();
        const action = command === "wa" || command === "workflow-activate" ? { activate: [workflow.id] }
          : command === "wr" || command === "workflow-reject" ? { reject: [workflow.id] }
            : command === "wl" || command === "workflow-lock" ? { lock: [workflow.id] }
              : { demote: [workflow.id] };
        await applyWorkflowReview(projectRoot, action);
        reviewed += 1;
        messages.push(`workflow:${Object.keys(action)[0]} ${workflow.id}`);
        continue;
      }
      const match = /^(a|activate|r|reject|l|lock|d|demote)\s+(\d+)$/i.exec(answer);
      if (!match) {
        console.log("Use: a 1, r 1, l 1, d 1, e 1, p 1, wa 1, wr 1, wl 1, wd 1, c, w, q, ?");
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

function printReviewScreen(candidates: Array<{ id: string; status: string; category: string; confidence: number; statement: string; scope: { level: string; paths: string[] } }>, workflowCandidates: Array<{ id: string; status: string; name: string; confidence: number; trigger: { paths: string[]; commands: string[] } }> = []): void {
  console.clear();
  console.log("OpenSkillKit Review");
  console.log("===================");
  if (!candidates.length && !workflowCandidates.length) {
    console.log("No candidate or conflict preferences/workflows.");
    console.log("q quit");
    return;
  }
  for (const [index, node] of candidates.entries()) {
    const scope = node.scope.paths.length ? `${node.scope.level}:${node.scope.paths.join(",")}` : node.scope.level;
    console.log(`${index + 1}. [${node.status}] ${node.category} ${node.confidence} ${scope}`);
    console.log(`   ${node.statement}`);
  }
  if (workflowCandidates.length) {
    console.log("");
    console.log("Workflow candidates:");
    for (const [index, workflow] of workflowCandidates.entries()) {
      const scope = workflow.trigger.paths.length ? workflow.trigger.paths.join(",") : "project";
      console.log(`w${index + 1}. [${workflow.status}] ${workflow.confidence} ${scope}`);
      console.log(`   ${workflow.name}: ${workflow.trigger.commands.join(" -> ") || "no commands"}`);
    }
  }
  console.log("");
  console.log("a N/r N/l N/d N preference | wa/wr/wl/wd N workflow | e N evidence | p N preview | c calibration | w write queue | q quit | ? help");
}

function printReviewHelp(): void {
  console.log("Commands:");
  console.log("  a 1  activate pending item 1");
  console.log("  r 1  reject pending item 1");
  console.log("  l 1  lock pending item 1");
  console.log("  d 1  demote pending item 1");
  console.log("  e 1  show sanitized evidence cards for pending item 1");
  console.log("  p 1  show compile/privacy preview for pending item 1");
  console.log("  wa 1 activate workflow candidate w1");
  console.log("  wr 1 reject workflow candidate w1");
  console.log("  wl 1 lock workflow candidate w1");
  console.log("  wd 1 demote workflow candidate w1");
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
