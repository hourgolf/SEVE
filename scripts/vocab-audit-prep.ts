// vocab-audit-prep — author the test specs for the new-vocab applicability audit, write
// them to /tmp/vocab-audit/, and print a manifest. The workflow then backtests each
// 5-window faithful + adversarially verifies. Self-contained except pulling 2 baselines
// (V3, ORB) from the DB to build their candle-augmented variants.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const DIR = "/tmp/vocab-audit";
mkdirSync(DIR, { recursive: true });
const write = (name: string, spec: unknown) => { const p = `${DIR}/${name}.json`; writeFileSync(p, JSON.stringify(spec, null, 2)); return p; };
// deno-lint-ignore no-explicit-any
const meta = (id: string, name: string, regime: string): any => ({ strategyId: id, name, instrument: "SPY", structure: "single-leg", dteRange: [0, 0], regime, direction: "both" });

const manifest: Array<{ label: string; path: string; baseline?: string; note: string }> = [];

// ── ARCHETYPE 1: reversal-at-level (the desk has NO reversal channel) ──────────
// A bullish reversal candle at the OR-low (support) → call; bearish at OR-high → put.
manifest.push({ label: "arch:reversal-at-level", note: "candle reversal at OR boundary — net-new mean-reversion shape", path: write("reversal-at-level", {
  meta: meta("arch-reversal", "Reversal-at-level", "reversal"),
  entries: [
    { direction: "call", reason: "bounce", all: [{ kind: "level", ref: "orb_lo", cmp: "near", withinPct: 0.12 }, { kind: "time_between", startET: "10:00", endET: "15:25" }], anyOf: { atLeast: 1, of: [{ kind: "pin_bar", dir: "up" }, { kind: "engulfing", dir: "up" }, { kind: "strong_trend", dir: "up" }] } },
    { direction: "put", reason: "reject", all: [{ kind: "level", ref: "orb_hi", cmp: "near", withinPct: 0.12 }, { kind: "time_between", startET: "10:00", endET: "15:25" }], anyOf: { atLeast: 1, of: [{ kind: "pin_bar", dir: "down" }, { kind: "engulfing", dir: "down" }, { kind: "strong_trend", dir: "down" }] } },
  ],
  exits: [{ profitPct: 75, stopPct: 40, timeET: "15:25" }], sizing: {},
}) });

// ── ARCHETYPE 2: confluence-gated breakout (range_break + ≥2 confirmations) ─────
manifest.push({ label: "arch:confluence-breakout", note: "rolling-range break + >=2 of {macd-state, sma-cross, rel_vol, strong_trend}", path: write("confluence-breakout", {
  meta: meta("arch-confbrk", "Confluence breakout", "momentum"),
  entries: [
    { direction: "call", reason: "brk", all: [{ kind: "range_break", dir: "up" }, { kind: "time_before", et: "15:25" }], anyOf: { atLeast: 2, of: [{ kind: "macd", fast: 12, slow: 26, signal: 9, cmp: "bull", mode: "state" }, { kind: "sma_cross", dir: "up" }, { kind: "rel_vol", min: 1.3 }, { kind: "strong_trend", dir: "up" }] } },
    { direction: "put", reason: "brk", all: [{ kind: "range_break", dir: "down" }, { kind: "time_before", et: "15:25" }], anyOf: { atLeast: 2, of: [{ kind: "macd", fast: 12, slow: 26, signal: 9, cmp: "bear", mode: "state" }, { kind: "sma_cross", dir: "down" }, { kind: "rel_vol", min: 1.3 }, { kind: "strong_trend", dir: "down" }] } },
  ],
  exits: [{ profitPct: 100, stopPct: 50, timeET: "15:25" }], sizing: {},
}) });

// ── ARCHETYPE 3: candle-filtered ORB (quality gate on the base ORB break) ───────
manifest.push({ label: "arch:candle-filtered-orb", note: "ORB break ONLY when confirmed by a strong-trend candle + rel_vol", path: write("candle-filtered-orb", {
  meta: meta("arch-cforb", "Candle-filtered ORB", "momentum"),
  entries: [
    { direction: "call", reason: "orb", all: [{ kind: "opening_range", minutes: 30, side: "break_above" }, { kind: "strong_trend", dir: "up" }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
    { direction: "put", reason: "orb", all: [{ kind: "opening_range", minutes: 30, side: "break_below" }, { kind: "strong_trend", dir: "down" }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
  ],
  exits: [{ profitPct: 100, stopPct: 50, timeET: "15:25" }], sizing: {},
}) });

// ── AUGMENTATIONS of existing channels (require a candle confirmation) ──────────
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.from("strategists").select("slug,spec_json").in("slug", ["breakout-alt-v3", "orb-trend-rider"]);
  if (error) throw new Error(error.message);
  const specBy = new Map<string, any>((((data ?? []) as any[]).map((r) => [r.slug, r.spec_json])));

  // add a same-direction candle confirmation (anyOf >=1 of bullish/bearish shapes) to each entry
  const augment = (spec: any) => {
    const s = JSON.parse(JSON.stringify(spec));
    for (const e of s.entries ?? []) {
      const up = e.direction === "call";
      const shapes = up ? [{ kind: "pin_bar", dir: "up" }, { kind: "engulfing", dir: "up" }, { kind: "strong_trend", dir: "up" }]
        : [{ kind: "pin_bar", dir: "down" }, { kind: "engulfing", dir: "down" }, { kind: "strong_trend", dir: "down" }];
      e.anyOf = { atLeast: 1, of: shapes }; // require ANY same-dir quality candle
    }
    return s;
  };

  for (const [slug, label, base] of [["breakout-alt-v3", "augment:V3+candle (armed edge)", "V3-baseline"], ["orb-trend-rider", "augment:ORB+candle (benched)", "ORB-baseline"]] as const) {
    const sp = specBy.get(slug);
    if (!sp) { console.error(`⚠ no spec for ${slug}`); continue; }
    const bp = write(base, sp);
    const vp = write(`${base}-aug`, augment(sp));
    manifest.push({ label, path: vp, baseline: bp, note: `candle confirmation added to ${slug}; compare variant vs its own baseline` });
  }

  console.log(JSON.stringify(manifest, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
