// ============================================================================
//  Conviction sizing — the ONE lever that turns the desk's binary enter/skip +
//  flat RISK into setup-quality-weighted size. A SizingModel maps a per-entry
//  feature vector → a RISK multiplier (scalar); the backtest applies it via
//  riskGovernor's `convictionScalar`. Default (no model) = 1.0 everywhere →
//  byte-identical to flat-RISK. A rule/fitted model rides the SAME --options
//  quotes / benched-sim / montecarlo harness under the 5-window OOS bar BEFORE
//  the paper-lab, BEFORE the live trader.
//
//  FAIL-CLOSED by construction: a malformed spec, a NaN, or a thrown model all
//  resolve to scalar 1.0 (flat RISK) — never 0, never unbounded. The clamp
//  ([0.5, 2.0] default) bounds how far conviction can move size in either
//  direction, so a bad fit can't blow the position.
//
//  NOT wired to the live worker (engine/research only). Live arming is gated on
//  the paper-lab (cockpit P3) per the desk's "never arm on backtest alone" law.
// ============================================================================

import { readFileSync } from "node:fs";
import type { Features } from "./types";

export type SizingFeatures = Record<string, number>;

// Spec loaded from `--sizing-model json:<path>` (or inline JSON):
//   {kind:"rules",  default, rules:[{key, op, value, scalar}]}             — first matching rule wins (e.g. gap-magnitude #3)
//   {kind:"linear", intercept, terms:[{key, weight, mean?, sd?}], link?}   — z-scored linear fit (conviction-fit #4)
// Both clamp to [clampMin, clampMax] (default 0.5–2.0) at apply time.
export interface SizingSpec {
  kind: "rules" | "linear";
  clamp?: [number, number];
  // rules
  default?: number;
  rules?: { key: string; op: ">=" | ">" | "<=" | "<"; value: number; scalar: number }[];
  // linear
  intercept?: number;
  terms?: { key: string; weight: number; mean?: number; sd?: number }[];
  link?: "identity" | "logistic2x"; // logistic2x → (0,2), centered at 1.0 when the sum is 0
}

export interface BuiltSizingModel { raw: (f: SizingFeatures) => number; clamp: [number, number] }

const clampN = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function buildSizingModel(spec: SizingSpec | null): BuiltSizingModel | null {
  if (!spec) return null;
  const clamp: [number, number] = spec.clamp ?? [0.5, 2.0];
  if (spec.kind === "rules") {
    const def = spec.default ?? 1.0, rules = spec.rules ?? [];
    return {
      clamp,
      raw: (f) => {
        for (const r of rules) {
          const v = f[r.key];
          if (v == null || !Number.isFinite(v)) continue;
          const hit = r.op === ">=" ? v >= r.value : r.op === ">" ? v > r.value : r.op === "<=" ? v <= r.value : v < r.value;
          if (hit) return r.scalar;
        }
        return def;
      },
    };
  }
  // linear (z-scored): scalar = link(intercept + Σ weight·z), z = sd>0 ? (v−mean)/sd : v
  const intercept = spec.intercept ?? 1.0, terms = spec.terms ?? [];
  return {
    clamp,
    raw: (f) => {
      let s = intercept;
      for (const t of terms) {
        const v = f[t.key];
        if (v == null || !Number.isFinite(v)) continue;
        s += t.weight * (t.sd && t.sd > 0 ? (v - (t.mean ?? 0)) / t.sd : v);
      }
      return spec.link === "logistic2x" ? 2 / (1 + Math.exp(-s)) : s;
    },
  };
}

// Apply with the fail-closed clamp: malformed / NaN / throw → 1.0 (flat RISK).
export function scalarFor(built: BuiltSizingModel | null, f: SizingFeatures): number {
  if (!built) return 1.0;
  try {
    const s = built.raw(f);
    return Number.isFinite(s) ? clampN(s, built.clamp[0], built.clamp[1]) : 1.0;
  } catch {
    return 1.0;
  }
}

// Parse a `--sizing-model` arg: "static" | "" → no model; "json:<path>" or inline JSON → spec.
// Unparseable / wrong-kind → null (fail-closed: the run is flat-RISK, not crashed).
export function loadSizingSpec(arg: string): SizingSpec | null {
  if (!arg || arg === "static") return null;
  try {
    const raw = arg.startsWith("json:") ? readFileSync(arg.slice(5), "utf8") : arg;
    const spec = JSON.parse(raw) as SizingSpec;
    return spec && (spec.kind === "rules" || spec.kind === "linear") ? spec : null;
  } catch {
    return null;
  }
}

// The per-bar feature record the sizing model sees, from the engine Features. `gap` is
// session-level (not in Features) so the backtest injects it per session before applying.
export function featuresForSizing(f: Features): SizingFeatures {
  return { er: f.er, relVol: f.relVol, atr: f.atr, mom: f.mom, minute: f.minute, minutesToClose: f.minutesToClose, close: f.close };
}
