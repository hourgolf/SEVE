// Portable, causal manager policies shared by the retrospective lab and the
// live worker's observation-only fast sweep. A tick can produce evidence; it
// cannot place an order or mutate an active channel manager.

export const BASE_MANAGER_IDS = [
  "LOCK20/30",
  "LOCK30/30",
  "LOCK50/30",
  "WIDE20/50",
  "BANK20/RUN50",
  "ARM20/HALF-GIVEBACK",
  "BELL/-30",
  "BELL/no-stop",
] as const;

export const PB_RIDE_2_MANAGER_ID = "PB2-BANK15/HALF-GIVEBACK" as const;
export const GRIND_CURRENT_MANAGER_ID = "GRIND-B25/CURRENT-A13" as const;
export const VB_MACD_CURRENT_MANAGER_ID = "VB-MACD-CURRENT-LOCK18" as const;
export const VB_LEVEL_CURRENT_MANAGER_ID = "VB-LEVEL-CURRENT-LOCK25" as const;
export const MOMO2_CURRENT_MANAGER_ID = "MOMO2-CURRENT-LOCK27" as const;
export const VB_MACD_LOCK18_NATIVE_START_SESSION = "2026-08-20" as const;
export const NEXT_WEEK_MANAGER_NATIVE_START_SESSION = "2026-08-24" as const;
export const MOMO2_BANK_RUNNER_NATIVE_START_SESSION = "2026-08-21" as const;

export const MANAGER_IDS = [
  ...BASE_MANAGER_IDS,
  PB_RIDE_2_MANAGER_ID,
  GRIND_CURRENT_MANAGER_ID,
  VB_MACD_CURRENT_MANAGER_ID,
  VB_LEVEL_CURRENT_MANAGER_ID,
  MOMO2_CURRENT_MANAGER_ID,
  "GRIND-SMART-ALL-OUT-8",
  "MOMO2-B20-BE-R50",
  "FULL-R20-K50",
  "FULL-R50-K67",
  "ORB-TREND-SOURCE-30/35",
] as const;

export type ManagerId = typeof MANAGER_IDS[number];

export interface ManagerState {
  bankReturnPct?: number;
  armedPeakPct?: number;
  recovered?: boolean;
}

/**
 * Candidate enrollment is explicit. The July 14 replay supports observing the
 * +15% staged exit on pb-ride-2 only; silently pooling it across the fleet
 * would recreate the global-exit fallacy the replay rejected.
 */
export function managerIdsForChannel(
  channelSlug: string,
  asOfSessionDateEt?: string,
): readonly ManagerId[] {
  const slug = channelSlug.toLowerCase();
  if (slug === "pb-ride-2") return [...BASE_MANAGER_IDS, PB_RIDE_2_MANAGER_ID];
  if (slug === "grind-v3") return [...BASE_MANAGER_IDS, GRIND_CURRENT_MANAGER_ID];
  // The +18 policy became vb-macd-state's paper native for the 2026-08-20
  // epoch. LOCK50/30 now preserves the displaced +50 control, so collecting a
  // second +18 shadow would be redundant and would overstate arm coverage.
  // Historical exact replays retain the arm set that existed for their
  // session. A later native change must not rewrite immutable path coverage.
  if (slug === "vb-macd-state"
      && (!asOfSessionDateEt
        || asOfSessionDateEt < VB_MACD_LOCK18_NATIVE_START_SESSION
        || asOfSessionDateEt >= NEXT_WEEK_MANAGER_NATIVE_START_SESSION)) {
    return [
      ...BASE_MANAGER_IDS.filter((id) => id !== "WIDE20/50"),
      VB_MACD_CURRENT_MANAGER_ID,
    ];
  }
  // LOCK50/30 becomes vb-level-break's native manager on 2026-08-24.
  // Keep its displaced all-out +25/-30 policy as the paired channel-only
  // shadow without duplicating the now-native LOCK50/30 arm.
  if (slug === "vb-level-break"
      && (!asOfSessionDateEt
        || asOfSessionDateEt >= NEXT_WEEK_MANAGER_NATIVE_START_SESSION)) {
    return [
      ...BASE_MANAGER_IDS.filter((id) => id !== "LOCK50/30"),
      VB_LEVEL_CURRENT_MANAGER_ID,
    ];
  }
  // BANK20/RUN50 becomes the paper-native momo-shape-2 manager on 2026-08-21.
  // Preserve the displaced +27/-40 all-out policy as a distinct shadow while
  // avoiding a duplicate BANK20/RUN50 arm in the new epoch. Historical dates
  // retain the exact arm set that was active at the time.
  if (slug === "momo-shape-2"
      && (!asOfSessionDateEt
        || asOfSessionDateEt >= MOMO2_BANK_RUNNER_NATIVE_START_SESSION)) {
    return [...BASE_MANAGER_IDS.filter((id) => id !== "BANK20/RUN50"),
      MOMO2_CURRENT_MANAGER_ID];
  }
  return BASE_MANAGER_IDS;
}

