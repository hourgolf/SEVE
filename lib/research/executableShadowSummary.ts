/** Reporting projection only. Append-only replay receipts are never rewritten. */
export interface SummaryReceipt {
  id: string; run_id: string; opportunity_id: string; signal_id: string;
  channel_slug: string; session_date_et: string; mode: string;
  configuration_content_hash: string; manager_id: string; manager_version: string;
  contract_selection_id: string; disposition: string;
  result_per_contract_usd: number | string | null;
}
export interface SummaryRun {
  id: string; generated_at: string; receipt_count: number;
  observedReceiptCount: number;
}
const numeric = (v: unknown): number | null => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const round = (v: number) => Math.round(v * 100) / 100;

export function summarizeExecutableShadow(input: {
  rows: readonly SummaryReceipt[]; runs: readonly SummaryRun[];
  slug: string; configurationHash: string; from: string; through: string; primaryManager: string;
}) {
  const eligibleRuns = new Map(input.runs.filter(r => Number.isFinite(Date.parse(r.generated_at))
    && r.receipt_count === r.observedReceiptCount).map(r => [r.id, r]));
  const eligible = input.rows.filter(r => r.channel_slug === input.slug && r.mode === "channel_isolated"
    && r.configuration_content_hash === input.configurationHash
    && r.session_date_et >= input.from && r.session_date_et <= input.through && eligibleRuns.has(r.run_id));
  // Choose an entire run for each session, never a result-dependent best row or
  // a mosaic of different re-entry/admission simulations.
  const selected = new Map<string, string>();
  for (const row of eligible) {
    const previous = selected.get(row.session_date_et);
    const rank = (id: string) => Date.parse(eligibleRuns.get(id)!.generated_at);
    if (!previous || rank(row.run_id) > rank(previous) || (rank(row.run_id) === rank(previous) && row.run_id > previous)) selected.set(row.session_date_et, row.run_id);
  }
  const rows = eligible.filter(r => selected.get(r.session_date_et) === r.run_id);
  const keys = rows.map(r => `${r.session_date_et}|${r.signal_id}|${r.manager_id}|${r.manager_version}|${r.contract_selection_id}`);
  if (new Set(keys).size !== keys.length) throw new Error("duplicate executable-shadow opportunity within canonical run");
  const score = (r: SummaryReceipt) => r.disposition === "filled" ? numeric(r.result_per_contract_usd) : null;
  const groups = new Map<string, SummaryReceipt[]>();
  for (const r of rows) {
    const key = `${r.manager_id}|${r.manager_version}|${r.contract_selection_id}`;
    groups.set(key, [...groups.get(key) ?? [], r]);
  }
  const arms = [...groups.values()].map(rs => {
    const values = rs.map(score).filter((v): v is number => v != null);
    return { manager: rs[0].manager_id, managerVersion: rs[0].manager_version, wrapper: rs[0].contract_selection_id,
      sessions: new Set(rs.map(r => r.session_date_et)).size, scored: values.length,
      censored: rs.filter(r => r.disposition.includes("censored")).length,
      blocked: rs.filter(r => r.disposition.startsWith("blocked_")).length,
      averagePerContractUsd: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null };
  }).sort((a, b) => Number(b.manager === input.primaryManager) - Number(a.manager === input.primaryManager)
    || a.wrapper.localeCompare(b.wrapper) || a.manager.localeCompare(b.manager) || a.managerVersion.localeCompare(b.managerVersion));
  return { sessions: selected.size,
    opportunities: new Set(rows.map(r => `${r.session_date_et}|${r.signal_id}`)).size,
    armObservations: rows.length, scored: rows.filter(r => score(r) != null).length,
    censored: rows.filter(r => r.disposition.includes("censored")).length,
    blocked: rows.filter(r => r.disposition.startsWith("blocked_")).length,
    supersededReceipts: eligible.length - rows.length,
    incompleteRuns: input.runs.filter(r => r.receipt_count !== r.observedReceiptCount).length,
    from: input.from, through: input.through, configurationHash: input.configurationHash,
    canonicalRunBySession: Object.fromEntries(selected), arms };
}
