#!/usr/bin/env node
import { Command, Option } from "commander";
import { intro as clackIntro, log as clackLog, note as clackNote, outro as clackOutro } from "@clack/prompts";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser/lib/esm/main.js";
import {
  appendEvent,
  applyAmbientLabelReview,
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
  getAgentPluginInstallProfile,
  getAgentPluginAttachStatus,
  installInstructionManifests,
  uninstallInstructionManifests,
  initAdaptiveProject,
  initOpenWorldTask,
  importProjectBehaviorPack,
  importEncryptedProjectBehaviorPack,
  importInteractionSource,
  inspectGitLocalContext,
  planLearningSources,
  runLearningPlan,
  explainInteractionImport,
  installSkill,
  listInteractionAdapters,
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
  readInteractionPool,
  runRawLocalLearning,
  applyLearnV2ConceptReview,
  applyLearnV2ModelProposalOutputs,
  activateLearnV2Concepts,
  recordLearnV2ConceptOutcome,
  reconstructPersistedLearnV2Episodes,
  extractPersistedLearnV2Concepts,
  runPersistedLearnV2Eval,
  writeLearnV2ModelRequests,
  runLearnV2RawVaultMaintenance,
  readLearnV2PipelineObservabilityReport,
  RawLearningModelModes,
  readEvidenceCards,
  runBehaviorEval,
  runBehaviorCompareEval,
  runExternalAgentEval,
  runDoctor,
  runFullDoctor,
  resetProjectState,
  recordCommandTelemetry,
  pruneProjectState,
  archiveProjectState,
  compactProjectState,
  scanSkillPath,
  signProjectBehaviorPack,
  diffProjectBehaviorPacks,
  uninstallSkill,
  updatePreferenceGraph,
  writeOpenWorldLeakageAudit,
  verifyHarnessReadiness,
  verifyProjectBehaviorPack,
  verifySkill,
  CompileTargets,
  AgentPluginAttachHosts,
  DEFAULT_AGENT_PLUGIN_ATTACH_HOST,
  OSK_PUBLIC_COMMAND_FAMILIES,
  type CompileTarget,
  type AgentPluginAttachHost,
  type InstallTarget,
  type LearnRun,
  type RawLocalLearningResult,
  type LearnV2PipelineObservabilityReport,
  type LearnSourcePlan,
  type CommandTelemetryFamily
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
          `Plugin host status: ${status.compiled.pluginAttachment.hosts.map((host) => `${host.host}=${host.status}`).join(", ")}`,
          `Next: ${status.compiled.pluginAttachment.nextActions.join(" ")}`
        ].join("\n")
        : status.compiled.pluginStatus.integrityIssues.length
          ? `Plugin integrity issues: ${status.compiled.pluginStatus.integrityIssues.join("; ")}`
          : [
            `Plugin missing: ${status.compiled.pluginStatus.missing.join(", ")}`,
            `Next: ${status.compiled.pluginStatus.nextActions.join(" ")}`
          ].join("\n")
    ].join("\n"));
  });

program.command("doctor")
  .description("Check local environment and install targets")
  .option("--full", "Check adaptive config, hooks, MCP config, pack, registry, and stale graph state")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const report = options.full === true ? await runFullDoctor(process.cwd()) : await runDoctor(process.cwd());
    output(options.json, report, renderDoctorReport(report));
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

const osk = program.command("osk")
  .description("Run harness-native OpenSkillKit command-family workflows");

let activeOskTelemetry: { family: CommandTelemetryFamily; startedAt: number; recorded: boolean } | undefined;

osk.hook("preAction", (_thisCommand, actionCommand) => {
  const family = oskTelemetryFamily(actionCommand);
  activeOskTelemetry = family ? { family, startedAt: Date.now(), recorded: false } : undefined;
});

osk.hook("postAction", async () => {
  await finishOskTelemetry(process.exitCode && process.exitCode !== 0 ? "failure" : "success");
});

osk.command("help")
  .description("Show the 12 public OSK command families")
  .option("--json", "Print JSON")
  .action((options) => {
    output(options.json, { schemaVersion: "openskill-kit.osk-help.v1", commands: OSK_PUBLIC_COMMAND_FAMILIES }, OSK_PUBLIC_COMMAND_FAMILIES
      .map((family) => `${family.publicCommand.padEnd(13)} ${family.oneLine}`)
      .join("\n"));
  });

osk.command("init")
  .description("Initialize OSK state and show readiness")
  .option("--project-name <name>", "Project display name")
  .option("--force", "Rewrite adaptive config")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const init = await initAdaptiveProject({ projectRoot: process.cwd(), projectName: options.projectName, force: options.force === true });
    const status = await getAdaptiveStatus(process.cwd());
    output(options.json, { init, status }, [`${init.status} ${init.configPath}`, `Plugin ready: ${status.compiled.plugin}`, `Pending review: ${status.pendingReviewCount}`].join("\n"));
  });

osk.command("status")
  .description("Show OSK status, plugin health, and attach state")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const explained = await explainAdaptiveStatus(process.cwd());
    output(options.json, explained, explained.nextActions.join("\n"));
  });

const oskTask = osk.command("task")
  .description("Load task context or finish safe task evidence");

oskTask.command("context")
  .argument("[query...]", "Task query")
  .option("--path <path>", "Relevant path", collectOption, [])
  .option("--changed-file <path>", "Changed file path", collectOption, [])
  .option("--command <command>", "Relevant command", collectOption, [])
  .option("--limit <number>", "Preference limit", parseIntegerOption, 8)
  .option("--json", "Print JSON")
  .action(async (queryParts: string[], options) => {
    const result = await getAgentTaskContext({
      projectRoot: process.cwd(),
      query: queryParts.join(" ") || undefined,
      paths: options.path,
      changedFiles: options.changedFile,
      commands: options.command,
      limit: options.limit
    });
    output(options.json, result, result.compactMarkdown);
  });

oskTask.command("finish")
  .requiredOption("--summary <summary>", "Safe task summary; no raw prompts or diffs")
  .option("--session-id <id>", "Session id")
  .option("--outcome <outcome>", "completed|accepted|rejected|edited", parseTaskOutcome, "completed")
  .option("--outcome-reason <text>", "Short outcome reason")
  .option("--file <path>", "Touched file path", collectOption, [])
  .option("--command <command>", "Command run", collectOption, [])
  .option("--command-status <status>", "pass|fail|blocked|timeout|unknown", parseCommandStatus, "unknown")
  .option("--proposed-patch-hash <hash>", "Hash/reference for agent proposed patch")
  .option("--final-patch-hash <hash>", "Hash/reference for final accepted/edited patch")
  .option("--diff-added <number>", "Added line count metadata", parseIntegerOption)
  .option("--diff-removed <number>", "Removed line count metadata", parseIntegerOption)
  .option("--diff-files <number>", "Changed file count metadata", parseIntegerOption)
  .option("--no-learn", "Record task events without running learning")
  .option("--compile-safe", "Compile only if safe active behavior exists")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await finishAgentTask({
      projectRoot: process.cwd(),
      sessionId: options.sessionId,
      summary: options.summary,
      outcome: options.outcome,
      outcomeReason: options.outcomeReason,
      files: options.file,
      commands: options.command,
      commandStatus: options.commandStatus,
      proposedPatchHash: options.proposedPatchHash,
      finalPatchHash: options.finalPatchHash,
      diffStats: makeDiffStats(options.diffAdded, options.diffRemoved, options.diffFiles),
      learn: options.learn !== false,
      compileSafe: options.compileSafe === true
    });
    output(options.json, result, result.nextActions.join("\n"));
  });

