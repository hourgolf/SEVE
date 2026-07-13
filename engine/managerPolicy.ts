// Portable, causal manager policies shared by the retrospective lab and the
// live worker's observation-only fast sweep. A tick can produce evidence; it
// cannot place an order or mutate an active channel manager.

export const MANAGER_IDS = [
  "LOCK20/30",
  "LOCK30/30",
  "LOCK50/30",
  "WIDE20/50",
  "BANK20/RUN50",
  "ARM20/HALF-GIVEBACK",
  "BELL/-30",
  "BELL/no-stop",
] as const;

export type ManagerId = typeof MANAGER_IDS[number];

export interface ManagerState {
  bankReturnPct?: number;
  armedPeakPct?: number;
  recovered?: boolean;
}

export interface ManagerExit {
  managerId: ManagerId;
  reason: string;
  returnPct: number;
  state: ManagerState;
}

export interface ManagerAdvance {
  state: ManagerState;
  exit: ManagerExit | null;
}

export const MANAGER_POLICY_VERSION = "manager-lab-preregister-v1";

function terminal(managerId: ManagerId, reason: string, returnPct: number, state: ManagerState): ManagerAdvance {
  return { state, exit: { managerId, reason, returnPct, state } };
}

function lock(managerId: ManagerId, ret: number, target: number | null, stop: number | null, isBell: boolean, state: ManagerState): ManagerAdvance {
  if (stop != null && ret <= -stop) return terminal(managerId, "stop", ret, state);
  if (target != null && ret >= target) return terminal(managerId, "target", ret, state);
  if (isBell) return terminal(managerId, "bell", ret, state);
  return { state, exit: null };
}

export function advanceManager(managerId: ManagerId, prior: ManagerState, ret: number, isBell: boolean): ManagerAdvance {
  const state = { ...prior };
  switch (managerId) {
    case "LOCK20/30": return lock(managerId, ret, 20, 30, isBell, state);
    case "LOCK30/30": return lock(managerId, ret, 30, 30, isBell, state);
    case "LOCK50/30": return lock(managerId, ret, 50, 30, isBell, state);
    case "WIDE20/50": return lock(managerId, ret, 20, 50, isBell, state);
    case "BELL/-30": return lock(managerId, ret, null, 30, isBell, state);
    case "BELL/no-stop": return lock(managerId, ret, null, null, isBell, state);
    case "BANK20/RUN50": {
      if (state.bankReturnPct == null) {
        if (ret <= -30) return terminal(managerId, "prebank_stop", ret, state);
        if (ret >= 20) state.bankReturnPct = ret;
      }
      if (state.bankReturnPct != null) {
        const blended = (state.bankReturnPct + ret) / 2;
        if (ret >= 50) return terminal(managerId, "runner_target", blended, state);
        if (ret <= 0) return terminal(managerId, "runner_floor", blended, state);
        if (isBell) return terminal(managerId, "runner_bell", blended, state);
      } else if (isBell) return terminal(managerId, "bell", ret, state);
      return { state, exit: null };
    }
    case "ARM20/HALF-GIVEBACK": {
      if (state.armedPeakPct == null) {
        if (ret <= -30) return terminal(managerId, "prearm_stop", ret, state);
        if (ret >= 20) state.armedPeakPct = ret;
      } else {
        state.armedPeakPct = Math.max(state.armedPeakPct, ret);
      }
      if (state.armedPeakPct != null && ret <= Math.max(0, state.armedPeakPct * 0.5))
        return terminal(managerId, "giveback", ret, state);
      if (isBell) return terminal(managerId, state.armedPeakPct != null ? "armed_bell" : "bell", ret, state);
      return { state, exit: null };
    }
  }
}

// A restart can recover armed state from the durable bid-side peak. The bank
// crossing is conservatively recorded at its registered +20 threshold because
// peak_mark cannot reconstruct the first crossing's overshoot. Evidence carries
// `recovered` so analysis never mistakes that approximation for an observed fill.
export function recoverManagerState(managerId: ManagerId, peakReturnPct: number): ManagerState {
  if (managerId === "BANK20/RUN50" && peakReturnPct >= 20)
    return { bankReturnPct: 20, recovered: true };
  if (managerId === "ARM20/HALF-GIVEBACK" && peakReturnPct >= 20)
    return { armedPeakPct: peakReturnPct, recovered: true };
  return {};
}

