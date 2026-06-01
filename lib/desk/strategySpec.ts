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
  // ---- NOT yet supported (need a feed/infra we don't ingest) ----
  | { kind: "tick"; cmp: ">" | "<"; value: number } // NYSE TICK feed
  | { kind: "gamma_regime"; sign: "positive" | "negative" } // GEX/dealer feed
  | { kind: "gamma_wall"; wall: "call" | "put"; note?: string } // GEX feed
  | { kind: "iv_rank"; cmp: "<" | ">"; value: number } // IV-rank history
  | { kind: "event_within"; sessions: number } // economic-event calendar
  | { kind: "unknown"; note: string };

export interface SpecEntry {
  direction: "call" | "put" | "both";
  all: Condition[]; // ALL must hold to enter
  reason: string;
}

export interface StrategySpec {
  meta: StrategyMeta;
  entries: SpecEntry[];
  exits: { profitPct?: number; stopPct?: number; timeET?: string; note?: string }[];
  sizing: { riskPctOfAccount?: number; note?: string };
}

// Condition kinds the engine/worker can evaluate live today.
const SUPPORTED_KINDS = new Set<Condition["kind"]>([
  "ma_cross", "vwap_side", "vwap_dev", "opening_range", "or_width_min",
  "rel_vol", "rsi", "time_before", "time_between",
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

export interface CapabilityReport {
  runnable: boolean; // can this be armed live on the supported subset?
  structureOk: boolean;
  unsupported: string[]; // human-readable gaps (data feeds / structure)
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
  const unsupported = [...new Set(gaps)];
  return { structureOk, unsupported, runnable: unsupported.length === 0 };
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
