// ============================================================================
//  SEVE streaming worker — entrypoint (Phase A · SHADOW).
//
//  The THIRD engine driver (backtest / cron / streaming). Holds an always-on
//  Alpaca stock-bar websocket, keeps bars + the NTM chain + config in memory,
//  and on every bar-close runs the SAME engine the backtest uses to decide each
//  channel — logging what it WOULD do (no orders, no prod-table writes). Validate
//  these against the cron worker's signals for a few sessions, then wire Phase B
//  (live orders + cron cutover). See docs/streaming-worker.md.
//
//  SINGLE INSTANCE ONLY — once Phase B places orders, two workers = double
//  orders. Railway: 1 replica, restart-on-crash, sole order-placer.
// ============================================================================

import { config, policy, WORKER_VERSION } from "./config.js";
import { info, warn, error, shadow } from "./log.js";
import * as alpaca from "./alpaca.js";
import * as store from "./store.js";
import { BarStore, ChainStore } from "./state.js";
import { StockBarStream } from "./stream.js";
import { decideChannel, buildSessionBars, computeLevels, type DecisionCtx, type ShadowDecision } from "./decide.js";
import { alertOnce, alertClear } from "./alerts.js";
import { updateShadowManagement } from "./shadowManage.js";
import { archiveQuotesToStorage, maybeArchiveTick } from "./archive.js";
import { maybePublishForensicsTick } from "./forensics.js";
import { executeEntry, executeExit, executeReconcile, executeAdd, premiumExitReason, seedRemaining, entryKey, noteRowHeld, type ExecCtx } from "./execute.js";
import { computeFeatures } from "../../engine/engine";
import { specPremiumExit } from "../../engine/specEvaluate";
import type { StrategySpec } from "../../lib/desk/strategySpec";
import type { Bar } from "../../engine/types";

const RTH_OPEN = 570, RTH_CLOSE = 960;

// Phase B posture: ALL of (DRY_RUN=false, LIVE_TRADING=true, service role) — the
// two-key turn plus credentials. Anything less = shadow, exactly as Phase A.
const liveMode = (): boolean => !config.dryRun && config.liveTrading && config.hasServiceRole;
// A channel this instance EXECUTES: stream-owned + one of THIS worker's symbols.
// Multi-symbol (B3): one instance holds N symbols, each with its own bars/chain,
// behind ONE 'stream' heartbeat — so it must reliably handle every symbol it lists.
const SYMBOLS = config.symbols;
const ownedBy = (c: store.ChannelConfig): boolean => c.executor === "stream" && SYMBOLS.includes(c.underlying.toUpperCase());
// Running peak option mid per open position (power giveback + sweep state).
const peakMidByKey = new Map<string, number>();
// Orphan safety-net persistence: `${accountId}|${occ}` → consecutive cycles seen UNCOVERED
// (held in a bucket with no open desk row). A 2-cycle gate dodges same-cycle fill→insert races.
const orphanSeen = new Map<string, number>();

// Per-symbol in-memory state (one BarStore + ChainStore each); OCCs are globally
// unique (the ticker is in the OCC root) so account-wide reads stay shared.
const barsBySym = new Map<string, BarStore>(SYMBOLS.map((s) => [s, new BarStore(config.barHistory)]));
const chainBySym = new Map<string, ChainStore>(SYMBOLS.map((s) => [s, new ChainStore()]));
const gammaLogged = new Set<string>(); // `${sym}|${etDate}` — once-per-day gamma-open diagnostic snapshot
const featLogged = new Set<string>(); // `${sym}|${etDate}|${5min}` — throttled per-symbol feature diagnostic (why armed channels don't fire)
let cfg: { fund: store.FundState | null; channels: store.ChannelConfig[]; accounts: store.AccountRow[] } = { fund: null, channels: [], accounts: [] };
let reloadPending = false;
let cycling = false;

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

// ---- accounts (cockpit P3) -------------------------------------------------
// Each channel routes its orders to ONE Alpaca paper account (strategists.account_id
// → accounts row → cred_ref → config.altAccounts creds). A channel with no/unknown
// account_id falls back to the DEFAULT account (the accounts row with cred_ref null =
// the original paper account). With one account holding every channel this is exactly
// today's single-account path. The whole point of separate accounts: per-bucket NAV is
// clean (no shared-OCC netting ACROSS buckets — only within one).
const SYNTH_DEFAULT: store.AccountRow = { id: "__default__", name: "default", cred_ref: null, is_armed: true, is_halted: false, master_daily_stop_usd: 0 };
function resolveDefaultAccount(accounts: store.AccountRow[]): store.AccountRow {
  return accounts.find((a) => !a.cred_ref) ?? SYNTH_DEFAULT;
}
/** The Api for an account, or null if it's a non-default account whose creds are
 *  absent from env — null = SHADOW ONLY (decide+log, never route an order to the
 *  wrong account). The default account always resolves to ACCT1_API. */
