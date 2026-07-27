// RC5.4 executable manager primitives. Pure: no broker, database, timer, or
// environment access. The runtime stamps the selected profile into each
// position row so a restart cannot silently reinterpret an older cohort.

import type { PositionRow } from "./store.js";

export const RC54_MANAGER_POLICY_VERSION = "rc54-composite-manager-v1" as const;

export const RC54_MANAGER_PROFILE_IDS = [
  "RC53-RIDE",
  "RC53-A13",
  "ORB54-B30-A13",
  "QQQ54-B20-NATIVE-ATR",
  "LAB54-L30-L50",
  "LAB54-B50-A13",
] as const;

export type Rc54ManagerProfileId = typeof RC54_MANAGER_PROFILE_IDS[number];

export interface Rc54ManagerProfile {
  id: Rc54ManagerProfileId;
  bankTargetPct: number | null;
  runner: "none" | "a13" | "fixed-50" | "native-atr";
  runnerFraction: 0 | 0.5;
  catastropheStopPct: 30;
  admissionStopEt: "15:25";
  liquidationEt: "15:25";
  reentry: "disabled";
  adds: 0;
  priceBasis: "executable-option-bid";
}

export const RC54_MANAGER_PROFILES: Readonly<Record<Rc54ManagerProfileId, Rc54ManagerProfile>> = {
  "RC53-RIDE": {
    id: "RC53-RIDE", bankTargetPct: null, runner: "none", runnerFraction: 0,
    catastropheStopPct: 30, admissionStopEt: "15:25", liquidationEt: "15:25",
    reentry: "disabled", adds: 0, priceBasis: "executable-option-bid",
  },
  "RC53-A13": {
    id: "RC53-A13", bankTargetPct: null, runner: "a13", runnerFraction: 0,
    catastropheStopPct: 30, admissionStopEt: "15:25", liquidationEt: "15:25",
    reentry: "disabled", adds: 0, priceBasis: "executable-option-bid",
  },
  "ORB54-B30-A13": {
    id: "ORB54-B30-A13", bankTargetPct: 30, runner: "a13", runnerFraction: 0.5,
    catastropheStopPct: 30, admissionStopEt: "15:25", liquidationEt: "15:25",
    reentry: "disabled", adds: 0, priceBasis: "executable-option-bid",
  },
  "QQQ54-B20-NATIVE-ATR": {
    id: "QQQ54-B20-NATIVE-ATR", bankTargetPct: 20, runner: "native-atr", runnerFraction: 0.5,
    catastropheStopPct: 30, admissionStopEt: "15:25", liquidationEt: "15:25",
    reentry: "disabled", adds: 0, priceBasis: "executable-option-bid",
  },
  "LAB54-L30-L50": {
    id: "LAB54-L30-L50", bankTargetPct: 30, runner: "fixed-50", runnerFraction: 0.5,
    catastropheStopPct: 30, admissionStopEt: "15:25", liquidationEt: "15:25",
    reentry: "disabled", adds: 0, priceBasis: "executable-option-bid",
  },
  "LAB54-B50-A13": {
    id: "LAB54-B50-A13", bankTargetPct: 50, runner: "a13", runnerFraction: 0.5,
    catastropheStopPct: 30, admissionStopEt: "15:25", liquidationEt: "15:25",
    reentry: "disabled", adds: 0, priceBasis: "executable-option-bid",
  },
};

const profileIds = new Set<string>(RC54_MANAGER_PROFILE_IDS);

export function rc54ManagerProfile(
  value: unknown,
): Rc54ManagerProfile | null {
  if (typeof value !== "string" || !profileIds.has(value)) return null;
  return RC54_MANAGER_PROFILES[value as Rc54ManagerProfileId];
}

export function rc54ManagerProfileFromRow(
  row: Pick<PositionRow, "entry_features">,
): Rc54ManagerProfile | null {
  return rc54ManagerProfile(row.entry_features?.rc54_manager_profile);
}

/** Distinguish a legacy row with no RC5.4 stamp from a corrupted/unknown RC5.4
 * stamp. Both fail profile lookup, but only the former may use legacy exits. */
