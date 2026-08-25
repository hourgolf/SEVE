import type { RuntimeLifecycle } from "./channelPassport";

export type ExecutionLifecycleState = "trading" | "observing" | "unverified";
export type ResearchLifecycleState = "shadowing" | "researching" | "paused" | "retired" | "unassigned";

export interface ChannelLifecycleProjection {
  execution: ExecutionLifecycleState;
  research: ResearchLifecycleState;
  states: Array<ExecutionLifecycleState | ResearchLifecycleState>;
  runtimeAuthority: "receipt" | "unverified";
  retirementAuthority: "explicit-terminal-receipt" | "none";
}

/**
 * Lifecycle is intentionally two-dimensional. Receipt authority answers whether
 * orders may execute; the research registry answers what evidence work is in
 * progress. A paper experiment is both trading and researching, while an
 * observe-only shadow book is both observing and shadowing. Mutable strategist
 * metadata and proposal-only retirement recommendations cannot create a
 * terminal state.
 */
export function projectChannelLifecycle(input: {
  runtimeLifecycle: RuntimeLifecycle | null | undefined;
  researchBook?: "core" | "experiment" | "shadow" | "archive" | null;
  terminalRetirementReceipt?: boolean;
}): ChannelLifecycleProjection {
  const execution: ExecutionLifecycleState = input.runtimeLifecycle === "paper-root"
    ? "trading"
    : input.runtimeLifecycle === "dark-evidence"
      ? "observing"
      : "unverified";
  const research: ResearchLifecycleState = input.terminalRetirementReceipt
    ? "retired"
    : input.researchBook === "archive"
      ? "paused"
      : input.researchBook === "shadow"
        ? "shadowing"
        : input.researchBook === "core" || input.researchBook === "experiment"
          ? "researching"
          : "unassigned";
  return {
    execution,
    research,
    states: research === "unassigned" ? [execution] : [execution, research],
    runtimeAuthority: execution === "unverified" ? "unverified" : "receipt",
    retirementAuthority: input.terminalRetirementReceipt ? "explicit-terminal-receipt" : "none",
  };
}