function apiForAccount(acct: store.AccountRow): alpaca.Api | null {
  if (!acct.cred_ref) return alpaca.ACCT1_API;
  const creds = config.altAccounts[acct.cred_ref];
  return creds ? alpaca.makeApi(creds.key, creds.secret) : null;
}
type AccountGroup = { account: store.AccountRow; api: alpaca.Api | null; channels: store.ChannelConfig[] };
/** Group channels by their effective account (cockpit P3). */
function groupByAccount(channels: store.ChannelConfig[], accounts: store.AccountRow[]): AccountGroup[] {
  const def = resolveDefaultAccount(accounts);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const groups = new Map<string, AccountGroup>();
  for (const ch of channels) {
    const acct = (ch.account_id && byId.get(ch.account_id)) || def;
    let g = groups.get(acct.id);
    if (!g) { g = { account: acct, api: apiForAccount(acct), channels: [] }; groups.set(acct.id, g); }
    g.channels.push(ch);
  }
  return [...groups.values()];
}
/** The account id a position row belongs to (via its channel) — for per-account row scoping. */
function rowAccountId(row: store.PositionRow, byChannelId: Map<string, store.ChannelConfig>, accounts: store.AccountRow[]): string {
  const ch = byChannelId.get(row.strategist_id);
  const def = resolveDefaultAccount(accounts);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return (ch?.account_id && byId.has(ch.account_id)) ? ch.account_id : def.id;
}

