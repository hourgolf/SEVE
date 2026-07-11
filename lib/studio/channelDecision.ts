import type { Condition } from "@/lib/desk/strategySpec";
import type { Signal, StrategistState } from "@/lib/desk/types";

const BUILTIN_CONDITIONS: Record<string, string[]> = {
  breakout: ["OR30 ±0.5 ATR", "rel vol ≥1.3", "ER ≥0.35", "momentum ≥0.3 ATR", "flat by 15:25 ET"],
  "pb-ride": ["EMA9/21 ribbon", "prior stretch ≥2 ATR", "band tag ≤0.5 ATR", "with-trend bounce", "10:00–14:00 ET"],
};

const conditionLabel = (condition: Condition): string => {
  switch (condition.kind) {
    case "opening_range": return `OR${condition.minutes} ${condition.side === "break_above" ? "break ↑" : "break ↓"}`;
    case "vwap_side": return `VWAP ${condition.side}`;
    case "gap_min": return `|gap| ≥${condition.pct}%`;
    case "rel_vol": return `rel vol ≥${condition.min}`;
    case "efficiency_ratio": return `ER ${condition.op}${condition.value}`;
    case "momentum_atr": return `momentum ${condition.op}${Math.abs(condition.value)} ATR`;
    case "time_before": return `entries →${condition.et} ET`;
    case "time_between": return `${condition.startET}–${condition.endET} ET`;
    case "or_width_min": return `OR width ≥${condition.pct}%`;
    case "trend_align": return `trend ${condition.side}`;
    case "range_break": return `${condition.bars ?? 8}-bar range break`;
    case "strong_trend": return `strong trend ${condition.dir}`;
    case "macd_hist_align": return "MACD hist aligned";
    case "macd": return `MACD ${condition.cmp}`;
    case "vwap_dev": return `VWAP dev ${condition.cmp}${condition.atr} ATR`;
    default: return condition.kind.replaceAll("_", " ");
  }
};

export function channelDecisionConditions(channel: StrategistState): string[] {
  if (!channel.spec) {
    const base = channel.slug.replace(/-\d+$/, "").replace(/-itm$/i, "");
    return BUILTIN_CONDITIONS[base] ?? [];
  }
  const labels: string[] = [];
  for (const entry of channel.spec.entries) {
    for (const condition of entry.all) {
      const label = conditionLabel(condition);
      if (!labels.includes(label)) labels.push(label);
    }
  }
  return labels.slice(0, 7);
}

export function channelDecisionState(signal: Signal | null): { label: string; tone: "idle" | "held" | "fired" | "risk"; fact: string } {
  if (!signal) return { label: "IDLE", tone: "idle", fact: "no recent candidate in the desk feed" };
  if (signal.level === "RISK") return { label: "REVIEW", tone: "risk", fact: signal.message };
  if (signal.blocked_reason) return {
    label: "POLICY HELD",
    tone: "held",
    fact: `${signal.direction ? `${signal.direction.toUpperCase()} · ` : ""}${signal.blocked_reason.replaceAll("_", " ")}`,
  };
  if (signal.acted_on) return {
    label: "FIRED",
    tone: "fired",
    fact: `${signal.direction ? `${signal.direction.toUpperCase()} · ` : ""}${signal.signal_type}`,
  };
  return { label: "OBSERVED", tone: "idle", fact: signal.signal_type };
}

export function strikeLabel(offset = 0): string {
  if (!offset) return "ATM";
  return `${offset < 0 ? "ITM" : "OTM"} ${Math.abs(offset)}`;
}
