// One-time read of the desk's CONFIG (strategists ⋈ strategist_config + the
// fund_state singleton) so the console controls reflect the real DB on load.
// Returns null on any error (e.g. RLS not applied) → caller falls back to seed.
//
// Channels render DYNAMICALLY: accent / sort_order / status come from the
// strategists row (added in 13_add_channel.sql) so custom compiled channels
// appear with no code change. If those columns don't exist yet (pre-migration),
// the select falls back to the legacy column set + the slug maps below.

import { getSupabase } from "@/lib/supabaseClient";
import { DEFAULT_CONFIG_BY_SLUG } from "@/lib/desk/seed";
import type { ChannelStatus, DeskState, PmColor, StrategistConfig, StrategistState } from "@/lib/desk/types";

import { PM_COLORS, PM_SET } from "@/lib/desk/colors";

// Legacy fallbacks (used only when the row lacks accent / sort_order — i.e. the
// DB predates 13_add_channel.sql). New channels carry their own columns.
const COLOR_BY_SLUG: Record<string, PmColor> = {
  fade: "green",
  breakout: "blue",
  power: "amber",
  grind: "cyan",
};
const ORDER = ["fade", "breakout", "power", "grind"];

const CONFIG_COLS =
  "strategist_config(capital_pct,aggression,max_contracts,daily_stop_usd,muted,soloed,boosted,underlying_stop_pct,event_policy,entry_dte,take_profit_pct,premium_stop_pct,pyramid_adds)";
const NEW_COLS = `id,slug,underlying,executor,account_id,name,mandate,regime,status,accent,sort_order,${CONFIG_COLS}`;
const NEW_COLS_NOUL = `id,slug,executor,account_id,name,mandate,regime,status,accent,sort_order,${CONFIG_COLS}`; // DB predates `underlying`
const LEGACY_COLS = `id,slug,name,mandate,regime,${CONFIG_COLS}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function normStatus(v: unknown): ChannelStatus {
  return v === "draft" || v === "disabled" ? v : "armed";
}

export async function loadDeskConfig(): Promise<DeskState | null> {
  try {
    const sb = getSupabase();

    // Try the dynamic-channel column set first; on error (columns missing —
    // pre-migration), retry with the legacy set so the desk keeps working.
    let stratRows: any[] | null = null;
    let hasNewCols = true;
    {
      // 3-tier: with `underlying` → without it (DB predates the column, accent/order
      // still preserved → no color regression) → legacy (pre-13_add_channel.sql).
      let res = await sb.from("strategists").select(NEW_COLS);
      if (res.error) res = await sb.from("strategists").select(NEW_COLS_NOUL);
      if (res.error) {
        hasNewCols = false;
        const legacy = await sb.from("strategists").select(LEGACY_COLS);
        if (legacy.error) return null;
        stratRows = legacy.data ?? [];
      } else {
        stratRows = res.data ?? [];
      }
    }

    const fundRes = await sb.from("fund_state").select("*").eq("id", 1).maybeSingle();
    if (fundRes.error || !fundRes.data) return null;

    const rows = stratRows ?? [];
    const strategists = rows
      .map((r, idx): StrategistState | null => {
        const cfg = Array.isArray(r.strategist_config) ? r.strategist_config[0] : r.strategist_config;
        if (!cfg) return null;
        const config = {
          capital_pct: Number(cfg.capital_pct),
          aggression: Number(cfg.aggression),
          max_contracts: Number(cfg.max_contracts),
          daily_stop_usd: Number(cfg.daily_stop_usd),
          muted: !!cfg.muted,
          boosted: !!cfg.boosted,
          soloed: !!cfg.soloed,
          // live attributes now editable from the strip (defaults keep old DBs working)
          underlying_stop_pct: cfg.underlying_stop_pct != null ? Number(cfg.underlying_stop_pct) : 0,
          event_policy: cfg.event_policy === "ignore" ? "ignore" : "standdown",
          entry_dte: cfg.entry_dte != null ? Number(cfg.entry_dte) : 0,
          take_profit_pct: cfg.take_profit_pct != null ? Number(cfg.take_profit_pct) : 0,
          premium_stop_pct: cfg.premium_stop_pct != null ? Number(cfg.premium_stop_pct) : null,
          pyramid_adds: cfg.pyramid_adds != null ? Number(cfg.pyramid_adds) : 0,
        } as StrategistConfig;
        // Accent: the row's token if valid → else the legacy slug map → else cycle
        // the palette by position (so an arbitrary new channel still gets a color).
        const color: PmColor =
          hasNewCols && typeof r.accent === "string" && PM_SET.has(r.accent)
            ? (r.accent as PmColor)
            : COLOR_BY_SLUG[r.slug] ?? PM_COLORS[idx % PM_COLORS.length];
        return {
          id: r.id,
          slug: r.slug,
          underlying: typeof r.underlying === "string" && r.underlying ? String(r.underlying).toUpperCase() : "SPY",
          name: r.name,
          mandate: r.mandate,
          regime: r.regime ?? "",
          color,
          status: hasNewCols ? normStatus(r.status) : "armed",
          executor: r.executor === "stream" ? "stream" : "cron",
          account_id: r.account_id ?? null,
          config,
          // sort key stashed for the sort below (kept off the public type).
          _sort: hasNewCols && r.sort_order != null ? Number(r.sort_order) : ORDER.indexOf(r.slug),
          defaults: DEFAULT_CONFIG_BY_SLUG[r.slug] ?? { ...config },
        } as StrategistState & { _sort: number };
      })
      .filter((s): s is StrategistState & { _sort: number } => s !== null)
      .filter((s) => s.status !== "disabled") // soft-deleted channels drop off the desk
      .sort((a, b) => {
        // sort_order asc; rows without one (-1 / 100) fall to the end, then name.
        const av = a._sort < 0 ? 999 : a._sort;
        const bv = b._sort < 0 ? 999 : b._sort;
        return av - bv || a.name.localeCompare(b.name);
      })
      .map(({ _sort, ...s }) => {
        void _sort;
        return s as StrategistState;
      });

    if (!strategists.length) return null;

    const f = fundRes.data as any;
    return {
      strategists,
      fund: {
        total_capital_usd: Number(f.total_capital_usd),
        master_daily_stop_usd: Number(f.master_daily_stop_usd),
        mode: f.mode,
        is_halted: !!f.is_halted,
        halted_reason: f.halted_reason ?? null,
        running: !f.is_halted,
      },
    };
  } catch {
    return null;
  }
}
