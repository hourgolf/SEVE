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
  // persistent TREND-ALIGNMENT state (every bar, unlike ma_cross's one-shot cross event): block
  // counter-trend entries. ref "ema9_21" = the EMA9>EMA21 ribbon (pb-ride's exact filter, default);
  // "ema21"/"ema50" = close vs that EMA. Computed EMA → faithful live (no vwap-bug dependency).
  | { kind: "trend_align"; side: "up" | "down"; ref?: "ema9_21" | "ema21" | "ema50" }
  | { kind: "vwap_dev"; atr: number; cmp: ">" | "<" }
  | { kind: "opening_range"; minutes: number; side: "break_above" | "break_below" }
  | { kind: "or_width_min"; pct: number }
  | { kind: "gap_min"; pct: number } // overnight gap regime: |open − priorClose|/priorClose ≥ pct% (gap = catalyst; flat-open = chop-prone). Magnitude only — gap direction is noise.
  | { kind: "rel_vol"; min: number }
  | { kind: "rsi"; period: number; cmp: ">" | "<"; value: number }
  | { kind: "time_before"; et: string }
  | { kind: "time_between"; startET: string; endET: string }
  // ---- engine signals (computeFeatures / precomputed indicators) ----
  | { kind: "efficiency_ratio"; op: ">=" | "<="; value: number; lookback?: number }
  | { kind: "momentum_atr"; op: ">=" | "<="; value: number; lookback?: number } // (close − close[lookback]) / ATR
  | { kind: "macd"; fast: number; slow: number; signal: number; cmp: "bull" | "bear"; mode?: "hist" | "state" } // hist (default) = histogram >/< 0; state = nakamoto macdState (sign±0.005 deadband + line-slope agree) OR fresh-cross ≤3 bars
  | { kind: "level"; ref: "pdh" | "pdl" | "orb_hi" | "orb_lo" | "custom"; cmp: ">" | "<" | "near"; withinPct?: number; withinDollars?: number } // price-level gate; near = within withinPct% (or withinDollars $ if set) of the level. ref "custom" = an injected level set (near-only; for backtest/replication head-to-heads)
  // ---- candle-shape conditions (engine/candle-shapes.ts; pure bar geometry) ----
  | { kind: "pin_bar"; dir: "up" | "down" } // rejection wick ≥2× body, body ≤33% range, close in upper/lower third
  | { kind: "engulfing"; dir: "up" | "down" } // current body fully covers prior body, colors reversed
  | { kind: "strong_trend"; dir: "up" | "down" } // body >65% range, close in top/bottom 20% (in dir)
  | { kind: "stale_extreme"; dir: "up" | "down"; sinceMin?: number } // ≥sinceMin (default 6) bars since session HOD(up)/LOD(down); needs ≥12 RTH bars
  | { kind: "curl"; dir: "up" | "down"; bars?: number } // N-bar (default 7) curl_up(up)/rollover_down(down): monotone lows/highs + range compressing + close past prior body
  | { kind: "range_break"; dir: "up" | "down"; bars?: number; maxWidthPct?: number; edgeMargin?: number } // break of a compressed rolling prior-N-bar (default 8) range — NOT the opening range
  | { kind: "sma_cross"; dir: "up" | "down"; fast?: number; slow?: number } // SMA(fast=20)/SMA(slow=120) state with $0.02 flat band (distinct from EMA ma_cross)
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

// One leg of a multi-leg structure (Brief: MULTI-LEG). Mirrors engine LegSpec
// (engine/types.ts) 1:1 so specEvaluate maps a SpecEntry's legs straight to
// intent.legs. Strikes are SIGNED $-offsets from the ATM strike at entry
// (0 = ATM, +n = n strikes above spot, −n = below), so the geometry is described
// once and resolved to real strikes live. `long` = bought (pays debit), `short`
// = sold (collects credit). The engine sizes a defined-risk structure off its
// MAX LOSS (width − net credit), not the debit, so credit spreads size correctly.
// A leg's strike is anchored to a structural LEVEL plus a signed $-offset. Default
// "atm" reproduces the plain ATM-relative offset; the others let a thesis sell/buy
// against the level the tape should respect (OR boundary, VWAP, prior-day H/L) —
// thesis #3's "edge multiplier." The anchor is resolved to an equivalent ATM
// offset at signal time in specEvaluate (where the level data lives), so the engine
// leg-resolution stays unchanged. orb_hi/orb_lo need the OR set (entry self-gates
// on it); pdh/pdl need the prior-day levels (passed to the evaluator).
export type LegAnchor = "atm" | "vwap" | "orb_hi" | "orb_lo" | "pdh" | "pdl";

