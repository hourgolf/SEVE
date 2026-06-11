// ============================================================================
//  day-report — the deterministic daily forensics the LLM autopsy isn't.
//
//  Answers, with numbers, the questions that matter after a session:
//    · NAV truth vs per-channel attribution (does the book reconcile?)
//    · what SHAPE was the tape (trend / V / chop — and how whipsawy)?
//    · per trade: entry → PEAK → exit, MFE%, giveback%, hold, exit reason
//    · the systemic flags: green→red round-trips ($ left from peak),
//      same-minute multi-channel entry CLUSTERS (correlation = one bet ×N),
//      re-lean churn (re-entry <10m after a stop, same side), stop overshoots,
//      daily-stop latches
//
//    npm run day-report                  (today ET)
//    npm run day-report -- --date 2026-06-10
//
//  Read-only (anon). Peaks come from option_quotes (7-day retention — run it
//  same-week). Exit reasons parsed from the worker journal in `events`.
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

const di = process.argv.indexOf("--date");
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const DATE = di >= 0 && process.argv[di + 1] ? process.argv[di + 1] : ET_DATE.format(new Date());

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
const sgn = (v: number) => (v >= 0 ? "+" : "") + Math.round(v);
const pct = (v: number | null) => (v == null ? "  —" : `${v >= 0 ? "+" : ""}${Math.round(v)}%`);

interface Trade {
  id: string; slug: string; cp: "call" | "put"; strike: number; qty: number; occ: string;
  entry: number; exit: number; pnl: number; openedAt: string; closedAt: string;
  peak: number | null; mfePct: number | null; gavePct: number | null; reason: string;
  manual: boolean;
  closeReason: string | null; // durable column (31_close_reason.sql) — authoritative once stamped
}

