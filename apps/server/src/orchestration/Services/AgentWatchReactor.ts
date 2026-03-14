/**
 * AgentWatchReactor - Service interface for AgentWatch-triggered follow-up turns.
 *
 * Owns background workers that react to AgentWatch job updates and dispatch
 * orchestration turns when monitored jobs need inspection.
 *
 * @module AgentWatchReactor
 */
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface AgentWatchReactorShape {
  /**
   * Start reacting to AgentWatch updates in the current scope.
   */
  readonly start: Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal queue is empty and idle.
   * Intended for test use.
   */
  readonly drain: Effect.Effect<void>;
}

export class AgentWatchReactor extends ServiceMap.Service<
  AgentWatchReactor,
  AgentWatchReactorShape
>()("t3/orchestration/Services/AgentWatchReactor") {}
