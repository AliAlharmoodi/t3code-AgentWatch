import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { AgentWatch } from "../../agentWatch.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { makeAgentWatchReactor } from "./AgentWatchReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { AgentWatchReactor } from "../Services/AgentWatchReactor.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for expectation.");
}

describe("AgentWatchReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | AgentWatchReactor,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  let watch: AgentWatch | null = null;
  const createdStateDirs = new Set<string>();

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    watch?.dispose();
    watch = null;
    for (const stateDir of createdStateDirs) {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
    createdStateDirs.clear();
  });

  async function createHarness() {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-agentwatch-reactor-"));
    createdStateDirs.add(stateDir);
    const now = new Date().toISOString();
    watch = new AgentWatch(20);

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );

    const layer = Layer.effect(
      AgentWatchReactor,
      makeAgentWatchReactor({ agentWatch: watch }),
    ).pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), stateDir)),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);

    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const reactor = await runtime.runPromise(Effect.service(AgentWatchReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "AgentWatch Project",
        workspaceRoot: process.cwd(),
        defaultModel: "gpt-5-codex",
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        threadId: asThreadId("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: now,
      }),
    );

    return { engine, reactor, watch };
  }

  it("dispatches a follow-up turn when an AgentWatch job exits needing inspection", async () => {
    const { engine, reactor, watch } = await createHarness();

    watch.start({
      threadId: asThreadId("thread-1"),
      command: "sleep 0.05; echo boom; exit 17",
      label: "failing-job",
      staleAfterMs: 10_000,
    });

    await waitFor(async () => {
      const readModel = await runtime!.runPromise(engine.getReadModel());
      const thread = readModel.threads.find((entry) => entry.id === "thread-1");
      return !!thread?.messages.some(
        (message) => message.role === "user" && message.text.includes("requires inspection"),
      );
    });
    await runtime!.runPromise(reactor.drain);

    const readModel = await runtime!.runPromise(engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === "thread-1");
    const followUpMessage = thread?.messages.find((message) =>
      message.text.includes("requires inspection"),
    );

    expect(followUpMessage?.text).toContain("failing-job");
    expect(followUpMessage?.text).toContain("exit 17");
  });

  it("waits for the thread session to stop running before dispatching the follow-up turn", async () => {
    const { engine, reactor, watch } = await createHarness();
    const now = new Date().toISOString();

    await runtime!.runPromise(
      engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-running"),
        threadId: asThreadId("thread-1"),
        session: {
          threadId: asThreadId("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    watch.start({
      threadId: asThreadId("thread-1"),
      command: "sleep 0.05; echo delayed; exit 23",
      label: "delayed-failure",
      staleAfterMs: 10_000,
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    await runtime!.runPromise(reactor.drain);

    let readModel = await runtime!.runPromise(engine.getReadModel());
    let thread = readModel.threads.find((entry) => entry.id === "thread-1");
    expect(thread?.messages.some((message) => message.text.includes("requires inspection"))).toBe(
      false,
    );

    const readyAt = new Date().toISOString();
    await runtime!.runPromise(
      engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-session-ready"),
        threadId: asThreadId("thread-1"),
        session: {
          threadId: asThreadId("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: readyAt,
        },
        createdAt: readyAt,
      }),
    );

    await waitFor(async () => {
      const current = await runtime!.runPromise(engine.getReadModel());
      const currentThread = current.threads.find((entry) => entry.id === "thread-1");
      return !!currentThread?.messages.some((message) => message.text.includes("delayed-failure"));
    });

    readModel = await runtime!.runPromise(engine.getReadModel());
    thread = readModel.threads.find((entry) => entry.id === "thread-1");
    expect(thread?.messages.some((message) => message.text.includes("delayed-failure"))).toBe(true);
  });
});
