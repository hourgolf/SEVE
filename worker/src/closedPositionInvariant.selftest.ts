import { readFileSync } from "node:fs";

let passed = 0;
function truth(name: string, value: unknown): void {
  if (!value) throw new Error(`${name}: expected true`);
  passed++;
}

const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
const manual = readFileSync(new URL("../../app/api/close-position/route.ts", import.meta.url), "utf8");
const legacy = readFileSync(new URL("../../supabase/functions/paper-trader/index.ts", import.meta.url), "utf8");
const dispatcher = readFileSync(new URL("../../supabase/functions/paper-trader/index.dispatcher.draft.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20260716204725_enforce_closed_position_unrealized_zero.sql", import.meta.url), "utf8");

truth("normal close clears unrealized", store.includes('status: "closed", closed_at: new Date().toISOString(), current_mark: mark, unrealized_pnl: 0, realized_pnl: realized'));
truth("tranche close clears unrealized", store.includes('qty: soldQty, current_mark: mark, unrealized_pnl: 0'));
truth("late marks remain open-only", store.includes('.update({ current_mark: mark, unrealized_pnl: unrealized }).eq("id", id).eq("status", "open")'));
truth("manual close clears unrealized", manual.includes('current_mark: fill, unrealized_pnl: 0, realized_pnl: realized'));
truth("legacy close clears unrealized", legacy.includes('unrealized_pnl: 0,\n        realized_pnl'));
truth("dispatcher close paths clear unrealized", (dispatcher.match(/status: "closed"[^\n]+unrealized_pnl: 0/g) ?? []).length >= 3);
truth("migration backfills closed rows", migration.includes("where status = 'closed'") && migration.includes("set unrealized_pnl = 0"));
truth("database enforces closed-zero invariant", migration.includes("positions_closed_unrealized_zero") && migration.includes("coalesce(unrealized_pnl, 1) = 0"));

console.log(`closed-position-invariant-selftest: ${passed}/${passed} PASS`);
