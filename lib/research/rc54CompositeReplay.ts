// Pure, replay-only RC5.4 composite-manager model. Each profile represents a
// two-contract entry split into two one-contract exit paths. It cannot write,
// authorize orders, or mutate the sealed runtime policy.

export const RC54_COMPOSITE_REPLAY_VERSION = "rc54-composite-replay-v1" as const;

export const RC54_COMPOSITE_IDS = [
  "B30/A13",
  "B20/NATIVE-ATR",
  "L30/L50",
  "B50/A13",
] as const;

export type Rc54CompositeId = typeof RC54_COMPOSITE_IDS[number];

export interface Rc54ReplayQuote {
  atMs: number;
  bid: number;
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
  | "native_atr_path_unavailable";

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
        return outcome("runner", input.entryAsk, quote, "prearm_stop", peakReturnPct);
      if (ret >= armPct) armed = true;
      continue;
    }
    if (ret <= peakReturnPct * keepFraction)
      return outcome("runner", input.entryAsk, quote, "a13_giveback", peakReturnPct);
  }
  const flatten = lastExecutableAtOrBefore(input.quotes, input.flattenAtMs);
  return flatten
    ? outcome(
        "runner",
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
