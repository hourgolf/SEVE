/** Closed ledger tranches across all accounts, independent of today's roster.
 * Broker reconciliation is a separate check; this is never a simulated PnL. */
export interface ForensicsExecutionSummary {
  schemaVersion: 1;
  source: "positions_ledger";
  date: string;
  observedAt: string;
  window: { from: string; toExclusive: string };
  nClosedTranches: number;
  nRootPositions: number;
  nUnattributedTranches: number;
  grossPnlUsd: number;
  feesIncluded: false;
  positions: Array<{ id: string; accountId: string | null; channelSlug: string; qty: number; grossPnlUsd: number; runnerOf: string | null }>;
}

export function buildForensicsExecutionSummary(input: {
  date: string; observedAt: string; from: string; toExclusive: string;
  rows: Array<{ id: string; account_id: string | null; qty: unknown; realized_pnl: unknown;
    runner_of?: string | null; strategists: { slug: string } }>;
}): ForensicsExecutionSummary {
  const ids = new Set<string>();
  const positions = input.rows.map(row => {
    const qty = Number(row.qty), pnl = Number(row.realized_pnl);
    if (!row.id || ids.has(row.id) || (row.account_id != null && !row.account_id) || !row.strategists?.slug
      || row.qty == null || !Number.isInteger(qty) || qty < 0
      || row.realized_pnl == null || row.realized_pnl === "" || !Number.isFinite(pnl)) {
      throw new Error("Incomplete or duplicate closed-position evidence");
    }
    ids.add(row.id);
    return { id: row.id, accountId: row.account_id ?? null, channelSlug: row.strategists.slug,
      qty, grossPnlUsd: pnl, runnerOf: row.runner_of ?? null };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { schemaVersion: 1, source: "positions_ledger", date: input.date, observedAt: input.observedAt,
    window: { from: input.from, toExclusive: input.toExclusive },
    nClosedTranches: positions.length, nRootPositions: positions.filter(p => p.runnerOf == null).length,
    nUnattributedTranches: positions.filter(p => p.accountId == null).length,
    grossPnlUsd: Math.round(positions.reduce((sum, p) => sum + p.grossPnlUsd, 0) * 1e8) / 1e8,
    feesIncluded: false, positions };
}

/** Older reports lack this evidence. Never substitute a roster subset or a simulation. */
export function readForensicsExecutionSummary(value: unknown, date: string): ForensicsExecutionSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as ForensicsExecutionSummary;
  if (v.schemaVersion !== 1 || v.source !== "positions_ledger" || v.date !== date || v.feesIncluded !== false
    || !Number.isFinite(Date.parse(v.observedAt)) || !Array.isArray(v.positions)
    || !v.window || !Number.isFinite(Date.parse(v.window.from))
    || !Number.isFinite(Date.parse(v.window.toExclusive)) || Date.parse(v.window.from) >= Date.parse(v.window.toExclusive)) return null;
  try {
    const rebuilt = buildForensicsExecutionSummary({ date, observedAt: v.observedAt,
      from: v.window.from, toExclusive: v.window.toExclusive,
      rows: v.positions.map(p => ({ id: p.id, account_id: p.accountId, qty: p.qty,
        realized_pnl: p.grossPnlUsd, runner_of: p.runnerOf, strategists: { slug: p.channelSlug } })) });
    return rebuilt.grossPnlUsd === v.grossPnlUsd && rebuilt.nClosedTranches === v.nClosedTranches
      && rebuilt.nRootPositions === v.nRootPositions && rebuilt.nUnattributedTranches === v.nUnattributedTranches ? rebuilt : null;
  } catch { return null; }
}
