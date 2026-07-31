export type StoredRosterBundleLifecycleState =
  | "draft"
  | "validated"
  | "canceled"
  | "superseded"
  | "approved"
  | "rolled-back";

export type OperatorRosterBundleState =
  | Exclude<StoredRosterBundleLifecycleState, "approved">
  | "activated";

export function projectRosterBundleOperatorState(input: {
  lifecycleState: unknown;
  hasActivationReceipt: boolean;
}): OperatorRosterBundleState {
  const state = String(input.lifecycleState ?? "");
  const known = new Set<StoredRosterBundleLifecycleState>([
    "draft",
    "validated",
    "canceled",
    "superseded",
    "approved",
    "rolled-back",
  ]);
  if (!known.has(state as StoredRosterBundleLifecycleState)) {
    throw new Error("roster bundle lifecycle state is unknown");
  }
  if (input.hasActivationReceipt) {
    if (state === "approved") return "activated";
    if (state === "rolled-back") return "rolled-back";
    throw new Error("roster activation receipt disagrees with lifecycle state");
  }
  if (state === "approved" || state === "rolled-back") {
    throw new Error("terminal roster lifecycle is missing its activation receipt");
  }
  return state as OperatorRosterBundleState;
}