/** Forward enrollment uses the immutable entry-time native identity. Historical
 * date-based inventories above remain unchanged; adding controls cannot claim
 * that they were collected before deployment or rewrite hydrated run state. */
export const FORWARD_CONTROL_NATIVE_VERSIONS: Readonly<Record<string, string>> = {
  "grind-smart-entries": "sha256:362e1a492bdf91c9c967bd5dd020fc728878c5a1811e353790301ab56487af1b",
  "momo-shape-2": "sha256:2785d9f2fe7bbf35545c85c561fa203aaf26144c49df3e9e0f84fcef977e2a1e",
  "vb-level-break": "sha256:0934c22575f039e970c30641dc89b834b2423ae0826161f63905dee8d6cf1753",
  "orb-trend-rider": "sha256:81f1e7da956e1252f178e6e37b54faea5865955f90b249e27d198ac23bc3ec57",
};
export function managerIdsForObservedConfiguration(slug: string, nativeManagerId?: string | null, nativeManagerVersion?: string | null): readonly ManagerId[] {
  const prior = managerIdsForChannel(slug);
  if (!nativeManagerVersion || nativeManagerVersion !== FORWARD_CONTROL_NATIVE_VERSIONS[slug]) return prior;
  if (slug === "grind-smart-entries" && nativeManagerId === "FULL-R50-K75")
    return [...prior, "GRIND-SMART-ALL-OUT-8"];
  if (slug === "momo-shape-2" && nativeManagerId === "BANK30-R50-K67")
    // FULL-R20-K50 is the named equivalent of ARM20/HALF-GIVEBACK. Do not
    // enroll identical economics twice or present them as independent tests.
    return [...prior.filter(id => id !== "ARM20/HALF-GIVEBACK"), "MOMO2-B20-BE-R50", "FULL-R20-K50", "FULL-R50-K67"];
  if (slug === "vb-level-break" && nativeManagerId === "VB-LEVEL-ALL-OUT-30")
    return [...prior.filter(id => id !== "LOCK30/30"), "LOCK50/30"];
  if (slug === "orb-trend-rider" && nativeManagerId === "ORB-ALL-OUT-50")
    return [...prior.filter(id => id !== "LOCK50/30"), "ORB-TREND-SOURCE-30/35"];
  return prior;
}