// Retry a transient async op with exponential backoff. Used for boot-time REST
// calls so a flaky Alpaca/network moment doesn't crash-loop the container.
async function retry<T>(label: string, fn: () => Promise<T>, attempts = 5, baseMs = 2000): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < attempts) {
        const delay = Math.min(30_000, baseMs * 2 ** (i - 1));
        warn(`${label}: attempt ${i}/${attempts} failed — ${(e as Error).message}; retry in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

async function reloadConfig(): Promise<void> {
  // Halt-transition watch: page the operator when the kill switch / master stop
  // trips while we hold prior state (a boot into an already-halted desk stays
  // quiet — that's known state, not news). Clearing the halt re-opens the slot
  // so a SECOND halt the same day pages again.
  const hadFund = !!cfg.fund;
  const prevHalted = cfg.fund?.is_halted ?? false;
  const c = await store.loadConfig();
  if (c.fund) cfg = c;
  else warn("config: reload returned no fund_state — keeping previous");
  const nowHalted = cfg.fund?.is_halted ?? false;
  if (hadFund && !prevHalted && nowHalted)
    alertOnce(alpaca.etParts(Date.now()).date, "halt", "fund", "⛔ desk HALTED", "kill switch / master stop tripped — entries frozen, exits keep managing");
  if (prevHalted && !nowHalted) alertClear("halt", "fund");
}

async function refreshChain(sym: string): Promise<void> {
  const chain = chainBySym.get(sym);
  const spot = barsBySym.get(sym)?.latest()?.close ?? 0;
  if (!chain || !spot) return;
  const today = alpaca.etParts(Date.now()).date;
  const toDate = alpaca.etParts(Date.now() + 5 * 24 * 3600 * 1000).date; // captures 0DTE + next session(s)
  try {
    chain.update(await alpaca.snapshotChain(sym, spot, today, toDate));
  } catch (e) {
    warn(`chain[${sym}]: snapshot failed (feed=${config.optFeed}) — ${(e as Error).message}; keeping prior (${chain.size})`);
  }
}

async function seed(): Promise<void> {
  info(`seed: backfilling bars + chain via REST for ${SYMBOLS.join(",")}`);
  for (const sym of SYMBOLS) {
    const bars = barsBySym.get(sym)!;
    // Per-symbol seed is independent — a flaky one symbol must not abort the others.
    try {
      bars.seed(await retry(`seed bars ${sym}`, () => alpaca.backfillBars(sym, 3)));
      const l = bars.latest();
      info(`seed[${sym}]: ${bars.length} bars (latest ${l ? new Date(l.ts).toISOString() : "—"}, spot ${l?.close ?? "?"})`);
      await refreshChain(sym);
      info(`seed[${sym}]: chain ${chainBySym.get(sym)!.size} contracts (feed=${config.optFeed})`);
    } catch (e) { error(`seed[${sym}] failed — ${(e as Error).message}; the websocket will populate bars live`); }
  }
}

// Per-account ORPHAN safety-net (cockpit P3). An Alpaca lot a bucket holds with NO open desk
// row covering it — the desk believes it's flat. Canonical cause: the 2026-06-24 manual-close
// bug (the route sold the DEFAULT account for a Core/Resurrected position → 0 sold, row booked
// closed, the real lot rode on); an insert-failed entry is another. EVERY other worker path keys
// off OPEN desk rows (fast-exit sweep, EOD hard-flatten), so such a lot is otherwise never
// managed. Detect + page ALWAYS; auto-flatten ONLY when armed (config.orphanFlatten) AND the
// bucket is live — flattening live positions on a held-vs-rows heuristic is where reconciliation
// bugs bite, so it's shadow-first. Runs on the PRE-cycle snapshot (same-cycle entries/exits touch
// neither side) + a 2-cycle persistence gate → only true cross-cycle orphans page. Off the trade
// path: the caller wraps it so a failure never breaks the cycle.
async function orphanSweep(
  g: AccountGroup,
  alpacaByOcc: Map<string, alpaca.AlpacaPosition>,
  groupRows: store.PositionRow[],
  acctLive: boolean,
  todayET: string,
): Promise<void> {
  if (!alpacaByOcc.size) return;
  const covered = new Map<string, number>();
  for (const r of groupRows) covered.set(r.occ_symbol, (covered.get(r.occ_symbol) ?? 0) + Math.abs(Math.round(r.qty)));
  for (const [occ, p] of alpacaByOcc) {
    const held = Math.abs(Math.round(p.qty));
    const uncovered = held - (covered.get(occ) ?? 0);
    const key = `${g.account.id}|${occ}`;
    if (uncovered <= 0) { orphanSeen.delete(key); continue; }
    const seen = (orphanSeen.get(key) ?? 0) + 1;
    orphanSeen.set(key, seen);
    if (seen < 2) continue; // grace: one cycle to let a same-cycle fill→insert settle
    warn(`orphan: ${g.account.name} holds ${uncovered}× ${occ} with no open desk row (held ${held}, desk-open ${covered.get(occ) ?? 0})`);
    await store.journal("WARN", `orphan: ${g.account.name} holds ${uncovered}× ${occ} the desk thinks is flat`, { account: g.account.name, occ, uncovered, held });
    alertOnce(todayET, "orphan", key, "⚠ orphaned lot", `${g.account.name} holds ${uncovered} ${occ} the desk thinks is flat — close it / check the bucket`);
    if (config.orphanFlatten && acctLive && g.api) {
      try {
        const o = await alpaca.orderAndFill(
          { symbol: occ, qty: String(uncovered), side: "sell", type: "market", time_in_force: "day", client_order_id: `orphan-${occ}-${Date.now()}` },
          g.api,
        );
        await store.journal("EXEC", `orphan-flatten: ${g.account.name} sold ${o.filledQty}/${uncovered} ${occ} @ ${o.fill.toFixed(2)} (${o.status})`,
          { account: g.account.name, occ, sold: o.filledQty, order_id: o.id });
        if (o.filledQty >= uncovered) orphanSeen.delete(key); // fully cleared; else re-page next round
      } catch (e) {
        await store.journal("WARN", `orphan-flatten ${g.account.name} ${occ} failed — ${(e as Error).message}`);
      }
    }
  }
}

async function cycle(trigger: string): Promise<void> {
  if (cycling) { return; } // never overlap cycles
  cycling = true;
  try {
    if (reloadPending) { reloadPending = false; await reloadConfig(); }
    if (!cfg.fund) { warn(`cycle(${trigger}): missing config — skip`); return; }

    const todayET = alpaca.etParts(Date.now()).date;
    const live = liveMode();
    const byId = new Map(cfg.channels.map((c) => [c.id, c]));
    const openRowsArr = await store.getOpenPositions(); // spans accounts; scoped per group below
    if (live) await store.heartbeat(`${WORKER_VERSION} cycle`);
    // Refresh every chain ONCE up front (shared, account-independent) so the per-account
    // passes + the diagnostics pass all read the same fresh NTM snapshot.
    for (const sym of SYMBOLS) await refreshChain(sym);

    const decisions: ShadowDecision[] = [];
    let totEquity = 0, totCash = 0, totUnreal = 0, snappedAny = false;
    // Per-account orphan-sweep inputs, captured on each bucket's PRE-cycle snapshot and swept
    // AFTER the decision pass (so same-cycle entries/exits don't false-positive).
    const sweepInputs: { g: AccountGroup; alpacaByOcc: Map<string, alpaca.AlpacaPosition>; groupRows: store.PositionRow[]; acctLive: boolean }[] = [];

    // ---- PER-ACCOUNT pass (cockpit P3) ----
    // Each bucket reads ITS OWN positions/orders/equity (the same OCC can be held in two
    // accounts as separate lots — netting must be per-account) and executes only its own
    // channels via its own Api. A non-armed bucket (or one whose creds are absent) is fully
    // decided + shadow-logged but places NO orders — the shadow-first gate.
    for (const g of groupByAccount(cfg.channels, cfg.accounts)) {
      const api = g.api;
      let account: alpaca.AlpacaAccount = { equity: 0, cash: 0 };
      let positions: alpaca.AlpacaPosition[] = [];
      if (api) {
        try { [account, positions] = await Promise.all([alpaca.getAccount(api), alpaca.getPositions(api)]); }
        catch (e) { warn(`cycle(${trigger}): account ${g.account.name} read failed — ${(e as Error).message}; skip bucket`); continue; }
      } else {
        warn(`cycle(${trigger}): account ${g.account.name} (cred_ref ${g.account.cred_ref}) has no creds in env — shadow only`);
      }
      const alpacaByOcc = new Map(positions.map((p) => [p.symbol, p]));
      const groupRows = openRowsArr.filter((r) => rowAccountId(r, byId, cfg.accounts) === g.account.id);
      const openRows = new Map(groupRows.map((r) => [r.strategist_id, r]));
      // EXECUTE only when fully live AND this bucket is armed AND not halted AND its creds resolve.
      const acctLive = live && g.account.is_armed && !g.account.is_halted && api != null;
      sweepInputs.push({ g, alpacaByOcc, groupRows, acctLive }); // orphan net (swept post-decision)
      let allOrders: alpaca.AlpacaOrder[] = [];
      let remainingByOcc = new Map<string, number>();
      const openRowQty = new Map<string, number>();
      if (acctLive) {
        try { allOrders = await alpaca.getOrders(500, api!); }
        catch (e) { warn(`cycle(${trigger}): ${g.account.name} order read failed — ${(e as Error).message}; bookkeeping only`); }
        remainingByOcc = seedRemaining(positions);
        for (const r of groupRows) openRowQty.set(r.occ_symbol, (openRowQty.get(r.occ_symbol) ?? 0) + Math.abs(Math.round(r.qty)));
      }

      // Per-symbol: each symbol decides on ITS last RTH bar against ITS own bars/chain.
      for (const sym of SYMBOLS) {
        const symChannels = g.channels.filter((c) => c.underlying.toUpperCase() === sym);
        if (!symChannels.length) continue;
        const bars = barsBySym.get(sym)!;
        const sessionBars = buildSessionBars(bars.all(), todayET);
        const lastSession = sessionBars[sessionBars.length - 1];
        if (!lastSession) continue; // this symbol has no RTH bars yet
        const barMin = alpaca.etParts(lastSession.ts).min;
        const minutesToClose = Math.max(0, RTH_CLOSE - barMin);
        const chain = chainBySym.get(sym)!;
        const ctx: DecisionCtx = {
          sessionBars, chain, fund: cfg.fund, equity: account.equity, todayET,
          minutesToClose, // BAR-relative (strategy intents); wall-clock below is bars-independent
          wallMinutesToClose: Math.max(0, RTH_CLOSE - alpaca.etParts(Date.now()).min),
          next1DTE: chain.nextExpiryAfter(todayET),
          ...computeLevels(bars.all(), todayET),
          openRows, alpacaByOcc,
          allOrders, // empty unless acctLive — the PYRAMID executor reconstructs the lot stack from it
        };
        const symDecisions: ShadowDecision[] = [];
        for (const ch of symChannels) {
          try { symDecisions.push(await decideChannel(ch, ctx)); }
          catch (e) { warn(`decide ${ch.slug} failed — ${(e as Error).message}`); }
        }
        decisions.push(...symDecisions);

        // ---- PHASE B: EXECUTE the decisions for channels this worker OWNS, on an ARMED bucket ----
        if (acctLive) {
          // STALE-BAR ORDER GUARD (per symbol): a boot/restart decides on the last KNOWN
          // bar — orders need a fresh decision bar; reconcile + mark are always safe.
          const barFresh = Date.now() - lastSession.ts < 180_000;
          if (!barFresh) info(`live pass[${g.account.name}/${sym}]: decision bar stale (boot/off-hours) — orders suppressed, bookkeeping only`);
          const exec: ExecCtx = { api: api!, chain, todayET, etMin: barMin, sinceIso: `${todayET}T00:00:00Z`, allOrders, alpacaByOcc, remainingByOcc, openRowQty };
          const bySlug = new Map(symChannels.map((c) => [c.slug, c]));
          for (const d of symDecisions) {
            const ch = bySlug.get(d.slug);
            if (!ch || !ownedBy(ch)) continue;
            // "The desk summons you" — informational pages (once per day per key; never alters execution).
            if (barFresh) {
              if (d.action === "exit" && d.reason === "event_flatten")
                alertOnce(todayET, "event", "standdown", "⚑ event stand-down", `${d.slug} flattening ${d.occ ?? ""} — entries blocked through the window`);
              if (d.action === "enter" && d.blocked === "daily_stop")
                alertOnce(todayET, "latch", d.slug, `⛔ ${d.slug} daily stop latched`, `realized ≤ −$${Math.round(ch.daily_stop_usd)} — its entries are done for the day`);
              if (d.action === "enter" && d.blocked === "insufficient_capital")
                alertOnce(todayET, "size0", d.slug, `⚠ ${d.slug} sized to ZERO`, `RISK $${Math.round(ch.capital_pct)} can't clear 1 contract (ask too rich) — nudge the knob if the trade was wanted`);
            }
            const row = openRows.get(ch.id);
            try {
              if (d.action === "reconcile" && row) await executeReconcile(d, row, exec);
              else if (d.action === "exit" && row && !d.blocked && barFresh) await executeExit(d, row, exec);
              else if (d.action === "add" && row && barFresh) await executeAdd(d, ch, row, exec); // PYRAMID (pyramid_adds>0)
              else if (d.action === "enter" && barFresh) await executeEntry(d, ch, Number(d.detail?.spotClose ?? lastSession.close), exec);
              else if (d.action === "hold" && row) {
                const alp = alpacaByOcc.get(row.occ_symbol);
                if (alp) {
                  noteRowHeld(row.id); // row is held → reset any pending reconcile count (2-cycle gate)
                  const unreal = Math.round((alp.current_price - row.avg_entry_price) * row.qty * 10000) / 100;
                  await store.markPositionRow(row.id, alp.current_price, unreal);
                }
              }
            } catch (e) { warn(`execute ${d.slug} failed — ${(e as Error).message}`); }
          }
        }
      }

      // Per-account equity snapshot (tagged account_id → clean per-bucket forward NAV).
      if (live && api) {
        const unreal = positions.reduce((a, p) => a + p.unrealized_pl, 0);
        totEquity += account.equity; totCash += account.cash; totUnreal += unreal; snappedAny = true;
        try { await store.insertEquitySnapshot(account.equity, account.cash, unreal, g.account.id); }
        catch (e) { warn(`equity snapshot[${g.account.name}] failed — ${(e as Error).message}`); }
      }
    }

    // ---- SHARED diagnostics, once per symbol (account-independent) ----
    for (const sym of SYMBOLS) {
      const bars = barsBySym.get(sym)!;
      const sessionBars = buildSessionBars(bars.all(), todayET);
      const lastSession = sessionBars[sessionBars.length - 1];
      if (!lastSession) continue;
      const barMin = alpaca.etParts(lastSession.ts).min;
      const minutesToClose = Math.max(0, RTH_CLOSE - barMin);
      const chain = chainBySym.get(sym)!;
      // ---- gamma-open diagnostic (frontier #3, SHADOW-ONLY collect-forward) ----
      try {
        const gk = `${sym}|${todayET}`;
        if (barMin >= 575 && barMin <= 600 && !gammaLogged.has(gk)) {
          gammaLogged.add(gk);
          const spot = lastSession.close, k = Math.round(spot);
          const call = chain.byOcc(alpaca.occSymbol(sym, todayET, k, "call"));
          const put = chain.byOcc(alpaca.occSymbol(sym, todayET, k, "put"));
          if (call && put && call.mid > 0 && put.mid > 0) {
            const imPct = ((call.mid + put.mid) / spot) * 100;
            void store.writeShadowEvent(`gamma-open ${sym} — im ${imPct.toFixed(2)}% delta ${call.delta != null ? call.delta.toFixed(2) : "?"} spot ${spot.toFixed(2)}`,
              { kind: "gamma-open", sym, etMin: barMin, spot: Math.round(spot * 100) / 100, strike: k, callMid: call.mid, putMid: put.mid, impliedMovePct: Math.round(imPct * 1000) / 1000, callDelta: call.delta, putDelta: put.delta });
          }
        }
      } catch (e) { warn(`gamma-open[${sym}] failed — ${(e as Error).message}`); }

      // ---- FEATURE diagnostic (temp) — why armed channels don't fire: journal each symbol's
      // V3-gate features so IWM's live numbers can be compared to SPY/QQQ. Throttled to once per
      // symbol per 5-min bucket; journal-only (off the trade path). Remove once IWM is diagnosed. ----
      try {
        const fk = `${sym}|${todayET}|${Math.floor(barMin / 5)}`;
        if (!featLogged.has(fk)) {
          featLogged.add(fk);
          const lv = computeLevels(bars.all(), todayET);
          const ff = computeFeatures(sessionBars, sessionBars.length - 1);
          void store.writeShadowEvent(
            `feat ${sym} gap=${lv.gap != null ? lv.gap.toFixed(3) : "null"} er=${ff.er.toFixed(2)} relVol=${ff.relVol.toFixed(2)} atr=${ff.atr.toFixed(2)} close=${ff.close.toFixed(2)} bars=${sessionBars.length}`,
            { kind: "feat-diag", sym, gap: lv.gap ?? null, er: +ff.er.toFixed(3), relVol: +ff.relVol.toFixed(3), atr: +ff.atr.toFixed(3), close: +ff.close.toFixed(2), sessionBars: sessionBars.length, barMin });
        }
      } catch (e) { warn(`feat-diag[${sym}] failed — ${(e as Error).message}`); }
      // Shadow MANAGEMENT what-if: scale/BE/trail over THIS symbol's live positions (all
      // buckets) on its real-time quote (logs managed-vs-actual; no orders). ALWAYS call —
      // the ride-to-close override finalize must run at the 15:25 flatten.
      try {
        const symRows = openRowsArr.filter((r) => byId.get(r.strategist_id)?.underlying.toUpperCase() === sym);
        await updateShadowManagement({
          rows: symRows,
          slugById: new Map(cfg.channels.filter((c) => c.underlying.toUpperCase() === sym).map((c) => [c.id, c.slug])),
          sym,
          chain, sessionBars,
          atr: computeFeatures(sessionBars, sessionBars.length - 1).atr,
          etMin: barMin, minutesToClose,
        });
      } catch (e) { warn(`shadow-management[${sym}] failed — ${(e as Error).message}`); }
    }

    report(trigger, totEquity, decisions);
    // Orphan safety-net: flag (and, when armed, flatten) Alpaca lots the desk thinks are flat.
    // Live-only (no pages on shadow/boot); each sweep is isolated so it can never break the cycle.
    if (live) for (const si of sweepInputs) {
      try { await orphanSweep(si.g, si.alpacaByOcc, si.groupRows, si.acctLive, todayET); }
      catch (e) { warn(`orphan-sweep[${si.g.account.name}] failed — ${(e as Error).message}`); }
    }
    // Desk-wide TOTAL snapshot (account_id null = the sum across buckets) — the existing
    // dashboard equity curve reads the null rows; per-bucket rows are tagged above.
    if (live && snappedAny) { try { await store.insertEquitySnapshot(totEquity, totCash, totUnreal, null); } catch (e) { warn(`equity snapshot[total] failed — ${(e as Error).message}`); } }
  } catch (e) {
    // A cycle must never throw — it's fired forget-style from onBar, so an
    // unhandled rejection would otherwise take down the process.
    warn(`cycle(${trigger}) failed — ${(e as Error).message}`);
  } finally {
    cycling = false;
  }
}

