// ============================================================================
//  StrategySpec — the compiled form of a thesis .md. A server-side LLM fills it
//  from the prose (app/api/compile-strategy); a capability check flags which
//  conditions the desk can actually execute today vs. those that need a data
//  feed / structure we don't ingest yet (GEX, NYSE TICK, event calendar,
//  multi-leg). The UI shows the gaps so a channel is never silently armed blind.
//  See docs/strategy-channels.md.
// ============================================================================

export type LegStructure =
  | "single-leg"
  | "straddle"
  | "strangle"
  | "vertical-spread"
  | "iron-condor";

export interface StrategyMeta {
  strategyId: string;
  name: string;
  instrument: string;
  structure: LegStructure;
  dteRange: [number, number];
  regime: string;
  direction: string;
  sessionWindow?: string;
}

// A condition over the indicator vocabulary. The `kind` either maps to a Feature
// the engine computes (supported) or an external input we don't have yet.
export type Condition =
  // ---- supported (engine/computeFeatures can evaluate these today) ----
  | { kind: "ma_cross"; fast: number; slow: number; dir: "up" | "down" }
  | { kind: "vwap_side"; side: "above" | "below" }
  | { kind: "vwap_dev"; atr: number; cmp: ">" | "<" }
  | { kind: "opening_range"; minutes: number; side: "break_above" | "break_below" }
  | { kind: "or_width_min"; pct: number }
  | { kind: "rel_vol"; min: number }
  | { kind: "rsi"; period: number; cmp: ">" | "<"; value: number }
  | { kind: "time_before"; et: string }
  | { kind: "time_between"; startET: string; endET: string }
  // ---- engine signals (computeFeatures / precomputed indicators) ----
  | { kind: "efficiency_ratio"; op: ">=" | "<="; value: number; lookback?: number }
  | { kind: "momentum_atr"; op: ">=" | "<="; value: number; lookback?: number } // (close − close[lookback]) / ATR
  | { kind: "macd"; fast: number; slow: number; signal: number; cmp: "bull" | "bear" } // bull = histogram > 0
  // ---- NOT yet supported (need a feed/infra we don't ingest) ----
  | { kind: "tick"; cmp: ">" | "<"; value: number } // NYSE TICK feed
  | { kind: "gamma_regime"; require: "POSITIVE" | "NEGATIVE" | "TRANSITION" | "NEGATIVE_OR_TRANSITION" } // GEX/dealer feed
  | { kind: "gamma_wall"; wall: "call" | "put"; note?: string } // GEX feed
  | { kind: "iv_rank"; cmp: "<" | ">"; value: number } // IV-rank history
  | { kind: "event_within"; sessions: number } // economic-event calendar
  | { kind: "unknown"; note: string };

// ---- Management block (smart layer, Brief Part 3b) — optional. Defines how a
// position is managed AFTER entry: R-based risk, scale-outs, breakeven ratchet,
// adaptive trail, pyramiding, cost gate. PR3 = schema + validation only; the
// runtime state machine that executes this lands in PR4. Specs without a
// `management` block behave exactly as before (legacy exits honored).
export type StructuralStop =
  | { kind: "failed_break"; insideAtr: number }
  | { kind: "atr_adverse"; atr: number };

export interface Management {
  risk: {
    defineR: "premium_stop" | "atr";
    premiumStopPct: number; // initial hard stop, % of entry premium
    structuralStop?: StructuralStop; // thesis-invalidation stop on the underlying
  };
  scaleOut?: Array<{
    atR: number; // trigger in R-multiples
    fraction: number; // portion of current position to close (0..1]
    then?: "move_stop_breakeven" | "engage_trail" | "none";
  }>;
  trail?: {
    mode: "atr_chandelier" | "premium_giveback" | "hybrid";
    atrChandelier?: { baseK: number; kMin: number; rTighten: number; timeTighten: number };
    premiumGivebackPct?: number; // never give back > X% of peak unrealized premium
  };
  scaleIn?: {
    enabled: boolean;
    onlyAfterR?: number;
    requireStopAtBreakeven?: boolean;
    addFraction?: number;
    forbidIfBelowEntryPremium: boolean; // MUST be true for single-leg long options
  };
  target?: { kind: "vwap_fraction"; fraction: number }; // e.g. exit at halfway-to-VWAP (fade-smart)
  timeStop?: { minutesHeld?: number; thetaTightenAfter?: string }; // "13:30" tightens trail/giveback
  eodFlattenMinToClose?: number;
  costGate?: { minMoveToCostRatio: number }; // veto if expectedPremiumMove < ratio × roundTripCost
}

export interface SpecEntry {
  direction: "call" | "put" | "both";
  all: Condition[]; // conditions to enter
  reason: string;
  // Confluence count: require AT LEAST N of the (supported) conditions to hold
  // instead of all of them (e.g. "≥2 of N features"). Omit → all must hold.
  atLeast?: number;
}

