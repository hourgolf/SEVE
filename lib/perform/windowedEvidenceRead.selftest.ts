import assert from "node:assert/strict";
import { readCompleteEvidence, readWindowedExecutionRoutes, readWindowedPositions } from "./windowedEvidenceRead";
import { summarizeLogicalTradeCohort } from "../positions/logicalTradeCohort";
import { attributePositionsByImmutableExecutionAccount } from "../ops/brokerReconciliation";

function fixture(tables: Record<string, any[]>, failPage = -1, cap = 1000) {
  return { from(table: string) {
    let filters: ((r: any) => boolean)[] = [];
    const orders: string[] = [];
    let exact = false;
    const q: any = {
      select(_fields: string, options?: { count: string }) { exact = options?.count === "exact"; return q; },
      eq(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
      in(k: string, vs: unknown[]) { filters.push(r => vs.includes(r[k])); return q; },
      gte(k: string, v: string) { filters.push(r => r[k] >= v); return q; },
      lte(k: string, v: string) { filters.push(r => r[k] <= v); return q; },
      order(k: string) { orders.push(k); return q; },
      async range(from: number, to: number) {
        assert.equal(exact, true, "every paged query must request coverage");
        assert.equal(orders.at(-1), "id", "equal timestamps require unique tie-break");
        if (from === failPage) return { data: null, count: null, error: { message: "page failed" } };
        const rows = tables[table].filter(r => filters.every(f => f(r))).sort((a, b) => {
          for (const k of orders) { const order = String(a[k]).localeCompare(String(b[k])); if (order) return order; }
          return 0;
        });
        return { data: rows.slice(from, Math.min(to + 1, from + cap)), count: rows.length, error: null };
      },
    };
    return q;
  } };
}

async function main() {
  const pos = (id: string, at: string, pnl = 10, parent: string | null = null) => ({ id, closed_at: at,
    status: "closed", realized_pnl: pnl, qty: 1, avg_entry_price: 1, peak_mark: 1.2, runner_of: parent });
  const positions = [pos("old", "2026-08-05", -10), pos("bank", "2026-08-15", 30),
    pos("runner", "2026-08-28", -10, "bank"), pos("today", "2026-08-31", 5)];
  const observations = Array.from({ length: 2841 }, (_, i) => ({ id: String(i).padStart(5, "0"),
    position_id: positions[Math.floor(i / 711) % 4].id, account_id: "paper-1", event_at: "2026-08-31T00:00:00Z" }));
  const sb = fixture({ positions, execution_observations: observations });
  const routes = await readWindowedExecutionRoutes(sb, positions);
  assert.equal(routes.length, 2841, "must exceed server's 1000-row cap");
  assert.equal(attributePositionsByImmutableExecutionAccount({ positions, observations: routes,
    configuredPaperAccountIds: new Set(["paper-1"]) }).missingPositionIds.length, 0);
  const roots: string[][] = [];
  for (const start of ["2026-08-31", "2026-08-24", "2026-08-01"]) {
    const rows = await readWindowedPositions(sb, start, "2026-08-31T23:59:59Z");
    const cohort = summarizeLogicalTradeCohort(rows);
    assert.deepEqual(cohort.issues, []);
    roots.push(cohort.groups.map(g => g.rootPositionId));
    if (start === "2026-08-24") assert.equal(cohort.groups.find(g => g.rootPositionId === "bank")?.realizedPnl, 20);
  }
  assert(roots[0].every(id => roots[1].includes(id)) && roots[1].every(id => roots[2].includes(id)));
  await assert.rejects(readWindowedExecutionRoutes(fixture({ execution_observations: observations }, 250), positions), /page failed/);
  await assert.rejects(readWindowedExecutionRoutes(fixture({ execution_observations: observations }, -1, 100), positions), /incomplete read/);
  await assert.rejects(readWindowedPositions(fixture({ positions: positions.filter(r => r.id !== "bank") }), "2026-08-24", "2026-08-31T23:59:59Z"), /parent evidence/);
  await assert.rejects(readCompleteEvidence(() => fixture({ x: observations }).from("x").select("id", { count: "exact" }).order("id"), "bound", 100), /safety bound/);
  await assert.rejects(readCompleteEvidence(() => fixture({ x: [{ id: "a" }, { id: "a" }] }).from("x").select("id", { count: "exact" }).order("id"), "duplicates"), /duplicate/);
  let call = 0;
  await assert.rejects(readCompleteEvidence(() => ({ range: async () => ({ count: ++call === 1 ? 251 : 252,
    data: Array.from({ length: 250 }, (_, i) => ({ id: `${call}:${i}` })) }) }), "changing"), /changed/);
  const partial = attributePositionsByImmutableExecutionAccount({ positions, observations: [], configuredPaperAccountIds: new Set(["paper-1"]) });
  assert.equal(partial.missingPositionIds.length, positions.length, "genuine missing routes must not fall back to mutable routing");
  const crossAccount = attributePositionsByImmutableExecutionAccount({ positions, observations: routes.map(r => ({ ...r,
    account_id: r.position_id === "today" ? "paper-3" : r.position_id === "old" ? "paper-2" : "paper-1" })),
    configuredPaperAccountIds: new Set(["paper-1", "paper-2", "paper-3"]) });
  assert.deepEqual([...crossAccount.byAccount.get("paper-3")!].map(p => p.id), ["today"]);
  assert.deepEqual([...crossAccount.byAccount.get("paper-2")!].map(p => p.id), ["old"]);
  assert.equal(crossAccount.byAccount.get("paper-1")!.length, 2, "pagination must retain actual account separation");
  console.log("windowed-evidence-read: PASS · pagination, count/identity guards, whole trades, nested windows, genuine missing evidence");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