function report(trigger: string, equity: number, ds: ShadowDecision[]): void {
  const act = ds.filter((d) => d.action === "enter" || d.action === "exit" || d.action === "reconcile" || d.action === "add");
  shadow(`cycle (${trigger}) equity $${Math.round(equity)} — ${ds.length} ch [${SYMBOLS.join("+")}], ${act.length} actionable`);
  for (const d of ds) {
    if (d.action === "add") {
      shadow(`  ${d.slug}: PYRAMID add ${d.occ} ×${d.qty} — WOULD ADD [${d.reason}]`, d.detail);
      void store.writeShadowEvent(`${d.slug} PYRAMID add ${d.occ} ×${d.qty} (${d.reason})`, d.detail);
    } else if (d.action === "enter") {
      const verb = d.blocked ? `BLOCKED(${d.blocked})` : `WOULD BUY ×${d.qty}`;
      shadow(`  ${d.slug}: ENTER ${d.direction} ${d.occ} — ${verb} [${d.reason}]`, d.detail);
      void store.writeShadowEvent(`${d.slug} ENTER ${d.direction} ${d.occ} — ${d.blocked ? `blocked:${d.blocked}` : `qty:${d.qty}`} (${d.reason})`, d.detail);
    } else if (d.action === "exit") {
      shadow(`  ${d.slug}: EXIT ${d.occ} ×${d.qty} — ${d.blocked ? `BLOCKED(${d.blocked})` : "WOULD SELL"} [${d.reason}]`, d.detail);
      void store.writeShadowEvent(`${d.slug} EXIT ${d.occ} ×${d.qty} (${d.reason})`, d.detail);
    } else if (d.action === "reconcile") {
      shadow(`  ${d.slug}: RECONCILE ${d.occ} — orphan desk row (Alpaca flat)`, d.detail);
    }
  }
}

