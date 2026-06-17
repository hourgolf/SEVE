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

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
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
  actualHoldMin?: number;     // operator's hold (open→actual close), min — exit-timing analysis
  rideHoldMin?: number | null; // the ride's would-be hold (open→−50% stop / flatten), min
  recordedAt: string;         // when this reconstruction was captured (ISO)
}

export const LEDGER_PATH = "data/override-ledger.json";

export function loadLedger(path = LEDGER_PATH): Record<string, LedgerEntry> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, LedgerEntry>;
  } catch {
    // Don't SILENTLY start fresh — that would let one bad parse make the next upsert overwrite
    // the whole accrued tally (gitignored = no recovery). Preserve the corrupt file + warn loudly.
    try { renameSync(path, `${path}.corrupt`); } catch { /* best-effort */ }
    console.error(`⚠ override-ledger: ${path} was unreadable — moved to ${path}.corrupt; starting fresh`);
    return {};
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
  // Atomic write (temp + rename on the same fs) — a crash mid-write can never leave a
  // half-written ledger that the next loadLedger would discard, wiping the accumulation.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(led) + "\n");
  renameSync(tmp, path);
  return { added, updated };
}

const sgn = (v: number) => (v >= 0 ? "+" : "") + Math.round(v);

// Structured tally for the dashboard payload (the §03 panel) — same math as scorecardLines,
// shaped as data instead of text so the panel renders it natively.
export interface ScorecardCut { key: string; n: number; wins: number; delta: number }
export interface ScorecardData {
  n: number; actual: number; ride: number; delta: number; wins: number; span: string;
  byTag: ScorecardCut[]; byChannel: ScorecardCut[];
}
export function scorecardData(led: Record<string, LedgerEntry>): ScorecardData {
  const rows = Object.values(led);
  const cut = (key: (r: LedgerEntry) => string): ScorecardCut[] => {
    const by = new Map<string, LedgerEntry[]>();
    for (const r of rows) { const k = key(r); by.set(k, [...(by.get(k) ?? []), r]); }
    return [...by.entries()]
      .map(([k, rs]) => ({ key: k, n: rs.length, wins: rs.filter((r) => r.delta > 0).length, delta: Math.round(rs.reduce((s, r) => s + r.delta, 0)) }))
      .sort((a, b) => b.delta - a.delta);
  };
  const dates = rows.map((r) => r.date).sort();
  return {
    n: rows.length,
    actual: Math.round(rows.reduce((s, r) => s + r.actual, 0)),
    ride: Math.round(rows.reduce((s, r) => s + r.ride, 0)),
    delta: Math.round(rows.reduce((s, r) => s + r.delta, 0)),
    wins: rows.filter((r) => r.delta > 0).length,
    span: dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}…${dates[dates.length - 1]}`) : "",
    byTag: cut((r) => r.tag ?? "untagged"),
    byChannel: cut((r) => r.name),
  };
}

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

// ============================================================================
//  FOUL-OUT-AWARE re-score — the capital-path / slot-occupancy correction.
//
//  The per-position ledger above sums GROSS deltas: each override's actual vs an
//  INDEPENDENT ride-to-close. That answers a NARROW question ("was THIS exit early?")
//  but it is NOT a ride-as-a-policy verdict, because a channel is ONE-AT-A-TIME
//  (worker decide.ts: openRows keyed by strategist_id, entry gated on `!row`). You
//  cannot ride EVERY override to close — riding one OCCUPIES the book and forecloses
//  the later re-entries that actually booked (slot occupancy), and a bigger ride loss
//  can trip the daily_stop (decide.ts:304, realized-closed ≤ −daily_stop_usd). So the
//  gross tally credits "ride" with phantom simultaneous re-entries that physically
//  can't coexist. This is the operator's "letting a winner bleed fouls out the player
//  so they can't make it back even with a signal" — made into a number.
//
//  simulateFoulout replays the day's legs for ONE channel under the live constraints:
//  riding an override extends its hold to rideExitMs; while occupied, later real
//  entries are BLOCKED (slot); after the daily-stop budget is exhausted in realized-
//  closed terms, further entries are BLOCKED (daily_stop). The session-level result is
//  the honest "what riding-as-a-policy would have netted". Persisted per (date,channel)
//  for the same accrual reason as the per-position ledger (option_quotes prune at 7d).
// ============================================================================

// Minimal per-position shape the replay needs (day-report maps its Trade → this).
export interface RideLeg {
  openedMs: number;       // actual entry time
  actualCloseMs: number;  // actual exit time (the operator's close)
  actualPnl: number;      // realized P&L the operator booked
  isOverride: boolean;    // a rideOk operator override → extends to its ride-to-close
  ridePnl: number;        // ride-to-close P&L (only consulted when isOverride)
  rideExitMs: number;     // when the ride would have exited (−50% stop fill / 15:25 flatten)
}
export interface FouloutResult {
  actualTotal: number;    // Σ actual P&L (observed reality — every leg happened)
  rideGross: number;      // overrides swapped to their INDEPENDENT ride, NO blocking (= the gross scorecard's ride world)
  rideFoulAware: number;  // ride world WITH one-at-a-time + daily-stop blocking
  deltaGross: number;     // actualTotal − rideGross   (>0 ⇒ operator beat ride; ties to the per-position ledger)
  deltaFoulAware: number; // actualTotal − rideFoulAware
  foulAdjustment: number; // deltaFoulAware − deltaGross = P&L of the legs riding would have FORECLOSED
  blockedSlot: number;    // legs foreclosed because the book was still occupied by an extended ride
  blockedStop: number;    // legs foreclosed because the daily-stop budget was exhausted
}

// One-at-a-time forward replay. The channel holds ≤1 position at a time (live + backtest),
// so a single pending slot suffices; realized-closed accrues at each leg's (world-) close
// for the daily-stop gate, exactly mirroring realizedTodayByChannel (closed P&L only).
export function simulateFoulout(legs: RideLeg[], dailyStopUsd: number, flattenMs: number): FouloutResult {
  const sorted = [...legs].sort((a, b) => a.openedMs - b.openedMs);
  let actualTotal = 0, rideGross = 0;
  for (const l of sorted) { actualTotal += l.actualPnl; rideGross += l.isOverride ? l.ridePnl : l.actualPnl; }

  let rideFoulAware = 0, realizedClosed = 0, blockedSlot = 0, blockedStop = 0;
  let hasOpen = false, pendingClose = -Infinity, pendingPnl = 0;
  const settle = (tms: number) => { if (hasOpen && pendingClose <= tms) { realizedClosed += pendingPnl; hasOpen = false; } };

  for (const l of sorted) {
    settle(l.openedMs); // free the book + book realized for any ride that has already exited by now
    const exitMs = l.isOverride ? (Number.isFinite(l.rideExitMs) ? l.rideExitMs : flattenMs) : l.actualCloseMs;
    const pnl = l.isOverride ? l.ridePnl : l.actualPnl;
    if (hasOpen) { blockedSlot++; continue; }                                  // book occupied by an extended ride
    if (dailyStopUsd > 0 && realizedClosed <= -dailyStopUsd) { blockedStop++; continue; } // fouled out on the stop
    rideFoulAware += pnl;
    hasOpen = true; pendingClose = exitMs; pendingPnl = pnl;                   // take it; it now occupies the book
  }
  if (hasOpen) realizedClosed += pendingPnl;

  const deltaGross = actualTotal - rideGross;
  const deltaFoulAware = actualTotal - rideFoulAware;
  return { actualTotal, rideGross, rideFoulAware, deltaGross, deltaFoulAware, foulAdjustment: deltaFoulAware - deltaGross, blockedSlot, blockedStop };
}

export interface FouloutEntry {
  key: string;            // `${date}|${slug}` (re-run-safe upsert key)
  date: string;
  slug: string;
  name: string;
  dailyStopUsd: number;
  nOverrides: number;     // rideOk overrides this channel/day (the legs that extend)
  nTrades: number;        // all closed trades for the channel that day
  actualTotal: number;
  rideGross: number;
  rideFoulAware: number;
  deltaGross: number;
  deltaFoulAware: number;
  foulAdjustment: number;
  blockedSlot: number;
  blockedStop: number;
  recordedAt: string;
}

export const FOULOUT_PATH = "data/foulout-ledger.json";

export function loadFoulout(path = FOULOUT_PATH): Record<string, FouloutEntry> {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, FouloutEntry>; }
  catch {
    try { renameSync(path, `${path}.corrupt`); } catch { /* best-effort */ }
    console.error(`⚠ foulout-ledger: ${path} was unreadable — moved to ${path}.corrupt; starting fresh`);
    return {};
  }
}

export function upsertFoulout(entries: FouloutEntry[], path = FOULOUT_PATH): { added: number; updated: number } {
  const led = loadFoulout(path);
  let added = 0, updated = 0;
  for (const e of entries) { if (led[e.key]) updated++; else added++; led[e.key] = e; }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(led) + "\n");
  renameSync(tmp, path);
  return { added, updated };
}

export interface FouloutScorecard {
  n: number; deltaGross: number; deltaFoulAware: number; foulAdjustment: number;
  byChannel: Array<{ key: string; n: number; deltaGross: number; deltaFoulAware: number; foulAdjustment: number }>;
}
export function fouloutScorecardData(led: Record<string, FouloutEntry>): FouloutScorecard {
  const rows = Object.values(led);
  const by = new Map<string, FouloutEntry[]>();
  for (const r of rows) by.set(r.name, [...(by.get(r.name) ?? []), r]);
  return {
    n: rows.length,
    deltaGross: Math.round(rows.reduce((s, r) => s + r.deltaGross, 0)),
    deltaFoulAware: Math.round(rows.reduce((s, r) => s + r.deltaFoulAware, 0)),
    foulAdjustment: Math.round(rows.reduce((s, r) => s + r.foulAdjustment, 0)),
    byChannel: [...by.entries()].map(([key, rs]) => ({
      key, n: rs.length,
      deltaGross: Math.round(rs.reduce((s, r) => s + r.deltaGross, 0)),
      deltaFoulAware: Math.round(rs.reduce((s, r) => s + r.deltaFoulAware, 0)),
      foulAdjustment: Math.round(rs.reduce((s, r) => s + r.foulAdjustment, 0)),
    })).sort((a, b) => b.deltaFoulAware - a.deltaFoulAware),
  };
}

// The foul-out-aware companion to scorecardLines: the SAME overrides, scored as a
// ride-as-a-policy on a one-at-a-time book (the honest "would riding have beaten me").
export function fouloutScorecardLines(led: Record<string, FouloutEntry>): string[] {
  const rows = Object.values(led).sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
  if (!rows.length) return ["  (none yet — run day-report same-week on a day with manual overrides)"];
  const dg = Math.round(rows.reduce((s, r) => s + r.deltaGross, 0));
  const df = Math.round(rows.reduce((s, r) => s + r.deltaFoulAware, 0));
  const span = rows[0].date === rows[rows.length - 1].date ? rows[0].date : `${rows[0].date}…${rows[rows.length - 1].date}`;
  const lines = [
    `  N=${rows.length} channel-day(s) (${span}) · one-at-a-time + daily-stop replay`,
    `  GROSS  (per-position, capital-blind)        Δ act−ride ${sgn(dg).padStart(7)}  ⇒ ride ${dg < 0 ? "beats you" : "trails you"} ${sgn(Math.abs(dg))}`,
    `  FOUL-AWARE (ride-as-a-policy, can't ride all) Δ act−ride ${sgn(df).padStart(7)}  ⇒ ride ${df < 0 ? "beats you" : "trails you"} ${sgn(Math.abs(df))}`,
    `  foul-out adjustment ${sgn(df - dg)} — P&L riding would have FORECLOSED (occupied book / tripped stop)`,
  ];
  const by = new Map<string, FouloutEntry[]>();
  for (const r of rows) by.set(r.name, [...(by.get(r.name) ?? []), r]);
  lines.push(`  ── by channel (Δgross → Δfoul-aware)`);
  for (const [k, rs] of [...by.entries()].sort((a, b) => b[1].reduce((s, r) => s + r.deltaFoulAware, 0) - a[1].reduce((s, r) => s + r.deltaFoulAware, 0))) {
    const g = rs.reduce((s, r) => s + r.deltaGross, 0), fa = rs.reduce((s, r) => s + r.deltaFoulAware, 0);
    const bs = rs.reduce((s, r) => s + r.blockedSlot, 0), bt = rs.reduce((s, r) => s + r.blockedStop, 0);
    lines.push(`     ${k.padEnd(22)} ${String(rs.length).padStart(2)}d  Δgross ${sgn(g).padStart(7)} → Δfoul ${sgn(fa).padStart(7)}  (adj ${sgn(fa - g)}; foreclosed ${bs}slot/${bt}stop)`);
  }
  return lines;
}
