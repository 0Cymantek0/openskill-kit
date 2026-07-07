import {
  LearnV2OutcomePolicyDecisionSchema,
  type LearnV2OutcomePolicyDecision
} from "./schemas.js";

export interface LearnV2OutcomePolicyFeedback {
  helpful: number;
  ignored: number;
  wrong: number;
  harmful: number;
  superseded: number;
  lastRecordedAt?: string;
}

export const LearnV2OutcomePolicyThresholds = {
  suppressWrongCount: 2,
  suppressIgnoredCount: 3,
  suppressHarmfulCount: 1,
  suppressSupersededCount: 1
} as const;

export function decideLearnV2OutcomePolicy(
  conceptId: string,
  feedback?: LearnV2OutcomePolicyFeedback
): LearnV2OutcomePolicyDecision {
  const counts = {
    helpful: feedback?.helpful ?? 0,
    ignored: feedback?.ignored ?? 0,
    wrong: feedback?.wrong ?? 0,
    harmful: feedback?.harmful ?? 0,
    superseded: feedback?.superseded ?? 0
  };
  const reasons: string[] = [];
  if (counts.harmful >= LearnV2OutcomePolicyThresholds.suppressHarmfulCount) reasons.push("outcome:harmful");
  if (counts.superseded >= LearnV2OutcomePolicyThresholds.suppressSupersededCount) reasons.push("outcome:superseded");
  if (counts.wrong >= LearnV2OutcomePolicyThresholds.suppressWrongCount) reasons.push(`outcome:wrong-threshold:${counts.wrong}`);
  if (counts.ignored >= LearnV2OutcomePolicyThresholds.suppressIgnoredCount) reasons.push(`outcome:ignored-threshold:${counts.ignored}`);
  const action = reasons.length
    ? "suppress-activation"
    : counts.wrong > 0 || counts.ignored > 0
      ? "demote-review"
      : counts.helpful > 0
        ? "allow-activation"
        : "keep-monitoring";
  return LearnV2OutcomePolicyDecisionSchema.parse({
    schemaVersion: "openskill-kit.learn-v2.outcome-policy-decision.v1",
    conceptId,
    action,
    reasons,
    counts,
    lastRecordedAt: feedback?.lastRecordedAt
  });
}
