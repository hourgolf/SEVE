"use client";

import { useState } from "react";
import { FIXTURE_SCENARIOS, type FixtureScenarioId } from "@/lib/ui/fixtureLane";
import { EntryFinishMap } from "@/components/research/EntryFinishMap";
import { SessionDistributionStrip } from "@/components/research/ChannelDecisionVisuals";
import type { ChannelLineupStory } from "@/lib/research/channelLineup";

const usd = (value: number) => `${value < 0 ? "-" : "+"}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const lineupFixtures: ChannelLineupStory[] = [
  { version: "channel-lineup-v1", channel: "orb-ustop-ctl", group: "GOOD ENTRY · LEAKING EXIT", maturity: "DECISION READY", freshness: "CURRENT", sessions: 23, opportunities: 46, throughSession: "2026-08-19", typicalSession: 18, positiveSessions: 15, positiveSessionRate: .65, typicalBestMovePct: 24, typicalFinalReturnPct: -2, typicalCapture: -.08, weakSession: -61, strongSession: 104, why: "Entries find a useful move; the finish does not retain it.", next: "TEST EXIT" },
  { version: "channel-lineup-v1", channel: "breakout-alt-v3-itm", group: "WORKING CONSISTENTLY", maturity: "DECISION READY", freshness: "CURRENT", sessions: 12, opportunities: 20, throughSession: "2026-08-19", typicalSession: 31, positiveSessions: 8, positiveSessionRate: .67, typicalBestMovePct: 19, typicalFinalReturnPct: 11, typicalCapture: .58, weakSession: -24, strongSession: 89, why: "Typical sessions are positive and the exit retains the move.", next: "HOLD" },
  { version: "channel-lineup-v1", channel: "pb-ride-itm", group: "PROMISING BUT FRAGILE", maturity: "DECISION READY", freshness: "CURRENT", sessions: 18, opportunities: 104, throughSession: "2026-08-19", typicalSession: 14, positiveSessions: 11, positiveSessionRate: .61, typicalBestMovePct: 9, typicalFinalReturnPct: 3, typicalCapture: .33, weakSession: -172, strongSession: 96, why: "Frequent small gains remain exposed to a damaging weak-session tail.", next: "COLLECT" },
  { version: "channel-lineup-v1", channel: "grind", group: "TOO EARLY / STALE", maturity: "BUILDING", freshness: "STALE", sessions: 1, opportunities: 2, throughSession: "2026-08-03", typicalSession: 124, positiveSessions: 1, positiveSessionRate: 1, typicalBestMovePct: 228, typicalFinalReturnPct: 124, typicalCapture: .54, weakSession: 124, strongSession: 124, why: "Two old paths cannot lead a current decision.", next: "COLLECT" },
];

export function MarketHoursFixtureLab() {
  const [scenarioId, setScenarioId] = useState<FixtureScenarioId>("managed");
  const [skin, setSkin] = useState<"909" | "folio">("909");
  const scenario = FIXTURE_SCENARIOS[scenarioId];

  return (
    <div className="fixture-lab" data-skin={skin === "909" ? "blackout" : "folio"}>
      <header className="fixture-toolbar">
        <a href="/">← LIVE DESK</a>
        <div><b>MARKET-HOURS UI LAB</b><span>FIXTURE ONLY · ZERO LIVE READS · ZERO WRITES</span></div>
        <label>Scenario<select value={scenarioId} onChange={(event) => setScenarioId(event.target.value as FixtureScenarioId)}>{Object.values(FIXTURE_SCENARIOS).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <div className="fixture-skin"><button className={skin === "909" ? "on" : ""} onClick={() => setSkin("909")}>909</button><button className={skin === "folio" ? "on" : ""} onClick={() => setSkin("folio")}>FOLIO</button></div>
      </header>

      <main className="fixture-frame">
        <section className="fixture-head">
          <div className="fixture-brand"><strong>SEVE</strong><span>DESIGN WORKSTATION</span></div>
          <div className="fixture-status" data-tone={scenario.incident.tone}><i /><b>{scenario.incident.title}</b><span>{scenario.incident.detail}</span></div>
          <time>{scenario.clock}</time>
        </section>
        <section className="fixture-metrics">
          <article><span>NAV</span><b>${scenario.nav.toLocaleString()}</b></article>
          <article><span>DAY P&amp;L</span><b className={scenario.dayPnl < 0 ? "negative" : "positive"}>{usd(scenario.dayPnl)}</b></article>
          <article><span>SPY</span><b>{scenario.spot.toFixed(2)}</b></article>
          <article><span>OPEN</span><b>{scenario.positions.length}</b></article>
        </section>
        <section className="fixture-workspace">
          <div className="fixture-market">
            <header><span>SPY · INTRADAY</span><em>STATIC REPRESENTATIVE PATH</em></header>
            <svg viewBox="0 0 800 300" role="img" aria-label="Fixture intraday chart">
              <defs><linearGradient id="fixtureFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".28"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
              <path className="grid" d="M0 60H800M0 120H800M0 180H800M0 240H800M100 0V300M200 0V300M300 0V300M400 0V300M500 0V300M600 0V300M700 0V300" />
              <path className="area" d="M0 248 L55 226 L105 235 L160 184 L215 202 L270 142 L330 158 L390 111 L455 124 L520 76 L585 94 L650 54 L720 70 L800 31 L800 300 L0 300Z" />
              <path className="line" d="M0 248 L55 226 L105 235 L160 184 L215 202 L270 142 L330 158 L390 111 L455 124 L520 76 L585 94 L650 54 L720 70 L800 31" />
            </svg>
          </div>
          <aside className="fixture-book">
            <header><span>OPEN POSITIONS</span><b>{scenario.positions.length}</b></header>
            {scenario.positions.length === 0 ? <p>FLAT — NO OPEN POSITIONS</p> : scenario.positions.map((position) => <article key={position.id}>
              <div><b>{position.channel}</b><span>{position.contract}</span></div>
              <strong className={position.mark >= position.entry ? "positive" : "negative"}>{usd((position.mark - position.entry) * position.quantity * 100)}</strong>
              <footer><span>{position.quantity} ct · {position.entry.toFixed(2)} → {position.mark.toFixed(2)}</span><em>best move {position.peakPct}% · {position.manager}</em></footer>
            </article>)}
          </aside>
          <section className="fixture-channels"><header><span>CHANNELS</span><b>{scenario.channels.length} representative</b></header>{scenario.channels.map((channel) => <article key={channel.slug} data-tone={channel.tone}><i /><div><b>{channel.slug}</b><span>{channel.family}</span></div><em>{channel.state}</em><small>{channel.detail}</small></article>)}</section>
          <section className="fixture-events"><header><span>EVENT TAPE</span><b>FIXTURE</b></header>{scenario.events.map((event) => <article key={`${event.at}-${event.message}`} data-tone={event.tone}><time>{event.at}</time><b>{event.level}</b><span>{event.message}</span></article>)}</section>
          <section className="fixture-research" data-tone={scenario.researchEvidence.tone}>
            <header><span>DARK / VB EVIDENCE</span><b>{scenario.researchEvidence.session} · {scenario.researchEvidence.state.replace("_", " ")}</b></header>
            <div><article><span>FROZEN</span><b>{scenario.researchEvidence.frozen}</b></article><article><span>CONTRACTS</span><b>{scenario.researchEvidence.contracts}</b></article><article><span>EXACT</span><b>{scenario.researchEvidence.exact}</b></article><article><span>MANAGER ARMS</span><b>{scenario.researchEvidence.arms}</b></article></div>
            <p>{scenario.researchEvidence.detail}</p>
          </section>
          <section id="decision-clarity" className="fixture-decision-clarity">
            <header><span>DIRTY DASHBOARD · DECISION CLARITY</span><b>FIXTURE · NO LIVE READS</b></header>
            <EntryFinishMap stories={lineupFixtures} selectedSlug="orb-ustop-ctl" postureBySlug={{ "orb-ustop-ctl": "trading", "breakout-alt-v3-itm": "trading", "pb-ride-itm": "observing", grind: "retired" }} />
            <div className="fixture-lineup-states">
              {lineupFixtures.map((story) => <article key={story.channel}><small>{story.group}</small><b>{story.channel}</b><span>{story.sessions}s / {story.opportunities} logical opportunities · through {story.throughSession}</span><p>{story.why}</p></article>)}
            </div>
            <SessionDistributionStrip story={lineupFixtures[2]} />
            <footer><span>CURRENT SETTINGS · 1s / 2</span><span>COMPARABLE EVIDENCE · 23s / 46</span><span>ALL CHANNEL HISTORY · 28s / 83</span></footer>
          </section>
        </section>
      </main>
    </div>
  );
}