osk.command("learn")
  .description("Plan or run review-gated learning from selected sources")
  .option("--source <id>", "Selected source id from plan", collectOption, [])
  .option("--raw", "Run raw local learning over explicitly supplied surface files")
  .option("--raw-vault-status", "Show learn-v2 raw vault retention and budget status")
  .option("--gc-raw-vault", "Compact or expire learn-v2 raw vault blobs whose retention window has elapsed")
  .option("--observability", "Show latest Learn-v2 pipeline observability dashboard")
  .option("--observability-file <path>", "Specific Learn-v2 pipeline observability JSON report")
  .option("--max-raw-vault-bytes <number>", "Learn-v2 hot raw vault byte budget", parseIntegerOption, 50_000_000)
  .option("--reconstruct-episodes", "Rebuild Learn-v2 episodes from persisted analysis frames")
  .option("--extract-concepts", "Extract deterministic Learn-v2 concepts from the persisted episode store")
  .option("--run-learn-v2-eval", "Run Learn-v2 eval from persisted episode and concept stores")
  .option("--prepare-model-requests", "Write prompt-safe Learn-v2 model request artifacts from the stored episode store")
  .option("--model-output <path>", "Learn-v2 model JSON output file or request-manifest.json to validate and merge", collectOption, [])
  .option("--activation-query <text>", "Score reviewed Learn-v2 concepts for a task query")
  .option("--activation-path <path>", "Path hint for --activation-query", collectOption, [])
  .option("--activation-command <command>", "Command hint for --activation-query", collectOption, [])
  .option("--activation-task-type <type>", "Task-type hint for --activation-query", collectOption, [])
  .option("--activation-negative <signal>", "Negative trigger/suppression signal for --activation-query", collectOption, [])
  .option("--include-candidate-concepts", "Include candidate/conflict Learn-v2 concepts in activation scoring")
  .option("--record-concept-outcome <conceptId>", "Record local Learn-v2 concept outcome telemetry for a concept id")
  .option("--concept-outcome <outcome>", "Concept outcome: helpful|ignored|wrong|harmful|superseded")
  .option("--concept-outcome-reason <text>", "Short safe reason for --record-concept-outcome")
  .option("--surface-file <path>", "Raw local learning source file", collectOption, [])
  .option("--learn-v2-goldens <path>", "Learn-v2 extraction golden scenario JSON file")
  .option("--model-mode <mode>", `Raw learning model mode: ${RawLearningModelModes.join("|")}`, parseRawLearningModelMode, "heuristic-only")
  .option("--all-detected", "Select all safe detected sources")
  .option("--apply", "Apply selected sources after preview approval")
  .option("--max-events <number>", "Maximum events", parseIntegerOption, 250)
  .option("--no-interactive", "Do not prompt; print the source plan")
  .option("--json", "Print JSON")
  .action(async (options) => {
    if (options.rawVaultStatus === true || options.gcRawVault === true) {
      const result = await runLearnV2RawVaultMaintenance(process.cwd(), {
        gc: options.gcRawVault === true,
        maxHotBytes: options.maxRawVaultBytes
      });
      output(options.json, result, renderRawVaultMaintenance(result));
      return;
    }
    if (options.observability === true || options.observabilityFile) {
      const report = await readLearnV2PipelineObservabilityReport(process.cwd(), options.observabilityFile);
      if (options.json === true || !process.stdout.isTTY) output(options.json, report, renderLearnV2ObservabilityPlain(report));
      else renderLearnV2ObservabilityTui(report);
      return;
    }
    if (options.reconstructEpisodes === true) {
      const result = await reconstructPersistedLearnV2Episodes(process.cwd());
      output(options.json, result, renderLearnV2Reconstruct(result));
      return;
    }
    if (options.extractConcepts === true) {
      const result = await extractPersistedLearnV2Concepts(process.cwd());
      output(options.json, result, renderLearnV2Extract(result));
      return;
    }
    if (options.runLearnV2Eval === true) {
      const result = await runPersistedLearnV2Eval(process.cwd(), { goldensPath: options.learnV2Goldens });
      output(options.json, result, renderLearnV2PersistedEval(result));
      return;
    }
    if (options.prepareModelRequests === true) {
      const result = await writeLearnV2ModelRequests(process.cwd());
      output(options.json, result, renderLearnV2ModelRequests(result));
      return;
    }
    if (options.modelOutput.length > 0) {
      const result = await applyLearnV2ModelProposalOutputs(process.cwd(), options.modelOutput);
      output(options.json, result, renderLearnV2ModelProposalApply(result));
      return;
    }
    if (options.recordConceptOutcome) {
      const outcome = parseConceptOutcome(options.conceptOutcome);
      const result = await recordLearnV2ConceptOutcome(process.cwd(), {
        conceptId: options.recordConceptOutcome,
        outcome,
        query: options.activationQuery,
        paths: options.activationPath,
        commands: options.activationCommand,
        reason: options.conceptOutcomeReason
      });
      output(options.json, result, `Recorded ${result.record.outcome} outcome for ${result.record.conceptId}: ${result.outcomePath}`);
      return;
    }
    if (options.activationQuery || options.activationPath.length || options.activationCommand.length || options.activationTaskType.length) {
      const result = await activateLearnV2Concepts(process.cwd(), {
        query: options.activationQuery,
        paths: options.activationPath,
        commands: options.activationCommand,
        taskTypes: options.activationTaskType,
        negativeSignals: options.activationNegative,
        includeCandidates: options.includeCandidateConcepts === true
      });
      output(options.json, result, renderLearnV2Activation(result));
      return;
    }
    if (options.raw === true) {
      const result = await runRawLocalLearning(process.cwd(), {
        sourceFiles: options.surfaceFile,
        previewOnly: options.apply !== true,
        maxTurns: options.maxEvents,
        modelMode: options.modelMode,
        learnV2GoldensPath: options.learnV2Goldens
      });
      output(options.json, result, renderRawLearnResult(result));
      return;
    }
    const sourceMode = options.source.length ? "selected" : options.allDetected === true ? "all-detected" : "ask";
    const result = options.source.length || options.allDetected === true || options.apply === true
      ? await runLearningPlan(process.cwd(), {
        sourceMode,
        selectedSourceIds: options.source,
        previewOnly: options.apply !== true,
        maxEvents: options.maxEvents
      })
      : options.interactive !== false && options.json !== true && canPrompt()
        ? await runInteractiveLearnPicker(process.cwd(), options.maxEvents)
      : await planLearningSources(process.cwd(), { sourceMode });
    output(options.json, result, renderLearnResult(result));
  });

osk.command("review")
  .description("Open or write review queue")
  .option("--write", "Write review queue and print path")
  .option("--concept-accept <id>", "Accept a learn-v2 concept card", collectOption, [])
  .option("--concept-reject <id>", "Reject a learn-v2 concept card", collectOption, [])
  .option("--concept-lock <id>", "Lock a learn-v2 concept card as active", collectOption, [])
  .option("--concept-demote <id>", "Demote a learn-v2 concept card back to candidate", collectOption, [])
  .option("--concept-one-off <id>", "Mark a learn-v2 concept card as one-off", collectOption, [])
  .option("--concept-merge <json>", "Merge learn-v2 concepts. JSON: {\"targetId\":\"concept_a\",\"sourceIds\":[\"concept_b\"]}", collectOption, [])
  .option("--concept-split <json>", "Split a learn-v2 concept. JSON: {\"sourceId\":\"concept_a\",\"atomIds\":[\"atom_b\"]}", collectOption, [])
  .option("--concept-supersede <json>", "Mark supersession. JSON: {\"supersededId\":\"concept_old\",\"supersededById\":\"concept_new\"}", collectOption, [])
  .option("--concept-auto-policy", "Run configured Learn-v2 auto-stage, auto-apply-safe, and auto-supersession policies")
  .option("--concept-bulk <action>", "Safe learn-v2 bulk action: accept-low-risk|reject-one-off|mark-superseded")
  .option("--no-concept-compile", "Update learn-v2 concept store without syncing active concepts into preference/workflow graphs")
  .option("--label-command <hash>", "Approve a command hash label")
  .option("--label-path <hash>", "Approve a path hash label")
  .option("--as <label>", "Human-readable label for --label-command or --label-path")
  .option("--reject-label <hash>", "Reject a command/path label candidate by hash")
  .option("--label-kind <kind>", "Label kind for --reject-label: command or path", "command")
  .option("--json", "Print JSON")
  .action(async (options) => {
    if (hasConceptReviewOptions(options)) {
      const result = await applyLearnV2ConceptReview(process.cwd(), {
        accept: options.conceptAccept,
        reject: options.conceptReject,
        lock: options.conceptLock,
        demote: options.conceptDemote,
        markOneOff: options.conceptOneOff,
        mergeConcepts: parseConceptMergeOptions(options.conceptMerge),
        splitConcepts: parseConceptSplitOptions(options.conceptSplit),
        supersedeConcepts: parseConceptSupersedeOptions(options.conceptSupersede),
        autoPolicy: options.conceptAutoPolicy === true,
        bulkSafe: parseConceptBulkAction(options.conceptBulk),
        compileActive: options.conceptCompile !== false
      });
      output(options.json, result, result.messages.join("\n"));
      return;
    }
    if (options.labelCommand || options.labelPath || options.rejectLabel) {
      const result = await applyAmbientLabelReview(process.cwd(), {
        approveCommand: options.labelCommand ? [{ hash: options.labelCommand, label: requireLabelOption(options.as, "--label-command") }] : [],
        approvePath: options.labelPath ? [{ hash: options.labelPath, label: requireLabelOption(options.as, "--label-path") }] : [],
        rejectCommand: options.rejectLabel && options.labelKind !== "path" ? [options.rejectLabel] : [],
        rejectPath: options.rejectLabel && options.labelKind === "path" ? [options.rejectLabel] : []
      });
      output(options.json, result, `Reviewed labels: ${result.reviewedCount}`);
      return;
    }
    if (options.write === true) {
      const queue = await buildReviewQueue(process.cwd());
      output(options.json, queue, queue.markdownPath);
      return;
    }
    const result = await runReviewTui(process.cwd());
    output(options.json, result, result.messages.join("\n"));
  });

osk.command("research")
  .description("Plan OpenWorld sources for a task")
  .requiredOption("--task-id <id>", "OpenWorld task id")
  .option("--query <text>", "Extra query")
  .option("--path <path>", "Relevant path", collectOption, [])
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await planOpenWorldResearch(process.cwd(), options.taskId, { query: options.query, paths: options.path });
    output(options.json, result, result.recommendedNextCommands.join("\n"));
  });

osk.command("evolve")
  .description("Run OpenWorld refinement for a candidate skill")
  .requiredOption("--task-id <id>", "OpenWorld task id")
  .requiredOption("--suite-id <id>", "Verifier suite id")
  .option("--candidate-id <id>", "Candidate skill id")
  .option("--max-rounds <number>", "Max refinement rounds", parseIntegerOption, 3)
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await runOpenWorldRefinement(process.cwd(), options.taskId, options.suiteId, { candidateSkillId: options.candidateId, maxRounds: options.maxRounds });
    output(options.json, result, `${result.status}: ${result.id}`);
  });

