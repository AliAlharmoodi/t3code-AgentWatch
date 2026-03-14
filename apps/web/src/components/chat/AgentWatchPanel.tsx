import type { AgentWatchCondition, AgentWatchJobSnapshot, ThreadId } from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  CircleCheckBigIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  TerminalSquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  agentWatchJobsQueryOptions,
  agentWatchQueryKeys,
  agentWatchTailQueryOptions,
} from "~/lib/agentWatchReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";

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
    return formatFreshness(job.outputFreshnessMs)
      ? `Updated ${formatFreshness(job.outputFreshnessMs)}`
      : "Running";
  }
  if (typeof job.exitCode === "number") {
    return `Exited ${job.exitCode}`;
  }
  return "Exited";
}

function describePrimaryCondition(condition: AgentWatchCondition | undefined): string | null {
  if (!condition) return null;
  return condition.message;
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const keep = Math.max(8, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function AgentWatchPanel({ threadId }: AgentWatchPanelProps) {
  const queryClient = useQueryClient();
  const jobsQuery = useQuery(agentWatchJobsQueryOptions(threadId));
  const jobs = jobsQuery.data?.jobs ?? EMPTY_JOBS;
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    const api = ensureNativeApi();
    return api.agentWatch.onUpdate((payload) => {
      if (payload.threadId !== threadId) {
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: agentWatchQueryKeys.jobs(threadId),
      });
      void queryClient.invalidateQueries({
        queryKey: agentWatchQueryKeys.tail(payload.job.jobId, 60),
      });
    });
  }, [queryClient, threadId]);

  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedJobId(null);
      setOpen(false);
      return;
    }
    if (selectedJobId && jobs.some((job) => job.jobId === selectedJobId)) {
      return;
    }
    setSelectedJobId((jobs.find((job) => job.shouldInspect) ?? jobs[0] ?? null)?.jobId ?? null);
  }, [jobs, selectedJobId]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.jobId === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId],
  );
  const tailQuery = useQuery(agentWatchTailQueryOptions(selectedJob?.jobId ?? null, 60));

  useEffect(() => {
    if (jobs.some((job) => job.shouldInspect || job.status === "running")) {
      setOpen(true);
      return;
    }
    if (jobs.length > 0) {
      setOpen(false);
    }
  }, [jobs]);

  const runningCount = jobs.filter((job) => job.status === "running").length;
  const inspectCount = jobs.filter((job) => job.shouldInspect).length;
  const primaryJob = jobs.find((job) => job.shouldInspect) ?? jobs[0] ?? null;
  const primaryCondition = primaryJob?.conditions[0];
  const panelStateKey = jobs
    .map((job) =>
      [
        job.jobId,
        job.status,
        job.exitCode ?? "",
        job.finishedAt ?? "",
        job.shouldInspect ? "inspect" : "ok",
      ].join(":"),
    )
    .join("|");

  if (jobs.length === 0 && !jobsQuery.isLoading && !jobsQuery.isError) {
    return null;
  }
  if (panelStateKey.length > 0 && dismissedKey === panelStateKey) {
    return null;
  }

  const variant =
    jobsQuery.isError || inspectCount > 0 ? "warning" : runningCount > 0 ? "info" : "success";
  const title = jobsQuery.isError
    ? "AgentWatch unavailable"
    : inspectCount > 0
      ? `AgentWatch needs attention${inspectCount > 1 ? ` (${inspectCount})` : ""}`
      : runningCount > 0
        ? `AgentWatch running ${runningCount} job${runningCount === 1 ? "" : "s"}`
        : `AgentWatch completed ${jobs.length} job${jobs.length === 1 ? "" : "s"}`;
  const description = jobsQuery.isError
    ? (jobsQuery.error as Error).message
    : primaryCondition
      ? describePrimaryCondition(primaryCondition)
      : primaryJob
        ? `${primaryJob.label}: ${summarizeJob(primaryJob)}`
        : "Waiting for AgentWatch activity.";

  return (
    <div className="mx-auto max-w-5xl px-3 pt-3 sm:px-5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <Alert variant={variant} className="gap-y-2 px-3 py-2.5 pr-12">
          <Button
            size="icon-xs"
            variant="ghost"
            className="absolute right-2 top-2"
            aria-label="Dismiss AgentWatch panel"
            onClick={() => {
              setDismissedKey(panelStateKey || "empty");
              setOpen(false);
            }}
          >
            <XIcon className="size-3.5" />
          </Button>
          {variant === "warning" ? (
            <AlertTriangleIcon />
          ) : variant === "success" ? (
            <CircleCheckBigIcon />
          ) : runningCount > 0 ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <TerminalSquareIcon />
          )}
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription className="min-w-0 gap-1.5">
            <div className="truncate text-sm" title={description ?? undefined}>
              {description}
            </div>
            {primaryJob ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/80">
                <span className="rounded border border-border/70 bg-background/60 px-1.5 py-0.5 font-mono">
                  {primaryJob.label}
                </span>
                <span className="shrink-0">{summarizeJob(primaryJob)}</span>
                <span className="truncate text-muted-foreground" title={primaryJob.command}>
                  {primaryJob.command}
                </span>
              </div>
            ) : null}
          </AlertDescription>
          <AlertAction className="items-start sm:items-center">
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
            <CollapsibleTrigger
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border/70 px-2 text-xs text-foreground transition-colors hover:bg-accent/50"
              aria-label={open ? "Collapse AgentWatch details" : "Expand AgentWatch details"}
            >
              Details
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", open && "rotate-180")}
              />
            </CollapsibleTrigger>
          </AlertAction>
        </Alert>

        <CollapsibleContent>
          <div className="mt-2 grid gap-2 xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-lg border border-border/80 bg-background">
              <div className="divide-y divide-border/70">
                {jobs.map((job) => {
                  const condition = job.conditions[0];
                  const isSelected = job.jobId === selectedJob?.jobId;
                  return (
                    <button
                      key={job.jobId}
                      type="button"
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-2 text-left transition-colors hover:bg-accent/40",
                        isSelected && "bg-accent/50",
                      )}
                      onClick={() => setSelectedJobId(job.jobId)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {job.label}
                        </div>
                        <div
                          className="truncate font-mono text-[11px] text-muted-foreground"
                          title={job.command}
                        >
                          {truncateMiddle(job.command, 48)}
                        </div>
                      </div>
                      <div
                        className={cn(
                          "shrink-0 text-[11px]",
                          job.shouldInspect ? "text-warning" : "text-muted-foreground",
                        )}
                      >
                        {summarizeJob(job)}
                      </div>
                      <div
                        className="col-span-2 truncate text-[11px] text-muted-foreground"
                        title={job.cwd}
                      >
                        {truncateMiddle(job.cwd, 64)}
                      </div>
                      {condition ? (
                        <div className="col-span-2 line-clamp-1 text-[11px] text-warning">
                          {condition.message}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border/80 bg-background">
              <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {selectedJob?.label ?? "Latest output"}
                  </div>
                  <div
                    className="truncate text-[11px] text-muted-foreground"
                    title={selectedJob?.cwd ?? undefined}
                  >
                    {selectedJob?.cwd ?? "Waiting for output"}
                  </div>
                </div>
                {selectedJob ? (
                  <div className="shrink-0 text-[11px] text-muted-foreground">
                    {summarizeJob(selectedJob)}
                  </div>
                ) : null}
              </div>
              <div className="min-h-28 max-h-48 overflow-y-auto">
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
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
