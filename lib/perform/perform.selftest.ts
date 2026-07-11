import { collapseEvents, derivePerformFocus, prioritizeChannels } from "./derivePerformView";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { MarketEvent } from "@/lib/types";

let passed = 0;
function check(label: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`${label}: got ${a}, want ${b}`);
  passed += 1;
}

check("flat normal keeps market hero", derivePerformFocus("normal", 0), "market");
check("open position promotes exposure", derivePerformFocus("warning", 1), "positions");
check("high incident pre-empts exposure", derivePerformFocus("high", 2), "incident");
check("critical incident pre-empts flat chart", derivePerformFocus("critical", 0), "incident");

const event = (id: string, message: string, level: MarketEvent["level"] = "EXEC"): MarketEvent => ({
  id, message, level, strategist_id: null, meta: null, created_at: `2026-07-11T00:00:0${id}Z`,
});
check("adjacent duplicate events collapse", collapseEvents([event("1", "boot"), event("2", "boot")]).map((e) => [e.id, e.count]), [["1", 2]]);
check("different levels stay distinct", collapseEvents([event("1", "boot"), event("2", "boot", "WARN")]).length, 2);
check("non-adjacent duplicates preserve chronology", collapseEvents([event("1", "boot"), event("2", "trade"), event("3", "boot")]).length, 3);

const channel = (slug: string, status: StrategistState["status"], muted = false, boosted = false) => ({
  id: slug, slug, name: slug, mandate: slug, regime: "test", underlying: "SPY", color: "green", status,
  config: { capital_pct: 100, daily_stop_usd: 100, max_contracts: 1, aggression: 1, muted, soloed: false, boosted },
  defaults: { capital_pct: 100, daily_stop_usd: 100, max_contracts: 1, aggression: 1, muted: false, soloed: false },
}) satisfies StrategistState;
const pnl = (openCount = 0, dayPnl = 0) => ({ openCount, dayPnl, exposure: 0, trades: 0, wins: 0, pkSum: 0, pkN: 0 }) as ChannelPnl;
const ranked = prioritizeChannels(
  [channel("armed", "armed"), channel("draft", "draft"), channel("open", "armed"), channel("muted", "armed", true)],
  { armed: pnl(), draft: pnl(), open: pnl(1), muted: pnl() },
);
check("dock orders exposure then exception then armed", ranked.visible.map((c) => c.slug), ["open", "muted", "armed"]);
check("dock folds inert drafts", ranked.inactive.map((c) => c.slug), ["draft"]);

console.log(`perform-selftest: ${passed}/${passed} passed`);
