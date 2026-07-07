// ============================================================================
//  one-account-shadow — the live-transition rehearsal (2026-07-07).
//
//  THE QUESTION IT ANSWERS: when the proven "dream team" one day trades REAL
//  money, it lives in ONE account with ONE buying-power pool — no more 3-bucket
//  luxury. Every per-channel verdict is an INDIVIDUAL read; nobody has measured
//  the PORTFOLIO: budget contention (who starves when cash binds), shared-strike
//  stack concentration (70% of trades land on shared OCCs), correlated drawdown.
//
//  WHAT IT DOES: replays the armed FIRST-TEAM roster's ACTUAL live trades (real
//  fills, real exits, real timestamps — positions table, NO engine re-derivation)
//  from the era-4 epoch through one shared cash pool, chronologically:
//   · entry admits at actual size if cash affords it; else DOWNSIZES to the
//     affordable qty; else REJECTS (starved) — time priority, exits release first
//   · pyramid children (runner_of) admit only if their parent was admitted
//   · stack depth per OCC is metered always; --stack-cap N enforces a C1-style
//     cap (default OFF — C1 enforcement is sequenced behind the A6 read)
//   · NAV = cash (era-4 book is all same-day round trips; an overnight hold
//     would carry at entry cost and be flagged)
//
//  V1 SEMANTICS (stated so the numbers can't overclaim): actual per-trade sizes
//  (no re-sizing — RISK dollars are already human-scale), realized P&L scaled
//  per-contract when downsized, per-channel daily stops as they fired on paper,
//  fills as they printed (no self-cross/coalescing model yet). It measures the
//  CAPITAL layer, not fill physics.
//
//    npm run one-account-shadow                        # era-4 → today, $50k, FIRST-TEAM
//    npm run one-account-shadow -- --equity 25000      # stress the pool
//    npm run one-account-shadow -- --stack-cap 3       # enforce a C1-style cap
//    npm run one-account-shadow -- --all-armed         # whole armed roster, all buckets
//  Read-only vs the DB. day-report folds the default run into the nightly
//  forensics payload (payload.oneAccountShadow) → the would-be NAV curve accrues.
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
}

const ERA4_EPOCH = "2026-06-30"; // LOCK/RIDE + stop-aware sizing live (the registry's clean-data epoch)
const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDate = (iso: string) => ET_DAY.format(new Date(iso));

export interface ShadowOpts {
  equity?: number;      // starting cash for the one account (default 50_000)
  from?: string;        // ET date, default era-4 epoch
  to?: string;          // ET date, default today
  allArmed?: boolean;   // default false → FIRST-TEAM bucket (accounts.cred_ref '2') only
  stackCap?: number;    // 0/undefined = meter only; N = reject entries stacking an OCC past N channels
}

interface PosRow {
  id: string; runner_of: string | null; occ_symbol: string; qty: number;
  avg_entry_price: number; realized_pnl: number; opened_at: string; closed_at: string;
  slug: string;
}

export interface ShadowDay {
  date: string; navEnd: number; dayPnl: number;
  entries: number; admitted: number; downsized: number; rejected: number;
  rejectReasons: Record<string, number>;
  peakDeployedUsd: number; minCashUsd: number;
  peakOcc: { occ: string; channels: number; contracts: number; usd: number } | null;
}

export interface ShadowResult {
  params: { equity: number; from: string; to: string; bucket: string; stackCap: number };
  days: ShadowDay[];
  navEnd: number; totalPnl: number; actualPnl: number;
  maxStackChannels: number;
  perChannel: { slug: string; trades: number; admitted: number; downsized: number; rejected: number; shadowPnl: number; actualPnl: number }[];
  openCarry: number; // positions still open at the end (carried at cost in NAV)
}

