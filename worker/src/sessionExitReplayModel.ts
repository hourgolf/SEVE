// Pure, one-session exit replay. It only tests scale actions observed before the
// native close; it never extends a position past the actual evidence horizon.

export interface ExitReplayQuote {
  atMs: number;
  bid: number;
}

export interface ExitReplayPosition {
  id: string;
  channel: string;
  quantity: number;
  entryPrice: number;
  openedAtMs: number;
  nativeClosedAtMs: number;
  nativeExitPrice: number;
  nativePnl: number;
}

export type RunnerMode = "native" | "breakeven" | "half_giveback";

export interface ScaleReplayResult {
  eligible: boolean;
  triggered: boolean;
  targetPct: number;
  runnerMode: RunnerMode;
  bankQty: number;
  runnerQty: number;
  bankAtMs: number | null;
  bankPrice: number | null;
  runnerAtMs: number;
  runnerPrice: number;
  runnerReason: "native" | "breakeven" | "half_giveback";
  modeledPnl: number;
  deltaVsNative: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const money = (value: number): number => Math.round(value * 100) / 100;
const pnl = (entry: number, exit: number, quantity: number): number => money((exit - entry) * quantity * 100);
const retPct = (entry: number, bid: number): number => ((bid / entry) - 1) * 100;

export function replayScaleBeforeNativeClose(
  position: ExitReplayPosition,
  quotes: readonly ExitReplayQuote[],
  targetPct: number,
  runnerMode: RunnerMode,
): ScaleReplayResult {
  const eligible = !!position.id && !!position.channel && Number.isInteger(position.quantity) && position.quantity >= 2
    && finite(position.entryPrice) && position.entryPrice > 0
    && finite(position.nativeExitPrice) && position.nativeExitPrice >= 0
    && finite(position.nativePnl) && finite(position.openedAtMs) && finite(position.nativeClosedAtMs)
    && position.nativeClosedAtMs >= position.openedAtMs && finite(targetPct) && targetPct > 0;
  const bankQty = eligible ? Math.floor(position.quantity / 2) : 0;
  const runnerQty = eligible ? position.quantity - bankQty : 0;
  const native = {
    eligible,
    triggered: false,
    targetPct,
    runnerMode,
    bankQty,
    runnerQty,
    bankAtMs: null,
    bankPrice: null,
    runnerAtMs: position.nativeClosedAtMs,
    runnerPrice: position.nativeExitPrice,
    runnerReason: "native" as const,
    modeledPnl: position.nativePnl,
    deltaVsNative: 0,
  };
  if (!eligible) return native;

  const path = quotes
    .filter((quote) => finite(quote.atMs) && finite(quote.bid) && quote.bid > 0
      && quote.atMs >= position.openedAtMs && quote.atMs <= position.nativeClosedAtMs)
    .sort((a, b) => a.atMs - b.atMs || a.bid - b.bid);
  const targetPrice = position.entryPrice * (1 + targetPct / 100);
  const bankIndex = path.findIndex((quote) => quote.bid + 1e-9 >= targetPrice);
  if (bankIndex < 0) return native;

  const bank = path[bankIndex];
  let runnerAtMs = position.nativeClosedAtMs;
  let runnerPrice = position.nativeExitPrice;
  let runnerReason: ScaleReplayResult["runnerReason"] = "native";
  let peakReturnPct = retPct(position.entryPrice, bank.bid);
  for (const quote of path.slice(bankIndex + 1)) {
    const current = retPct(position.entryPrice, quote.bid);
    peakReturnPct = Math.max(peakReturnPct, current);
    if (runnerMode === "breakeven" && current <= 0) {
      runnerAtMs = quote.atMs; runnerPrice = quote.bid; runnerReason = "breakeven"; break;
    }
    if (runnerMode === "half_giveback" && current <= Math.max(0, peakReturnPct * 0.5)) {
      runnerAtMs = quote.atMs; runnerPrice = quote.bid; runnerReason = "half_giveback"; break;
    }
  }
  const modeledPnl = money(pnl(position.entryPrice, bank.bid, bankQty) + pnl(position.entryPrice, runnerPrice, runnerQty));
  return {
    eligible: true,
    triggered: true,
    targetPct,
    runnerMode,
    bankQty,
    runnerQty,
    bankAtMs: bank.atMs,
    bankPrice: bank.bid,
    runnerAtMs,
    runnerPrice,
    runnerReason,
    modeledPnl,
    deltaVsNative: money(modeledPnl - position.nativePnl),
  };
}