osk.command("verify")
  .description("Verify harness readiness or score an OpenWorld verifier suite")
  .option("--task-id <id>", "OpenWorld task id")
  .option("--suite-id <id>", "Verifier suite id")
  .option("--json", "Print JSON")
  .action(async (options) => {
    if (!options.taskId && !options.suiteId) {
      const result = await verifyHarnessReadiness(process.cwd());
      output(options.json, result, [
        `Harness readiness ${result.status}`,
        `Findings: ${result.summary.findings}; failures: ${result.summary.failures}; warnings: ${result.summary.warnings}`,
        `Public MCP tools: ${result.summary.publicMcpToolCount ?? "missing"}/${result.limits.publicMcpToolCount}`,
        `OpenCode commands: ${result.summary.opencodeCommandCount ?? "missing"}/${result.limits.publicCommandCount}`,
        `OpenCode agents: ${result.summary.opencodeAgentCount ?? "missing"}/${result.limits.opencodeAgentCount}`,
        `OpenCode plugin: ${result.summary.opencodePluginReady ? "ready" : "missing-or-failing"}`
      ].join("\n"));
      process.exitCode = result.status === "fail" ? 1 : 0;
      return;
    }
    if (!options.taskId || !options.suiteId) throw new Error("--task-id and --suite-id must be supplied together for OpenWorld verifier quality.");
    const result = await assessOpenWorldVerifierQuality(process.cwd(), options.taskId, options.suiteId);
    output(options.json, result, `${result.report.status}: traceability=${result.report.metrics.traceabilityScore}`);
  });

osk.command("compile")
  .description("Compile active reviewed behavior")
  .option("--target <target>", "Compile target", collectOption, [])
  .option("--json", "Print JSON")
  .action(async (options) => {
    const targets = options.target.length ? options.target.map(parseCompileTarget) : ["plugin"] as CompileTarget[];
    const result = await compileBehaviorLayer(process.cwd(), { targets });
    output(options.json, result, `Compiled: ${result.compiledTargets.join(", ")}`);
  });

osk.command("deploy")
  .description("Preview or apply full OpenCode harness deployment")
  .option("--host <host>", "Attach host", parseAgentPluginAttachHost, DEFAULT_AGENT_PLUGIN_ATTACH_HOST)
  .option("--yes", "Apply after reviewing dry-run")
  .option("--skip-hooks", "Do not install lifecycle hooks")
  .option("--skip-manifests", "Do not install managed instruction manifests")
  .option("--json", "Print JSON")
  .action(async (options) => {
    if (options.host === "opencode") {
      const result = await runSetupWizard(process.cwd(), options.host, {
        yes: options.yes === true,
        nonInteractive: true,
        skipHooks: options.skipHooks === true,
        skipManifests: options.skipManifests === true
      });
      output(options.json, result, result.messages.join("\n"));
      process.exitCode = result.status === "blocked" ? 1 : 0;
      return;
    }
    const result = await attachAgentPlugin(process.cwd(), { host: options.host, dryRun: options.yes !== true, yes: options.yes === true });
    output(options.json, result, result.messages.join("\n"));
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

osk.command("eval")
  .description("Run behavior replay eval")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await runBehaviorEval({ projectRoot: process.cwd() });
    output(options.json, result, `${result.status}: ${result.passCount}/${result.scenarioCount} passed`);
    process.exitCode = result.status === "fail" ? 1 : 0;
  });

osk.command("pack")
  .description("Export, verify, sign, diff, or import behavior packs through trust gates")
  .argument("[action]", "export|verify|inspect|sign|diff|import|apply", "export")
  .argument("[pack-path]", "Pack path for verify, inspect, sign, import, or apply")
  .argument("[other-pack-path]", "Other pack path for diff")
  .option("--pack <path>", "Pack path")
  .option("--other <path>", "Other pack path for diff")
  .option("--yes", "Apply imports; required for apply")
  .option("--review", "Write import review artifact")
  .option("--trust-hooks", "Import hook files too")
  .option("--max-changed-files <number>", "Block import if changed file count exceeds this number", parseIntegerOption)
  .option("--key-dir <path>", "Signing key directory")
  .option("--json", "Print JSON")
  .action(async (action, packPathArg, otherPackPathArg, options) => {
    const result = await runOskPackAction(action, {
      packPath: options.pack ?? packPathArg,
      otherPackPath: options.other ?? otherPackPathArg,
      yes: options.yes === true,
      review: options.review === true,
      trustHooks: options.trustHooks === true,
      maxChangedFiles: options.maxChangedFiles,
      keyDir: options.keyDir
    });
    output(options.json, result.data, result.text);
    process.exitCode = result.exitCode ?? 0;
  });

osk.command("setup")
  .description("Preview or run the interactive setup wizard for OpenCode")
  .option("--host <host>", "Harness host target", parseAgentPluginAttachHost, "opencode")
  .option("--yes", "Apply attachment after preview")
  .option("--non-interactive", "Run without prompts; previews only unless --yes")
  .option("--skip-hooks", "Do not install lifecycle hooks")
  .option("--skip-manifests", "Do not install managed instruction manifests")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await runSetupWizard(process.cwd(), options.host, {
      yes: options.yes === true,
      nonInteractive: options.nonInteractive === true,
      skipHooks: options.skipHooks === true,
      skipManifests: options.skipManifests === true
    });
    output(options.json, result, result.messages.join("\n"));
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

osk.command("uninstall")
  .description("Preview or run the uninstaller wizard to revert config changes and files")
  .option("--host <host>", "Harness host target", parseAgentPluginAttachHost, "opencode")
  .option("--dry-run", "Plan without deleting or writing")
  .option("--yes", "Apply file removals and config cleanup after preview")
  .option("--non-interactive", "Run without prompts; dry-run unless --yes")
  .option("--delete-state", "Also remove .openskill-kit state; requires --yes")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await runUninstallWizard(process.cwd(), options.host, {
      dryRun: options.dryRun === true,
      yes: options.yes === true,
      nonInteractive: options.nonInteractive === true,
      deleteState: options.deleteState === true
    });
    output(options.json, result, result.messages.join("\n"));
    process.exitCode = result.status === "blocked" ? 1 : 0;
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
  .option("--yes", "Apply source ingestion after reviewing the dry-run plan")
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
      dryRun: options.dryRun === true || options.yes !== true,
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
  .option("--benchmark-name <name>", "Optional external benchmark name for readiness metadata")
  .option("--benchmark-result-path <path>", "Optional external benchmark result summary path reference; content is not read")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await buildOpenWorldHiddenOracleHarness(process.cwd(), options.taskId, {
      suiteId: options.suiteId,
      deniedPaths: options.deniedPath,
      benchmarkName: options.benchmarkName,
      benchmarkResultPath: options.benchmarkResultPath
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
  .option("--host <host>", "opencode|codex|claude-code|cursor|generic-mcp", DEFAULT_AGENT_PLUGIN_ATTACH_HOST)
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
      `Primary host: ${result.defaultHost}=${result.defaultHostStatus.status}`,
      `Plugin host status: ${result.hosts.map((host) => `${host.host}=${host.status}`).join(", ")}`,
      `Plugin attach receipts: ${result.receiptCount}`,
      ...result.nextActions
    ].join("\n"));
  });

agent.command("plugin-install-profile")
  .description("Show machine-readable install profile for existing coding harnesses")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await getAgentPluginInstallProfile(process.cwd());
    output(options.json, result, result.ready && result.profile
      ? [
        `Plugin install profile ready: ${result.ready}`,
        `Plugin directory: ${result.profile.pluginDirectory}`,
        `First MCP call: ${result.profile.firstCall.mcpTool}`,
        `MCP server: ${result.profile.mcp.command}`,
        `Required env: ${Object.keys(result.profile.mcp.requiredEnv).join(", ")}`,
        `Command map: ${result.profile.commandRouting.map}`,
        `Approval tools: ${result.profile.approvalRequiredTools.join(", ")}`,
        `Plugin host attached: ${result.attachment.attached}`,
        `Primary host: ${result.attachment.defaultHost}=${result.attachment.defaultHostStatus.status}`,
        `Plugin host status: ${result.attachment.hosts.map((host) => `${host.host}=${host.status}`).join(", ")}`
      ].join("\n")
      : [
        `Plugin install profile ready: ${result.ready}`,
        `Plugin host attached: ${result.attachment.attached}`,
        ...result.nextActions
      ].join("\n"));
    process.exitCode = result.ready ? 0 : 1;
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
  .option("--outcome-reason <text>", "Short reason for rejected or edited outcomes")
  .option("--file <path>", "Touched file path", collectOption, [])
  .option("--command <command>", "Verification or tool command", collectOption, [])
  .option("--command-status <status>", "pass|fail|blocked|timeout|unknown", "unknown")
  .option("--proposed-patch-hash <hash>", "Hash/reference for agent proposed patch")
  .option("--final-patch-hash <hash>", "Hash/reference for final accepted/edited patch")
  .option("--diff-added <number>", "Added line count metadata", parseIntegerOption)
  .option("--diff-removed <number>", "Removed line count metadata", parseIntegerOption)
  .option("--diff-files <number>", "Changed file count metadata", parseIntegerOption)
  .option("--no-learn", "Record events without running learning")
  .option("--compile-safe", "Compile active behavior only when lifecycle sees no conflicts")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await finishAgentTask({
      projectRoot: process.cwd(),
      sessionId: options.session,
      summary: options.summary,
      outcome: parseTaskOutcome(options.outcome),
      outcomeReason: options.outcomeReason,
      files: options.file,
      commands: options.command,
      commandStatus: parseCommandStatus(options.commandStatus),
      proposedPatchHash: options.proposedPatchHash,
      finalPatchHash: options.finalPatchHash,
      diffStats: makeDiffStats(options.diffAdded, options.diffRemoved, options.diffFiles),
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

interactions.command("import-review")
  .description("Preview or import a local review-comment file into redacted OpenSkillKit events")
  .argument("<source-path>", "JSON, JSONL, markdown, or text review comment file")
  .option("--agent-name <name>", "Review source name", "Review")
  .option("--max-events <number>", "Maximum parsed review comments to append", parseIntegerOption, 200)
  .option("--allow-duplicate", "Allow importing a source hash that was already imported")
  .option("--yes", "Append parsed review comments; default is dry-run")
  .option("--json", "Print JSON")
  .action(async (sourcePath, options) => {
    const result = await importInteractionSource(process.cwd(), sourcePath, {
      adapter: "review-local",
      agentName: options.agentName,
      maxEvents: options.maxEvents,
      allowDuplicate: options.allowDuplicate === true,
      dryRun: options.yes !== true
    });
    output(options.json, result, `${result.status}: parsed ${result.parsedEventCount}, appended ${result.appendedEventCount}\nReport: ${result.artifacts.markdownPath}`);
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

interactions.command("import-terminal")
  .description("Preview or import an explicit terminal history file as allowlisted command metadata only")
  .argument("<source-path>", "Plain text, JSON, or JSONL command history file")
  .option("--agent-name <name>", "Terminal source name", "Terminal")
  .option("--max-events <number>", "Maximum parsed terminal commands to append", parseIntegerOption, 200)
  .option("--allow-duplicate", "Allow importing a source hash that was already imported")
  .option("--yes", "Append parsed terminal commands; default is dry-run")
  .option("--json", "Print JSON")
  .action(async (sourcePath, options) => {
    const result = await importInteractionSource(process.cwd(), sourcePath, {
      adapter: "terminal-history",
      agentName: options.agentName,
      maxEvents: options.maxEvents,
      allowDuplicate: options.allowDuplicate === true,
      dryRun: options.yes !== true
    });
    output(options.json, result, `${result.status}: parsed ${result.parsedEventCount}, appended ${result.appendedEventCount}\nReport: ${result.artifacts.markdownPath}`);
    process.exitCode = result.status === "blocked" ? 1 : 0;
  });

interactions.command("adapters")
  .description("List supported interaction import adapters and privacy policy")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const adapters = listInteractionAdapters();
    output(options.json, { schemaVersion: "openskill-kit.interaction-adapters.v1", adapters }, adapters.map((adapter) => `${adapter.id} ${adapter.status} privacy=${adapter.privacy} formats=${adapter.acceptedFormats.join(",")}`).join("\n"));
  });

interactions.command("imports")
  .description("List interaction import runs")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const runs = await readInteractionImportRuns(process.cwd());
    output(options.json, { schemaVersion: "openskill-kit.interaction-import-runs.v1", runs }, runs.length ? runs.map((run) => `${run.id} ${run.status} parsed=${run.parsedEventCount} appended=${run.appendedEventCount} ${run.source.adapter}`).join("\n") : "No interaction imports");
  });