export interface SpecLeg {
  optType: "call" | "put";
  side: "long" | "short";
  strikeOffset: number; // signed $-strikes from the anchor
  ratio?: number; // qty multiplier vs the structure size (default 1)
  anchor?: LegAnchor; // default "atm"
}

export interface SpecEntry {
  direction: "call" | "put" | "both";
  all: Condition[]; // conditions to enter
  reason: string;
  // Confluence count: require AT LEAST N of the (supported) `all` conditions to hold
  // instead of all of them (e.g. "≥2 of N features"). Omit → all must hold.
  atLeast?: number;
  // Mandatory + counted-optional confluence: the entry fires only if the `all` block
  // holds (strict AND, or ≥atLeast of it) AND ≥`anyOf.atLeast` of the `anyOf.of` pool
  // also hold. Expresses "core gate + N confirmations" — e.g. the nakamoto breakout
  // (3 required gates + ≥k of {macd, ma_cross, volume}). With an empty/absent `all`
  // it degrades to a pure "≥N of pool". Omit → no optional pool (legacy behavior).
  anyOf?: { atLeast: number; of: Condition[] };
  // Multi-leg geometry. Present (and used) only when meta.structure is not
  // "single-leg"; the entry then emits intent.legs instead of a single direction.
  // For single-leg structures this is ignored (direction drives the trade).
  legs?: SpecLeg[];
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
  "ma_cross", "vwap_side", "trend_align", "vwap_dev", "opening_range", "or_width_min", "gap_min",
  "rel_vol", "rsi", "time_before", "time_between",
  "efficiency_ratio", "momentum_atr", "macd", "level",
  "pin_bar", "engulfing", "strong_trend", "stale_extreme", "curl", "range_break", "sma_cross",
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

// Expected leg count per structure (single-leg carries none).
const LEG_COUNT: Partial<Record<LegStructure, number>> = {
  straddle: 2, strangle: 2, "vertical-spread": 2, "iron-condor": 4,
};

// Validate a multi-leg entry's geometry against its declared structure. Returns
// precise errors (empty = valid). The load-bearing check is DEFINED RISK: every
// SHORT leg must be covered by a LONG leg of the same type further out-of-the-
// money (a higher-offset long call / lower-offset long put), so max loss is
// bounded by the wing — the desk never sells naked premium. Offsets are signed
// $-strikes from ATM (engine/types.ts LegSpec convention).
export function validateLegs(structure: LegStructure, legs: SpecLeg[] | undefined): string[] {
  const errs: string[] = [];
  if (structure === "single-leg") return errs; // legs ignored for single-leg
  const want = LEG_COUNT[structure];
  if (!legs || !legs.length) return [`${structure} needs a legs[] geometry`];
  if (want != null && legs.length !== want) errs.push(`${structure} needs exactly ${want} legs (got ${legs.length})`);
  legs.forEach((l, i) => {
    if (l.optType !== "call" && l.optType !== "put") errs.push(`leg[${i}].optType must be call|put`);
    if (l.side !== "long" && l.side !== "short") errs.push(`leg[${i}].side must be long|short`);
    if (typeof l.strikeOffset !== "number" || !isFinite(l.strikeOffset)) errs.push(`leg[${i}].strikeOffset must be a finite number`);
    if (l.ratio != null && !(l.ratio > 0)) errs.push(`leg[${i}].ratio must be > 0`);
  });
  if (errs.length) return errs; // don't run the risk check on malformed legs
  // Straddle/strangle = all long (debit, bounded by premium). Verticals/condors
  // must define risk: each short leg covered by a further-OTM long of same type.
  if (structure === "straddle" || structure === "strangle") {
    if (legs.some((l) => l.side === "short")) errs.push(`${structure} legs must all be long (debit structure)`);
    const hasCall = legs.some((l) => l.optType === "call"), hasPut = legs.some((l) => l.optType === "put");
    if (!hasCall || !hasPut) errs.push(`${structure} needs one call and one put`);
    if (structure === "strangle") {
      const c = legs.find((l) => l.optType === "call"), p = legs.find((l) => l.optType === "put");
      if (c && p && !(c.strikeOffset > p.strikeOffset)) errs.push("strangle call must be above the put (call offset > put offset)");
    }
  } else {
    // Defined-risk coverage is only meaningful between legs on the SAME anchor
    // (offsets are relative to it) — so a short is covered by a further-OTM long
    // of the same optType AND anchor.
    const anc = (l: SpecLeg) => l.anchor ?? "atm";
    for (const s of legs.filter((l) => l.side === "short")) {
      const covered = legs.some(
        (l) => l.side === "long" && l.optType === s.optType && anc(l) === anc(s) &&
          (s.optType === "call" ? l.strikeOffset > s.strikeOffset : l.strikeOffset < s.strikeOffset)
      );
      if (!covered) errs.push(`short ${s.optType} at ${anc(s)}${s.strikeOffset >= 0 ? "+" : ""}${s.strikeOffset} is uncovered (no further-OTM long ${s.optType} on the same anchor) — undefined risk`);
    }
  }
  return errs;
}

// Every condition kind the compiler is allowed to emit (the Condition union).
const KNOWN_KINDS = new Set<string>([
  "ma_cross", "vwap_side", "trend_align", "vwap_dev", "opening_range", "or_width_min", "gap_min", "rel_vol",
  "rsi", "time_before", "time_between", "efficiency_ratio", "momentum_atr", "macd",
  "level", "pin_bar", "engulfing", "strong_trend", "stale_extreme", "curl", "range_break", "sma_cross",
  "tick", "gamma_regime", "gamma_wall", "iv_rank", "event_within", "unknown",
]);

// Normalize a freshly-compiled spec: coerce the enum slips the LLM commonly makes
// and downgrade any malformed / unrecognized condition to `unknown` — so a bad
// compile shows up as a NON-ARMABLE gap in capabilityCheck rather than silently
// arming a rule the engine/worker will misread (e.g. opening_range side "above",
// which both interpreters fall through to the OPPOSITE break). Returns the cleaned
// spec + a list of human-readable repairs for the UI to surface.
export function normalizeSpec(spec: StrategySpec): { spec: StrategySpec; repairs: string[] } {
  const repairs: string[] = [];
  const fixCond = (raw: unknown): Condition => {
    const c = raw as Record<string, unknown>;
    if (!c || typeof c !== "object" || typeof c.kind !== "string") {
      repairs.push("condition with no `kind` → unknown");
      return { kind: "unknown", note: "missing kind" };
    }
    if (c.kind === "opening_range") {
      const s = c.side;
      if (s === "above" || s === "up" || s === "break_high") { repairs.push(`opening_range.side "${s}" → "break_above"`); c.side = "break_above"; }
      else if (s === "below" || s === "down" || s === "break_low") { repairs.push(`opening_range.side "${s}" → "break_below"`); c.side = "break_below"; }
      if (c.side !== "break_above" && c.side !== "break_below") {
        repairs.push(`opening_range.side "${String(s)}" invalid → unknown`);
        return { kind: "unknown", note: `opening_range.side ${String(s)}` };
      }
    }
    if (!KNOWN_KINDS.has(c.kind)) {
      repairs.push(`unrecognized kind "${c.kind}" → unknown`);
      return { kind: "unknown", note: `unrecognized: ${c.kind}` };
    }
    return c as unknown as Condition;
  };
  const entries = (spec.entries ?? []).map((e) => ({
    ...e,
    all: (e.all ?? []).map(fixCond),
    // normalize the optional pool too, so a malformed condition in anyOf.of downgrades
    // to `unknown` (a flagged gap) rather than silently arming a misread rule.
    ...(e.anyOf ? { anyOf: { atLeast: e.anyOf.atLeast, of: (e.anyOf.of ?? []).map(fixCond) } } : {}),
  }));
  return { spec: { ...spec, entries }, repairs };
}

// The ARMABLE subset of management — what the LIVE worker can execute today:
// a premium hard-stop, a premium-giveback TRAIL, the cost gate, theta-tighten,
// EOD flatten. EXCLUDES the smart-layer tranching (scale-outs / scale-in /
// vwap-fraction target), which the real-fills A/B showed CAPS the convex tail
// (`smart-layer-real-fills-verdict.md`) → those stay backtest-only. A management
// block using ONLY the armable subset can be ARMED; one with tranching cannot.
export function isArmableManagement(m: Management | undefined): boolean {
  if (!m) return true; // no management → trivially armable
  if (m.scaleOut && m.scaleOut.length > 0) return false;
  if (m.scaleIn?.enabled) return false;
  if (m.target) return false; // vwap-fraction target = smart layer
  return true;
}

// The live TRAIL config, IF the block is armable and declares a trail. This is THE
// unlock: "ride the move, exit on giveback" — what harvests momentum's tail —
// expressed so the engine backtest and the live worker run it identically. Two modes:
//  • atrChandelierK — underlying ATR chandelier (exit when price retraces k·ATR from
//    the peak FAVORABLE underlying). Ignores premium noise → the right trail for 0DTE
//    momentum (this is what breakout's code does, k≈1.5). STATELESS (peak underlying
//    reconstructs from session bars), so the worker needs no new column.
//  • premiumGivebackPct — give back X% of PEAK premium GAIN. Simpler but noisy on 0DTE.
// atr_chandelier wins on the data; premium_giveback offered for non-0DTE theses.
export interface TrailConfig { atrChandelierK?: number; premiumGivebackPct?: number }
export function specTrail(m: Management | undefined): TrailConfig | undefined {
  if (!m || !isArmableManagement(m)) return undefined;
  const t = m.trail;
  if (!t) return undefined;
  const out: TrailConfig = {};
  if ((t.mode === "atr_chandelier" || t.mode === "hybrid") && t.atrChandelier && t.atrChandelier.baseK > 0)
    out.atrChandelierK = t.atrChandelier.baseK;
  if ((t.mode === "premium_giveback" || t.mode === "hybrid") && typeof t.premiumGivebackPct === "number" && t.premiumGivebackPct > 0)
    out.premiumGivebackPct = t.premiumGivebackPct;
  return out.atrChandelierK != null || out.premiumGivebackPct != null ? out : undefined;
}

export interface CapabilityReport {
  runnable: boolean; // can this be armed live on the supported subset?
  structureOk: boolean;
  unsupported: string[]; // human-readable gaps (data feeds / structure / pending runtime)
  isSmart: boolean; // has a management block
  managementErrors: string[]; // schema-validation errors on the management block
  legErrors: string[]; // geometry-validation errors on multi-leg entries (empty for single-leg)
}

export function capabilityCheck(spec: StrategySpec): CapabilityReport {
  const gaps: string[] = [];
  const structureOk = SUPPORTED_STRUCTURES.has(spec.meta.structure);
  if (!structureOk) gaps.push(`${spec.meta.structure} orders (multi-leg routing — backtest-only, not run live yet)`);
  for (const e of spec.entries ?? []) {
    for (const c of [...(e.all ?? []), ...(e.anyOf?.of ?? [])]) {
      if (!SUPPORTED_KINDS.has(c.kind)) gaps.push(GAP_LABEL[c.kind] ?? c.kind);
    }
    // A malformed optional pool (empty / non-positive count) is a capability gap.
    if (e.anyOf && (!(e.anyOf.atLeast >= 1) || !(e.anyOf.of?.length > 0)))
      gaps.push("anyOf confluence (needs atLeast ≥ 1 and a non-empty `of` pool)");
  }
  // Multi-leg geometry: validate every entry's legs against the declared structure
  // (defined-risk check). Surfaced so a malformed multi-leg spec shows a precise
  // geometry error, not just the blanket "not supported yet" gap.
  const legErrors: string[] = [];
  if (spec.meta.structure !== "single-leg") {
    (spec.entries ?? []).forEach((e, i) => {
      for (const err of validateLegs(spec.meta.structure, e.legs)) legErrors.push(`entry[${i}]: ${err}`);
    });
  }
  // Management block. The ARMABLE subset (premium stop + premium-giveback TRAIL +
  // cost gate + theta/EOD) runs live now — only the smart-layer TRANCHING
  // (scale-outs / scale-in / vwap-target) is backtest-only and blocks Arm.
  const isSmart = !!spec.management;
  const managementErrors = validateManagement(spec.management, spec.meta.structure);
  if (isSmart && managementErrors.length === 0 && !isArmableManagement(spec.management))
    gaps.push("smart management (scale-outs / scale-in / vwap-target) — backtest-only, not run live; keep only a premium-giveback trail + stop to arm the entries");

  const unsupported = [...new Set(gaps)];
  return {
    structureOk,
    unsupported,
    isSmart,
    managementErrors,
    legErrors,
    runnable: unsupported.length === 0 && managementErrors.length === 0 && legErrors.length === 0,
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

// Underlyings the desk has live data for. MUST stay in sync with market-ingest's
// UNDERLYINGS env (else a channel could arm for a ticker with no chain/bars). A
// thesis declares its market with `underlying: QQQ` in the frontmatter; an
// unsupported ticker is a capability gap (flagged like the data-feed gaps).
export const SUPPORTED_UNDERLYINGS = ["SPY", "QQQ"];

// Resolve a channel's underlying ticker: prefer the explicit `underlying:` key,
// else scan the `instrument:` string / compiled meta for a supported ticker,
// else default SPY. Always uppercased.
export function resolveUnderlying(fm: Record<string, string>, spec?: StrategySpec | null): string {
  const explicit = (fm.underlying || "").toUpperCase().trim();
  if (explicit) return explicit;
  const s = (fm.instrument || spec?.meta.instrument || "").toUpperCase();
  for (const t of SUPPORTED_UNDERLYINGS) if (s.includes(t)) return t;
  return "SPY";
}
