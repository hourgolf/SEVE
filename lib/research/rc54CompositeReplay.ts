// Pure, replay-only RC5.4 manager model. It covers the split composite
// profiles plus the sealed full-position RIDE/A13 shapes and the underlying
// ATR runner. It cannot write, authorize orders, or mutate runtime policy.

import { computeFeatures } from "../../engine/engine";
import type { Bar } from "../../engine/types";

export const RC54_COMPOSITE_REPLAY_VERSION = "rc54-composite-replay-v1" as const;

export const RC54_COMPOSITE_IDS = [
  "B30/A13",
  "B20/NATIVE-ATR",
  "L30/L50",
  "B50/A13",
] as const;

export type Rc54CompositeId = typeof RC54_COMPOSITE_IDS[number];

export const RC54_SEALED_REPLAY_IDS = [
  "RC53-RIDE",
  "RC53-A13",
  "QQQ54-B20-NATIVE-ATR",
] as const;

export type Rc54SealedReplayId = typeof RC54_SEALED_REPLAY_IDS[number];

export interface Rc54ReplayQuote {
  atMs: number;
  bid: number;
}

export const RC54_TARGET_STUDY_RUNNERS = [
  "ride",
  "a13",
  "fixed-50",
] as const;

export type Rc54TargetStudyRunner = typeof RC54_TARGET_STUDY_RUNNERS[number];

export interface Rc54TargetStudyProfile {
  targetPct: number;
  runner: Rc54TargetStudyRunner;
}

export type Rc54LotExitReason =
  | "target"
  | "prearm_stop"
  | "stop"
  | "a13_giveback"
  | "time_flatten"
  | "native_atr";

export interface Rc54LotOutcome {
  lot: "bank" | "runner";
  exitAtMs: number;
  exitBid: number;
  exitReason: Rc54LotExitReason;
  returnPct: number;
  pnl: number;
  peakReturnPct: number;
  basis: "databento_entry_ask_to_executable_bid" | "native_atr_exact_receipt";
}

export type Rc54ReplayCensor =
  | "invalid_entry"
  | "invalid_clock"
  | "entry_after_flatten"
  | "missing_executable_path"
  | "no_executable_flatten_bid"
  | "native_atr_path_unavailable"
  | "native_atr_underlying_path_unavailable";

export interface Rc54CompositeOutcome {
  profile: Rc54CompositeId;
  entryAsk: number;
  entryAtMs: number;
  flattenAtMs: number;
  lots: Rc54LotOutcome[];
  exitAtMs: number | null;
  pnl: number | null;
  pnlPerContract: number | null;
  censors: Rc54ReplayCensor[];
  exact: boolean;
  externalWrites: false;
  orderPathAuthorized: false;
  policyChangeAuthorized: false;
}

interface NativeAtrReceipt {
  exitAtMs: number;
  exitBid: number;
}

