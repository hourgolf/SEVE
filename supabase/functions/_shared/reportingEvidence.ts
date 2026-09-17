/** Shared by hosted producers and dashboard readers. No database or runtime authority. */
export const REPORTING_SCHEMA = 'seve-reporting-v3' as const;
export interface PeakObservation { id: string; realizedUsd: number; peakGainUsd: number | null; peakPct: number | null; issue?: string | null }
export interface PeakDiagnostic {
  schema: typeof REPORTING_SCHEMA;
  basis: 'sampled_held_position_marks';
  unit: 'logical_trade';
  moneyUnit: 'whole_position_usd';
  horizon: 'each_tranche_held_window';
  decisionEligible: false;
  total: number; valid: number; excluded: number;
  exclusions: { id: string; reason: string }[];
  numeratorUsd: number; denominatorUsd: number;
  averagePeakPct: number | null;
  signedRatio: number | null;
  retainedPct: number | null;
}
export function summarizePeakDiagnostics(rows: readonly PeakObservation[]): PeakDiagnostic {
  const valid: PeakObservation[] = [], exclusions: PeakDiagnostic['exclusions'] = [];
  for (const row of rows) {
    const issue = row.issue || (!Number.isFinite(row.realizedUsd) ? 'invalid_result'
      : row.peakGainUsd == null || !Number.isFinite(row.peakGainUsd) ? 'missing_peak'
      : row.peakGainUsd <= 0 ? 'no_positive_peak'
      : row.realizedUsd > row.peakGainUsd + 1e-7 ? 'exit_above_sampled_peak'
      : row.peakPct == null || !Number.isFinite(row.peakPct) || row.peakPct < 0 ? 'invalid_peak' : null);
    if (issue) exclusions.push({ id: row.id, reason: issue }); else valid.push(row);
  }
  const numeratorUsd = valid.reduce((s, r) => s + r.realizedUsd, 0);
  const denominatorUsd = valid.reduce((s, r) => s + r.peakGainUsd!, 0);
  const signedRatio = denominatorUsd > 0 ? numeratorUsd / denominatorUsd : null;
  return { schema: REPORTING_SCHEMA, basis: 'sampled_held_position_marks', unit: 'logical_trade', moneyUnit: 'whole_position_usd', horizon: 'each_tranche_held_window', decisionEligible: false,
    total: rows.length, valid: valid.length, excluded: exclusions.length, exclusions, numeratorUsd, denominatorUsd,
    averagePeakPct: valid.length ? valid.reduce((s,r) => s + r.peakPct!, 0) / valid.length : null,
    signedRatio, retainedPct: signedRatio != null && signedRatio >= 0 && signedRatio <= 1 ? signedRatio * 100 : null };
}
/** Reject the entire narrative if tool markup or wrong field shapes leaked into it. */
export function validatedNarrative<T>(value: T | null, kind: 'daily' | 'weekly'): T | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const malformed = (x: unknown): boolean => typeof x === 'string' ? /<\/?(?:parameter|function|tool|invoke)|\[\s*\{\s*"slug"/i.test(x) : Array.isArray(x) ? x.some(malformed) : x != null && typeof x === 'object' ? Object.values(x).some(malformed) : false;
  if (malformed(value)) return null;
  for (const field of kind === 'daily' ? ['marketSummary'] : ['weekSummary']) if (object[field] != null && typeof object[field] !== 'string') return null;
  for (const field of kind === 'daily' ? ['topActions'] : ['keyLearnings']) if (object[field] != null && (!Array.isArray(object[field]) || (object[field] as unknown[]).some(x => typeof x !== 'string'))) return null;
  for (const field of kind === 'daily' ? ['channels','systemFindings'] : ['channels','suggestions']) {
    if (object[field] == null) continue;
    if (!Array.isArray(object[field]) || (object[field] as unknown[]).some(x => !x || typeof x !== 'object' || Array.isArray(x))) return null;
    for (const row of object[field] as Record<string, unknown>[]) {
      for (const [key, val] of Object.entries(row)) {
        if (['channels','wentRight','wentWrong'].includes(key)) { if (!Array.isArray(val) || val.some(x => typeof x !== 'string')) return null; }
        else if (typeof val !== 'string' && val != null) return null;
      }
    }
  }
  return value;
}

export function heldTradePeakObservation(id: string, rows: readonly { avg_entry_price: unknown; qty: unknown; realized_pnl: unknown; peak_mark: unknown }[]): PeakObservation {
  let realizedUsd = 0, peakGainUsd = 0, debitUsd = 0;
  let issue: string | null = rows.length ? null : 'missing_tranches';
  for (const row of rows) {
    const entry = Number(row.avg_entry_price), qty = Math.abs(Number(row.qty)), pnl = Number(row.realized_pnl), peak = Number(row.peak_mark);
    if (row.avg_entry_price == null || row.qty == null || row.realized_pnl == null || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(pnl)) issue = 'invalid_tranche_economics';
    else if (row.peak_mark == null || !Number.isFinite(peak) || peak <= 0) issue ??= 'missing_tranche_peak';
    else if (entry + pnl / (qty * 100) > peak + 1e-9) issue ??= 'exit_above_sampled_peak';
    realizedUsd += pnl; debitUsd += entry * qty * 100;
    peakGainUsd += Math.max(0, peak - entry) * qty * 100;
  }
  return { id, realizedUsd, peakGainUsd, peakPct: debitUsd > 0 ? peakGainUsd / debitUsd * 100 : null, issue };
}
