// ============================================================================
//  override-ledger — the durable spine of "did the human beat the ride".
//
//  Each operator override (positions.close_reason = manual / manual:<tag>) gets ONE
//  row, keyed by the position id, capturing the ride-to-close P&L reconstructed from
//  option_quotes at compute time. WHY persist: option_quotes prune at 7d, so the
//  ride-to-close (which reads the quote stream that keeps flowing AFTER the operator's
//  close, on to the native 15:25 flatten / −50% stop) can only be reconstructed the
//  same week — the day-report's standing constraint. The scorecard then accumulates
//  these into the running tally the handoff calls "the only honest arbiter": one
//  giveback day doesn't overturn the distribution, but the tally does.
//
//  data/ is gitignored → this is operator-local accumulation (single desk machine).
//  The cloud-durable, fully-live twin is the shadowManage ride-vs-override extension
//  (worker, deferred — it has the service-role write + sees every cycle).
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

export interface LedgerEntry {
  id: string;                 // positions.id (stable UUID → re-run-safe upsert key)
  date: string;              // ET trade date
  slug: string;
  name: string;              // operator's display label
  occ: string;
  cp: "call" | "put";
  strike: number;
  qty: number;
  closeReason: string | null; // 'manual' | 'manual:<tag>'
  tag: string | null;         // <tag> from manual:<tag> (target/reversal/risk/stall)
  actual: number;             // realized P&L the operator actually booked
  ride: number;               // reconstructed ride-to-close P&L (hold to flatten / −50% stop)
  delta: number;              // actual − ride  (>0 ⇒ the override beat riding)
  stopHit: boolean;           // the ride would have hit the −50% premium stop
  recordedAt: string;         // when this reconstruction was captured (ISO)
}

export const LEDGER_PATH = "data/override-ledger.json";

export function loadLedger(path = LEDGER_PATH): Record<string, LedgerEntry> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, LedgerEntry>;
  } catch {
    return {}; // a corrupt ledger fails SAFE — start fresh rather than crash the report
  }
}

export function upsertLedger(entries: LedgerEntry[], path = LEDGER_PATH): { added: number; updated: number } {
  const led = loadLedger(path);
  let added = 0, updated = 0;
  for (const e of entries) {
    if (led[e.id]) updated++; else added++;
    led[e.id] = e; // re-running an old same-week date refreshes the reconstruction in place
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(led) + "\n");
  return { added, updated };
}

const sgn = (v: number) => (v >= 0 ? "+" : "") + Math.round(v);

// The running tally + the "which instinct beats the ride" cuts (by close-reason tag,
// by channel). Pure formatting over the ledger — no DB, so the standalone
// `npm run override-scorecard` and the day-report share one definition.
export function scorecardLines(led: Record<string, LedgerEntry>): string[] {
  const rows = Object.values(led).sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt));
  if (!rows.length) return ["  (none recorded yet — run day-report same-week after a manual close)"];

  const N = rows.length;
  const sa = rows.reduce((s, r) => s + r.actual, 0);
  const sr = rows.reduce((s, r) => s + r.ride, 0);
  const sd = rows.reduce((s, r) => s + r.delta, 0);
  const wins = rows.filter((r) => r.delta > 0).length;
  const span = rows[0].date === rows[rows.length - 1].date ? rows[0].date : `${rows[0].date}…${rows[rows.length - 1].date}`;

  const lines = [
    `  N=${N} overrides (${span}) · actual ${sgn(sa)} vs ride-to-close ${sgn(sr)} · Δ ${sgn(sd)} · override beat ride ${wins}/${N} (${Math.round((100 * wins) / N)}%) · mean Δ ${sgn(sd / N)}/t`,
  ];

  const cut = (label: string, key: (r: LedgerEntry) => string) => {
    const by = new Map<string, LedgerEntry[]>();
    for (const r of rows) { const k = key(r); by.set(k, [...(by.get(k) ?? []), r]); }
    lines.push(`  ── by ${label}`);
    for (const [k, rs] of [...by.entries()].sort((a, b) => b[1].reduce((s, r) => s + r.delta, 0) - a[1].reduce((s, r) => s + r.delta, 0))) {
      const d = rs.reduce((s, r) => s + r.delta, 0), w = rs.filter((r) => r.delta > 0).length;
      lines.push(`     ${k.padEnd(22)} ${String(rs.length).padStart(2)}t  beat ${w}/${rs.length}  Δ ${sgn(d).padStart(7)}`);
    }
  };
  cut("tag", (r) => r.tag ?? "(untagged)");
  cut("channel", (r) => r.name);
  lines.push(`  · baseline = uniform hold-to-close (15:25 flatten / −50% stop): the NATIVE behavior for ride channels`);
  lines.push(`    (pb-ride…), a pure-hold reference for scalper twins (grind…) — read the by-channel cut, not just the headline.`);
  return lines;
}
