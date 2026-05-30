// One-time read of the desk's CONFIG (strategists ⋈ strategist_config + the
// fund_state singleton) so the console controls reflect the real DB on load.
// Returns null on any error (e.g. RLS not applied) → caller falls back to seed.

import { getSupabase } from "@/lib/supabaseClient";
import type { DeskState, PmColor, StrategistState } from "@/lib/desk/types";

// Stable slug → accent + display order (matches the schema seed).
const COLOR_BY_SLUG: Record<string, PmColor> = {
  fade: "green",
  breakout: "blue",
  power: "amber",
  grind: "cyan",
};
const ORDER = ["fade", "breakout", "power", "grind"];

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadDeskConfig(): Promise<DeskState | null> {
  try {
    const sb = getSupabase();
    const [stratRes, fundRes] = await Promise.all([
      sb
        .from("strategists")
        .select(
          "id,slug,name,mandate,regime,color,strategist_config(capital_pct,aggression,max_contracts,daily_stop_usd,muted,soloed)"
        ),
      sb.from("fund_state").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (stratRes.error || fundRes.error || !fundRes.data) return null;

    const rows = (stratRes.data ?? []) as any[];
    const strategists = rows
      .map((r): StrategistState | null => {
        const cfg = Array.isArray(r.strategist_config)
          ? r.strategist_config[0]
          : r.strategist_config;
        if (!cfg) return null;
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          mandate: r.mandate,
          regime: r.regime ?? "",
          color: COLOR_BY_SLUG[r.slug] ?? "green",
          config: {
            capital_pct: Number(cfg.capital_pct),
            aggression: Number(cfg.aggression),
            max_contracts: Number(cfg.max_contracts),
            daily_stop_usd: Number(cfg.daily_stop_usd),
            muted: !!cfg.muted,
            soloed: !!cfg.soloed,
          },
        };
      })
      .filter((s): s is StrategistState => s !== null)
      .sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug));

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
