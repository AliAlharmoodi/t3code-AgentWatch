import { AgentWatch } from "./agentWatch";

let sharedAgentWatch: AgentWatch | null = null;

export function getSharedAgentWatch(): AgentWatch {
  if (sharedAgentWatch) {
    return sharedAgentWatch;
  }
  sharedAgentWatch = new AgentWatch();
  return sharedAgentWatch;
}