interactions.command("explain")
  .description("Explain one interaction import receipt without reading raw source content")
  .argument("<run-id>", "Interaction import run id")
  .option("--json", "Print JSON")
  .action(async (runId, options) => {
    const result = await explainInteractionImport(process.cwd(), runId);
    output(options.json, result, [
      `${result.runId} ${result.status}: parsed=${result.imported.parsedEventCount} appended=${result.imported.appendedEventCount}`,
      `Adapter: ${result.source.adapter} (${result.source.adapterStatus})`,
      `Privacy: raw source stored=${result.privacy.rawSourceStored}, artifact copy=${result.privacy.rawSourceCopiedToArtifacts}`,
      `Learnable: ${result.learnable.canLearn ? "yes" : "no"}${result.learnable.signalSources.length ? ` (${result.learnable.signalSources.join(", ")})` : ""}`,
      ...result.learnable.nextActions.map((action) => `- ${action}`)
    ].join("\n"));
  });

interactions.command("pool")
  .description("List normalized interaction pool metadata without raw source content")
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await readInteractionPool(process.cwd());
    output(options.json, result, result.records.length
      ? result.records.map((record) => `${record.id} ${record.adapter} ${record.eventType} commands=${record.commandCount} files=${record.fileCount}`).join("\n")
      : "No interaction pool records");
  });

