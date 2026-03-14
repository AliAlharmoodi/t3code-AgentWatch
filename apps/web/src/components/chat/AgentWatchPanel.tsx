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
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";

interface AgentWatchPanelProps {
  threadId: ThreadId;
}

const EMPTY_JOBS: AgentWatchJobSnapshot[] = [];

function summarizeJob(job: AgentWatchJobSnapshot): string {
  if (job.status === "running") {
    return "Running";
  }
  if (job.reviewState === "in_review") {
    return "In review";
  }
  if (typeof job.exitCode === "number") {
    return `Exited ${job.exitCode}`;
  }
  return "Exited";
}

function describePrimaryCondition(condition: AgentWatchCondition | undefined): string | null {
  return condition?.message ?? null;
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
  const [checkedJobIds, setCheckedJobIds] = useState<string[]>([]);

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
      setCheckedJobIds([]);
      setOpen(false);
      return;
    }
    if (selectedJobId && jobs.some((job) => job.jobId === selectedJobId)) {
      return;
    }
    setSelectedJobId(
      (
        jobs.find((job) => job.shouldInspect) ??
        jobs.find((job) => job.status === "running") ??
        jobs[0] ??
        null
      )?.jobId ?? null,
    );
  }, [jobs, selectedJobId]);

  useEffect(() => {
    setCheckedJobIds((current) =>
      current.filter((jobId) => jobs.some((job) => job.jobId === jobId)),
    );
  }, [jobs]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.jobId === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId],
  );
  const tailQuery = useQuery(agentWatchTailQueryOptions(selectedJob?.jobId ?? null, 60));

  const actionableCount = jobs.filter((job) => job.shouldInspect).length;
  const reviewCount = jobs.filter((job) => job.reviewState === "in_review").length;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const primaryJob =
    jobs.find((job) => job.shouldInspect) ??
    jobs.find((job) => job.reviewState === "in_review") ??
    jobs.find((job) => job.status === "running") ??
    jobs[0] ??
    null;
  const primaryCondition = primaryJob?.conditions[0];
  const allChecked = jobs.length > 0 && checkedJobIds.length === jobs.length;
  const someChecked = checkedJobIds.length > 0 && !allChecked;
  const checkedRunningCount = jobs.filter(
    (job) => checkedJobIds.includes(job.jobId) && job.status === "running",
  ).length;

  useEffect(() => {
    if (actionableCount > 0 || runningCount > 0) {
      setOpen(true);
      return;
    }
    if (jobs.length > 0) {
      setOpen(false);
    }
  }, [actionableCount, jobs.length, runningCount]);

  const panelStateKey = jobs
    .map((job) =>
      [
        job.jobId,
        job.status,
        job.exitCode ?? "",
        job.finishedAt ?? "",
        job.reviewState,
        job.shouldInspect ? "inspect" : "ok",
      ].join(":"),
    )
    .join("|");

  if (jobs.length === 0 && !jobsQuery.isLoading && !jobsQuery.isError) {
    return null;
  }
  if (panelStateKey.length > 0 && dismissedKey === panelStateKey) {
    return (
      <div className="mx-auto max-w-5xl px-3 pt-3 sm:px-5">
        <div className="flex w-full items-center justify-end">
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setDismissedKey(null);
              if (actionableCount > 0 || runningCount > 0) {
                setOpen(true);
              }
            }}
          >
            Show AgentWatch
          </Button>
        </div>
      </div>
    );
  }

  const variant =
    jobsQuery.isError || actionableCount > 0
      ? "warning"
      : runningCount > 0
        ? "info"
        : reviewCount > 0
          ? "info"
          : "success";
  const title = jobsQuery.isError
    ? "AgentWatch unavailable"
    : actionableCount > 0
      ? "AgentWatch needs attention"
      : runningCount > 0
        ? `AgentWatch running ${runningCount} job${runningCount === 1 ? "" : "s"}`
        : reviewCount > 0
          ? `AgentWatch reviewing ${reviewCount} job${reviewCount === 1 ? "" : "s"}`
          : `AgentWatch completed ${jobs.length} job${jobs.length === 1 ? "" : "s"}`;
  const description = jobsQuery.isError
    ? (jobsQuery.error as Error).message
    : runningCount > 1
      ? `${runningCount} jobs are currently running.`
      : reviewCount > 1
        ? `${reviewCount} jobs are currently in review.`
        : actionableCount > 1
          ? `${actionableCount} jobs currently need inspection.`
          : primaryJob?.shouldInspect
            ? describePrimaryCondition(primaryCondition)
            : primaryJob
              ? `${primaryJob.label}: ${summarizeJob(primaryJob)}`
              : "Waiting for AgentWatch activity.";

  const dismissJobs = async (jobIds: string[]) => {
    if (jobIds.length === 0) {
      return;
    }
    const confirmed = await ensureNativeApi().dialogs.confirm(
      jobIds.length === 1
        ? "Dismiss this AgentWatch run from the panel? This does not stop the process."
        : `Dismiss ${jobIds.length} AgentWatch runs from the panel? This does not stop their processes.`,
    );
    if (!confirmed) {
      return;
    }
    await Promise.all(jobIds.map((jobId) => ensureNativeApi().agentWatch.dismiss({ jobId })));
    setCheckedJobIds((current) => current.filter((jobId) => !jobIds.includes(jobId)));
    if (selectedJobId && jobIds.includes(selectedJobId)) {
      setSelectedJobId(null);
    }
  };

  const stopJobs = async (jobIds: string[]) => {
    const runningJobIds = jobs
      .filter((job) => jobIds.includes(job.jobId) && job.status === "running")
      .map((job) => job.jobId);
    if (runningJobIds.length === 0) {
      return;
    }
    const confirmed = await ensureNativeApi().dialogs.confirm(
      runningJobIds.length === 1
        ? "Stop this AgentWatch process?"
        : `Stop ${runningJobIds.length} AgentWatch processes?`,
    );
    if (!confirmed) {
      return;
    }
    await Promise.all(runningJobIds.map((jobId) => ensureNativeApi().agentWatch.stop({ jobId })));
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-3 pt-3 sm:px-5">
      <Collapsible open={open} onOpenChange={setOpen} className="block w-full">
        <Alert variant={variant} className="w-full gap-y-2 px-3 py-2.5 pr-12">
          <Button
            size="icon-xs"
            variant="ghost"
            className="absolute right-2 top-2 text-muted-foreground hover:bg-destructive/8 hover:text-destructive"
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
          <AlertDescription className="min-w-0 gap-1">
            <div className="truncate text-sm" title={description ?? undefined}>
              {description}
            </div>
            {primaryJob && runningCount <= 1 && reviewCount <= 1 && actionableCount <= 1 ? (
              <div className="flex min-w-0 items-center gap-2 text-xs text-foreground/80">
                <span className="truncate rounded border border-border/70 bg-background/60 px-1.5 py-0.5 font-mono">
                  {primaryJob.label}
                </span>
                <span className="shrink-0">{summarizeJob(primaryJob)}</span>
              </div>
            ) : null}
          </AlertDescription>
          <AlertAction className="items-start sm:items-center">
            {checkedRunningCount > 0 ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  void stopJobs(checkedJobIds);
                }}
              >
                Stop {checkedRunningCount}
              </Button>
            ) : null}
            {checkedJobIds.length > 0 ? (
              <Button
                size="xs"
                variant="destructive-outline"
                onClick={() => {
                  void dismissJobs(checkedJobIds);
                }}
              >
                Dismiss {checkedJobIds.length}
              </Button>
            ) : null}
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
          <div className="mt-2 max-h-[15rem] overflow-y-auto rounded-lg">
            <div className="grid gap-2 xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-lg border border-border/80 bg-background">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
                  <Checkbox
                    aria-label={
                      allChecked ? "Clear AgentWatch run selection" : "Select all AgentWatch runs"
                    }
                    checked={allChecked}
                    indeterminate={someChecked}
                    onCheckedChange={(nextChecked) => {
                      setCheckedJobIds(nextChecked ? jobs.map((job) => job.jobId) : []);
                    }}
                  />
                  <span>
                    {checkedJobIds.length > 0 ? `${checkedJobIds.length} selected` : "Runs"}
                  </span>
                  {checkedJobIds.length > 0 ? (
                    <button
                      type="button"
                      className="text-destructive transition-colors hover:text-destructive/80"
                      onClick={() => {
                        void dismissJobs(checkedJobIds);
                      }}
                    >
                      Dismiss
                    </button>
                  ) : null}
                </div>
                <div className="divide-y divide-border/70">
                  {jobs.map((job) => {
                    const isSelected = job.jobId === selectedJob?.jobId;
                    const toneClass = job.shouldInspect
                      ? "text-warning"
                      : job.reviewState === "in_review"
                        ? "text-info"
                        : "text-muted-foreground";
                    return (
                      <div
                        key={job.jobId}
                        className={cn(
                          "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-3 py-2",
                          isSelected && "bg-accent/50",
                        )}
                      >
                        <div className="pt-0.5">
                          <Checkbox
                            aria-label={`Select ${job.label}`}
                            checked={checkedJobIds.includes(job.jobId)}
                            onCheckedChange={(nextChecked) => {
                              setCheckedJobIds((current) =>
                                nextChecked
                                  ? Array.from(new Set([...current, job.jobId]))
                                  : current.filter((jobId) => jobId !== job.jobId),
                              );
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          className="min-w-0 text-left"
                          onClick={() => setSelectedJobId(job.jobId)}
                        >
                          <div className="grid min-w-0 gap-y-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="truncate text-sm font-medium text-foreground">
                                {job.label}
                              </div>
                              <div className={cn("shrink-0 text-[11px]", toneClass)}>
                                {summarizeJob(job)}
                              </div>
                            </div>
                            <div
                              className="truncate font-mono text-[11px] text-muted-foreground"
                              title={job.command}
                            >
                              {truncateMiddle(job.command, 52)}
                            </div>
                            <div
                              className="truncate text-[11px] text-muted-foreground"
                              title={job.cwd}
                            >
                              {truncateMiddle(job.cwd, 52)}
                            </div>
                            {job.shouldInspect ? (
                              <div className="line-clamp-1 text-[11px] text-warning">
                                {job.conditions[0]?.message}
                              </div>
                            ) : null}
                          </div>
                        </button>
                        <div className="col-start-2 mt-1 flex items-center justify-between gap-2">
                          <div>
                            {job.status === "running" ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                  void stopJobs([job.jobId]);
                                }}
                              >
                                Stop
                              </Button>
                            ) : null}
                          </div>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="text-muted-foreground hover:bg-destructive/8 hover:text-destructive"
                            aria-label={`Dismiss ${job.label}`}
                            onClick={() => {
                              void dismissJobs([job.jobId]);
                            }}
                          >
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                      </div>
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
                    <div
                      className={cn(
                        "shrink-0 text-[11px]",
                        selectedJob.shouldInspect
                          ? "text-warning"
                          : selectedJob.reviewState === "in_review"
                            ? "text-info"
                            : "text-muted-foreground",
                      )}
                    >
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
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