export interface Rc54SealedReplayOutcome
  extends Omit<Rc54CompositeOutcome, "profile"> {
  profile: Rc54SealedReplayId;
  nativeAtrTargetPct: number | null;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const round = (value: number): number => Math.round(value * 100) / 100;

function outcome(
  lot: Rc54LotOutcome["lot"],
  entryAsk: number,
  quote: Rc54ReplayQuote,
  exitReason: Rc54LotExitReason,
  peakReturnPct: number,
  basis: Rc54LotOutcome["basis"] = "databento_entry_ask_to_executable_bid",
): Rc54LotOutcome {
  const returnPct = ((quote.bid - entryAsk) / entryAsk) * 100;
  return {
    lot,
    exitAtMs: quote.atMs,
    exitBid: quote.bid,
    exitReason,
    returnPct,
    pnl: round((quote.bid - entryAsk) * 100),
    peakReturnPct,
    basis,
  };
}

function lastExecutableAtOrBefore(
  quotes: readonly Rc54ReplayQuote[],
  atMs: number,
): Rc54ReplayQuote | null {
  for (let index = quotes.length - 1; index >= 0; index--) {
    const quote = quotes[index];
    if (quote.atMs <= atMs && quote.bid > 0) return quote;
  }
  return null;
}

function replayLock(input: {
  lot: Rc54LotOutcome["lot"];
  targetPct: number;
  stopPct: number;
  entryAsk: number;
  quotes: readonly Rc54ReplayQuote[];
  flattenAtMs: number;
}): Rc54LotOutcome | null {
  let peakReturnPct = Number.NEGATIVE_INFINITY;
  for (const quote of input.quotes) {
    if (quote.atMs > input.flattenAtMs || quote.bid <= 0) continue;
    const ret = ((quote.bid - input.entryAsk) / input.entryAsk) * 100;
    peakReturnPct = Math.max(peakReturnPct, ret);
    // Risk exits are evaluated before reward exits at the same executable
    // quote, matching the existing manager-policy precedence.
    if (ret <= input.stopPct)
      return outcome(input.lot, input.entryAsk, quote, "stop", peakReturnPct);
    if (ret >= input.targetPct)
      return outcome(input.lot, input.entryAsk, quote, "target", peakReturnPct);
  }
  const flatten = lastExecutableAtOrBefore(input.quotes, input.flattenAtMs);
  return flatten
    ? outcome(
        input.lot,
        input.entryAsk,
        flatten,
        "time_flatten",
        Math.max(peakReturnPct, ((flatten.bid - input.entryAsk) / input.entryAsk) * 100),
      )
    : null;
}

function replayA13(input: {
  lot?: Rc54LotOutcome["lot"];
  entryAsk: number;
  quotes: readonly Rc54ReplayQuote[];
  flattenAtMs: number;
}): Rc54LotOutcome | null {
  const armPct = 50;
  const keepFraction = 2 / 3;
  let armed = false;
  let peakReturnPct = Number.NEGATIVE_INFINITY;
  for (const quote of input.quotes) {
    if (quote.atMs > input.flattenAtMs || quote.bid <= 0) continue;
    const ret = ((quote.bid - input.entryAsk) / input.entryAsk) * 100;
    peakReturnPct = Math.max(peakReturnPct, ret);
    if (!armed) {
      if (ret <= -30)
        return outcome(input.lot ?? "runner", input.entryAsk, quote, "prearm_stop", peakReturnPct);
      if (ret >= armPct) armed = true;
      continue;
    }
    if (ret <= peakReturnPct * keepFraction)
      return outcome(input.lot ?? "runner", input.entryAsk, quote, "a13_giveback", peakReturnPct);
  }
  const flatten = lastExecutableAtOrBefore(input.quotes, input.flattenAtMs);
  return flatten
    ? outcome(
        input.lot ?? "runner",
        input.entryAsk,
        flatten,
        "time_flatten",
        Math.max(peakReturnPct, ((flatten.bid - input.entryAsk) / input.entryAsk) * 100),
      )
    : null;
}

function replayNativeAtr(
  entryAsk: number,
  receipt: NativeAtrReceipt,
): Rc54LotOutcome | null {
  if (!finite(receipt.exitAtMs) || !finite(receipt.exitBid) || receipt.exitBid <= 0)
    return null;
  const quote = { atMs: receipt.exitAtMs, bid: receipt.exitBid };
  return outcome(
    "runner",
    entryAsk,
    quote,
    "native_atr",
    ((receipt.exitBid - entryAsk) / entryAsk) * 100,
    "native_atr_exact_receipt",
  );
}

function replayRide(input: {
  lot?: Rc54LotOutcome["lot"];
  entryAsk: number;
  quotes: readonly Rc54ReplayQuote[];
  flattenAtMs: number;
}): Rc54LotOutcome | null {
  return replayLock({
    lot: input.lot ?? "runner",
    targetPct: Number.POSITIVE_INFINITY,
    stopPct: -30,
    entryAsk: input.entryAsk,
    quotes: input.quotes,
    flattenAtMs: input.flattenAtMs,
  });
}

function optionTypeFromOcc(occSymbol: string): "call" | "put" | null {
  const match = /^[A-Z]{1,6}\d{6}([CP])\d{8}$/.exec(occSymbol);
  return match?.[1] === "C" ? "call" : match?.[1] === "P" ? "put" : null;
}

function lastExecutableAtOrBeforeAndAfter(
  quotes: readonly Rc54ReplayQuote[],
  atMs: number,
  afterMs: number,
): Rc54ReplayQuote | null {
  for (let index = quotes.length - 1; index >= 0; index--) {
    const quote = quotes[index];
    if (quote.atMs <= atMs && quote.atMs >= afterMs && quote.bid > 0) return quote;
  }
  return null;
}

function replayNativeAtrFromUnderlying(input: {
  entryAsk: number;
  entryAtMs: number;
  bank: Rc54LotOutcome;
  quotes: readonly Rc54ReplayQuote[];
  flattenAtMs: number;
  underlyingBars: readonly Bar[];
  optionType: "call" | "put";
  trailK: number;
}): Rc54LotOutcome | null {
  // Before the bank fills there is no runner row. A pre-bank catastrophe or
  // time flatten closes the original two-contract row, so the second share
  // receives the same executable outcome rather than an invented ATR path.
  if (input.bank.exitReason !== "target") {
    return {
      ...input.bank,
      lot: "runner",
    };
  }

  const bars = [...input.underlyingBars]
    // Keep the complete RTH prefix. ATR14 at the entry/runner clocks must see
    // the same pre-entry session bars as the worker, not a post-entry slice.
    .filter((bar) => Number.isFinite(bar.ts) && bar.ts <= input.flattenAtMs)
    .sort((left, right) => left.ts - right.ts);
  // Frozen clocks occur a few seconds after the completed decision bar. The
  // live worker preserves that bar's spot close in entryStateByKey, so anchor
  // to the last completed bar at/before the candidate clock without lookahead.
  let entryIndex = -1;
  for (let index = 0; index < bars.length && bars[index].ts <= input.entryAtMs; index++) {
    entryIndex = index;
  }
  if (entryIndex < 0 || !(input.trailK > 0)) return null;

  let peakFavorable = bars[entryIndex].close;
  let trailExit: { triggerAtMs: number; quote: Rc54ReplayQuote; peakReturnPct: number } | null = null;
  for (let index = entryIndex; index < bars.length; index++) {
    const bar = bars[index];
    // The 15:25 mandatory flatten runs before ordinary price exits.
    if (bar.ts >= input.flattenAtMs) break;
    peakFavorable = input.optionType === "call"
      ? Math.max(peakFavorable, bar.close)
      : Math.min(peakFavorable, bar.close);
    if (bar.ts <= input.bank.exitAtMs) continue;
    const features = computeFeatures(bars, index);
    if (!(features.atr > 0)) continue;
    const entryUnderlying = bars[entryIndex].close;
    const inProfit = input.optionType === "call"
      ? features.close > entryUnderlying
      : features.close < entryUnderlying;
    const retraced = input.optionType === "call"
      ? features.close <= peakFavorable - input.trailK * features.atr
      : features.close >= peakFavorable + input.trailK * features.atr;
    if (!inProfit || !retraced) continue;
    const quote = lastExecutableAtOrBeforeAndAfter(
      input.quotes,
      bar.ts,
      input.bank.exitAtMs,
    );
    if (!quote) continue;
    trailExit = {
      triggerAtMs: bar.ts,
      quote,
      peakReturnPct: ((quote.bid - input.entryAsk) / input.entryAsk) * 100,
    };
    break;
  }

  const stop = input.quotes.find((quote) =>
    quote.atMs >= input.bank.exitAtMs
      && quote.atMs <= input.flattenAtMs
      && quote.bid > 0
      && ((quote.bid - input.entryAsk) / input.entryAsk) * 100 <= -30);
  if (stop && (!trailExit || stop.atMs <= trailExit.triggerAtMs)) {
    return outcome(
      "runner",
      input.entryAsk,
      stop,
      "stop",
      ((stop.bid - input.entryAsk) / input.entryAsk) * 100,
    );
  }
  if (trailExit) {
    return outcome(
      "runner",
      input.entryAsk,
      { atMs: trailExit.triggerAtMs, bid: trailExit.quote.bid },
      "native_atr",
      trailExit.peakReturnPct,
    );
  }
  const flatten = lastExecutableAtOrBefore(input.quotes, input.flattenAtMs);
  return flatten && flatten.atMs >= input.bank.exitAtMs
    ? outcome(
        "runner",
        input.entryAsk,
        flatten,
        "time_flatten",
        ((flatten.bid - input.entryAsk) / input.entryAsk) * 100,
      )
    : null;
}

/**
 * Research-only target sweep using the exact RC5.4 economic primitives:
 * two contracts, executable bid exits, a -30% catastrophe stop, no adds, and
 * a 15:25 caller-supplied flatten clock. The first lot banks at the injected
 * target; the second lot is deliberately varied only among RC5.4-compatible
 * runner shapes. This function does not select a target or authorize policy.
 */
export function replayRc54TargetStudy(input: {
  profile: Rc54TargetStudyProfile;
  entryAsk: number;
  entryAtMs: number;
  flattenAtMs: number;
  quotes: readonly Rc54ReplayQuote[];
}): Rc54CompositeOutcome & { studyProfile: Rc54TargetStudyProfile } {
  const targetPct = input.profile.targetPct;
  if (!finite(targetPct) || targetPct <= 0) {
    throw new Error("RC5.4 target study requires a positive target");
  }
  const censors: Rc54ReplayCensor[] = [];
  if (!finite(input.entryAsk) || input.entryAsk <= 0) censors.push("invalid_entry");
  if (!finite(input.entryAtMs) || !finite(input.flattenAtMs)
      || input.flattenAtMs < input.entryAtMs) censors.push("invalid_clock");
  if (input.entryAtMs >= input.flattenAtMs) censors.push("entry_after_flatten");
  const quotes = [...input.quotes]
    .filter((quote) => finite(quote.atMs) && finite(quote.bid)
      && quote.atMs >= input.entryAtMs && quote.atMs <= input.flattenAtMs)
    .sort((a, b) => a.atMs - b.atMs);
  if (!quotes.some((quote) => quote.bid > 0)) censors.push("missing_executable_path");

  const base = {
    profile: "L30/L50" as const,
    studyProfile: input.profile,
    entryAsk: input.entryAsk,
    entryAtMs: input.entryAtMs,
    flattenAtMs: input.flattenAtMs,
    censors,
    externalWrites: false as const,
    orderPathAuthorized: false as const,
    policyChangeAuthorized: false as const,
  };
  if (censors.length) {
    return { ...base, lots: [], exitAtMs: null, pnl: null, pnlPerContract: null, exact: false };
  }

  const bank = replayLock({
    lot: "bank",
    targetPct,
    stopPct: -30,
    entryAsk: input.entryAsk,
    quotes,
    flattenAtMs: input.flattenAtMs,
  });
  const runner = input.profile.runner === "a13"
    ? replayA13({ entryAsk: input.entryAsk, quotes, flattenAtMs: input.flattenAtMs })
    : input.profile.runner === "fixed-50"
      ? replayLock({
          lot: "runner",
          targetPct: 50,
          stopPct: -30,
          entryAsk: input.entryAsk,
          quotes,
          flattenAtMs: input.flattenAtMs,
        })
      : replayRide({ entryAsk: input.entryAsk, quotes, flattenAtMs: input.flattenAtMs });
  if (!bank || !runner) censors.push("no_executable_flatten_bid");
  const lots = [bank, runner].filter((row): row is Rc54LotOutcome => row != null);
  if (censors.length || lots.length !== 2) {
    return { ...base, censors, lots, exitAtMs: null, pnl: null, pnlPerContract: null, exact: false };
  }
  const pnl = round(lots.reduce((sum, lot) => sum + lot.pnl, 0));
  return {
    ...base,
    censors,
    lots,
    exitAtMs: Math.max(...lots.map((lot) => lot.exitAtMs)),
    pnl,
    pnlPerContract: round(pnl / 2),
    exact: true,
  };
}

export function replayRc54Composite(input: {
  profile: Rc54CompositeId;
  entryAsk: number;
  entryAtMs: number;
  flattenAtMs: number;
  quotes: readonly Rc54ReplayQuote[];
  nativeAtrReceipt?: NativeAtrReceipt | null;
}): Rc54CompositeOutcome {
  const censors: Rc54ReplayCensor[] = [];
  if (!finite(input.entryAsk) || input.entryAsk <= 0) censors.push("invalid_entry");
  if (!finite(input.entryAtMs) || !finite(input.flattenAtMs)
      || input.flattenAtMs < input.entryAtMs) censors.push("invalid_clock");
  if (input.entryAtMs >= input.flattenAtMs) censors.push("entry_after_flatten");
  const quotes = [...input.quotes]
    .filter((quote) => finite(quote.atMs) && finite(quote.bid)
      && quote.atMs >= input.entryAtMs && quote.atMs <= input.flattenAtMs)
    .sort((a, b) => a.atMs - b.atMs);
  if (!quotes.some((quote) => quote.bid > 0)) censors.push("missing_executable_path");

  const base: Omit<Rc54CompositeOutcome, "lots" | "exitAtMs" | "pnl" | "pnlPerContract" | "exact"> = {
    profile: input.profile,
    entryAsk: input.entryAsk,
    entryAtMs: input.entryAtMs,
    flattenAtMs: input.flattenAtMs,
    censors,
    externalWrites: false,
    orderPathAuthorized: false,
    policyChangeAuthorized: false,
  };
  if (censors.length)
    return { ...base, lots: [], exitAtMs: null, pnl: null, pnlPerContract: null, exact: false };

  const lock = (lot: Rc54LotOutcome["lot"], targetPct: number): Rc54LotOutcome | null =>
    replayLock({ lot, targetPct, stopPct: -30, entryAsk: input.entryAsk, quotes, flattenAtMs: input.flattenAtMs });

  let bank: Rc54LotOutcome | null;
  let runner: Rc54LotOutcome | null;
  switch (input.profile) {
    case "B30/A13":
      bank = lock("bank", 30);
      runner = replayA13({ entryAsk: input.entryAsk, quotes, flattenAtMs: input.flattenAtMs });
      break;
    case "B20/NATIVE-ATR":
      bank = lock("bank", 20);
      runner = input.nativeAtrReceipt
        ? replayNativeAtr(input.entryAsk, input.nativeAtrReceipt)
        : null;
      if (!runner) censors.push("native_atr_path_unavailable");
      break;
    case "L30/L50":
      bank = lock("bank", 30);
      runner = lock("runner", 50);
      break;
    case "B50/A13":
      bank = lock("bank", 50);
      runner = replayA13({ entryAsk: input.entryAsk, quotes, flattenAtMs: input.flattenAtMs });
      break;
  }
  if (!bank || (input.profile !== "B20/NATIVE-ATR" && !runner))
    censors.push("no_executable_flatten_bid");
  const lots = [bank, runner].filter((row): row is Rc54LotOutcome => row != null);
  if (censors.length || lots.length !== 2)
    return { ...base, censors, lots, exitAtMs: null, pnl: null, pnlPerContract: null, exact: false };
  const pnl = round(lots.reduce((sum, lot) => sum + lot.pnl, 0));
  return {
    ...base,
    censors,
    lots,
    exitAtMs: Math.max(...lots.map((lot) => lot.exitAtMs)),
    pnl,
    pnlPerContract: round(pnl / 2),
    exact: true,
  };
}

/**
 * Reconstruct the exact sealed RC5.4 manager shapes that are not represented
 * by the generic bank/runner target grid. Full-position policies preserve both
 * original shares. Native ATR uses the same 14-bar feature helper and
 * 1.5-ATR close/peak rule as the worker, with option exits valued at the last
 * executable Databento bid available at the bar-close trigger.
 */
export function replayRc54SealedManager(input: {
  profile: Rc54SealedReplayId;
  entryAsk: number;
  entryAtMs: number;
  flattenAtMs: number;
  quotes: readonly Rc54ReplayQuote[];
  occSymbol: string;
  underlyingBars?: readonly Bar[];
  nativeAtrTargetPct?: number;
  nativeAtrTrailK?: number;
}): Rc54SealedReplayOutcome {
  const censors: Rc54ReplayCensor[] = [];
  if (!finite(input.entryAsk) || input.entryAsk <= 0) censors.push("invalid_entry");
  if (!finite(input.entryAtMs) || !finite(input.flattenAtMs)
      || input.flattenAtMs < input.entryAtMs) censors.push("invalid_clock");
  if (input.entryAtMs >= input.flattenAtMs) censors.push("entry_after_flatten");
  const quotes = [...input.quotes]
    .filter((quote) => finite(quote.atMs) && finite(quote.bid)
      && quote.atMs >= input.entryAtMs && quote.atMs <= input.flattenAtMs)
    .sort((left, right) => left.atMs - right.atMs);
  if (!quotes.some((quote) => quote.bid > 0)) censors.push("missing_executable_path");

  const nativeAtrTargetPct = input.profile === "QQQ54-B20-NATIVE-ATR"
    ? input.nativeAtrTargetPct ?? 20
    : null;
  const base = {
    profile: input.profile,
    nativeAtrTargetPct,
    entryAsk: input.entryAsk,
    entryAtMs: input.entryAtMs,
    flattenAtMs: input.flattenAtMs,
    censors,
    externalWrites: false as const,
    orderPathAuthorized: false as const,
    policyChangeAuthorized: false as const,
  };
  if (censors.length) {
    return {
      ...base,
      lots: [],
      exitAtMs: null,
      pnl: null,
      pnlPerContract: null,
      exact: false,
    };
  }

  let lots: Rc54LotOutcome[] = [];
  if (input.profile === "RC53-RIDE") {
    const first = replayRide({
      lot: "bank",
      entryAsk: input.entryAsk,
      quotes,
      flattenAtMs: input.flattenAtMs,
    });
    const second = replayRide({
      lot: "runner",
      entryAsk: input.entryAsk,
      quotes,
      flattenAtMs: input.flattenAtMs,
    });
    lots = [first, second].filter((row): row is Rc54LotOutcome => row != null);
  } else if (input.profile === "RC53-A13") {
    const first = replayA13({
      lot: "bank",
      entryAsk: input.entryAsk,
      quotes,
      flattenAtMs: input.flattenAtMs,
    });
    const second = replayA13({
      lot: "runner",
      entryAsk: input.entryAsk,
      quotes,
      flattenAtMs: input.flattenAtMs,
    });
    lots = [first, second].filter((row): row is Rc54LotOutcome => row != null);
  } else {
    if (!(finite(nativeAtrTargetPct) && nativeAtrTargetPct > 0)) {
      throw new Error("native ATR replay requires a positive bank target");
    }
    const optionType = optionTypeFromOcc(input.occSymbol);
    if (!optionType || !input.underlyingBars?.length) {
      censors.push("native_atr_underlying_path_unavailable");
    } else {
      const bank = replayLock({
        lot: "bank",
        targetPct: nativeAtrTargetPct,
        stopPct: -30,
        entryAsk: input.entryAsk,
        quotes,
        flattenAtMs: input.flattenAtMs,
      });
      const runner = bank
        ? replayNativeAtrFromUnderlying({
            entryAsk: input.entryAsk,
            entryAtMs: input.entryAtMs,
            bank,
            quotes,
            flattenAtMs: input.flattenAtMs,
            underlyingBars: input.underlyingBars,
            optionType,
            trailK: input.nativeAtrTrailK ?? 1.5,
          })
        : null;
      if (!bank || !runner) censors.push("native_atr_underlying_path_unavailable");
      lots = [bank, runner].filter((row): row is Rc54LotOutcome => row != null);
    }
  }
  if (lots.length !== 2 && !censors.length) censors.push("no_executable_flatten_bid");
  if (censors.length || lots.length !== 2) {
    return {
      ...base,
      censors,
      lots,
      exitAtMs: null,
      pnl: null,
      pnlPerContract: null,
      exact: false,
    };
  }
  const pnl = round(lots.reduce((sum, lot) => sum + lot.pnl, 0));
  return {
    ...base,
    censors,
    lots,
    exitAtMs: Math.max(...lots.map((lot) => lot.exitAtMs)),
    pnl,
    pnlPerContract: round(pnl / 2),
    exact: true,
  };
}
