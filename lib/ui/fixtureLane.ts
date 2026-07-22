import type { DeploymentTarget } from "../shell/presentation";

export type FixtureScenarioId = "flat" | "managed" | "incident";
export type FixtureTone = "green" | "amber" | "red" | "neutral";

export interface FixturePosition {
  id: string;
  channel: string;
  contract: string;
  quantity: number;
  entry: number;
  mark: number;
  peakPct: number;
  manager: string;
}

export interface FixtureChannel {
  slug: string;
  family: string;
  state: "armed" | "dark" | "muted";
  detail: string;
  tone: FixtureTone;
}

export interface FixtureScenario {
  id: FixtureScenarioId;
  label: string;
  clock: string;
  incident: { title: string; detail: string; tone: FixtureTone };
  nav: number;
  dayPnl: number;
  spot: number;
  positions: FixturePosition[];
  channels: FixtureChannel[];
  events: Array<{ at: string; level: string; message: string; tone: FixtureTone }>;
  researchEvidence: {
    state: "exact_pending" | "complete" | "partial";
    tone: FixtureTone;
    session: string;
    frozen: number;
    contracts: number;
    exact: number;
    arms: string;
    detail: string;
  };
}

/** The fixture lane is deliberately impossible to expose in production. */
export function fixtureLaneAvailable(target: DeploymentTarget): boolean {
  return target !== "production";
}

const channels: FixtureChannel[] = [
  { slug: "pb-ride", family: "pullback", state: "armed", detail: "2 ct · bank / runner", tone: "green" },
  { slug: "orb-ustop-ctl", family: "opening range", state: "armed", detail: "2 ct · managed", tone: "green" },
  { slug: "momo-shape", family: "momentum", state: "armed", detail: "2 ct · ratchet", tone: "amber" },
  { slug: "vb-ribbon-cross", family: "virtual bench", state: "dark", detail: "candidate only", tone: "neutral" },
];

export const FIXTURE_SCENARIOS: Readonly<Record<FixtureScenarioId, FixtureScenario>> = {
  flat: {
    id: "flat", label: "Flat / nominal", clock: "09:42 PT",
    incident: { title: "SYSTEM NOMINAL", detail: "process observed · broker reconciled", tone: "green" },
    nav: 986_420, dayPnl: 0, spot: 754.92, positions: [], channels,
    events: [
      { at: "09:41:58", level: "DATA", message: "SPY / QQQ / IWM market reads current", tone: "green" },
      { at: "09:40:12", level: "POLICY", message: "six-root RC5.3 roster verified", tone: "neutral" },
    ],
    researchEvidence: { state: "exact_pending", tone: "amber", session: "07-22", frozen: 0, contracts: 0, exact: 0, arms: "0/0", detail: "session open · candidates accrue before the T+1 exact gate" },
  },
  managed: {
    id: "managed", label: "Open / managed", clock: "11:18 PT",
    incident: { title: "POSITION MANAGED", detail: "2 open · manager observations current", tone: "green" },
    nav: 987_104, dayPnl: 684, spot: 756.31,
    positions: [
      { id: "p1", channel: "momo-shape", contract: "SPY 755P 0DTE", quantity: 2, entry: 1.42, mark: 2.31, peakPct: 76, manager: "ratchet armed" },
      { id: "p2", channel: "orb-qqq-trail", contract: "QQQ 718C 0DTE", quantity: 2, entry: 0.91, mark: 1.04, peakPct: 21, manager: "bank / runner" },
    ],
    channels,
    events: [
      { at: "11:17:59", level: "MANAGER", message: "momo-shape peak +76% · trail retained", tone: "amber" },
      { at: "11:15:02", level: "FILL", message: "orb-qqq-trail opened 2 contracts", tone: "green" },
      { at: "11:13:00", level: "CENSOR", message: "SPY sibling suppressed by family occupancy", tone: "neutral" },
    ],
    researchEvidence: { state: "exact_pending", tone: "amber", session: "07-22", frozen: 34, contracts: 11, exact: 0, arms: "0/272", detail: "candidate identities frozen · exact CBBO pending T+1" },
  },
  incident: {
    id: "incident", label: "Degraded reads", clock: "12:07 PT",
    incident: { title: "MARKET READ DEGRADED", detail: "release receipt timed out · last good evidence retained", tone: "amber" },
    nav: 985_870, dayPnl: -550, spot: 752.64,
    positions: [{ id: "p3", channel: "breakout-alt-v3-iwm", contract: "IWM 293P 0DTE", quantity: 2, entry: 0.64, mark: 0.51, peakPct: 12, manager: "risk reducing exits live" }],
    channels,
    events: [
      { at: "12:06:58", level: "OBS", message: "release receipt read timed out", tone: "amber" },
      { at: "12:06:45", level: "EXEC", message: "process heartbeat current", tone: "green" },
      { at: "12:06:31", level: "RISK", message: "new entries censored; exits remain available", tone: "red" },
    ],
    researchEvidence: { state: "partial", tone: "red", session: "07-21", frozen: 138, contracts: 34, exact: 132, arms: "1056/1104", detail: "6 exact paths censored · no policy inference authorized" },
  },
};