export interface StrategySpec {
  meta: StrategyMeta;
  entries: SpecEntry[];
  exits: { profitPct?: number; stopPct?: number; timeET?: string; note?: string }[];
  sizing: { riskPctOfAccount?: number; note?: string };
  management?: Management; // smart layer (optional); legacy specs omit it
}

// Condition kinds the engine/worker can evaluate live today.
const SUPPORTED_KINDS = new Set<Condition["kind"]>([
  "ma_cross", "vwap_side", "vwap_dev", "opening_range", "or_width_min",
  "rel_vol", "rsi", "time_before", "time_between",
  "efficiency_ratio", "momentum_atr", "macd",
]);
// Structures the (single-leg) worker can place today.
const SUPPORTED_STRUCTURES = new Set<LegStructure>(["single-leg"]);

// Friendly name for the gap so the UI can explain it.
const GAP_LABEL: Partial<Record<Condition["kind"], string>> = {
  tick: "NYSE TICK feed",
  gamma_regime: "GEX / dealer-gamma feed",
  gamma_wall: "GEX wall levels",
  iv_rank: "IV-rank history",
  event_within: "economic-event calendar",
  unknown: "unrecognized rule",
};

// Validate a management block (Brief Part 3c). Returns a list of precise errors
// (empty = valid). Structure-aware: single-leg long options may not average down.
export function validateManagement(m: Management | undefined, structure: LegStructure): string[] {
  const errs: string[] = [];
  if (!m) return errs;
  if (m.risk?.defineR === "premium_stop" && !(m.risk.premiumStopPct > 0))
    errs.push("risk.premiumStopPct must be > 0 when defineR is 'premium_stop'");
  if (m.scaleOut) {
    let sum = 0;
    m.scaleOut.forEach((s, i) => {
      if (!(s.fraction > 0 && s.fraction <= 1)) errs.push(`scaleOut[${i}].fraction must be in (0,1]`);
      if (!(s.atR > 0)) errs.push(`scaleOut[${i}].atR must be > 0`);
      sum += Number(s.fraction) || 0;
    });
    if (sum > 1 + 1e-9) errs.push(`scaleOut fractions sum to ${sum.toFixed(2)} (must be <= 1.0)`);
  }
  if (m.scaleIn?.enabled && structure === "single-leg" && m.scaleIn.forbidIfBelowEntryPremium !== true)
    errs.push("scaleIn.forbidIfBelowEntryPremium must be true for single-leg (never average down long premium)");
  if (m.trail) {
    const modes = ["atr_chandelier", "premium_giveback", "hybrid"];
    if (!modes.includes(m.trail.mode)) errs.push(`trail.mode '${m.trail.mode}' invalid (allowed: ${modes.join(" | ")})`);
    if ((m.trail.mode === "atr_chandelier" || m.trail.mode === "hybrid") && !m.trail.atrChandelier)
      errs.push("trail.atrChandelier required for mode atr_chandelier/hybrid");
    if ((m.trail.mode === "premium_giveback" || m.trail.mode === "hybrid") && m.trail.premiumGivebackPct == null)
      errs.push("trail.premiumGivebackPct required for mode premium_giveback/hybrid");
  }
  return errs;
}

export interface CapabilityReport {
  runnable: boolean; // can this be armed live on the supported subset?
  structureOk: boolean;
  unsupported: string[]; // human-readable gaps (data feeds / structure / pending runtime)
  isSmart: boolean; // has a management block
  managementErrors: string[]; // schema-validation errors on the management block
}

export function capabilityCheck(spec: StrategySpec): CapabilityReport {
  const gaps: string[] = [];
  const structureOk = SUPPORTED_STRUCTURES.has(spec.meta.structure);
  if (!structureOk) gaps.push(`${spec.meta.structure} orders (multi-leg not supported yet)`);
  for (const e of spec.entries ?? []) {
    for (const c of e.all ?? []) {
      if (!SUPPORTED_KINDS.has(c.kind)) gaps.push(GAP_LABEL[c.kind] ?? c.kind);
    }
  }
  // Management block: validate now; flag that the runtime executes in PR4.
  const isSmart = !!spec.management;
  const managementErrors = validateManagement(spec.management, spec.meta.structure);
  if (isSmart && managementErrors.length === 0) gaps.push("smart management (runs in backtest; live-worker execution pending)");

  const unsupported = [...new Set(gaps)];
  return {
    structureOk,
    unsupported,
    isSmart,
    managementErrors,
    runnable: unsupported.length === 0 && managementErrors.length === 0,
  };
}

// Dependency-free YAML-ish frontmatter parse — pulls the leading `--- ... ---`
// block into key/value strings for an instant channel preview before compile.
export function parseFrontmatter(md: string): Record<string, string> {
  const m = md.match(/^\s*---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
    if (key) out[key] = val;
  }
  return out;
}

// Structure → multi-leg? (used for the quick frontmatter-only capability hint)
export function structureSupported(structure: string): boolean {
  return SUPPORTED_STRUCTURES.has(structure as LegStructure);
}
