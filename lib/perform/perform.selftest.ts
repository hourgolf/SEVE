import { collapseEvents, derivePerformFocus, prioritizeChannels } from "./derivePerformView";
import { deriveMarketRisk, operationalMark } from "./deriveMarketWorkspace";
import { derivePositionsWorkspace, deriveRecentExits } from "./derivePositionsWorkspace";
import type { ChannelPnl, Position, StrategistState } from "@/lib/desk/types";
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

const openPosition = (overrides: Partial<Position> = {}): Position => ({
  id: "pos-1", strategist_slug: "open", occ_symbol: "QQQ260715C00718000", expiration: "2026-07-15",
  strike: 718, opt_type: "call", qty: 4, avg_entry_price: 1, current_mark: 1.2, unrealized_pnl: 80,
  status: "open", ...overrides,
});
check("market risk prefers a positive live mark", operationalMark(openPosition(), { QQQ260715C00718000: 1.5 }), 1.5);
check("market risk rejects an invalid live mark", operationalMark(openPosition(), { QQQ260715C00718000: 0 }), 1.2);
const marketRisk = deriveMarketRisk([openPosition()], [channel("open", "armed")], { QQQ260715C00718000: 1.5 });
check("market risk preserves contract ownership label", marketRisk.rows[0].contractLabel, "QQQ 718C ×4");
check("market risk uses marked quantity P&L", marketRisk.totalUnrealized, 200);

const secondOpen = openPosition({
  id: "pos-2", strategist_slug: "armed", qty: 2, avg_entry_price: 1.25, current_mark: 1.3,
});
const positionWorkspace = derivePositionsWorkspace(
  [openPosition(), secondOpen],
  [],
  { QQQ260715C00718000: 1.5 },
);
check("positions workspace totals absolute contracts", positionWorkspace.open.contracts, 6);
check("positions workspace marks every attributed row", positionWorkspace.open.unrealized, 250);
check("positions workspace exposes shared OCC concentration", [positionWorkspace.exposure.occCount, positionWorkspace.exposure.stackedOccCount], [1, 1]);

const closedTrade = openPosition({
  id: "closed-1", status: "closed", qty: 4, avg_entry_price: 1, current_mark: 1.5,
  realized_pnl: 200, peak_mark: 2, opened_at: "2026-07-15T14:30:00Z", closed_at: "2026-07-15T15:00:00Z",
  close_reason: "manual:target",
});
const exitSummary = deriveRecentExits([closedTrade]);
check("recent exit computes premium return", Math.round(exitSummary.rows[0].returnPct ?? 0), 50);
check("recent exit computes peak giveback", Math.round(exitSummary.rows[0].givebackPct ?? 0), 50);
check("recent exit computes peak capture", Math.round(exitSummary.rows[0].capturePct ?? 0), 50);
check("recent exit computes hold minutes", exitSummary.rows[0].holdMinutes, 30);
check("recent exit preserves realized attribution", [exitSummary.realized, exitSummary.wins, exitSummary.losses], [200, 1, 0]);
const incompletePeak = deriveRecentExits([{ ...closedTrade, current_mark: 2.1, peak_mark: 2 }]);
check("exit above recorded peak is flagged, not over-captured", [incompletePeak.rows[0].peakExceeded, incompletePeak.rows[0].capturePct], [true, null]);

console.log(`perform-selftest: ${passed}/${passed} passed`);