// ---- PHASE B: fast EXIT sweep -------------------------------------------------
// Between bar closes (every FAST_EXIT_SEC) check the PREMIUM-side exits for
// stream-owned open positions on the LIVE chain: catastrophic stop, compiled
// stop/target, power giveback, the manual-twin bell backstop. Underlying-side
// exits (ustop / chandelier / strategy intents) stay on the bar-close cycle —
// they're defined on bars. This is the structural latency win over the minute
// cron: a crossed stop fires within seconds, not at the next minute boundary.
async function fastExitSweep(): Promise<void> {
  if (!liveMode() || cycling) return;
  const nowMin = alpaca.etParts(Date.now()).min;
  if (nowMin < RTH_OPEN || nowMin >= RTH_CLOSE) return;
  const owned = cfg.channels.filter(ownedBy);
  if (!owned.length || !cfg.fund) return;
  cycling = true;
  try {
    await store.heartbeat(`${WORKER_VERSION} sweep`);
    if (cfg.fund.is_halted || cfg.fund.mode !== "paper") return; // exits frozen (kill switch)
    const byId = new Map(cfg.channels.map((c) => [c.id, c]));
    const allRows = (await store.getOpenPositions()).filter((r) => owned.some((c) => c.id === r.strategist_id));
    if (!allRows.length) return;
    // refresh only the chains for symbols that have owned open positions
    const activeSyms = new Set(allRows.map((r) => byId.get(r.strategist_id)!.underlying.toUpperCase()));
    for (const sym of activeSyms) await refreshChain(sym);
    const todayET = alpaca.etParts(Date.now()).date;
    // Per-account (cockpit P3): only ARMED buckets with resolved creds sweep; each reads its OWN
    // positions/orders so an exit sells the right account's lot (the same OCC can live in two).
    for (const g of groupByAccount(owned, cfg.accounts)) {
      const api = g.api;
      if (!api || !g.account.is_armed || g.account.is_halted) continue;
      const rows = allRows.filter((r) => rowAccountId(r, byId, cfg.accounts) === g.account.id);
      if (!rows.length) continue;
      let positions: alpaca.AlpacaPosition[] = [], allOrders: alpaca.AlpacaOrder[] = [];
      try { [positions, allOrders] = await Promise.all([alpaca.getPositions(api), alpaca.getOrders(500, api)]); }
      catch (e) { warn(`fast-exit[${g.account.name}] read failed — ${(e as Error).message}`); continue; }
      const alpacaByOcc = new Map(positions.map((p) => [p.symbol, p]));
      const remainingByOcc = seedRemaining(positions);
      const openRowQty = new Map<string, number>();
      for (const r of rows) openRowQty.set(r.occ_symbol, (openRowQty.get(r.occ_symbol) ?? 0) + Math.abs(Math.round(r.qty)));
      for (const r of rows) {
      const ch = byId.get(r.strategist_id)!;
      const chain = chainBySym.get(ch.underlying.toUpperCase());
      const exec: ExecCtx = { api, chain: chain!, todayET, etMin: nowMin, sinceIso: `${todayET}T00:00:00Z`, allOrders, alpacaByOcc, remainingByOcc, openRowQty };
      // ---- EOD HARD-FLATTEN backstop (wall-clock; 2026-06-19 Juneteenth strand fix) ----
      // The strategy's same-day flatten is BAR-relative, so a gapped near-bell bar (06-18: no
      // 15:59 print) means it never fires and the position strands — over a 3-day weekend if a
      // holiday follows. This sweep is a 10s WALL-CLOCK timer that runs even when bars stop, so
      // it force-flattens a SAME-SESSION machine position with margin while the market is still
      // open. Reuses executeExit → inherits the shared-OCC sell-cap + client_order_id idempotency.
      // Machine channels only — manual twins keep their own MANUAL_BACKSTOP_MIN bell exit.
      const wallMtc = Math.max(0, RTH_CLOSE - nowMin);
      const openedET = r.opened_at ? alpaca.etParts(Date.parse(r.opened_at)).date : todayET;
      if (wallMtc <= policy.EOD_HARD_FLATTEN_MIN && openedET === todayET && !/-manual$/i.test(ch.slug)) {
        info(`eod-hard-flatten: ${ch.slug} ${r.occ_symbol} ×${r.qty} — same-session, wall-clock mtc ${wallMtc} (pre-bell backstop, bars-independent)`);
        try { await executeExit({ slug: ch.slug, status: ch.status, action: "exit", reason: "eod_hard_flatten" }, r, exec); }
        catch (e) { warn(`eod-hard-flatten ${ch.slug} failed — ${(e as Error).message}`); }
        peakMidByKey.delete(entryKey(r.strategist_id, r.occ_symbol));
        continue;
      }
      const mid = chain?.byOcc(r.occ_symbol)?.mid ?? 0;
      if (!(mid > 0)) continue;
      const key = entryKey(r.strategist_id, r.occ_symbol);
      // seed from the persisted peak_mark so a worker restart doesn't lose the MFE high-water mark
      const prevPeak = peakMidByKey.get(key) ?? r.peak_mark ?? r.avg_entry_price;
      const peak = Math.max(prevPeak, mid);
      peakMidByKey.set(key, peak);
      if (peak > prevPeak) void store.markPeak(r.id, peak); // durable MFE ratchet, NEW-high only (44_trade_forensics; off the trade path)
      // "The desk summons you" — premium-side pages off the same ~10s sweep state:
      // a ripper crossing +CROSS%, and a meaningful peak giving back ≥ FRAC of the
      // move (the positions panel's 50%-giveback amber, pushed to the phone live).
      const entryPx = r.avg_entry_price;
      if (entryPx > 0) {
        const retPct = ((mid - entryPx) / entryPx) * 100;
        const peakPct = ((peak - entryPx) / entryPx) * 100;
        // dedup scope = the POSITION ROW id (not the OCC) so a same-day re-entry into the
        // same strike (e.g. two ORB legs on 742C) pages on its OWN +75%/giveback, not once.
        if (retPct >= policy.ALERT_CROSS_PCT)
          alertOnce(todayET, "cross", r.id, `▲ ${ch.slug} +${Math.round(retPct)}%`,
            `${r.occ_symbol} ×${r.qty} — entry $${entryPx.toFixed(2)} → $${mid.toFixed(2)}. Ride or bank?`);
        if (peakPct >= policy.ALERT_GIVEBACK_MIN_PEAK_PCT && peak - mid >= policy.ALERT_GIVEBACK_FRAC * (peak - entryPx))
          alertOnce(todayET, "giveback", r.id, `▼ ${ch.slug} giving it back`,
            `${r.occ_symbol} peaked +${Math.round(peakPct)}%, now ${retPct >= 0 ? "+" : ""}${Math.round(retPct)}% — ${Math.round(((peak - mid) / (peak - entryPx)) * 100)}% of the move gone`);
      }
      const pe = ch.spec_json ? specPremiumExit(ch.spec_json as StrategySpec) : undefined;
      const reason = premiumExitReason({
        row: r, slug: ch.slug, premiumExit: pe, takeProfitPct: ch.take_profit_pct, premiumStopPct: ch.premium_stop_pct,
        isPowerTrail: policy.POWER_TRAIL_CHANNELS.has(ch.slug),
        isManual: /-manual$/i.test(ch.slug),
        minutesToClose: Math.max(0, RTH_CLOSE - nowMin),
        stallMinutes: ch.stall_minutes, stallMaxFavorPct: ch.stall_max_favor_pct, // strand-4 stall-exit (0 = off)
      }, mid, peak);
      if (!reason) continue;
      info(`fast-exit: ${ch.slug} ${r.occ_symbol} → ${reason} (mid ${mid.toFixed(2)} vs entry ${r.avg_entry_price.toFixed(2)})`);
      await executeExit({ slug: ch.slug, status: ch.status, action: "exit", reason }, r, exec);
      peakMidByKey.delete(key);
      }
    }
  } catch (e) {
    warn(`fast-exit sweep failed — ${(e as Error).message}`);
  } finally {
    cycling = false;
  }
}