interactions.command("git-context")
  .description("Inspect local git branch, changed files, and aggregate diff metadata without raw diffs")
  .option("--max-changed-files <number>", "Maximum changed files to return", parseIntegerOption, 80)
  .option("--max-recent-commits <number>", "Maximum recent commit subjects to return", parseIntegerOption, 5)
  .option("--json", "Print JSON")
  .action(async (options) => {
    const result = await inspectGitLocalContext(process.cwd(), {
      maxChangedFiles: options.maxChangedFiles,
      maxRecentCommits: options.maxRecentCommits
    });
    output(options.json, result, [
      `Git: ${result.repository.isGitRepository ? "yes" : "no"}`,
      result.repository.branch ? `Branch: ${result.repository.branch}` : undefined,
      result.repository.head ? `HEAD: ${result.repository.head}` : undefined,
      `Changed files: ${result.summary.changedFileCount}`,
      `Diff metadata: +${result.summary.addedLines} -${result.summary.removedLines}`,
      ...result.changedFiles.slice(0, 12).map((file) => `- ${file.status} ${file.path}${file.added !== undefined || file.removed !== undefined ? ` (+${file.added ?? 0} -${file.removed ?? 0})` : ""}`),
      ...result.warnings.map((warning) => `Warning: ${warning}`)
    ].filter(Boolean).join("\n"));
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

program.parseAsync(process.argv).catch(async (error) => {
  await finishOskTelemetry("failure");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function oskTelemetryFamily(actionCommand: Command): CommandTelemetryFamily | undefined {
  const chain: string[] = [];
  let current: Command | undefined = actionCommand;
  while (current) {
    chain.unshift(current.name());
    current = current.parent ?? undefined;
  }
  const oskIndex = chain.indexOf("osk");
  const raw = oskIndex >= 0 ? chain[oskIndex + 1] : undefined;
  const family = raw === "setup" || raw === "uninstall" ? "deploy" : raw;
  return isOskTelemetryFamily(family) ? family : undefined;
}

function isOskTelemetryFamily(value: unknown): value is CommandTelemetryFamily {
  return typeof value === "string" && OSK_PUBLIC_COMMAND_FAMILIES.some((family) => family.id === value);
}

async function finishOskTelemetry(status: "success" | "failure"): Promise<void> {
  if (!activeOskTelemetry || activeOskTelemetry.recorded) return;
  activeOskTelemetry.recorded = true;
  const configExists = await fs.stat(path.join(process.cwd(), ".openskill-kit", "config.json")).then(() => true).catch(() => false);
  if (!configExists) return;
  await recordCommandTelemetry(process.cwd(), {
    surface: "cli",
    family: activeOskTelemetry.family,
    status,
    durationMs: Date.now() - activeOskTelemetry.startedAt,
    exitCode: process.exitCode && process.exitCode !== 0 ? Number(process.exitCode) : undefined
  }).catch(() => undefined);
}

function output(json: boolean | undefined, data: unknown, text: string): void {
  if (json) console.log(JSON.stringify(sanitizeForOutput(data), null, 2));
  else console.log(sanitizeText(text));
}

function requireLabelOption(value: string | undefined, flag: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`${flag} requires --as <label>`);
}

function renderLearnResult(result: LearnSourcePlan | LearnRun): string {
  if (!("digest" in result)) {
    return [
      `Sources: ${result.summary.total} (${result.summary.safeMetadata} safe, ${result.summary.explicitImport} explicit, ${result.summary.blocked} blocked)`,
      `Default selected: ${result.defaults.selectedSourceIds.join(", ") || "none"}`,
      ...result.nextActions
    ].join("\n");
  }
  const lines = [
    `Sources considered: ${result.digest.sourcesConsidered}`,
    `Sources used: ${result.digest.sourcesUsed}`,
    `Events appended: ${result.digest.eventsAppended}`,
    `Signals extracted: ${result.digest.signalsExtracted}`,
    `Candidate preferences: ${result.digest.candidatePreferences}`
  ];
  if (result.preview) {
    lines.push("");
    lines.push("--- Preview ---");
    lines.push(`Events accepted (transient): ${result.preview.eventsRead}`);
    if (result.preview.recordsRead !== undefined) lines.push(`Ambient records read: ${result.preview.recordsRead}`);
    if (result.preview.recordsSkipped !== undefined) lines.push(`Ambient records skipped: ${result.preview.recordsSkipped}`);
    lines.push(`Command/workflow signals: ${result.preview.commandWorkflowSignals}`);
    lines.push(`File/repo patterns: ${result.preview.fileTouchPatterns}`);
    lines.push(`Candidate preferences: ${result.preview.candidatePreferences}`);
    lines.push(`Candidate workflows: ${result.preview.candidateWorkflows}`);
    if (result.preview.rawFieldsDetected) {
      for (const warning of result.preview.rawFieldWarnings) lines.push(`WARNING: ${warning}`);
    }
    if (result.preview.candidateBehavior.length > 0) {
      lines.push("");
      lines.push("Candidate behavior (would be learned):");
      for (const item of result.preview.candidateBehavior) {
        lines.push(`  [${item.kind}] ${item.statement}`);
      }
    }
    if (result.preview.labelCandidates.length > 0) {
      lines.push("");
      lines.push("Label candidates (review-gated):");
      for (const item of result.preview.labelCandidates) {
        lines.push(`  [${item.kind}] ${item.hash} (${item.evidenceCount} events)`);
      }
    }
  }
  if (result.receipt) {
    lines.push("");
    lines.push(`Receipt written. Applied: ${result.receipt.applied}. Next: ${result.receipt.nextCommand}`);
  }
  lines.push(...result.nextActions);
  return lines.join("\n");
}

function renderRawLearnResult(result: RawLocalLearningResult): string {
  const lines = [
    `Raw sources considered: ${result.digest.sourcesConsidered}`,
    `Sources included: ${result.digest.sourcesIncluded}`,
    `Learning windows: ${result.digest.learningWindows}`,
    `Behavior atoms: ${result.digest.behaviorAtoms}`,
    `Concept cards: ${result.digest.conceptCards}`,
    `Events appended: ${result.digest.eventsAppended}`,
    `Raw vault records written: ${result.digest.rawVaultRecordsWritten}`,
    `Overall quality: ${result.quality.overallScore.toFixed(2)} (relevance ${result.quality.relevanceScore.toFixed(2)}, yield ${result.quality.conceptYieldScore.toFixed(2)}, safety ${result.quality.propagationSafetyScore.toFixed(2)})`,
    `Digest: ${result.artifacts.reviewMarkdownPath}`,
    result.artifacts.learnV2EvidenceQualityPath ? `Evidence quality: ${result.artifacts.learnV2EvidenceQualityPath}` : undefined,
    result.artifacts.learnV2ConflictLedgerPath ? `Conflict ledger: ${result.artifacts.learnV2ConflictLedgerPath}` : undefined,
    result.artifacts.learnV2ObservabilityReportPath ? `Observability: ${result.artifacts.learnV2ObservabilityReportPath}` : undefined,
    `Model requests: ${result.artifacts.learnV2ModelRequestDir}`
  ].filter((line): line is string => Boolean(line));
  if (result.concepts.length > 0) {
    lines.push("");
    lines.push("Candidate concepts:");
    for (const concept of result.concepts.slice(0, 12)) {
      lines.push(`  [${concept.confidence.toFixed(2)}] ${concept.canonicalBehavior}`);
    }
  }
  for (const source of result.sources.filter((item) => item.projectRelevance.decision !== "include")) {
    lines.push(`WARNING: ${source.projectRelevance.decision} ${source.sourcePath} (${source.projectRelevance.reasons.join(", ") || "low project relevance"})`);
  }
  lines.push(...result.nextActions);
  return lines.join("\n");
}

function renderLearnV2ObservabilityPlain(report: LearnV2PipelineObservabilityReport): string {
  return [
    "Learn v2 observability",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.run.previewOnly ? "preview" : "apply"} / ${report.run.modelMode}`,
    `Sources: ${report.sources.included} included, ${report.sources.reviewNeeded} review-needed, ${report.sources.excluded} excluded / ${report.sources.considered}`,
    `Evidence: ${report.evidence.normalizedEvidence} records, ${report.evidence.episodes} episodes, confidence high/medium/low ${report.evidence.confidenceBuckets.high}/${report.evidence.confidenceBuckets.medium}/${report.evidence.confidenceBuckets.low}`,
    `Evidence quality: ${renderLearnV2CountLine(report.evidence.qualityTierCounts)}, actions ${renderLearnV2CountLine(report.evidence.qualityActionCounts)}`,
    `Stitching: ${renderLearnV2CountLine(report.evidence.stitchingMethodCounts)}`,
    `Tools: ${report.compression.tools} summaries, ${report.compression.totalToolOmittedBytes} omitted bytes, strategies ${renderLearnV2CountLine(report.compression.toolCompressionStrategyCounts)}`,
    `Patches: ${report.compression.behaviorEligiblePatches} behavior-eligible, ${report.compression.auditOnlyPatches} audit-only / ${report.compression.patches}; filters ${renderLearnV2CountLine(report.compression.patchFilterReasonCounts)}`,
    `Concepts: ${report.concepts.cards} cards, ${report.concepts.reviewReadyCards} review-ready, status ${renderLearnV2CountLine(report.concepts.statusCounts)}, risk ${renderLearnV2CountLine(report.concepts.riskCounts)}`,
    `Conflicts: ${report.concepts.unresolvedConflicts} unresolved, types ${renderLearnV2CountLine(report.concepts.conflictTypeCounts)}`,
    `Gates: eval ${report.qualityGates.evalStatus}, leak ${report.qualityGates.leakStatus}, review cards ${report.qualityGates.reviewCards}`,
    `Artifacts: ${Object.keys(report.artifacts).length ? Object.entries(report.artifacts).map(([key, value]) => `${key}=${value}`).join("; ") : "none"}`,
    `Next: ${report.nextActions.join(" | ") || "none"}`
  ].join("\n");
}

function renderLearnV2ObservabilityTui(report: LearnV2PipelineObservabilityReport): void {
  clackIntro("OpenSkillKit Learn v2");
  clackNote([
    `Generated: ${report.generatedAt}`,
    `Run: ${report.run.previewOnly ? "preview" : "apply"} / ${report.run.modelMode}`,
    `Sources: ${report.sources.included} included, ${report.sources.reviewNeeded} review-needed, ${report.sources.excluded} excluded / ${report.sources.considered}`,
    `Quality gates: eval ${report.qualityGates.evalStatus}, leak ${report.qualityGates.leakStatus}`
  ].join("\n"), "Pipeline");
  clackNote([
    `Evidence: ${report.evidence.normalizedEvidence} records -> ${report.evidence.episodes} episodes`,
    `Confidence: high ${report.evidence.confidenceBuckets.high}, medium ${report.evidence.confidenceBuckets.medium}, low ${report.evidence.confidenceBuckets.low}`,
    `Evidence quality: ${renderLearnV2CountLine(report.evidence.qualityTierCounts)}`,
    `Quality actions: ${renderLearnV2CountLine(report.evidence.qualityActionCounts)}`,
    `Stitching: ${renderLearnV2CountLine(report.evidence.stitchingMethodCounts)}`,
    `Risks: ${renderLearnV2CountLine(report.evidence.stitchingRiskCounts)}`
  ].join("\n"), "Episodes");
  clackNote([
    `Tools: ${report.compression.tools}`,
    `Compression: ${renderLearnV2CountLine(report.compression.toolCompressionStrategyCounts)}`,
    `Omitted bytes: ${report.compression.totalToolOmittedBytes}`,
    `Patches: ${report.compression.behaviorEligiblePatches} eligible, ${report.compression.auditOnlyPatches} audit-only / ${report.compression.patches}`,
    `Patch filters: ${renderLearnV2CountLine(report.compression.patchFilterReasonCounts)}`
  ].join("\n"), "Compression");
  clackNote([
    `Cards: ${report.concepts.cards}`,
    `Review-ready: ${report.concepts.reviewReadyCards}`,
    `Status: ${renderLearnV2CountLine(report.concepts.statusCounts)}`,
    `Risk: ${renderLearnV2CountLine(report.concepts.riskCounts)}`,
    `Conflicts: ${report.concepts.unresolvedConflicts} unresolved (${renderLearnV2CountLine(report.concepts.conflictTypeCounts)})`,
    `Safe bulk: ${report.qualityGates.safeBulkActions.join(", ") || "none"}`
  ].join("\n"), "Concepts");
  if (Object.keys(report.artifacts).length) {
    clackNote(Object.entries(report.artifacts).map(([key, value]) => `${key}: ${value}`).join("\n"), "Artifacts");
  }
  for (const action of report.nextActions) clackLog.step(action);
  clackOutro("Learn v2 visibility complete. Raw evidence stayed local-only.");
}

function renderLearnV2CountLine(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none";
}

function renderLearnV2ModelRequests(result: Awaited<ReturnType<typeof writeLearnV2ModelRequests>>): string {
  const lines = [
    `Learn v2 model requests: ${result.requestCount}`,
    ...result.requests.map((request) => `  ${request.episodeId}: ${request.promptPath} -> ${request.expectedOutputPath}`),
    ...result.requests.map((request) => `  manifest: ${request.manifestPath}`)
  ];
  lines.push(...result.instructions);
  return lines.join("\n");
}

function renderLearnV2Reconstruct(result: Awaited<ReturnType<typeof reconstructPersistedLearnV2Episodes>>): string {
  return [
    `Learn v2 analysis frames: ${result.analysisFrameCount}`,
    `Normalized evidence: ${result.normalizedEvidenceCount}`,
    `Episodes: ${result.episodeCount}`,
    `Episode store: ${result.episodeStorePath}`,
    `Model requests: ${result.modelRequestCount} (${result.modelRequestDir})`
  ].join("\n");
}

function renderLearnV2Extract(result: Awaited<ReturnType<typeof extractPersistedLearnV2Concepts>>): string {
  return [
    `Learn v2 episodes: ${result.episodeCount}`,
    `Behavior atoms: ${result.atomCount}`,
    `Rejected atoms: ${result.rejectedAtomCount}`,
    `Concept store cards: ${result.conceptCount}`,
    `Concept store: ${result.conceptStorePath}`
  ].join("\n");
}

function renderLearnV2PersistedEval(result: Awaited<ReturnType<typeof runPersistedLearnV2Eval>>): string {
  return [
    `Learn v2 eval: ${result.evalStatus}`,
    `Episodes: ${result.episodeCount}`,
    `Concepts: ${result.conceptCount}`,
    `Eval report: ${result.evalReportPath}`
  ].join("\n");
}

function renderLearnV2ModelProposalApply(result: Awaited<ReturnType<typeof applyLearnV2ModelProposalOutputs>>): string {
  const lines = [
    `Learn v2 model outputs applied: ${result.outputFiles.length}`,
    `Validated atoms: ${result.atomCount}`,
    `Rejected proposals: ${result.rejected.length}`,
    `Concept store cards: ${result.conceptCount}`,
    `Concept store: ${result.conceptStorePath}`
  ];
  for (const item of result.rejected.slice(0, 20)) {
    lines.push(`REJECTED ${item.id}: ${item.reason}${item.detail ? ` (${item.detail})` : ""}`);
  }
  return lines.join("\n");
}

function renderLearnV2Activation(result: Awaited<ReturnType<typeof activateLearnV2Concepts>>): string {
  const lines = [
    `Learn v2 activation matches: ${result.matches.length}`,
    `Suppressed: ${result.suppressed.length}`,
    `Activation index: ${result.activationIndexPath}`
  ];
  for (const match of result.matches) {
    lines.push(`  [${match.score.toFixed(3)}] ${match.conceptId} ${match.title} (${match.status}; ${match.reasons.join(", ")})`);
  }
  for (const match of result.suppressed.slice(0, 8)) {
    lines.push(`  SUPPRESSED ${match.conceptId} (${match.reasons.join(", ")})`);
  }
  return lines.join("\n");
}

function renderRawVaultMaintenance(result: Awaited<ReturnType<typeof runLearnV2RawVaultMaintenance>>): string {
  return [
    `Learn v2 raw vault: ${result.status}`,
    `Records: ${result.manifest.records.length}`,
    `Hot bytes: ${result.manifest.budget.hotBytes}/${result.manifest.budget.maxHotBytes}`,
    `Pinned bytes: ${result.manifest.budget.pinnedBytes}`,
    `Compacted bytes: ${result.manifest.budget.compactedBytes}`,
    `Expired records: ${result.manifest.budget.expiredCount}`,
    `GC run: ${result.gc}`,
    `Records compacted: ${result.compactedRecords}`,
    `Blobs removed: ${result.removedBlobRefs.length}`,
    `Manifest: ${result.manifestPath}`,
    ...result.nextActions
  ].join("\n");
}

function renderDoctorReport(report: { status: "pass" | "warn" | "fail"; checks: Array<{ name: string; status: "pass" | "warn" | "fail"; message: string }> }): string {
  const notable = report.checks.filter((check) => check.status !== "pass");
  const lines = [`Doctor ${report.status}: ${report.checks.length} checks`];
  lines.push(...notable.map((check) => `${check.status.toUpperCase()} ${check.name}: ${check.message}`));
  return lines.join("\n");
}

async function runOskPackAction(
  actionInput: string,
  options: {
    packPath?: string;
    otherPackPath?: string;
    yes: boolean;
    review: boolean;
    trustHooks: boolean;
    maxChangedFiles?: number;
    keyDir?: string;
  }
): Promise<{ data: unknown; text: string; exitCode?: number }> {
  const action = actionInput.toLowerCase();
  if (action === "export") {
    const result = await exportProjectBehaviorPack(process.cwd());
    return { data: result, text: `Exported pack ${result.packPath}` };
  }
  const packPath = options.packPath;
  if (!packPath) throw new Error(`Pack path required for /osk pack ${action}.`);
  if (action === "verify") {
    const result = await verifyProjectBehaviorPack(packPath);
    return { data: result, text: `${result.status}: ${result.issues.join("; ") || "pack verified"}`, exitCode: result.status === "fail" ? 1 : 0 };
  }
  if (action === "inspect") {
    const result = await inspectProjectBehaviorPack(packPath);
    return { data: result, text: `${result.status}: ${result.fileCount} file(s), signature ${result.signature.status}`, exitCode: result.status === "fail" ? 1 : 0 };
  }
  if (action === "sign") {
    const result = await signProjectBehaviorPack(packPath, options.keyDir);
    return { data: result, text: `Signed pack ${result.packPath}\nPublic key: ${result.publicKeyPath}` };
  }
  if (action === "diff") {
    if (!options.otherPackPath) throw new Error("Other pack path required for /osk pack diff.");
    const result = await diffProjectBehaviorPacks(packPath, options.otherPackPath);
    return { data: result, text: `Added: ${result.added.length}\nRemoved: ${result.removed.length}\nChanged: ${result.changed.length}` };
  }
  if (action === "import" || action === "apply") {
    const apply = action === "apply" || options.yes;
    if (action === "apply" && !options.yes) throw new Error("/osk pack apply requires --yes.");
    const result = await importProjectBehaviorPack(process.cwd(), packPath, {
      dryRun: !apply,
      trustHooks: options.trustHooks,
      review: options.review || !apply,
      maxChangedFiles: options.maxChangedFiles
    });
    return {
      data: result,
      text: `${result.status}: ${result.files.length} file(s)${result.reviewPath ? `\nReview: ${result.reviewPath}` : ""}${result.issues.length ? `\nIssues: ${result.issues.join("; ")}` : ""}`,
      exitCode: result.status === "blocked" ? 1 : 0
    };
  }
  throw new Error(`Unknown /osk pack action: ${actionInput}. Expected export, verify, inspect, sign, diff, import, or apply.`);
}

async function runInteractiveLearnPicker(projectRoot: string, maxEvents: number): Promise<LearnSourcePlan | LearnRun> {
  const plan = await planLearningSources(projectRoot, { sourceMode: "ask" });
  const choices = plan.question.choices;
  if (!choices.length) return plan;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(plan.question.prompt);
    for (const [index, choice] of choices.entries()) {
      const option = plan.options.find((item) => item.id === choice.id);
      const marker = plan.defaults.selectedSourceIds.includes(choice.id) ? "*" : " ";
      const approval = choice.approvalRequired ? "approval required" : "safe metadata";
      console.log(`${index + 1}. [${marker}] ${choice.id} - ${choice.label} (${approval})`);
      if (option?.reason) console.log(`   ${option.reason}`);
    }
    const answer = (await rl.question("Select source numbers/ids, `all`, or Enter for defaults: ")).trim();
    if (/^(q|quit|cancel)$/i.test(answer)) return plan;
    const selectedSourceIds = parseLearnSelection(answer, plan);
    if (!selectedSourceIds.length) return plan;
    const selectedOptions = selectedSourceIds
      .map((id) => plan.options.find((item) => item.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const hasExplicitImport = selectedOptions.some((item) => item.policy === "explicit-import");
    const pipedPrompt = process.stdin.isTTY !== true || process.stdout.isTTY !== true;
    const previewOnly = hasExplicitImport || pipedPrompt
      ? true
      : !await askYes(rl, "Apply selected safe metadata now? Default is preview only");
    if (hasExplicitImport) {
      console.log("Explicit import selected; running preview only. Re-run with explicit --source id and --apply after reviewing the preview.");
    }
    return runLearningPlan(projectRoot, {
      sourceMode: "selected",
      selectedSourceIds,
      previewOnly,
      maxEvents
    });
  } finally {
    rl.close();
  }
}

function parseLearnSelection(answer: string, plan: LearnSourcePlan): string[] {
  const available = new Map(plan.question.choices.map((choice, index) => [choice.id, { id: choice.id, index: index + 1 }]));
  if (!answer) return plan.defaults.selectedSourceIds.filter((id) => available.has(id));
  if (/^(all|a)$/i.test(answer)) return plan.question.choices.map((choice) => choice.id);
  const selected = new Set<string>();
  for (const token of answer.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)) {
    const byNumber = Number.parseInt(token, 10);
    const numbered = Number.isFinite(byNumber) ? [...available.values()].find((item) => item.index === byNumber) : undefined;
    if (numbered) {
      selected.add(numbered.id);
      continue;
    }
    if (available.has(token)) selected.add(token);
    else throw new Error(`Unknown learning source selection: ${token}`);
  }
  return [...selected];
}

function canPrompt(): boolean {
  return process.env.OPENSKILLKIT_FORCE_INTERACTIVE === "1" || (process.stdin.isTTY === true && process.stdout.isTTY === true);
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

function parseRawLearningModelMode(value: string): typeof RawLearningModelModes[number] {
  if ((RawLearningModelModes as readonly string[]).includes(value)) return value as typeof RawLearningModelModes[number];
  throw new Error(`Invalid raw learning model mode: ${value}. Expected one of: ${RawLearningModelModes.join(", ")}`);
}

function parseConceptOutcome(value: string | undefined): Parameters<typeof recordLearnV2ConceptOutcome>[1]["outcome"] {
  const outcome = value ?? "helpful";
  if (["helpful", "ignored", "wrong", "harmful", "superseded"].includes(outcome)) return outcome as Parameters<typeof recordLearnV2ConceptOutcome>[1]["outcome"];
  throw new Error(`Invalid concept outcome: ${outcome}. Expected helpful, ignored, wrong, harmful, or superseded.`);
}

function parseConceptBulkAction(value: string | undefined): "accept-low-risk" | "reject-one-off" | "mark-superseded" | undefined {
  if (!value) return undefined;
  if (value === "accept-low-risk" || value === "reject-one-off" || value === "mark-superseded") return value;
  throw new Error(`Invalid learn-v2 concept bulk action: ${value}`);
}

type ConceptReviewOptionsInput = Parameters<typeof applyLearnV2ConceptReview>[1];

function parseConceptMergeOptions(values: string[] | undefined): NonNullable<ConceptReviewOptionsInput["mergeConcepts"]> {
  return (values ?? []).map((value) => {
    const parsed = parseJsonOption(value, "--concept-merge") as Partial<NonNullable<ConceptReviewOptionsInput["mergeConcepts"]>[number]>;
    if (!parsed.targetId || !Array.isArray(parsed.sourceIds) || !parsed.sourceIds.length) throw new Error("--concept-merge requires targetId and non-empty sourceIds.");
    return {
      targetId: parsed.targetId,
      sourceIds: parsed.sourceIds,
      title: parsed.title,
      canonicalBehavior: parsed.canonicalBehavior,
      activationPhrases: parsed.activationPhrases
    };
  });
}

function parseConceptSplitOptions(values: string[] | undefined): NonNullable<ConceptReviewOptionsInput["splitConcepts"]> {
  return (values ?? []).map((value) => {
    const parsed = parseJsonOption(value, "--concept-split") as Partial<NonNullable<ConceptReviewOptionsInput["splitConcepts"]>[number]>;
    if (!parsed.sourceId || !Array.isArray(parsed.atomIds) || !parsed.atomIds.length) throw new Error("--concept-split requires sourceId and non-empty atomIds.");
    return {
      sourceId: parsed.sourceId,
      atomIds: parsed.atomIds,
      title: parsed.title,
      canonicalBehavior: parsed.canonicalBehavior,
      paths: parsed.paths,
      taskTypes: parsed.taskTypes,
      activationPhrases: parsed.activationPhrases
    };
  });
}

function parseConceptSupersedeOptions(values: string[] | undefined): NonNullable<ConceptReviewOptionsInput["supersedeConcepts"]> {
  return (values ?? []).map((value) => {
    const parsed = parseJsonOption(value, "--concept-supersede") as Partial<NonNullable<ConceptReviewOptionsInput["supersedeConcepts"]>[number]>;
    if (!parsed.supersededId || !parsed.supersededById) throw new Error("--concept-supersede requires supersededId and supersededById.");
    return {
      supersededId: parsed.supersededId,
      supersededById: parsed.supersededById,
      reason: parsed.reason
    };
  });
}

function parseJsonOption(value: string, optionName: string): unknown {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected JSON object");
    return parsed;
  } catch (error) {
    throw new Error(`Invalid ${optionName} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function hasConceptReviewOptions(options: {
  conceptAccept?: string[];
  conceptReject?: string[];
  conceptLock?: string[];
  conceptDemote?: string[];
  conceptOneOff?: string[];
  conceptMerge?: string[];
  conceptSplit?: string[];
  conceptSupersede?: string[];
  conceptAutoPolicy?: boolean;
  conceptBulk?: string;
}): boolean {
  return Boolean(
    options.conceptBulk
    || options.conceptAccept?.length
    || options.conceptReject?.length
    || options.conceptLock?.length
    || options.conceptDemote?.length
    || options.conceptOneOff?.length
    || options.conceptMerge?.length
    || options.conceptSplit?.length
    || options.conceptSupersede?.length
    || options.conceptAutoPolicy
  );
}

function parseTaskOutcome(value: string): "completed" | "accepted" | "rejected" | "edited" {
  if (value === "completed" || value === "accepted" || value === "rejected" || value === "edited") return value;
  throw new Error(`Invalid task outcome: ${value}. Expected completed, accepted, rejected, or edited.`);
}

function parseCommandStatus(value: string): "pass" | "fail" | "blocked" | "timeout" | "unknown" {
  if (value === "pass" || value === "fail" || value === "blocked" || value === "timeout" || value === "unknown") return value;
  throw new Error(`Invalid command status: ${value}. Expected pass, fail, blocked, timeout, or unknown.`);
}

function makeDiffStats(added: number | undefined, removed: number | undefined, files: number | undefined): { added: number; removed: number; files: number } | undefined {
  if (added === undefined && removed === undefined && files === undefined) return undefined;
  return {
    added: added ?? 0,
    removed: removed ?? 0,
    files: files ?? 0
  };
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

interface SetupWizardOptions {
  yes: boolean;
  nonInteractive: boolean;
  skipHooks: boolean;
  skipManifests: boolean;
}

interface SetupWizardResult {
  schemaVersion: "openskill-kit.setup-wizard.v1";
  status: "planned" | "installed" | "cancelled" | "blocked";
  host: AgentPluginAttachHost;
  applied: boolean;
  compiledPlugin?: string;
  plannedFiles: number;
  plannedHookFiles?: number;
  plannedManifestFiles?: number;
  hooksStatus?: string;
  manifestsStatus?: string;
  messages: string[];
}

async function runSetupWizard(projectRoot: string, hostInput: string, options: SetupWizardOptions): Promise<SetupWizardResult> {
  const host = parseAgentPluginAttachHost(hostInput);
  const messages = [
    "OpenSkillKit setup wizard",
    "Privacy: local-first, no model training, no raw prompt/diff storage by default.",
    `Target host: ${host}`,
    `Project root: ${projectRoot}`
  ];
  if (host !== "opencode") {
    return {
      schemaVersion: "openskill-kit.setup-wizard.v1",
      status: "blocked",
      host,
      applied: false,
      plannedFiles: 0,
      messages: [...messages, "`osk setup` is OpenCode-specific. Use `openskill-kit agent attach-plugin --host <host> --dry-run` for other harnesses."]
    };
  }
  const rl = options.nonInteractive || options.yes ? undefined : createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (rl && !await askYes(rl, "Proceed with local init, compile, and attach preview?")) {
      return { schemaVersion: "openskill-kit.setup-wizard.v1", status: "cancelled", host, applied: false, plannedFiles: 0, messages: [...messages, "Setup cancelled before writes."] };
    }

    const initRes = await initAdaptiveProject({ projectRoot, projectName: undefined, force: false });
    messages.push(`Initialized project state: ${initRes.status}`);
    const compileRes = await compileBehaviorLayer(projectRoot, { targets: ["plugin"] });
    messages.push(`Compiled plugin targets: ${compileRes.compiledTargets.join(", ")}`);

    const previewRes = await attachAgentPlugin(projectRoot, { host, dryRun: true, yes: false });
    messages.push(...previewRes.messages.map((message) => `Preview: ${message}`));
    if (previewRes.status === "blocked") {
      return { schemaVersion: "openskill-kit.setup-wizard.v1", status: "blocked", host, applied: false, compiledPlugin: compileRes.pluginManifestPath, plannedFiles: previewRes.files.length, messages };
    }

    const hooksPreview = options.skipHooks ? undefined : await installAgentHooks({ projectRoot, target: "project", dryRun: true });
    if (hooksPreview) {
      messages.push(...hooksPreview.messages.map((message) => `Hooks preview: ${message}`));
      if (hooksPreview.status === "blocked") {
        return {
          schemaVersion: "openskill-kit.setup-wizard.v1",
          status: "blocked",
          host,
          applied: false,
          compiledPlugin: compileRes.pluginManifestPath,
          plannedFiles: previewRes.files.length + 1,
          plannedHookFiles: 1,
          messages
        };
      }
    } else {
      messages.push("Hooks skipped.");
    }

    const manifestsPreview = options.skipManifests ? undefined : await installInstructionManifests(projectRoot, { target: "project", dryRun: true });
    if (manifestsPreview) {
      messages.push(...manifestsPreview.messages.map((message) => `Instruction manifests preview: ${message}`));
      if (manifestsPreview.status === "blocked") {
        return {
          schemaVersion: "openskill-kit.setup-wizard.v1",
          status: "blocked",
          host,
          applied: false,
          compiledPlugin: compileRes.pluginManifestPath,
          plannedFiles: previewRes.files.length + (hooksPreview ? 1 : 0) + manifestsPreview.files.length,
          plannedHookFiles: hooksPreview ? 1 : 0,
          plannedManifestFiles: manifestsPreview.files.length,
          messages
        };
      }
    } else {
      messages.push("Instruction manifests skipped.");
    }

    const plannedHookFiles = hooksPreview ? 1 : 0;
    const plannedManifestFiles = manifestsPreview?.files.length ?? 0;
    const plannedFiles = previewRes.files.length + plannedHookFiles + plannedManifestFiles;
    const applySurfaces = [
      "host config",
      "generated OpenCode files",
      ...(options.skipHooks ? [] : ["hooks"]),
      ...(options.skipManifests ? [] : ["instruction manifests"])
    ];
    const shouldApply = options.yes || (rl ? await askYes(rl, `Apply previewed ${formatList(applySurfaces)}?`) : false);
    if (!shouldApply) {
      messages.push(`Preview only. Re-run with \`--yes\` to apply ${formatList(applySurfaces)}.`);
      return {
        schemaVersion: "openskill-kit.setup-wizard.v1",
        status: "planned",
        host,
        applied: false,
        compiledPlugin: compileRes.pluginManifestPath,
        plannedFiles,
        plannedHookFiles,
        plannedManifestFiles,
        messages
      };
    }

    const deployRes = await attachAgentPlugin(projectRoot, { host, dryRun: false, yes: true });
    messages.push(...deployRes.messages.map((message) => `Apply: ${message}`));
    if (deployRes.status === "blocked") {
      return { schemaVersion: "openskill-kit.setup-wizard.v1", status: "blocked", host, applied: false, compiledPlugin: compileRes.pluginManifestPath, plannedFiles, plannedHookFiles, plannedManifestFiles, messages };
    }

    let hooksStatus: string | undefined;
    if (!options.skipHooks) {
      const hooksRes = await installAgentHooks({ projectRoot, target: "project", yes: true });
      hooksStatus = hooksRes.status;
      messages.push(`Hooks: ${hooksRes.status}`);
      if (hooksRes.status === "blocked") {
        return { schemaVersion: "openskill-kit.setup-wizard.v1", status: "blocked", host, applied: false, compiledPlugin: compileRes.pluginManifestPath, plannedFiles, plannedHookFiles, plannedManifestFiles, hooksStatus, messages };
      }
    } else {
      messages.push("Hooks skipped.");
    }

    let manifestsStatus: string | undefined;
    if (!options.skipManifests) {
      const manifestsRes = await installInstructionManifests(projectRoot, { target: "project", dryRun: false, yes: true });
      manifestsStatus = manifestsRes.status;
      messages.push(`Instruction manifests: ${manifestsRes.status}`);
      if (manifestsRes.status === "blocked") {
        return { schemaVersion: "openskill-kit.setup-wizard.v1", status: "blocked", host, applied: false, compiledPlugin: compileRes.pluginManifestPath, plannedFiles, plannedHookFiles, plannedManifestFiles, hooksStatus, manifestsStatus, messages };
      }
    } else {
      messages.push("Instruction manifests skipped.");
    }

    const explained = await explainAdaptiveStatus(projectRoot);
    messages.push(`Ready. Active preferences: ${explained.status.activePreferenceCount}`);
    messages.push("Restart OpenCode, then run `/osk status`.");
    return { schemaVersion: "openskill-kit.setup-wizard.v1", status: "installed", host, applied: true, compiledPlugin: compileRes.pluginManifestPath, plannedFiles, plannedHookFiles, plannedManifestFiles, hooksStatus, manifestsStatus, messages };
  } finally {
    rl?.close();
  }
}

interface UninstallWizardOptions {
  dryRun: boolean;
  yes: boolean;
  nonInteractive: boolean;
  deleteState: boolean;
}

interface UninstallWizardResult {
  schemaVersion: "openskill-kit.uninstall-wizard.v1";
  status: "planned" | "uninstalled" | "cancelled" | "blocked";
  host: AgentPluginAttachHost;
  dryRun: boolean;
  configChanged: boolean;
  removed: string[];
  planned: string[];
  messages: string[];
}

async function runUninstallWizard(projectRoot: string, hostInput: string, options: UninstallWizardOptions): Promise<UninstallWizardResult> {
  const host = parseAgentPluginAttachHost(hostInput);
  const dryRun = options.dryRun || !options.yes;
  const messages = [
    "OpenSkillKit uninstall wizard",
    `Target host: ${host}`,
    dryRun ? "Dry-run only. Re-run with `--yes` to apply removals." : "Applying approved uninstall."
  ];
  if (host !== "opencode") {
    return {
      schemaVersion: "openskill-kit.uninstall-wizard.v1",
      status: "blocked",
      host,
      dryRun: true,
      configChanged: false,
      removed: [],
      planned: [],
      messages: [...messages, "`osk uninstall` is OpenCode-specific. Use host-native config review for other harnesses."]
    };
  }
  const rl = options.nonInteractive || options.yes || dryRun ? undefined : createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (rl && !await askYes(rl, "Revert OpenCode settings and remove generated OSK files?")) {
      return { schemaVersion: "openskill-kit.uninstall-wizard.v1", status: "cancelled", host, dryRun: true, configChanged: false, removed: [], planned: [], messages: [...messages, "Uninstall cancelled."] };
    }

    const planned = await planOpenCodeUninstall(projectRoot, options.deleteState);
    messages.push(...planned.paths.map((item) => `Plan remove: ${item}`));
    if (dryRun) {
      return { schemaVersion: "openskill-kit.uninstall-wizard.v1", status: "planned", host, dryRun: true, configChanged: planned.configChanged, removed: [], planned: planned.paths, messages };
    }

    if (options.deleteState && !options.yes) {
      return { schemaVersion: "openskill-kit.uninstall-wizard.v1", status: "blocked", host, dryRun: false, configChanged: false, removed: [], planned: planned.paths, messages: [...messages, "`--delete-state` requires `--yes`."] };
    }

    if (planned.nextConfig !== undefined) {
      const opencodeJsonPath = await resolveOpenCodeConfigPath(projectRoot);
      assertInsideProject(projectRoot, opencodeJsonPath);
      const text = typeof planned.nextConfig === "string" ? planned.nextConfig : `${JSON.stringify(planned.nextConfig, null, 2)}\n`;
      await fs.writeFile(opencodeJsonPath, text, "utf8");
      messages.push(`Updated ${path.basename(opencodeJsonPath)}.`);
    }

    const removed: string[] = [];
    for (const relativePath of planned.paths) {
      const absolutePath = path.join(projectRoot, relativePath);
      assertInsideProject(projectRoot, absolutePath);
      await fs.rm(absolutePath, { recursive: true, force: true });
      removed.push(relativePath);
      messages.push(`Removed: ${relativePath}`);
    }

    const manifests = await uninstallInstructionManifests(projectRoot, { target: "project", dryRun: false, yes: true });
    messages.push(`Instruction manifests: ${manifests.status}`);
    messages.push(options.deleteState ? "Local OSK state removed." : "Local OSK state preserved.");
    messages.push("Restart OpenCode to finalize removal.");
    return { schemaVersion: "openskill-kit.uninstall-wizard.v1", status: "uninstalled", host, dryRun: false, configChanged: planned.configChanged, removed, planned: planned.paths, messages };
  } finally {
    rl?.close();
  }
}

async function askYes(rl: ReturnType<typeof createInterface>, question: string): Promise<boolean> {
  const answer = (await rl.question(`${question} (y/n): `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

async function resolveOpenCodeConfigPath(projectRoot: string): Promise<string> {
  const jsonPath = path.join(projectRoot, "opencode.json");
  const jsoncPath = path.join(projectRoot, "opencode.jsonc");
  const [hasJson, hasJsonc] = await Promise.all([
    fs.stat(jsonPath).then(() => true).catch(() => false),
    fs.stat(jsoncPath).then(() => true).catch(() => false)
  ]);
  return hasJsonc && !hasJson ? jsoncPath : jsonPath;
}

function parseOpenCodeConfig(text: string, filePath: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(stripUtf8Bom(text), errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    const format = filePath.endsWith(".jsonc") ? "JSONC" : "JSON";
    throw new Error(`Existing OpenCode config is not valid ${format}: ${errors.map((error) => `error ${error.error} at offset ${error.offset}`).join(", ")}`);
  }
  return isRecord(parsed) ? parsed : {};
}

function applyOpenCodeJsoncEdits(text: string, edits: Array<{ path: Array<string | number>; value: unknown }>): string {
  const hadBom = text.charCodeAt(0) === 0xfeff;
  const body = stripUtf8Bom(text);
  const edited = edits.reduce((current, edit) => applyEdits(current, modify(current, edit.path, edit.value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  })), body);
  return hadBom ? `\uFEFF${edited}` : edited;
}

function stripUtf8Bom(text: string): string {
  return text.replace(/^\uFEFF+/, "");
}

async function planOpenCodeUninstall(projectRoot: string, deleteState: boolean): Promise<{ configChanged: boolean; nextConfig?: Record<string, unknown> | string; paths: string[] }> {
  const paths = new Set<string>([".agents/hooks/openskill-kit.json", ".openskill-kit/compiled"]);
  const opencodeJsonPath = await resolveOpenCodeConfigPath(projectRoot);
  let configChanged = false;
  let nextConfig: Record<string, unknown> | string | undefined;
  try {
    const existing = await fs.readFile(opencodeJsonPath, "utf8");
    const config = parseOpenCodeConfig(existing, opencodeJsonPath);
    nextConfig = { ...config };
    const mcp = isRecord(nextConfig.mcp) ? { ...nextConfig.mcp } : undefined;
    if (mcp && "openskill-kit" in mcp) {
      delete mcp["openskill-kit"];
      configChanged = true;
      if (Object.keys(mcp).length) nextConfig.mcp = mcp;
      else delete nextConfig.mcp;
    }
    if (typeof nextConfig.plugin === "string") {
      if (nextConfig.plugin === ".opencode/plugins/openskillkit.ts") {
        delete nextConfig.plugin;
        configChanged = true;
      }
    } else if (Array.isArray(nextConfig.plugin)) {
      const filtered = nextConfig.plugin.filter((item) => item !== ".opencode/plugins/openskillkit.ts");
      if (filtered.length !== nextConfig.plugin.length) configChanged = true;
      if (filtered.length) nextConfig.plugin = filtered;
      else delete nextConfig.plugin;
    }
    const command = isRecord(nextConfig.command) ? { ...nextConfig.command } : undefined;
    if (command && "osk" in command) {
      delete command.osk;
      configChanged = true;
      if (Object.keys(command).length) nextConfig.command = command;
      else delete nextConfig.command;
    }
    if (!configChanged) nextConfig = undefined;
    else {
      nextConfig = applyOpenCodeJsoncEdits(existing, [
        { path: ["plugin"], value: nextConfig.plugin },
        { path: ["mcp"], value: nextConfig.mcp },
        { path: ["command"], value: nextConfig.command }
      ]);
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw new Error(`Cannot plan OpenCode config cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const item of await generatedOpenCodePaths(projectRoot)) paths.add(item);
  if (deleteState) paths.add(".openskill-kit");
  return { configChanged, nextConfig, paths: [...paths].sort() };
}

async function generatedOpenCodePaths(projectRoot: string): Promise<string[]> {
  const candidates = [
    ".opencode/plugins/openskillkit.ts",
    ".opencode/model-routing.json",
    ...OSK_PUBLIC_COMMAND_FAMILIES.map((family) => path.posix.join(".opencode/commands", family.commandFile)),
    ...EXPECTED_OPENCODE_AGENT_FILES.map((file) => path.posix.join(".opencode/agents", file)),
    ...EXPECTED_OPENCODE_SKILL_DIRS.map((dir) => path.posix.join(".opencode/skills", dir))
  ];
  const existing = await Promise.all(candidates.map(async (relativePath) => ({
    relativePath,
    exists: await fs.stat(path.join(projectRoot, relativePath)).then(() => true).catch(() => false)
  })));
  return existing.filter((item) => item.exists).map((item) => item.relativePath);
}

const EXPECTED_OPENCODE_AGENT_FILES = [
  "osk-docs.md",
  "osk-evaluator.md",
  "osk-evolver.md",
  "osk-learner.md",
  "osk-researcher.md",
  "osk-reviewer.md",
  "osk-router.md",
  "osk-verifier.md"
];

const EXPECTED_OPENCODE_SKILL_DIRS = [
  "osk-learning",
  "osk-openworld",
  "osk-operating-manual",
  "osk-review-gate"
];

function assertInsideProject(projectRoot: string, target: string): void {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to touch path outside project root: ${target}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}