export function isBankRunnerManager(managerId: ManagerId): boolean {
  return ["BANK20/RUN50", "PB2-BANK15/HALF-GIVEBACK", "GRIND-B25/CURRENT-A13", "MOMO2-B20-BE-R50"].includes(managerId);
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
    case "GRIND-SMART-ALL-OUT-8": return lock(managerId, ret, 8, 35, isBell, state);
    case "ORB-TREND-SOURCE-30/35": return lock(managerId, ret, 30, 35, isBell, state);
    case "FULL-R20-K50":
    case "FULL-R50-K67": {
      const arm = managerId === "FULL-R20-K50" ? 20 : 50;
      const keep = managerId === "FULL-R20-K50" ? 0.5 : 2 / 3;
      if (state.armedPeakPct == null && ret <= -30) return terminal(managerId, "prearm_stop", ret, state);
      if (ret >= arm || state.armedPeakPct != null) state.armedPeakPct = Math.max(state.armedPeakPct ?? ret, ret);
      if (state.armedPeakPct != null && ret <= state.armedPeakPct * keep)
        return terminal(managerId, "giveback", ret, state);
      if (isBell) return terminal(managerId, "bell", ret, state);
      return { state, exit: null };
    }
    case "MOMO2-B20-BE-R50": {
      if (state.bankReturnPct == null) {
        if (ret <= -40) return terminal(managerId, "prebank_stop", ret, state);
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
    case "VB-MACD-CURRENT-LOCK18": return lock(managerId, ret, 18, 30, isBell, state);
    case "VB-LEVEL-CURRENT-LOCK25": return lock(managerId, ret, 25, 30, isBell, state);
    case "MOMO2-CURRENT-LOCK27": return lock(managerId, ret, 27, 40, isBell, state);
    case "PB2-BANK15/HALF-GIVEBACK": {
      if (state.bankReturnPct == null) {
        if (ret <= -30) return terminal(managerId, "prebank_stop", ret, state);
        if (ret >= 15) {
          state.bankReturnPct = ret;
          state.armedPeakPct = ret;
        }
      } else {
        state.armedPeakPct = Math.max(state.armedPeakPct ?? ret, ret);
      }
      if (state.bankReturnPct != null && state.armedPeakPct != null
          && ret <= Math.max(0, state.armedPeakPct * 0.5)) {
        return terminal(managerId, "runner_half_giveback", (state.bankReturnPct + ret) / 2, state);
      }
      if (isBell) {
        const blended = state.bankReturnPct == null ? ret : (state.bankReturnPct + ret) / 2;
        return terminal(managerId, state.bankReturnPct == null ? "bell" : "runner_bell", blended, state);
      }
      return { state, exit: null };
    }
    case "GRIND-B25/CURRENT-A13": {
      if (state.bankReturnPct == null) {
        if (ret <= -30) return terminal(managerId, "prebank_stop", ret, state);
        if (ret >= 25) {
          state.bankReturnPct = ret;
          state.armedPeakPct = ret;
        }
      } else {
        state.armedPeakPct = Math.max(state.armedPeakPct ?? ret, ret);
      }
      if (state.bankReturnPct != null && state.armedPeakPct != null) {
        const runnerFloor = state.armedPeakPct >= 50
          ? state.armedPeakPct * 0.67
          : -33 + state.armedPeakPct * 0.67;
        if (ret <= runnerFloor) {
          return terminal(managerId, state.armedPeakPct >= 50
            ? "runner_a13" : "runner_legacy_ratchet",
          (state.bankReturnPct + ret) / 2, state);
        }
      }
      if (isBell) {
        const blended = state.bankReturnPct == null ? ret
          : (state.bankReturnPct + ret) / 2;
        return terminal(managerId,
          state.bankReturnPct == null ? "bell" : "runner_bell",
          blended, state);
      }
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
  if (managerId === "MOMO2-B20-BE-R50" && peakReturnPct >= 20)
    return { bankReturnPct: 20, recovered: true };
  if ((managerId === "FULL-R20-K50" && peakReturnPct >= 20) || (managerId === "FULL-R50-K67" && peakReturnPct >= 50))
    return { armedPeakPct: peakReturnPct, recovered: true };
  if (managerId === "BANK20/RUN50" && peakReturnPct >= 20)
    return { bankReturnPct: 20, recovered: true };
  if (managerId === "ARM20/HALF-GIVEBACK" && peakReturnPct >= 20)
    return { armedPeakPct: peakReturnPct, recovered: true };
  if (managerId === PB_RIDE_2_MANAGER_ID && peakReturnPct >= 15)
    return { bankReturnPct: 15, armedPeakPct: peakReturnPct, recovered: true };
  if (managerId === GRIND_CURRENT_MANAGER_ID && peakReturnPct >= 25)
    return { bankReturnPct: 25, armedPeakPct: peakReturnPct, recovered: true };
  return {};
}
