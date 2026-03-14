import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import {
  CommandId,
  MessageId,
  type AgentWatchJobSnapshot,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { Cause, Effect, Layer, Stream } from "effect";

import { getSharedAgentWatch } from "../../agentWatchInstance.ts";
import type { AgentWatch } from "../../agentWatch.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { AgentWatchReactor, type AgentWatchReactorShape } from "../Services/AgentWatchReactor.ts";

type AgentWatchReactorInput =
  | { type: "job-updated"; job: AgentWatchJobSnapshot }
  | {
      type: "thread-session-set";
      event: Extract<OrchestrationEvent, { type: "thread.session-set" }>;
    };

function isThreadSessionBusy(status: string | null | undefined): boolean {
  return status === "starting" || status === "running";
}

function serverCommandId(tag: string): CommandId {
  return CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);
}

function buildAgentWatchFollowUpPrompt(job: AgentWatchJobSnapshot): string {
  const conditions =
    job.conditions.length > 0
      ? job.conditions.map((condition) => `- ${condition.message}`).join("\n")
      : "- This job requires inspection.";

  return [
    `An AgentWatch job for this thread requires inspection.`,
    "",
    `Inspect it with agentwatch_status and agentwatch_tail, determine why it failed, make the needed fix, and rerun or otherwise verify the command if appropriate.`,
    "",
    `Job ID: ${job.jobId}`,
    `Label: ${job.label}`,
    `Command: ${job.command}`,
    `Working directory: ${job.cwd}`,
    "",
    `Current conditions:`,
    conditions,
  ].join("\n");
}

export const makeAgentWatchReactor = (input?: { readonly agentWatch?: AgentWatch }) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const agentWatch = input?.agentWatch ?? getSharedAgentWatch();
    const escalatedJobIds = new Set<string>();
    const pendingJobsByThread = new Map<string, AgentWatchJobSnapshot>();

    const maybeDispatchFollowUp = Effect.fnUntraced(function* (threadId: string) {
      const pendingJob = pendingJobsByThread.get(threadId);
      if (!pendingJob) {
        return;
      }

      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find((entry) => entry.id === threadId);
      if (!thread) {
        pendingJobsByThread.delete(threadId);
        return;
      }

      if (isThreadSessionBusy(thread.session?.status)) {
        return;
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: serverCommandId("agentwatch-followup"),
        threadId: thread.id,
        message: {
          messageId: MessageId.makeUnsafe(`agentwatch-${crypto.randomUUID()}`),
          role: "user",
          text: buildAgentWatchFollowUpPrompt(pendingJob),
          attachments: [],
        },
        ...(thread.session?.providerName === "codex"
          ? { provider: thread.session.providerName }
          : {}),
        ...(thread.model ? { model: thread.model } : {}),
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        createdAt: new Date().toISOString(),
      });

      agentWatch.markInReview(pendingJob.jobId);
      escalatedJobIds.add(pendingJob.jobId);
      pendingJobsByThread.delete(threadId);
    });

    const processInput = Effect.fnUntraced(function* (entry: AgentWatchReactorInput) {
      if (entry.type === "job-updated") {
        const { job } = entry;
        if (!job.threadId || job.status !== "exited" || !job.shouldInspect) {
          return;
        }
        if (escalatedJobIds.has(job.jobId)) {
          return;
        }
        pendingJobsByThread.set(job.threadId, job);
        yield* maybeDispatchFollowUp(job.threadId);
        return;
      }

      yield* maybeDispatchFollowUp(entry.event.payload.threadId);
    });

    const processInputSafely = (entry: AgentWatchReactorInput) =>
      processInput(entry).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning("agentwatch reactor failed to process input", {
            inputType: entry.type,
            cause: Cause.pretty(cause),
          });
        }),
      );

    const worker = yield* makeDrainableWorker(processInputSafely);

    const startAgentWatchSubscription = Effect.gen(function* () {
      const listener = (job: AgentWatchJobSnapshot) => {
        void Effect.runPromise(worker.enqueue({ type: "job-updated", job }));
      };

      agentWatch.on("updated", listener);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          agentWatch.off("updated", listener);
        }),
      );
    });

    const startDomainEventSubscription = Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.session-set") {
          return Effect.void;
        }
        return worker.enqueue({ type: "thread-session-set", event });
      }),
    ).pipe(Effect.asVoid);

    const start: AgentWatchReactorShape["start"] = Effect.gen(function* () {
      yield* startAgentWatchSubscription;
      yield* startDomainEventSubscription;
    });

    return {
      start,
      drain: worker.drain,
    } satisfies AgentWatchReactorShape;
  });

export const AgentWatchReactorLive = Layer.effect(AgentWatchReactor, makeAgentWatchReactor());