function onBar(symbol: string, bar: Bar): void {
  const store = barsBySym.get(symbol);
  if (!store) return; // a symbol we don't own (shouldn't happen — sub is scoped)
  const isNew = store.upsert(bar);
  // Only a NEW *RTH* closed bar triggers a decision (after-hours bars update
  // state but don't re-run the strategies). The cycle re-evaluates ALL symbols —
  // cheap (in-memory decide) and keeps minutesToClose fresh across the roster.
  const m = alpaca.etParts(bar.ts).min;
  if (isNew && m >= RTH_OPEN && m < RTH_CLOSE) void cycle(`bar-close ${symbol}`);
}
async function onReconnect(): Promise<void> {
  warn("stream: reconnected — reseeding state from REST");
  try { await seed(); } catch (e) { error(`reseed failed — ${(e as Error).message}`); }
}

async function main(): Promise<void> {
  info(`SEVE streaming worker ${WORKER_VERSION} — the third engine driver`);
  const writeMode = config.hasServiceRole
    ? (config.shadowWriteEvents ? "events" : "none (service role, events off)")
    : "none (anon, read-only)";
  info(`feeds: stock=${config.stockFeed} opt=${config.optFeed} · dryRun=${config.dryRun} · liveTrading=${config.liveTrading} · writes=${writeMode}`);

  // Phase B posture — the TWO-KEY turn. Going live requires DRY_RUN=false AND
  // LIVE_TRADING=true AND the service role, together; a partial flip refuses to
  // start rather than guessing. Even fully live, this instance only ever places
  // orders for channels with strategists.executor='stream' on ITS symbol — the
  // cron keeps everything else, and defers via the worker_heartbeat dead-man.
  if (!config.dryRun && !(config.liveTrading && config.hasServiceRole)) {
    error("DRY_RUN=false requires LIVE_TRADING=true AND the service role (the two-key turn). Refusing to start.");
    process.exit(1);
  }
  if (config.liveTrading && config.dryRun) {
    warn("LIVE_TRADING=true but DRY_RUN=true — staying in SHADOW (set DRY_RUN=false to complete the two-key turn).");
  }
  if (liveMode()) {
    info(`◉ LIVE EXECUTOR — trading executor='stream' channels on ${SYMBOLS.join(",")}; heartbeat → worker_heartbeat('stream'); fast exits every ${config.fastExitSec}s`);
  }

  // Boot is non-fatal: a transient config/seed failure must not crash-loop the
  // container. Config self-heals via the realtime sub + 30s poll; bars self-heal
  // via the websocket stream. So we log and carry on rather than exit.
  try { await reloadConfig(); }
  catch (e) { warn(`config: initial load failed — ${(e as Error).message}; will retry via realtime/poll`); }
  info(`config: ${cfg.fund ? `fund cap $${cfg.fund.total_capital_usd} mode=${cfg.fund.mode} halted=${cfg.fund.is_halted}` : "fund MISSING"}, ${cfg.channels.length} channels [${cfg.channels.map((c) => `${c.slug}:${c.status}`).join(", ")}]`);
  // Cockpit P3 routing summary: each bucket's posture — LIVE (armed + creds), shadow (decided,
  // no orders), or no-creds (cred_ref set but env keys absent). The shadow-first verification view.
  const acctSummary = groupByAccount(cfg.channels, cfg.accounts)
    .map((g) => `${g.account.name}[${g.api ? (liveMode() && g.account.is_armed && !g.account.is_halted ? "LIVE" : "shadow") : "no-creds"}]×${g.channels.length}`).join(", ");
  info(`accounts (cockpit P3): ${acctSummary || "single-account"}; alt-creds: [${Object.keys(config.altAccounts).join(",") || "none"}]`);
  try { await seed(); }
  catch (e) { error(`seed failed after retries — continuing; the websocket will populate bars live (${(e as Error).message})`); }

  store.subscribeConfig(() => { reloadPending = true; });
  setInterval(() => { reloadPending = true; }, 30_000); // poll fallback if realtime is off

  // Decide once against the latest known bar at boot (validates the pipeline + is
  // useful when booting mid-session); thereafter every bar-close drives it.
  await cycle("boot");

  const stream = new StockBarStream(SYMBOLS, onBar, onReconnect);
  stream.start();

  // Phase B: the fast premium-exit sweep (no-op in shadow / outside RTH / flat).
  setInterval(() => { void fastExitSweep(); }, Math.max(5, config.fastExitSec) * 1000);

  // FORWARD-DATA DURABILITY: upload each complete day's option_quotes (gz) to Supabase Storage,
  // post-close, from this always-on worker — the Mac-independent backstop against the 7d prune
  // (docs/data-capture.md). Boot run = catch-up for any day missed while down; the timer fires
  // once post-close per ET day. Off the trade path; no-op without the service role.
  void archiveQuotesToStorage("boot");
  setInterval(() => { void maybeArchiveTick(); }, 20 * 60_000); // every 20 min; self-gates to once/day post-close

  // SHADOW §03 PANEL (Mac-independent): run the existing day-report (override/foul-out
  // scorecard + benched-sim) from this always-on worker post-close, so the panel stays
  // current with no Mac. Reuses scripts/shadow-cron.ts as a NON-BLOCKING child (the heartbeat
  // keeps beating while it runs); off the trade path; no-op without the service role.
  setInterval(() => { void maybePublishForensicsTick(); }, 20 * 60_000); // self-gates to once/day post-close

  // PRE-OPEN IDLE BEAT: the cron wakes at 09:00 ET but bars (hence cycles/sweeps)
  // start at 09:30 — the heartbeat read stale every morning and the cron's
  // executor gate WARN-flooded "stream heartbeat STALE" per channel per minute
  // (310 lines on 06-12). Beat once a minute through 08:55–09:35 so the gate
  // reads FRESH from the cron's first cycle. Harmless on weekends (no cron).
  setInterval(() => {
    if (!liveMode()) return;
    const m = alpaca.etParts(Date.now()).min;
    if (m >= RTH_OPEN - 35 && m < RTH_OPEN + 5) void store.heartbeat(`${WORKER_VERSION} pre-open`);
  }, 60_000);

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => { info(`shutdown (${sig})`); stream.stop(); process.exit(0); });
  }
}

// Last-resort safety nets. A stray promise rejection is logged but NOT fatal (the
// worker keeps streaming); a genuine uncaught exception exits so Railway restarts
// with clean state (boot is now retry-hardened, so a restart won't crash-loop).
process.on("unhandledRejection", (reason) => {
  warn(`unhandledRejection — ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on("uncaughtException", (e) => {
  error(`uncaughtException — ${e.message}; exiting for a clean restart`);
  process.exit(1);
});

main().catch((e) => { error(`fatal — ${(e as Error).message}`); process.exit(1); });