export async function runOneAccountShadow(opts: ShadowOpts = {}): Promise<ShadowResult> {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const equity = opts.equity ?? 50_000;
  const from = opts.from ?? ERA4_EPOCH;
  const to = opts.to ?? ET_DAY.format(new Date());
  const stackCap = opts.stackCap ?? 0;

  // roster: armed channels, FIRST-TEAM bucket unless --all-armed
  const { data: stratRaw, error: se } = await sb.from("strategists")
    .select("id,slug,status,accounts(cred_ref)").eq("status", "armed");
  if (se) throw new Error("strategists read: " + se.message);
  const roster = new Map<string, string>(); // strategist_id → slug
  for (const s of (stratRaw ?? []) as any[]) {
    const ref = (Array.isArray(s.accounts) ? s.accounts[0] : s.accounts)?.cred_ref ?? null;
    if (opts.allArmed || ref === "2") roster.set(s.id, s.slug);
  }
  if (!roster.size) throw new Error("no armed channels matched the bucket filter");

  // era-4 closed positions for the roster, chronological. Same-week page sizes are
  // small (a few hundred rows) — one range fetch with a sanity re-page if capped.
  const rows: PosRow[] = [];
  for (let fromIdx = 0; ; fromIdx += 1000) {
    const { data, error } = await sb.from("positions")
      .select("id,runner_of,occ_symbol,qty,avg_entry_price,realized_pnl,opened_at,closed_at,strategist_id")
      .eq("status", "closed")
      .gte("opened_at", `${from}T04:00:00Z`).lte("opened_at", `${to}T23:59:59Z`)
      .order("opened_at", { ascending: true }).range(fromIdx, fromIdx + 999);
    if (error) throw new Error("positions read: " + error.message);
    const page = (data ?? []) as any[];
    for (const p of page) {
      const slug = roster.get(p.strategist_id);
      if (!slug || p.closed_at == null) continue;
      rows.push({ id: p.id, runner_of: p.runner_of, occ_symbol: p.occ_symbol, qty: Number(p.qty),
        avg_entry_price: Number(p.avg_entry_price), realized_pnl: Number(p.realized_pnl),
        opened_at: p.opened_at, closed_at: p.closed_at, slug });
    }
    if (page.length < 1000) break;
  }

  // event stream — exits release cash before entries consume it on timestamp ties
  interface Ev { ts: number; kind: "exit" | "entry"; pos: PosRow }
  const events: Ev[] = [];
  for (const p of rows) {
    events.push({ ts: Date.parse(p.opened_at), kind: "entry", pos: p });
    events.push({ ts: Date.parse(p.closed_at), kind: "exit", pos: p });
  }
  events.sort((a, b) => a.ts - b.ts || (a.kind === "exit" ? -1 : 1) - (b.kind === "exit" ? -1 : 1));

  let cash = equity;
  const admittedQty = new Map<string, number>(); // position id → shadow qty
  const openCost = new Map<string, number>();    // position id → deployed $
  const occOpen = new Map<string, Map<string, { contracts: number }>>(); // occ → slug → lot
  const perChannel = new Map<string, { trades: number; admitted: number; downsized: number; rejected: number; shadowPnl: number; actualPnl: number }>();
  const chan = (slug: string) => {
    let c = perChannel.get(slug);
    if (!c) { c = { trades: 0, admitted: 0, downsized: 0, rejected: 0, shadowPnl: 0, actualPnl: 0 }; perChannel.set(slug, c); }
    return c;
  };

  const days: ShadowDay[] = [];
  let d: ShadowDay | null = null;
  let navPrev = equity;
  let maxStackChannels = 0;
  const deployed = () => [...openCost.values()].reduce((a, v) => a + v, 0);
  const roll = (date: string) => {
    if (d) { d.navEnd = Math.round(cash + deployed()); d.dayPnl = Math.round(d.navEnd - navPrev); navPrev = d.navEnd; days.push(d); }
    d = { date, navEnd: 0, dayPnl: 0, entries: 0, admitted: 0, downsized: 0, rejected: 0, rejectReasons: {}, peakDeployedUsd: 0, minCashUsd: Math.round(cash), peakOcc: null };
  };

  for (const ev of events) {
    const date = etDate(ev.pos[ev.kind === "entry" ? "opened_at" : "closed_at"]);
    if (!d || date > d.date) roll(date);
    const p = ev.pos;
    const c = chan(p.slug);
    if (ev.kind === "entry") {
      c.trades++; c.actualPnl += p.realized_pnl; d!.entries++;
      const costPerCt = p.avg_entry_price * 100;
      let reason = "";
      let q = 0;
      if (p.runner_of && !(admittedQty.get(p.runner_of) ?? 0)) reason = "parent-rejected";
      else if (stackCap > 0 && (occOpen.get(p.occ_symbol)?.size ?? 0) >= stackCap && !occOpen.get(p.occ_symbol)?.has(p.slug)) reason = "stack-cap";
      else {
        q = Math.min(p.qty, Math.floor(cash / costPerCt));
        if (q <= 0) reason = "no-cash";
      }
      if (reason) {
        c.rejected++; d!.rejected++;
        d!.rejectReasons[reason] = (d!.rejectReasons[reason] ?? 0) + 1;
        admittedQty.set(p.id, 0);
      } else {
        if (q < p.qty) { c.downsized++; d!.downsized++; }
        d!.admitted++;
        admittedQty.set(p.id, q);
        const cost = q * costPerCt;
        cash -= cost;
        openCost.set(p.id, cost);
        let m = occOpen.get(p.occ_symbol);
        if (!m) { m = new Map(); occOpen.set(p.occ_symbol, m); }
        const lot = m.get(p.slug) ?? { contracts: 0 };
        lot.contracts += q; m.set(p.slug, lot);
        // concentration meters
        const dep = deployed();
        if (dep > d!.peakDeployedUsd) d!.peakDeployedUsd = Math.round(dep);
        if (cash < d!.minCashUsd) d!.minCashUsd = Math.round(cash);
        const occContracts = [...m.values()].reduce((a, l) => a + l.contracts, 0);
        if (m.size > maxStackChannels) maxStackChannels = m.size;
        if (!d!.peakOcc || m.size > d!.peakOcc.channels || (m.size === d!.peakOcc.channels && occContracts > d!.peakOcc.contracts)) {
          const usd = rows.reduce((a, x) => a + (x.occ_symbol === p.occ_symbol ? (openCost.get(x.id) ?? 0) : 0), 0);
          d!.peakOcc = { occ: p.occ_symbol, channels: m.size, contracts: occContracts, usd: Math.round(usd) };
        }
      }
    } else {
      const q = admittedQty.get(p.id) ?? 0;
      if (q > 0) {
        const pnlPerCt = p.realized_pnl / p.qty;
        const cost = openCost.get(p.id) ?? 0;
        cash += cost + q * pnlPerCt;
        c.shadowPnl += q * pnlPerCt;
        openCost.delete(p.id);
        const m = occOpen.get(p.occ_symbol);
        if (m) {
          const lot = m.get(p.slug);
          if (lot) { lot.contracts -= q; if (lot.contracts <= 0) m.delete(p.slug); }
          if (!m.size) occOpen.delete(p.occ_symbol);
        }
      }
    }
  }
  roll("9999-12-31"); // sentinel: pushes the final real day; the sentinel itself stays in `d`, never pushed

  const totalPnl = Math.round(cash + deployed() - equity);
  const actualPnl = Math.round([...perChannel.values()].reduce((a, c) => a + c.actualPnl, 0));
  return {
    params: { equity, from, to, bucket: opts.allArmed ? "all-armed" : "FIRST-TEAM", stackCap },
    days, navEnd: Math.round(cash + deployed()), totalPnl, actualPnl, maxStackChannels,
    perChannel: [...perChannel.entries()].map(([slug, c]) => ({ slug, ...c,
      shadowPnl: Math.round(c.shadowPnl), actualPnl: Math.round(c.actualPnl) }))
      .sort((a, b) => b.shadowPnl - a.shadowPnl),
    openCarry: openCost.size,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const argNum = (name: string, dflt: number) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt; };
const argStr = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const sgn = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(v).toLocaleString()}`;

async function cli() {
  const r = await runOneAccountShadow({
    equity: argNum("equity", 50_000),
    from: argStr("from", ERA4_EPOCH),
    to: argStr("to", ET_DAY.format(new Date())),
    allArmed: process.argv.includes("--all-armed"),
    stackCap: argNum("stack-cap", 0),
  });
  console.log(`\nONE-ACCOUNT SHADOW — the dream team in a single $${r.params.equity.toLocaleString()} account`);
  console.log(`${r.params.bucket} bucket · ${r.params.from} → ${r.params.to} · actual live trades through one cash pool · stack cap ${r.params.stackCap || "OFF (metered)"}\n`);
  console.log(`  date        NAV       day P&L   entries adm/dwn/rej   peak deployed   min cash   deepest stack`);
  for (const day of r.days) {
    const po = day.peakOcc ? `${day.peakOcc.channels}ch/${day.peakOcc.contracts}ct ${day.peakOcc.occ.replace(/^SPY|^QQQ|^IWM/, (m) => m + " ")}` : "—";
    console.log(`  ${day.date}  $${day.navEnd.toLocaleString().padEnd(8)} ${sgn(day.dayPnl).padStart(8)}   ${String(day.entries).padStart(3)}   ${day.admitted}/${day.downsized}/${day.rejected}      $${day.peakDeployedUsd.toLocaleString().padStart(7)}    $${day.minCashUsd.toLocaleString().padStart(7)}   ${po}`);
  }
  console.log(`\n  Σ shadow ${sgn(r.totalPnl)} on $${r.params.equity.toLocaleString()} (${((100 * r.totalPnl) / r.params.equity).toFixed(1)}%) vs the same trades' paper P&L ${sgn(r.actualPnl)} · max OCC stack ${r.maxStackChannels} channels${r.openCarry ? ` · ⚠ ${r.openCarry} open carried at cost` : ""}`);
  const contested = r.days.filter((day) => day.rejected + day.downsized > 0).length;
  console.log(`  contention: ${contested}/${r.days.length} sessions had a downsize/rejection${contested ? "" : " — cash never bound at this equity"}\n`);
  console.log(`  per-channel (shadow vs paper):`);
  for (const c of r.perChannel) console.log(`    ${c.slug.padEnd(28)} ${String(c.trades).padStart(3)}t  ${sgn(c.shadowPnl).padStart(9)}  (paper ${sgn(c.actualPnl)})${c.rejected ? `  · ${c.rejected} rejected` : ""}${c.downsized ? ` · ${c.downsized} downsized` : ""}`);
  console.log(`\n  ⚠ capital layer only: actual sizes/fills/exits as lived on paper; no self-cross or fill-impact model; per-channel daily stops as they fired at paper scale.\n`);
}
if (process.argv[1]?.endsWith("one-account-shadow.ts")) cli().catch((e) => { console.error(e); process.exit(1); });