async function main() {
  console.log(`\nDAY REPORT — ${DATE} (ET)\n`);

  // ---- tape shape (per underlying traded today) -------------------------------
  const { data: barsRaw } = await sb.from("underlying_bars").select("symbol,ts,close")
    .gte("ts", `${DATE}T13:25:00Z`).lte("ts", `${DATE}T20:05:00Z`).order("ts");
  const bySym = new Map<string, Array<{ ts: number; c: number }>>();
  for (const b of (barsRaw ?? []) as Array<{ symbol: string; ts: string; close: number | null }>) {
    if (b.close == null) continue;
    const arr = bySym.get(b.symbol) ?? [];
    arr.push({ ts: Date.parse(b.ts), c: Number(b.close) });
    bySym.set(b.symbol, arr);
  }
  for (const [sym, bs] of bySym) {
    const o = bs[0].c, c = bs[bs.length - 1].c;
    const hi = Math.max(...bs.map((b) => b.c)), lo = Math.min(...bs.map((b) => b.c));
    // whipsaw read: count direction flips of ≥0.30% legs on the close path
    let legs = 0, anchor = o, dir = 0;
    for (const b of bs) {
      const move = (b.c - anchor) / anchor;
      if (Math.abs(move) >= 0.003) {
        const d = Math.sign(move);
        if (d !== dir && dir !== 0) legs++;
        if (d !== dir) dir = d;
        anchor = b.c;
      }
    }
    console.log(`${sym}: open ${o.toFixed(2)} → close ${c.toFixed(2)} (${(100 * (c / o - 1)).toFixed(2)}%) · range ${(100 * (hi - lo) / o).toFixed(2)}% · ${legs} reversal leg(s) ≥0.3%${legs >= 3 ? "  ⚠ WHIPSAW" : ""}`);
  }

  // ---- NAV truth vs attribution ------------------------------------------------
  const { data: snaps } = await sb.from("equity_snapshots").select("net_liquidation,captured_at")
    .is("strategist_id", null).gte("captured_at", `${DATE}T13:00:00Z`).lte("captured_at", `${DATE}T21:30:00Z`)
    .order("captured_at");
  const nav = (snaps ?? []) as Array<{ net_liquidation: number; captured_at: string }>;
  const navDelta = nav.length >= 2 ? Number(nav[nav.length - 1].net_liquidation) - Number(nav[0].net_liquidation) : null;

  // ---- trades -------------------------------------------------------------------
  const { data: posRaw } = await sb.from("positions")
    .select("id,strategist_id,occ_symbol,opt_type,strike,qty,avg_entry_price,realized_pnl,opened_at,closed_at,close_reason,strategists(slug)")
    .eq("status", "closed").gte("closed_at", `${DATE}T13:00:00Z`).lte("closed_at", `${DATE}T22:00:00Z`)
    .order("opened_at");
  const { data: evRaw } = await sb.from("events").select("message,created_at")
    .gte("created_at", `${DATE}T13:00:00Z`).lte("created_at", `${DATE}T22:00:00Z`);
  const events = (evRaw ?? []) as Array<{ message: string; created_at: string }>;

  // Per-channel executor + arm state (W2 migration: which executor OWNS each channel).
  // NOTE: this is CURRENT config, not the config at trade time — accurate for a
  // same-day report (the normal use), approximate when re-running an old date.
  const { data: stratRaw } = await sb.from("strategists").select("slug,executor,status,strategist_config(muted)");
  const execBySlug = new Map<string, { executor: string; armed: boolean; muted: boolean }>();
  for (const s of (stratRaw ?? []) as any[]) {
    const cfg = Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config;
    execBySlug.set(s.slug, { executor: String(s.executor ?? "cron"), armed: s.status === "armed", muted: !!cfg?.muted });
  }
  const execOf = (slug: string) => execBySlug.get(slug)?.executor ?? "cron";

  const trades: Trade[] = [];
  for (const p of (posRaw ?? []) as any[]) {
    const slug = p.strategists?.slug ?? "?";
    const entry = Number(p.avg_entry_price), qty = Number(p.qty), pnl = Number(p.realized_pnl ?? 0);
    const exit = entry + (qty > 0 ? pnl / (qty * 100) : 0);
    const { data: pk } = await sb.from("option_quotes").select("mid").eq("occ_symbol", p.occ_symbol)
      .gte("captured_at", p.opened_at).lte("captured_at", p.closed_at)
      .order("mid", { ascending: false }).limit(1).maybeSingle();
    const peak = pk?.mid != null ? Number(pk.mid) : null;
    const mfePct = peak != null && entry > 0 ? ((peak - entry) / entry) * 100 : null;
    const gavePct = peak != null && peak > entry && exit < peak ? ((peak - exit) / (peak - entry)) * 100 : null;
    // exit reason from the worker journal: "<slug>: exit <occ> ×N @ px (reason)" / reconciled
    const ev = events.find((e) =>
      e.message.includes(p.occ_symbol) && e.message.includes(slug)
      && Math.abs(Date.parse(e.created_at) - Date.parse(p.closed_at)) < 180_000
      && /exit|reconcil/i.test(e.message));
    const reason = ev?.message.match(/\(([a-z_0-9]+)\)\s*$/i)?.[1] ?? (ev && /reconcil/i.test(ev.message) ? "reconciled" : "—");
    trades.push({
      id: p.id, slug, cp: p.opt_type, strike: Number(p.strike), qty, occ: p.occ_symbol,
      entry, exit, pnl, openedAt: p.opened_at, closedAt: p.closed_at,
      peak, mfePct, gavePct,
      reason: p.close_reason ?? reason, // column beats journal-parse once stamped
      manual: /-manual$/i.test(slug),
      closeReason: p.close_reason ?? null,
    });
  }

  const auto = trades.filter((t) => !t.manual);
  const tot = trades.reduce((a, t) => a + t.pnl, 0);
  console.log(`\nNAV truth: ${navDelta == null ? "n/a" : sgn(navDelta)} · Σ attribution ${sgn(tot)} (auto ${sgn(auto.reduce((a, t) => a + t.pnl, 0))}, manual ${sgn(trades.filter((t) => t.manual).reduce((a, t) => a + t.pnl, 0))}) · ${trades.length} trades`);
  if (navDelta != null && Math.abs(navDelta - tot) > 300) console.log(`  ⚠ attribution drifts ${sgn(tot - navDelta)} from NAV (open positions / shared-OCC residue?)`);

  // ---- coverage: account fills vs desk rows (the uncovered-contract detector) ----
  // The 06-11 incident surfaced only as a +$58 NAV-vs-attribution gap: a partial-fill
  // poll recorded qty 1 on a ×2 buy and the extra contract rode UNMANAGED. This makes
  // the check explicit and daily: per OCC, Alpaca's filled orders today vs the desk's
  // recorded rows, plus a live held-vs-open-rows audit. Needs ALPACA_KEY/SECRET
  // (read-only paper endpoints) — degrades to a skip note without them.
  const AK = process.env.ALPACA_KEY, AS = process.env.ALPACA_SECRET;
  if (!AK || !AS) {
    console.log(`\ncoverage: skipped (no ALPACA_KEY/ALPACA_SECRET in env)`);
  } else {
    try {
      const aHdr = { "APCA-API-KEY-ID": AK, "APCA-API-SECRET-KEY": AS };
      const PAPER = "https://paper-api.alpaca.markets";
      // day's terminal orders, paginated by sliding `until` (endpoint caps at 500/page)
      const orders: Array<{ symbol: string; side: string; filled_qty: string; submitted_at: string }> = [];
      let until = `${DATE}T22:00:00Z`;
      for (let page = 0; page < 6; page++) {
        const r = await fetch(`${PAPER}/v2/orders?status=closed&limit=500&direction=desc&after=${DATE}T13:00:00Z&until=${until}`, { headers: aHdr });
        if (!r.ok) throw new Error(`alpaca orders ${r.status}`);
        const batch = await r.json() as typeof orders;
        orders.push(...batch);
        if (batch.length < 500) break;
        until = batch[batch.length - 1].submitted_at;
      }
      const acct = new Map<string, { b: number; s: number }>();
      for (const o of orders) {
        const q = Number(o.filled_qty);
        if (!(q > 0)) continue;
        const a = acct.get(o.symbol) ?? { b: 0, s: 0 };
        if (o.side === "buy") a.b += q; else a.s += q;
        acct.set(o.symbol, a);
      }
      // desk buys: Σ row qty opened today per OCC (every channel — rows mirror fills)
      const { data: openedRaw } = await sb.from("positions").select("occ_symbol,qty")
        .gte("opened_at", `${DATE}T13:00:00Z`).lte("opened_at", `${DATE}T22:00:00Z`);
      const deskBought = new Map<string, number>();
      for (const p of (openedRaw ?? []) as Array<{ occ_symbol: string; qty: number }>) {
        deskBought.set(p.occ_symbol, (deskBought.get(p.occ_symbol) ?? 0) + Number(p.qty));
      }
      // live audit: what Alpaca holds NOW vs Σ open desk rows ("check coverage")
      const pr = await fetch(`${PAPER}/v2/positions`, { headers: aHdr });
      const alpPos = pr.ok ? (await pr.json() as Array<{ symbol: string; qty: string }>) : [];
      const { data: openRows } = await sb.from("positions").select("occ_symbol,qty").eq("status", "open");
      const openByOcc = new Map<string, number>();
      for (const p of (openRows ?? []) as Array<{ occ_symbol: string; qty: number }>) {
        openByOcc.set(p.occ_symbol, (openByOcc.get(p.occ_symbol) ?? 0) + Number(p.qty));
      }
      const issues: string[] = [];
      for (const [occ, a] of acct) {
        const rows = deskBought.get(occ) ?? 0;
        if (a.b !== rows) issues.push(`${occ}: account bought ${a.b} / desk rows opened ${rows} → ${a.b > rows ? `+${a.b - rows} UNCOVERED at entry (partial-fill class)` : `${rows - a.b} over-recorded (ghost qty)`}`);
        if (a.b !== a.s) issues.push(`${occ}: EOD net ${a.b - a.s > 0 ? "+" : ""}${a.b - a.s} (buys ${a.b} / sells ${a.s}) — carried overnight, expired on book, or a prior-day carry closed today`);
      }
      for (const ap of alpPos) {
        const held = Math.abs(Math.round(Number(ap.qty)));
        const rows = openByOcc.get(ap.symbol) ?? 0;
        if (held !== rows) issues.push(`${ap.symbol}: Alpaca holds ${held} / open desk rows ${rows} → ${held > rows ? "UNCOVERED — close or reconstruct" : "ghost rows"}`);
      }
      console.log(`\ncoverage (account vs rows)`);
      if (issues.length) for (const i of issues) console.log(`  ⚠ ${i}`);
      else console.log(`  ✓ clean: ${acct.size} OCC(s) — account buys == desk rows opened, EOD flat, held == open rows`);
    } catch (e) {
      console.log(`\ncoverage: check failed (${(e as Error).message})`);
    }
  }

  // ---- per-trade table ------------------------------------------------------------
  console.log(`\ntime        channel                 trade        entry→peak→exit      P&L     MFE   gave   hold  exit`);
  for (const t of trades) {
    const hold = Math.round((Date.parse(t.closedAt) - Date.parse(t.openedAt)) / 60000);
    console.log(
      `${hhmm(t.openedAt)}–${hhmm(t.closedAt)}  ${(t.slug + (t.manual ? " ✋" : "")).padEnd(22)} ${(t.strike.toFixed(0) + (t.cp === "call" ? "C" : "P") + "×" + t.qty).padEnd(12)} ` +
      `${t.entry.toFixed(2)}→${t.peak != null ? t.peak.toFixed(2) : "  ? "}→${t.exit.toFixed(2)}`.padEnd(20) +
      ` ${sgn(t.pnl).padStart(6)}  ${pct(t.mfePct).padStart(5)} ${(t.gavePct != null ? Math.round(t.gavePct) + "%" : "—").padStart(6)} ${String(hold).padStart(4)}m  ${t.reason}`,
    );
  }

  // ---- flags -----------------------------------------------------------------------
  console.log(`\nFLAGS`);
  // green→red: was up ≥20%, closed ≤ 0
  const g2r = auto.filter((t) => (t.mfePct ?? 0) >= 20 && t.pnl <= 0);
  const left = g2r.reduce((a, t) => a + (t.peak! - t.exit) * t.qty * 100, 0);
  console.log(`  green→red (MFE ≥+20% → closed ≤0): ${g2r.length} trades · $${Math.round(left).toLocaleString()} given back from peaks${g2r.length ? "  ← " + g2r.map((t) => t.slug).join(", ") : ""}`);
  // entry clusters: same minute + same side across ≥3 channels
  const clusters = new Map<string, Trade[]>();
  for (const t of auto) {
    const k = `${hhmm(t.openedAt)}|${t.cp}`;
    clusters.set(k, [...(clusters.get(k) ?? []), t]);
  }
  for (const [k, ts] of clusters) {
    if (ts.length >= 3) {
      const [min, side] = k.split("|");
      console.log(`  CLUSTER ${min} ${side.toUpperCase()}: ${ts.length} channels entered together (${ts.map((t) => t.slug).join(", ")}) → Σ ${sgn(ts.reduce((a, t) => a + t.pnl, 0))}  ← one bet ×${ts.length}`);
    }
  }
  // re-lean churn: entry within 10m after the same channel's same-side loss
  for (const t of auto) {
    const prior = auto.find((u) => u.slug === t.slug && u.cp === t.cp && u.pnl < 0 && u.id !== t.id
      && Date.parse(t.openedAt) - Date.parse(u.closedAt) > 0
      && Date.parse(t.openedAt) - Date.parse(u.closedAt) < 10 * 60_000);
    if (prior) console.log(`  RE-LEAN ${t.slug}: re-entered ${t.cp} ${Math.round((Date.parse(t.openedAt) - Date.parse(prior.closedAt)) / 60000)}m after a ${sgn(prior.pnl)} stop → ${sgn(t.pnl)}`);
  }
  // stop overshoot beyond design
  for (const t of auto) {
    const ret = t.entry > 0 ? (t.exit - t.entry) / t.entry : 0;
    if (ret < -0.62) console.log(`  OVERSHOOT ${t.slug} ${t.strike}${t.cp === "call" ? "C" : "P"}: closed ${Math.round(ret * 100)}% vs −50% design`);
  }
  // daily-stop latches
  const { data: latches } = await sb.from("signals").select("strategist_id,created_at,strategists(slug)")
    .eq("blocked_reason", "daily_stop").gte("created_at", `${DATE}T13:00:00Z`).lte("created_at", `${DATE}T21:00:00Z`);
  const latchSlugs = [...new Set(((latches ?? []) as any[]).map((l) => l.strategists?.slug ?? "?"))];
  if (latchSlugs.length) console.log(`  DAILY-STOP latched: ${latchSlugs.join(", ")}`);

  // ---- channel rollup -----------------------------------------------------------------
  console.log(`\nchannel rollup (auto)`);
  const bySlug = new Map<string, Trade[]>();
  for (const t of auto) bySlug.set(t.slug, [...(bySlug.get(t.slug) ?? []), t]);
  for (const [slug, ts] of [...bySlug.entries()].sort((a, b) => b[1].reduce((x, t) => x + t.pnl, 0) - a[1].reduce((x, t) => x + t.pnl, 0))) {
    const p = ts.reduce((a, t) => a + t.pnl, 0);
    const w = ts.filter((t) => t.pnl > 0).length;
    console.log(`  ${slug.padEnd(24)} ${`[${execOf(slug)}]`.padEnd(8)} ${String(ts.length).padStart(2)}t  ${w}/${ts.length} win  ${sgn(p).padStart(7)}`);
  }
  // EXECUTOR SPLIT (W2 migration validation): where did the day's trades run? After
  // the cutover the stream line should carry the migrated roster; a stream channel
  // you EXPECTED to trade sitting in the 0-trade list = a cron→stream handoff miss.
  const splitOf = (exec: string) => {
    const ts = auto.filter((t) => execOf(t.slug) === exec);
    return `${new Set(ts.map((t) => t.slug)).size}ch ${ts.length}t ${sgn(ts.reduce((a, x) => a + x.pnl, 0))}`;
  };
  console.log(`  ── executors: stream ${splitOf("stream")} · cron ${splitOf("cron")}`);
  const traded = new Set(auto.map((t) => t.slug));
  const silentStream = [...execBySlug.entries()].filter(([slug, m]) => m.executor === "stream" && m.armed && !m.muted && !traded.has(slug)).map(([slug]) => slug);
  if (silentStream.length) console.log(`  ── stream armed+unmuted · 0 trades: ${silentStream.join(", ")}  (selectivity, or a handoff miss — eyeball vs the worker log)`);

  // ---- participation (the operator-selection dataset, close_reason 31) -------------
  // Manual twins: the machine enters and pushes "your exit"; the operator either
  // ENGAGES (closes it himself → close_reason 'manual'/'manual:<tag>', or a
  // "manual: close" journal line for pre-column rows) or SKIPS (the 15:57 bell
  // backstop flattens it → manual_eod_backstop). Selection is his compilable half —
  // this is the dataset that lets it inform machine entry filters.
  const manualTrades = trades.filter((t) => t.manual);
  if (manualTrades.length) {
    console.log(`\nparticipation (manual twins — taken = operator closed · skipped = bell backstop)`);
    const manualCloseEv = (t: Trade) => events.some((e) =>
      /manual: close /.test(e.message) && e.message.includes(t.occ)
      && Math.abs(Date.parse(e.created_at) - Date.parse(t.closedAt)) < 180_000);
    const kind = (t: Trade): "taken" | "skipped" | "other" => {
      if (t.closeReason?.startsWith("manual:") || t.closeReason === "manual" || manualCloseEv(t)) return "taken";
      if (t.closeReason === "manual_eod_backstop" || t.reason === "manual_eod_backstop") return "skipped";
      return "other"; // reconciled / sibling-drained / unknown
    };
    const byTwin = new Map<string, Trade[]>();
    for (const t of manualTrades) byTwin.set(t.slug, [...(byTwin.get(t.slug) ?? []), t]);
    for (const [slug, ts] of byTwin) {
      const grp: Record<"taken" | "skipped" | "other", Trade[]> = { taken: [], skipped: [], other: [] };
      for (const t of ts) grp[kind(t)].push(t);
      const fmt = (g: Trade[]) => `${g.length}t ${sgn(g.reduce((a, x) => a + x.pnl, 0))}`;
      const tags = ts.map((t) => t.closeReason?.match(/^manual:(.+)$/)?.[1]).filter(Boolean);
      console.log(`  ${slug.padEnd(24)} taken ${fmt(grp.taken).padEnd(11)} skipped ${fmt(grp.skipped).padEnd(11)}${grp.other.length ? ` other ${fmt(grp.other)}` : ""}${tags.length ? `  tags: ${tags.join(",")}` : ""}`);
    }
    const overrides = auto.filter((t) => t.closeReason === "manual" || t.closeReason?.startsWith("manual:"));
    if (overrides.length) console.log(`  operator overrides on AUTO channels: ${overrides.length} (${[...new Set(overrides.map((t) => t.slug))].join(", ")})`);
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
