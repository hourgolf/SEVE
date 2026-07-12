// Pure lifecycle policy for the management counterfactual.
//
// The actual trade and its simulated management policy own independent clocks:
// closing either one must not truncate the other. This module deliberately has no
// store, clock, or market-data imports so the invariant stays hermetically testable.

export type ShadowLifecycleAction = "step" | "wait" | "finalize";

export interface ShadowLifecycleState {
  actualOpen: boolean;
  managedClosed: boolean;
  hasExecutableQuote: boolean;
}

export function shadowLifecycleAction(state: ShadowLifecycleState): ShadowLifecycleAction {
  if (!state.actualOpen && state.managedClosed) return "finalize";
  if (!state.managedClosed && state.hasExecutableQuote) return "step";
  return "wait";
}
