import type { ChannelSpecVersion } from "../channels/channelControlPlane";
import type { ExecutableShadowManager } from "./executableShadowLedger";

const finite = (value: unknown): value is number => typeof value === "number"
  && Number.isFinite(value);

const nonEmptyText = (value: unknown): string | null => typeof value === "string"
  && value.trim() ? value.trim() : null;

/** Use the immutable channel liquidation clock for an active-native replay. */
export function executableForceExitClockFromChannelSpec(
  spec: Readonly<ChannelSpecVersion>,
  fallback: string,
): string {
  return nonEmptyText(spec.exitParameters.eodEt) ?? fallback;
}

/** Reproduce the immutable per-session filled-entry limit. */
export function executableMaxEntriesFromChannelSpec(
  spec: Readonly<ChannelSpecVersion>,
): number {
  const configured = spec.entryParameters.maxEntriesPerSession
    ?? spec.entryParameters.max_entries_per_session;
  return finite(configured) && configured >= 1
    ? Math.trunc(configured)
    : spec.reentryPolicy === "disabled" ? 1 : 3;
}

/** Build the executable-bid replay form of an immutable active manager spec. */
export function executableManagerFromChannelSpec(
  spec: Readonly<ChannelSpecVersion>,
  forceExitAt: string,
): ExecutableShadowManager {
  const stopLossPct = spec.stopLoss.catastrophePct;
  const ratchet = spec.ratchetParameters;
  if (spec.takeProfit.kind === "bank" && spec.takeProfit.fraction === 0.5) {
    if (!finite(spec.takeProfit.targetPct)
        || ratchet.kind !== "a13"
        || !finite(ratchet.engageReturnPct)) {
      throw new Error(`${spec.slug}: active split manager is not an executable A13 replay shape`);
    }
    const keep = ratchet.retainGainPct
      ?? (finite(ratchet.givebackPct) ? 100 - ratchet.givebackPct : null);
    if (!finite(keep)) throw new Error(`${spec.slug}: active A13 retention is missing`);
    return {
      kind: "bank_runner",
      id: spec.managerProfileId,
      version: spec.managerVersion,
      stopLossPct,
      bankTargetPct: spec.takeProfit.targetPct,
      runnerFraction: spec.takeProfit.fraction,
      runnerArmPct: ratchet.engageReturnPct,
      runnerKeepFraction: keep / 100,
      postBankFloorPct: ratchet.postBankFloor === "breakeven" ? 0 : null,
      forceExitAt,
    };
  }
  if (spec.takeProfit.kind === "ride" && spec.takeProfit.fraction === 0
      && ratchet.kind === "a13") {
    const keep = ratchet.retainGainPct
      ?? (finite(ratchet.givebackPct) ? 100 - ratchet.givebackPct : null);
    if (!finite(ratchet.engageReturnPct) || !finite(keep)) {
      throw new Error(`${spec.slug}: active full-position A13 is incomplete`);
    }
    return {
      kind: "full_ratchet",
      id: spec.managerProfileId,
      version: spec.managerVersion,
      stopLossPct,
      armPct: ratchet.engageReturnPct,
      keepFraction: keep / 100,
      forceExitAt,
    };
  }
  if (ratchet.kind !== "none") {
    throw new Error(`${spec.slug}: ${ratchet.kind} requires a dedicated executable replay adapter`);
  }
  return {
    kind: "all_out",
    id: spec.managerProfileId,
    version: spec.managerVersion,
    stopLossPct,
    takeProfitPct: spec.takeProfit.kind === "bank"
      ? spec.takeProfit.targetPct : null,
    forceExitAt,
  };
}
