import { Schema } from "effect";
import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const AgentWatchConditionCode = Schema.Literals([
  "stale_output",
  "non_zero_exit",
  "abnormal_exit",
  "missing_job",
]);
export type AgentWatchConditionCode = typeof AgentWatchConditionCode.Type;

export const AgentWatchCondition = Schema.Struct({
  code: AgentWatchConditionCode,
  message: TrimmedNonEmptyString,
});
export type AgentWatchCondition = typeof AgentWatchCondition.Type;

export const AgentWatchJobStatus = Schema.Literals(["running", "exited"]);
export type AgentWatchJobStatus = typeof AgentWatchJobStatus.Type;

export const AgentWatchJobSnapshot = Schema.Struct({
  jobId: TrimmedNonEmptyString,
  threadId: Schema.optional(ThreadId),
  label: TrimmedNonEmptyString,
  command: Schema.String,
  cwd: Schema.String,
  pid: Schema.Number,
  status: AgentWatchJobStatus,
  exitCode: Schema.optional(Schema.Number),
  startedAt: TrimmedNonEmptyString,
  finishedAt: Schema.optional(TrimmedNonEmptyString),
  lastOutputAt: Schema.optional(TrimmedNonEmptyString),
  outputFreshnessMs: Schema.optional(NonNegativeInt),
  shouldInspect: Schema.Boolean,
  conditions: Schema.Array(AgentWatchCondition),
});
export type AgentWatchJobSnapshot = typeof AgentWatchJobSnapshot.Type;

export const AgentWatchPollInput = Schema.Struct({
  jobId: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(ThreadId),
  includeHealthy: Schema.optional(Schema.Boolean),
});
export type AgentWatchPollInput = typeof AgentWatchPollInput.Type;

export const AgentWatchPollResult = Schema.Struct({
  jobs: Schema.Array(AgentWatchJobSnapshot),
});
export type AgentWatchPollResult = typeof AgentWatchPollResult.Type;

export const AgentWatchTailInput = Schema.Struct({
  jobId: TrimmedNonEmptyString,
  lines: Schema.optional(NonNegativeInt),
});
export type AgentWatchTailInput = typeof AgentWatchTailInput.Type;

export const AgentWatchTailResult = Schema.Struct({
  jobId: TrimmedNonEmptyString,
  output: Schema.String,
});
export type AgentWatchTailResult = typeof AgentWatchTailResult.Type;
