// Compile a thesis .md → StrategySpec, server-side (keeps the LLM key off the
// client). Forces structured output via tool-use so we always get valid JSON.
// Needs ANTHROPIC_API_KEY in the env; without it, returns { needsKey:true } and
// the client falls back to a frontmatter-only preview.

import { NextResponse } from "next/server";
import { normalizeSpec, type StrategySpec } from "@/lib/desk/strategySpec";

export const dynamic = "force-dynamic";

const API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";  // current Sonnet (4-5 is now legacy)

// The StrategySpec shape, as a tool schema the model must fill (mirrors
// lib/desk/strategySpec.ts). Conditions use a fixed `kind` vocabulary.
const SPEC_TOOL = {
  name: "emit_spec",
  description: "Return the compiled StrategySpec for the strategy thesis.",
  input_schema: {
    type: "object",
    required: ["meta", "entries", "exits", "sizing"],
    properties: {
      meta: {
        type: "object",
        required: ["strategyId", "name", "instrument", "structure", "dteRange", "regime", "direction"],
        properties: {
          strategyId: { type: "string" }, name: { type: "string" }, instrument: { type: "string" },
          structure: { type: "string", enum: ["single-leg", "straddle", "strangle", "vertical-spread", "iron-condor"] },
          dteRange: { type: "array", items: { type: "number" } },
          regime: { type: "string" }, direction: { type: "string" }, sessionWindow: { type: "string" },
        },
      },
      entries: {
        type: "array",
        items: {
          type: "object",
          required: ["direction", "all", "reason"],
          properties: {
            direction: { type: "string", enum: ["call", "put", "both"] },
            reason: { type: "string" },
            atLeast: { type: "number", description: "Confluence: require ≥N of the `all` conditions to hold (e.g. '≥2 of N features'). Omit for strict AND." },
            all: {
              type: "array",
              description: "Conditions to enter (all must hold unless `atLeast` is set). Use these kinds: ma_cross{fast,slow,dir:up|down}, vwap_side{side:above|below}, vwap_dev{atr,cmp:>|<}, opening_range{minutes,side:break_above|break_below}, or_width_min{pct}, rel_vol{min}, rsi{period,cmp:>|<,value}, time_before{et}, time_between{startET,endET}, efficiency_ratio{op:>=|<=,value,lookback}, momentum_atr{op:>=|<=,value,lookback}, macd{fast,slow,signal,cmp:bull|bear}, level{ref:pdh|pdl|orb_hi|orb_lo,cmp:>|<|near,withinPct}, pin_bar{dir:up|down}, engulfing{dir:up|down}, strong_trend{dir:up|down}, stale_extreme{dir:up|down,sinceMin}, tick{cmp,value}, gamma_regime{require:POSITIVE|NEGATIVE|TRANSITION|NEGATIVE_OR_TRANSITION}, gamma_wall{wall}, iv_rank{cmp,value}, event_within{sessions}, unknown{note}.",
              items: { type: "object", required: ["kind"], properties: { kind: { type: "string" } }, additionalProperties: true },
            },
            anyOf: {
              type: "object",
              description: "Optional mandatory+confluence pool: the entry fires only if the `all` block holds AND ≥`atLeast` of these `of` conditions ALSO hold. Use for 'core gate + N confirmations' theses (e.g. 3 required gates in `all` + ≥1 of {macd, ma_cross, rel_vol} confirmations here). Same condition kinds as `all`. Omit if not needed.",
              properties: {
                atLeast: { type: "number" },
                of: { type: "array", items: { type: "object", required: ["kind"], properties: { kind: { type: "string" } }, additionalProperties: true } },
              },
            },
          },
        },
      },
      exits: {
        type: "array",
        items: { type: "object", properties: { profitPct: { type: "number" }, stopPct: { type: "number" }, timeET: { type: "string" }, note: { type: "string" } } },
      },
      sizing: { type: "object", properties: { riskPctOfAccount: { type: "number" }, note: { type: "string" } } },
      // OPTIONAL "smart" management block — only when the thesis defines R-based
      // risk / scale-outs / breakeven / trail / cost gate (e.g. a *-smart thesis).
      management: {
        type: "object",
        description: "Optional. Post-entry management (smart layer). Include ONLY if the thesis specifies it. Composes: risk{defineR:'premium_stop'|'atr', premiumStopPct, structuralStop?:{kind:'failed_break',insideAtr}|{kind:'atr_adverse',atr}}, scaleOut[]{atR,fraction,then:'move_stop_breakeven'|'engage_trail'|'none'}, trail{mode:'atr_chandelier'|'premium_giveback'|'hybrid', atrChandelier?{baseK,kMin,rTighten,timeTighten}, premiumGivebackPct?}, scaleIn{enabled,onlyAfterR,requireStopAtBreakeven,addFraction,forbidIfBelowEntryPremium}, target?{kind:'vwap_fraction',fraction}, timeStop{minutesHeld?,thetaTightenAfter?}, eodFlattenMinToClose, costGate{minMoveToCostRatio}.",
        properties: {
          risk: { type: "object" }, scaleOut: { type: "array", items: { type: "object" } },
          trail: { type: "object" }, scaleIn: { type: "object" }, target: { type: "object" },
          timeStop: { type: "object" }, eodFlattenMinToClose: { type: "number" }, costGate: { type: "object" },
        },
        additionalProperties: true,
      },
    },
  },
};

