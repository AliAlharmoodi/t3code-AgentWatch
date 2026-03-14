import type { ThreadId } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

export const agentWatchQueryKeys = {
  all: ["agentWatch"] as const,
  jobs: (threadId: ThreadId | null) => ["agentWatch", "jobs", threadId] as const,
  tail: (jobId: string | null, lines: number) => ["agentWatch", "tail", jobId, lines] as const,
};

export function agentWatchJobsQueryOptions(threadId: ThreadId | null) {
  return queryOptions({
    queryKey: agentWatchQueryKeys.jobs(threadId),
    queryFn: async () => {
      if (!threadId) {
        return { jobs: [] };
      }
      const api = ensureNativeApi();
      return api.agentWatch.poll({ threadId, includeHealthy: true });
    },
    enabled: Boolean(threadId),
    refetchInterval: 10_000,
  });
}

export function agentWatchTailQueryOptions(jobId: string | null, lines = 80) {
  return queryOptions({
    queryKey: agentWatchQueryKeys.tail(jobId, lines),
    queryFn: async () => {
      if (!jobId) {
        return { jobId: "", output: "" };
      }
      const api = ensureNativeApi();
      return api.agentWatch.tail({ jobId, lines });
    },
    enabled: Boolean(jobId),
    refetchInterval: 10_000,
  });
}
