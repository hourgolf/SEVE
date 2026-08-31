// Exercise the production retrieval helpers against the audit's frozen rows.
// Not a live smoke: no database/network calls, no publication.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { readWindowedPositions, readWindowedExecutionRoutes } from "../lib/perform/windowedEvidenceRead";
import { summarizeLogicalTradeCohort } from "../lib/positions/logicalTradeCohort";
import { attributePositionsByImmutableExecutionAccount } from "../lib/ops/brokerReconciliation";
const root = "data/roster-evidence-audit-2026-08-31-1222";
const auditText = readFileSync(`${root}/audit.json`, "utf8");
const snapshotText = readFileSync(`${root}/canonical/snapshot.json`, "utf8");
const receipt = JSON.parse(readFileSync(`${root}/canonical/receipt.json`, "utf8"));
const hash = (v: string) => `sha256:${createHash("sha256").update(v).digest("hex")}`;
assert.equal(hash(snapshotText), receipt.snapshotSha256);
const audit = JSON.parse(auditText), snapshot = JSON.parse(snapshotText);
const observations = [...new Map(audit.uiRuns.flatMap((w: any) => w.completeObservations).map((r: any) => [r.id, r])).values()];
const tables: Record<string, any[]> = { positions: snapshot.positions, execution_observations: observations };
const db = { from(table: string) {
  const filters: Array<(r: any) => boolean> = [], orders: Array<[string, boolean]> = [];
  const q: any = {
    select(_f: string, opts: any) { assert.equal(opts.count, "exact"); return q; },
    eq(k: string, v: any) { filters.push(r => r[k] === v); return q; },
    in(k: string, v: any[]) { filters.push(r => v.includes(r[k])); return q; },
    gte(k: string, v: any) { filters.push(r => r[k] >= v); return q; },
    lte(k: string, v: any) { filters.push(r => r[k] <= v); return q; },
    order(k: string, opts?: any) { orders.push([k, opts?.ascending !== false]); return q; },
    async range(a: number, b: number) {
      assert.equal(orders.at(-1)?.[0], "id");
      const rows = tables[table].filter(r => filters.every(f => f(r))).sort((x, y) => {
        for (const [k, asc] of orders) { const n = String(x[k]).localeCompare(String(y[k])); if (n) return asc ? n : -n; }
        return 0;
      });
      return { data: rows.slice(a, Math.min(b + 1, a + 1000)), count: rows.length, error: null };
    },
  }; return q;
} };
async function main() {
  const checks = [];
  for (const window of audit.uiRuns) {
    const rows = await readWindowedPositions(db, window.start, audit.cutoff);
    const routes = await readWindowedExecutionRoutes(db, rows);
    const attribution = attributePositionsByImmutableExecutionAccount({ positions: rows, observations: routes,
      configuredPaperAccountIds: new Set<string>(snapshot.accounts.map((a: any) => a.id)) });
    assert.equal(attribution.missingPositionIds.length, 0);
    for (const spec of audit.roster) {
      const group = summarizeLogicalTradeCohort(attribution.byAccount.get(spec.accountId) ?? [], { allowExternalParents: false });
      assert.equal(group.issues.length, 0);
      const trades = group.groups.filter(t => t.status === "closed" && t.rows[0].channel_slug === spec.slug
        && t.rows.map(r => r.closed_at ?? "").sort().at(-1)! >= window.start);
      assert(trades.every(t => t.realizedPnl != null));
      const result = { trades: trades.length, wins: trades.filter(t => t.realizedPnl! > 0).length,
        pnl: Math.round(trades.reduce((n, t) => n + t.realizedPnl!, 0) * 100) / 100 };
      const expected = window.comparisons.find((c: any) => c.slug === spec.slug).canonical;
      assert.deepEqual(result, { trades: expected.trades, wins: expected.wins, pnl: expected.pnl });
      checks.push({ window: window.key, channel: spec.slug, ...result });
    }
  }
  const briefs = JSON.parse(readFileSync("data/roster-evidence-repairs-2026-08-31/briefs-complete/briefs.json", "utf8"));
  for (const expected of audit.nativeStats) {
    const trial = briefs.channels[expected.slug].trialReview;
    assert.equal(trial.trades, expected.exactCurrentSpecCompleted.trades);
    assert.equal(trial.totalUsd, expected.exactCurrentSpecCompleted.pnl);
  }
  const out = "data/roster-evidence-repairs-2026-08-31/verification";
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/frozen-reconciliation.json`, `${JSON.stringify({ sourceAuditSha256: hash(auditText), snapshotSha256: hash(snapshotText),
    comparisonsPassed: checks.length, currentSpecBriefChecksPassed: audit.nativeStats.length, productionReads: 0, productionWrites: 0, checks }, null, 2)}\n`, { flag: "wx" });
  console.log(`Frozen audit repair verification: PASS · ${checks.length}/20 account/channel/window comparisons · 10/10 exact-spec brief reconciliations`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
