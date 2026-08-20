"use client";

import "@/app/decision-atlas.css";
import type { ChannelLineupStory } from "@/lib/research/channelLineup";

const money = (value: number | null): string => value == null ? "—" : `${value >= 0 ? "+" : "−"}$${Math.abs(Math.round(value))}`;
const pct = (value: number | null): string => value == null ? "—" : `${Math.round(value * 100)}%`;

export function SessionDistributionStrip({ story, compact = false }: { story: ChannelLineupStory; compact?: boolean }) {
  const values = [story.weakSession, story.typicalSession, story.strongSession].filter((value): value is number => value != null);
  const extent = Math.max(1, ...values.map((value) => Math.abs(value)));
  const x = (value: number | null) => value == null ? 50 : 50 + Math.max(-1, Math.min(1, value / extent)) * 43;
  return <section className={`channel-session-strip${compact ? " compact" : ""}`} aria-label={`${story.channel} weak to strong independent-session distribution`}>
    <header><b>WEAK → TYPICAL → STRONG SESSION</b><span>{story.sessions} independent sessions</span></header>
    <svg viewBox="0 0 100 24" role="img" aria-label={`Weak ${money(story.weakSession)}, typical ${money(story.typicalSession)}, strong ${money(story.strongSession)} per contract`}>
      <line x1="5" x2="95" y1="12" y2="12" className="range" />
      <line x1="50" x2="50" y1="4" y2="20" className="zero" />
      {story.weakSession != null && story.strongSession != null && <line x1={x(story.weakSession)} x2={x(story.strongSession)} y1="12" y2="12" className="spread" />}
      {story.weakSession != null && <circle cx={x(story.weakSession)} cy="12" r="2.5" className="weak" />}
      {story.typicalSession != null && <circle cx={x(story.typicalSession)} cy="12" r="3.1" className="typical" />}
      {story.strongSession != null && <circle cx={x(story.strongSession)} cy="12" r="2.5" className="strong" />}
    </svg>
    <div><span><small>WEAK</small><b>{money(story.weakSession)}</b></span><span><small>TYPICAL</small><b>{money(story.typicalSession)}</b></span><span><small>STRONG</small><b>{money(story.strongSession)}</b></span></div>
  </section>;
}

export function ChannelEntryFinishMini({ story }: { story: ChannelLineupStory }) {
  const move = Math.max(0, story.typicalBestMovePct ?? 0);
  const finish = story.typicalFinalReturnPct ?? 0;
  const max = Math.max(10, move, Math.abs(finish));
  const x = 8 + move / max * 84;
  const y = 88 - ((finish + max) / (2 * max)) * 76;
  return <section className="channel-entry-finish-mini" aria-label={`${story.channel} entry to finish result`}>
    <header><b>ENTRY → FINISH</b><span>opportunity vs result</span></header>
    <svg viewBox="0 0 100 100" role="img" aria-label={`Typical best move ${Math.round(move)} percent; typical final return ${Math.round(finish)} percent; typical share kept ${pct(story.typicalCapture)}`}>
      <line x1="8" y1="88" x2="92" y2="12" className="perfect" />
      <line x1="8" y1="50" x2="92" y2="50" className="zero" />
      <line x1={x} y1={12 + (move / max) * 76} x2={x} y2={y} className="giveback" />
      <circle cx={x} cy={y} r="5" className="point" />
    </svg>
    <div><span><small>BEST MOVE</small><b>{Math.round(move)}%</b></span><span><small>MOVE KEPT</small><b>{pct(story.typicalCapture)}</b></span></div>
  </section>;
}
