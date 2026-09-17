import { sessionCloseMin } from "../../engine/market-calendar";

export interface ComparisonSpec {
  id: string; version_key: string;
  stop_loss: { catastrophePct?: number; priceBasis?: string };
  take_profit: { targetPct?: number | null; fraction?: number; kind?: string };
  ratchet_parameters?: { kind?: string };
  exit_parameters: { eodEt?: string };
}
export interface ComparisonPosition {
  id: string; runner_of?: string | null; qty?: number | string; avg_entry_price?: number | string;
  status?: string; closed_at?: string | null; close_reason?: string | null;
  channel_spec_version_id?: string | null; entry_features?: Record<string, unknown> | null;
}
export interface ComparisonRun {
  position_id: string; manager_id: string; status: string; shadow_book_version: string;
  manager_policy_version: string; entry_price?: number | string; original_qty?: number | string;
  entry_at?: string; admission_source?: string | null; first_quote_at?: string | null;
  economic_mode?: string; terminal_at?: string | null; peak_return_pct?: number | string | null;
  terminal_trigger?: string | null; censor_code?: string | null;
  terminal_pnl?: number | string | null; terminal_return_pct?: number | string | null;
}
export interface NativeObservation {
  position_id: string | null; event_at: string; reason?: string | null;
  bid?: number | string | null; payload?: Record<string, unknown> | null;
}
const n = (v: unknown) => v == null || v === "" ? NaN : Number(v);
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const time = (s: string | null | undefined) => s ? Date.parse(s) : NaN;
const et = (s: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(s));
  const get = (k: string) => parts.find(p => p.type === k)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) + Number(get("second")) / 60 };
};
/** Unknown arms must not inherit a default stop. */
export function shadowManagerStop(manager: string): number | null {
  if (["LOCK20/30", "LOCK30/30", "LOCK50/30", "BANK20/RUN50", "ARM20/HALF-GIVEBACK", "BELL/-30",
    "FULL-R20-K50", "FULL-R50-K67", "PB2-BANK15/HALF-GIVEBACK", "GRIND-B25/CURRENT-A13",
    "VB-MACD-CURRENT-LOCK18", "VB-LEVEL-CURRENT-LOCK25"].includes(manager)) return 30;
  if (["GRIND-SMART-ALL-OUT-8", "ORB-TREND-SOURCE-30/35"].includes(manager)) return 35;
  if (["MOMO2-CURRENT-LOCK27", "MOMO2-B20-BE-R50"].includes(manager)) return 40;
  return manager === "WIDE20/50" ? 50 : null;
}
export function comparisonSpec(position: ComparisonPosition, specs: readonly ComparisonSpec[]) {
  const identity = object(position.entry_features?.configuration_identity);
  const direct = specs.find(s => s.id === position.channel_spec_version_id);
  const stamped = specs.find(s => s.version_key === identity.channelSpecVersionId);
  if (direct && stamped && direct.id !== stamped.id) return undefined;
  return direct ?? stamped;
}

/** All gates act on derived research values only. They cannot rewrite a trade,
 * retroactively synthesize a quote, change a manager, or authorize an order. */