export function rc54ManagerStampPresent(
  row: Pick<PositionRow, "entry_features">,
): boolean {
  return !!row.entry_features
    && Object.prototype.hasOwnProperty.call(row.entry_features, "rc54_manager_profile");
}

/** Return the target attached to the exact RC5.4 lot being closed. The
 * channel-level target describes the first bank leg; a stamped runner may
 * intentionally carry a different second-lot target. */
export function rc54ConfiguredTakeProfitPct(input: {
  profile: Rc54ManagerProfile | null;
  isRunner: boolean;
  reason: string;
}): number | null {
  if (!input.profile || (input.reason !== "target_premium" && input.reason !== "target_tranche")) {
    return null;
  }
  if (input.isRunner) {
    return input.profile.runner === "fixed-50" ? 50 : null;
  }
  return input.profile.bankTargetPct;
}

/** First-lot bank target. RC5.4 rows use the persisted manager stamp rather
 * than the current channel configuration, so restart/config drift cannot move
 * an already-open lot's target. Runner rows never bank a second time. */
export function rc54BankTargetReached(input: {
  profile: Rc54ManagerProfile | null;
  isRunner: boolean;
  entryPrice: number;
  mark: number;
}): boolean {
  return !input.isRunner
    && input.profile?.bankTargetPct != null
    && input.entryPrice > 0
    && input.mark >= input.entryPrice * (1 + input.profile.bankTargetPct / 100);
}

/** Exact split posture attached to a persisted RC5.4 manager stamp. The
 * giveback value is descriptive/audit metadata; executable A13 logic remains
 * the gain-retention helper below and native/fixed runners use their own rules. */
export function rc54RunnerConfiguration(
  profile: Rc54ManagerProfile | null,
): { frac: number; givebackPct: number } | null {
  if (!profile) return null;
  return {
    frac: profile.runnerFraction,
    givebackPct: profile.runner === "a13" ? 100 / 3 : 0,
  };
}

/** Legacy rows keep their compiled ATR behavior. An RC5.4 native-ATR profile
 * deliberately arms that exit only on the post-bank runner remainder. */
export function rc54NativeAtrExitEligible(input: {
  profile: Rc54ManagerProfile | null;
  isRunner: boolean;
  sealedRc54: boolean;
}): boolean {
  if (input.profile == null) return !input.sealedRc54;
  return input.profile.runner === "native-atr" && input.isRunner;
}

/** Fixed second-lot target. This deliberately applies only to a stamped runner
 * row; the first lot is handled by the ordinary bank target and tranche split. */
export function rc54RunnerFixedTargetReached(input: {
  profile: Rc54ManagerProfile | null;
  isRunner: boolean;
  entryPrice: number;
  mark: number;
}): boolean {
  return input.isRunner
    && input.profile?.runner === "fixed-50"
    && input.entryPrice > 0
    && input.mark >= input.entryPrice * 1.5;
}

/** A13: arm at +50%, then retain two thirds of peak gain. The catastrophe
 * stop is evaluated by the caller before this helper, making simultaneous
 * risk/ratchet states deterministically risk-first. */
export function rc54A13GivebackReached(input: {
  profile: Rc54ManagerProfile | null;
  isRunner: boolean;
  entryPrice: number;
  mark: number;
  peak: number;
}): boolean {
  if (input.profile?.runner !== "a13" || !(input.entryPrice > 0)) return false;
  // A13 exists in two deliberately different allocations:
  // - RC53-A13 protects the original, unsplit two-lot row.
  // - bank/A13 profiles protect only the one-lot remainder row.
  // Refuse the wrong row shape so a restarted cohort cannot accidentally
  // ratchet the bank leg or disable MOMO's full-position A13.
  const eligible = input.profile.runnerFraction === 0 ? !input.isRunner : input.isRunner;
  if (!eligible) return false;
  if (input.peak < input.entryPrice * 1.5) return false;
  const floor = input.entryPrice + (input.peak - input.entryPrice) * (2 / 3);
  return input.mark <= floor;
}