const SYSTEM = `You compile options trading-strategy theses (markdown) into a strict StrategySpec via the emit_spec tool.
Rules:
- Map every mechanical entry/exit rule to a condition. Use the EXACT kinds in the tool schema.
- Use the documented feed-dependent kinds where the thesis calls for them (tick, gamma_regime, gamma_wall, iv_rank, event_within) — do not invent supported substitutes; the desk flags them as gaps itself.
- Use efficiency_ratio / momentum_atr for ER and momentum gates, macd{fast,slow,signal,cmp} for MACD. For a "≥N of M confluence" rule, put the M conditions in \`all\` and set \`atLeast: N\`. For a "these MUST hold AND ≥k of {confirmations}" rule (core gate + confirmations), put the REQUIRED gates in \`all\` and the confirmation pool in \`anyOf:{atLeast:k, of:[...]}\`.
- entries[].all are ENTRY GATES ONLY (market state: price/indicator/volume/time). Post-entry rules — stops, scale-outs, breakeven, trailing, cost gate, EOD-flatten — are MANAGEMENT: put them in the \`management\` block. NEVER emit them as entry conditions and never emit \`unknown\` for a cost gate / stop / scale rule.
- structure: single-leg for one long call/put; straddle/vertical-spread/etc. for multi-leg.
- "Smart" theses (those with a Management section: R-based stops, scale-outs, breakeven ratchet, trail, cost gate) → fill the optional \`management\` block faithfully from that section. A plain thesis with no such section → OMIT management entirely.
- Be faithful to the thesis; do not add rules it doesn't state. Always call emit_spec exactly once.`;

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  let md = "";
  try { md = (await req.json())?.md ?? ""; } catch { /* */ }
  if (!md.trim()) return NextResponse.json({ error: "empty thesis" }, { status: 400 });
  if (!key) return NextResponse.json({ needsKey: true });

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        tools: [SPEC_TOOL],
        tool_choice: { type: "tool", name: "emit_spec" },
        // cache the static system + schema across compiles
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `Compile this thesis:\n\n${md.slice(0, 20000)}` }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ error: `anthropic ${res.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
    const j = await res.json();
    const toolUse = (j.content ?? []).find((b: { type: string }) => b.type === "tool_use");
    if (!toolUse) return NextResponse.json({ error: "no spec returned" }, { status: 502 });
    // Normalize before it leaves the server: coerce the LLM's common enum slips
    // (e.g. opening_range side "above" → "break_above") and downgrade malformed
    // conditions to `unknown`, so a bad compile flags as non-armable in the UI's
    // capability check instead of silently arming a rule the worker will misread.
    const { spec, repairs } = normalizeSpec(toolUse.input as StrategySpec);
    return NextResponse.json({ spec, repairs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