export function nativeComparisonReason(input: {
  run: ComparisonRun; position?: ComparisonPosition; positions: readonly ComparisonPosition[];
  specs: readonly ComparisonSpec[]; runs: readonly ComparisonRun[]; observations: readonly NativeObservation[];
}): string | null {
  const { run, position: p } = input;
  if (!p) return "comparison_position_missing";
  if (input.runs.filter(x => x.position_id === run.position_id && x.manager_id === run.manager_id
    && x.shadow_book_version === run.shadow_book_version && x.manager_policy_version === run.manager_policy_version).length > 1)
    return "comparison_duplicate_manager";
  if (p.runner_of) return "comparison_requires_logical_root";
  const spec = comparisonSpec(p, input.specs);
  if (!spec || spec.stop_loss.priceBasis !== "executable-option-bid") return "comparison_native_policy_unresolved";
  if (run.manager_policy_version !== "manager-lab-preregister-v1") return "comparison_manager_version_unknown";
  if (run.shadow_book_version !== "manager-shadow-book-v2" || run.admission_source !== "fill_hook"
    || run.economic_mode !== "whole_lot_executable") return "comparison_not_prospective_whole_lot";
  if (shadowManagerStop(run.manager_id) !== n(spec.stop_loss.catastrophePct)) return "comparison_native_stop_mismatch";
  const family = [p], seen = new Set([p.id]);
  for (let i = 0; i < family.length; i++) for (const child of input.positions.filter(x => x.runner_of === family[i].id)) {
    if (seen.has(child.id)) return "comparison_lineage_cycle";
    seen.add(child.id); family.push(child);
  }
  if (family.some(x => x.status !== "closed" || !Number.isFinite(time(x.closed_at)))) return "comparison_actual_incomplete";
  const qty = family.reduce((sum, x) => sum + n(x.qty), 0);
  if (family.some(x => !Number.isInteger(n(x.qty)) || n(x.qty) <= 0 || !Number.isFinite(n(x.avg_entry_price)) || Math.abs(n(x.avg_entry_price) - n(p.avg_entry_price)) > 0.0001)
    || !Number.isFinite(qty) || qty !== n(run.original_qty)
    || !Number.isFinite(n(p.avg_entry_price)) || Math.abs(n(p.avg_entry_price) - n(run.entry_price)) > 0.0001)
    return "comparison_entry_or_quantity_mismatch";
  if (!Number.isFinite(time(run.entry_at)) || !Number.isFinite(time(run.first_quote_at)) || time(run.first_quote_at) < time(run.entry_at)
    || time(run.first_quote_at) > Math.max(...family.map(x => time(x.closed_at)))) return "comparison_first_quote_unverified";
  const eod = spec.exit_parameters.eodEt;
  if (!eod || !/^([01]\d|2[0-3]):[0-5]\d$/.test(eod)) return "comparison_native_cutoff_unresolved";
  if (run.status === "terminal") {
    if (!Number.isFinite(n(run.terminal_pnl)) || !Number.isFinite(n(run.terminal_return_pct))
      || Math.abs(n(run.terminal_pnl) - n(run.terminal_return_pct) * n(run.entry_price) * qty) > 0.05)
      return "comparison_terminal_economics_invalid";
    if (!Number.isFinite(time(run.terminal_at)) || !Number.isFinite(time(run.entry_at))) return "comparison_terminal_clock_invalid";
    const end = et(run.terminal_at!), start = et(run.entry_at!);
    const [h, m] = eod.split(":").map(Number), cutoff = Math.min(h * 60 + m, sessionCloseMin(start.day) - 5);
    if (end.day !== start.day || end.minute > cutoff + 0.5) return "comparison_after_native_flatten";
    const mandatoryClose = family.find(x => /event|halt|kill|eod|flatten/.test(x.close_reason ?? ""));
    if (mandatoryClose && time(run.terminal_at) > time(mandatoryClose.closed_at) + 1_000)
      return "comparison_after_mandatory_close";
  }
  // An all-out native has an independently observable target. If its identical
  // observer missed a native target quote, quarantine every arm of the entry.
  const target = n(spec.take_profit.targetPct), stop = n(spec.stop_loss.catastrophePct);
  const equivalent = spec.take_profit.fraction === 0 && spec.ratchet_parameters?.kind === "none"
    ? ({ "20/30": "LOCK20/30", "30/30": "LOCK30/30", "50/30": "LOCK50/30", "20/50": "WIDE20/50",
      "8/35": "GRIND-SMART-ALL-OUT-8", "18/30": "VB-MACD-CURRENT-LOCK18", "25/30": "VB-LEVEL-CURRENT-LOCK25",
      "27/40": "MOMO2-CURRENT-LOCK27" } as Record<string, string>)[`${target}/${stop}`] : null;
  const baseline = equivalent && input.runs.find(x => x.position_id === p.id && x.manager_id === equivalent
    && x.shadow_book_version === run.shadow_book_version);
  if (baseline) for (const obs of input.observations) {
    if (obs.position_id !== p.id || obs.payload?.shadowOnly || obs.reason !== "target_premium") continue;
    const bid = n(object(obs.payload?.decisionDetail).bid ?? obs.bid);
    if (time(obs.event_at) < time(run.entry_at) || time(obs.event_at) > time(p.closed_at)) continue;
    if (bid >= n(run.entry_price) * (1 + target / 100)
      && (!baseline.terminal_at || time(baseline.terminal_at) > time(obs.event_at) + 1_000)
      && n(baseline.peak_return_pct) + 0.01 < target) return "comparison_native_quote_missed";
  }
  return null;
}
