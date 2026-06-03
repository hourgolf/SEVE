// ============================================================================
//  Supabase store — config reads (fund_state + strategists ⋈ strategist_config),
//  open-position reads (per-channel attribution), the Realtime KILL-switch
//  subscription (so a halt bites in <1s), and shadow event writes.
//
//  Uses the service role on Railway (full read/write). Locally it falls back to
//  the anon key → READ-ONLY: config + quotes read fine (RLS allows anon SELECT),
//  writes are skipped (logged instead). See config.hasServiceRole.
// ============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { config } from "./config.js";
import { info, warn } from "./log.js";

// supabase realtime-js needs a WebSocket implementation; Node <22 has no global
// one (it throws on createClient). Provide `ws` explicitly so it works on any
// Node version. Type extracted from createClient's own options so there's no `any`.
type WSTransport = NonNullable<NonNullable<Parameters<typeof createClient>[2]>["realtime"]>["transport"];

export interface ChannelConfig {
  id: string;
  slug: string;
  status: "armed" | "draft" | "disabled";
  spec_json: unknown | null;
  capital_pct: number;
  aggression: number;
  max_contracts: number;
  daily_stop_usd: number;
  muted: boolean;
  soloed: boolean;
}
export interface FundState {
  total_capital_usd: number;
  master_daily_stop_usd: number;
  mode: string;
  is_halted: boolean;
}
export interface PositionRow {
  id: string;
  strategist_id: string;
  occ_symbol: string;
  opt_type: "call" | "put";
  qty: number;
  avg_entry_price: number;
  strike: number;
  expiration: string | null;
  opened_at: string | null;
  status: string;
}

const sb: SupabaseClient = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as unknown as WSTransport },
});

export async function loadConfig(): Promise<{ fund: FundState | null; channels: ChannelConfig[] }> {
  const { data: fundRow, error: fundErr } = await sb.from("fund_state").select("*").eq("id", 1).maybeSingle();
  if (fundErr) warn(`store: fund_state read failed — ${fundErr.message}`);
  const { data: rows, error } = await sb
    .from("strategists")
    .select("id,slug,status,spec_json,strategist_config(*)");
  if (error) { warn(`store: strategists read failed — ${error.message}`); return { fund: null, channels: [] }; }
  if (!fundRow) warn("store: fund_state id=1 not found (check SUPABASE_URL / service-role key point at the right project)");

  const channels: ChannelConfig[] = [];
  for (const r of (rows ?? []) as any[]) {
    const cfg = Array.isArray(r.strategist_config) ? r.strategist_config[0] : r.strategist_config;
    if (!cfg) continue;
    channels.push({
      id: r.id,
      slug: r.slug,
      status: (r.status ?? "armed") as ChannelConfig["status"],
      spec_json: r.spec_json ?? null,
      capital_pct: Number(cfg.capital_pct),
      aggression: Number(cfg.aggression),
      max_contracts: Number(cfg.max_contracts),
      daily_stop_usd: Number(cfg.daily_stop_usd),
      muted: !!cfg.muted,
      soloed: !!cfg.soloed,
    });
  }
  const fund: FundState | null = fundRow
    ? {
        total_capital_usd: Number((fundRow as any).total_capital_usd),
        master_daily_stop_usd: Number((fundRow as any).master_daily_stop_usd),
        mode: String((fundRow as any).mode ?? "paper"),
        is_halted: !!(fundRow as any).is_halted,
      }
    : null;
  return { fund, channels };
}

export async function getOpenPositions(): Promise<PositionRow[]> {
  const { data } = await sb.from("positions").select("*").eq("status", "open");
  return ((data ?? []) as any[]).map((p) => ({
    id: p.id,
    strategist_id: p.strategist_id,
    occ_symbol: p.occ_symbol,
    opt_type: p.opt_type,
    qty: Number(p.qty),
    avg_entry_price: Number(p.avg_entry_price ?? 0),
    strike: Number(p.strike ?? 0),
    expiration: p.expiration ?? null,
    opened_at: p.opened_at ?? null,
    status: p.status,
  }));
}

// Today's realized P&L for a channel (for the Stop knob gate). closedAfterDate is
// the ET date string; we filter client-side like the cron worker.
export async function realizedTodayByChannel(strategistId: string, etDate: string): Promise<number> {
  const { data } = await sb
    .from("positions")
    .select("realized_pnl,closed_at")
    .eq("strategist_id", strategistId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(100);
  let sum = 0;
  for (const c of (data ?? []) as any[]) {
    if (c.closed_at && etDateOf(Date.parse(c.closed_at)) === etDate) sum += Number(c.realized_pnl ?? 0);
  }
  return sum;
}

// Peak option mid since `since` (for the power giveback trail). Read-only.
export async function peakMidSince(occ: string, since: string): Promise<number> {
  const { data } = await sb
    .from("option_quotes")
    .select("mid")
    .eq("occ_symbol", occ)
    .gte("captured_at", since)
    .order("mid", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number((data as any)?.mid ?? 0);
}

// Realtime KILL-switch / config subscription. Fires onChange on any fund_state /
// strategist_config / strategists mutation so a halt bites in <1s. If the
// realtime publication isn't enabled (06_realtime.sql optional), this no-ops and
// the index.ts poll fallback covers it.
export function subscribeConfig(onChange: () => void): void {
  sb.channel("seve-worker-config")
    .on("postgres_changes", { event: "*", schema: "public", table: "fund_state" }, () => { info("store: fund_state changed (realtime)"); onChange(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "strategist_config" }, () => { info("store: strategist_config changed (realtime)"); onChange(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "strategists" }, () => { info("store: strategists changed (realtime)"); onChange(); })
    .subscribe((status) => { if (status === "SUBSCRIBED") info("store: realtime config subscription active"); });
}

export async function writeShadowEvent(message: string, meta?: unknown): Promise<void> {
  if (!config.hasServiceRole || !config.shadowWriteEvents) return;
  try {
    await sb.from("events").insert({ level: "INFO", message: `stream-shadow: ${message}`, meta: meta ?? null });
  } catch { /* best-effort */ }
}

// ET date helper (duplicated tiny bit to avoid a cycle with alpaca.ts).
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
function etDateOf(ms: number): string { return ET_DATE.format(new Date(ms)); }
