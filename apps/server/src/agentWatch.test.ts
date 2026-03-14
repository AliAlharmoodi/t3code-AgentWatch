import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { AgentWatch } from "./agentWatch";

describe("AgentWatch", () => {
  it("starts a detached job and reports non-zero exits for inspection", async () => {
    const watch = new AgentWatch(20);

    try {
      const started = watch.start({
        command: "sleep 0.05; echo boom; exit 17",
        staleAfterMs: 10_000,
      });

      await new Promise((resolve) => setTimeout(resolve, 220));

      const status = watch.status(started.jobId);
      expect(status.status).toBe("exited");
      expect(status.exitCode).toBe(17);
      expect(status.shouldInspect).toBe(true);
      expect(status.conditions.some((condition) => condition.code === "non_zero_exit")).toBe(true);
    } finally {
      watch.dispose();
    }
  });

  it("returns only flagged jobs by default when polling", async () => {
    const watch = new AgentWatch(20);

    try {
      watch.start({
        command: "sleep 0.2; echo done",
        staleAfterMs: 10_000,
      });

      await new Promise((resolve) => setTimeout(resolve, 40));

      const poll = watch.poll();
      expect(poll.jobs).toHaveLength(0);
    } finally {
      watch.dispose();
    }
  });

  it("records a clean exit code when the command explicitly exits", async () => {
    const watch = new AgentWatch(20);

    try {
      const started = watch.start({
        command: "printf 'agentwatch ok\\n'; sleep 0.05; exit 0",
        staleAfterMs: 10_000,
      });

      await new Promise((resolve) => setTimeout(resolve, 220));

      const status = watch.status(started.jobId);
      expect(status.status).toBe("exited");
      expect(status.exitCode).toBe(0);
      expect(status.shouldInspect).toBe(false);
      expect(status.conditions).toHaveLength(0);
    } finally {
      watch.dispose();
    }
  });

  it("filters jobs by thread id", async () => {
    const watch = new AgentWatch(20);

    try {
      const threadA = ThreadId.makeUnsafe("thread-a");
      const threadB = ThreadId.makeUnsafe("thread-b");
      watch.start({
        threadId: threadA,
        command: "sleep 0.2; echo alpha",
        staleAfterMs: 10_000,
      });
      watch.start({
        threadId: threadB,
        command: "sleep 0.2; echo bravo",
        staleAfterMs: 10_000,
      });

      await new Promise((resolve) => setTimeout(resolve, 40));

      const poll = watch.poll({ threadId: threadA, includeHealthy: true });
      expect(poll.jobs).toHaveLength(1);
      expect(poll.jobs[0]?.threadId).toBe(threadA);
    } finally {
      watch.dispose();
    }
  });
});
