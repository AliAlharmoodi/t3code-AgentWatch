import type { AgentWatchJobSnapshot, ThreadId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, CircleAlertIcon, RotateCwIcon, TerminalSquareIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { agentWatchJobsQueryOptions, agentWatchTailQueryOptions } from "~/lib/agentWatchReactQuery";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

interface AgentWatchPanelProps {
  threadId: ThreadId;
}

const EMPTY_JOBS: AgentWatchJobSnapshot[] = [];

function formatFreshness(freshnessMs: number | undefined): string | null {
  if (freshnessMs === undefined) return null;
  if (freshnessMs < 1_000) return `${freshnessMs}ms ago`;
  if (freshnessMs < 60_000) return `${Math.round(freshnessMs / 1_000)}s ago`;
  return `${Math.round(freshnessMs / 60_000)}m ago`;
}

function summarizeJob(job: AgentWatchJobSnapshot): string {
  if (job.status === "running") {
    return formatFreshness(job.outputFreshnessMs) ?? "Running";
  }
  if (typeof job.exitCode === "number") {
    return `Exited ${job.exitCode}`;
  }
  return "Exited";
}

export function AgentWatchPanel({ threadId }: AgentWatchPanelProps) {
  const jobsQuery = useQuery(agentWatchJobsQueryOptions(threadId));
  const jobs = jobsQuery.data?.jobs ?? EMPTY_JOBS;
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (selectedJobId && jobs.some((job) => job.jobId === selectedJobId)) {
      return;
    }
    setSelectedJobId((jobs.find((job) => job.shouldInspect) ?? jobs[0] ?? null)?.jobId ?? null);
  }, [jobs, selectedJobId]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.jobId === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const tailQuery = useQuery(agentWatchTailQueryOptions(selectedJob?.jobId ?? null, 60));

  if (jobs.length === 0 && !jobsQuery.isLoading && !jobsQuery.isError) {
    return null;
  }

  return (
    <section className="border-b border-border/80 bg-muted/10 px-3 py-2 sm:px-5">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            <TerminalSquareIcon className="size-4 text-muted-foreground" />
            <span className="font-medium">AgentWatch</span>
            <span className="text-xs text-muted-foreground">
              {jobs.length === 0 ? "No jobs" : `${jobs.length} job${jobs.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void jobsQuery.refetch();
              void tailQuery.refetch();
            }}
            disabled={jobsQuery.isFetching}
          >
            <RotateCwIcon className={cn("size-3.5", jobsQuery.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {jobsQuery.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
            {(jobsQuery.error as Error).message}
          </div>
        ) : null}

        {jobs.length > 0 ? (
          <div className="grid gap-2 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div className="rounded-lg border border-border/80 bg-background">
              <div className="divide-y divide-border/70">
                {jobs.map((job) => {
                  const condition = job.conditions[0];
                  const isSelected = job.jobId === selectedJob?.jobId;
                  return (
                    <button
                      key={job.jobId}
                      type="button"
                      className={cn(
                        "flex w-full flex-col items-start gap-1 px-3 py-2 text-left transition-colors hover:bg-accent/40",
                        isSelected && "bg-accent/50",
                      )}
                      onClick={() => setSelectedJobId(job.jobId)}
                    >
                      <div className="flex w-full items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium text-foreground">
                          {job.label}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-[11px]",
                            job.shouldInspect ? "text-warning-foreground" : "text-muted-foreground",
                          )}
                        >
                          {summarizeJob(job)}
                        </span>
                      </div>
                      <div className="w-full truncate font-mono text-[11px] text-muted-foreground">
                        {job.command}
                      </div>
                      {condition ? (
                        <div className="flex items-start gap-1 text-[11px] text-warning-foreground">
                          <CircleAlertIcon className="mt-0.5 size-3 shrink-0" />
                          <span className="line-clamp-2">{condition.message}</span>
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-background">
              <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {selectedJob?.label ?? "Latest output"}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {selectedJob?.cwd ?? "Waiting for output"}
                  </div>
                </div>
                {selectedJob?.shouldInspect ? (
                  <div className="flex items-center gap-1 text-[11px] text-warning-foreground">
                    <AlertTriangleIcon className="size-3.5" />
                    Inspect
                  </div>
                ) : null}
              </div>
              <div className="min-h-32 max-h-48 overflow-y-auto">
                {tailQuery.isLoading ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">Loading output...</div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words px-3 py-3 font-mono text-[12px] leading-5 text-foreground">
                    {tailQuery.data?.output?.trim() || "No output yet."}
                  </pre>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
