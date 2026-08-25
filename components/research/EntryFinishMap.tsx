"use client";

import "@/app/decision-atlas.css";
import type { ChannelLineupStory } from "@/lib/research/channelLineup";

export type ChannelPosture = "trading" | "observing" | "shadowing" | "researching" | "paused" | "retired" | "unverified";

export function EntryFinishMap({ stories, selectedSlug, postureBySlug = {}, scopeLabel = "COMPARABLE EVIDENCE", emptyMessage = "No mature best-move and finish pairs are available yet.", onSelect }: {
  stories: readonly ChannelLineupStory[];
  selectedSlug?: string;
  postureBySlug?: Readonly<Record<string, ChannelPosture>>;
  scopeLabel?: string;
  emptyMessage?: string;
  onSelect?: (slug: string) => void;
}) {
  const points = stories.filter((story) => story.typicalBestMovePct != null && story.typicalFinalReturnPct != null);
  const maxMove = Math.max(20, ...points.map((story) => Math.max(0, story.typicalBestMovePct ?? 0)));
  const finishes = points.map((story) => story.typicalFinalReturnPct ?? 0);
  const minFinish = Math.min(-20, ...finishes);
  const maxFinish = Math.max(20, maxMove, ...finishes);
  const x = (value: number) => 52 + Math.max(0, value) / maxMove * 616;
  const y = (value: number) => 224 - (value - minFinish) / (maxFinish - minFinish) * 188;
  return <section className="entry-finish-map" aria-label="Channel entry to finish map">
    <header><span><small>FLEET MAP · {scopeLabel}</small><b>ENTRY → FINISH</b></span><p>Right finds more opportunity. Higher keeps more of it. Select a channel to inspect.</p></header>
    {points.length ? <svg viewBox="0 0 700 260" role="img" aria-label={`${points.length} channels plotted by typical best move and typical final return`}>
      <line x1="52" y1={y(0)} x2="680" y2={y(0)} className="axis zero" />
      <line x1="52" y1="28" x2="52" y2="224" className="axis" />
      <line x1="52" y1="224" x2="680" y2="224" className="axis" />
      <line x1={x(0)} y1={y(0)} x2={x(maxMove)} y2={y(maxMove)} className="perfect" />
      <text x="58" y="20">TYPICAL FINAL RETURN ↑</text>
      <text x="532" y="250">TYPICAL BEST MOVE →</text>
      <text x="520" y={Math.max(20, y(maxMove) - 6)}>perfect capture</text>
      {points.map((story) => {
        const finish = story.typicalFinalReturnPct ?? 0;
        const mature = story.maturity === "DECISION READY";
        const radius = 4 + Math.min(10, Math.sqrt(story.sessions) * 1.6);
        const posture = postureBySlug[story.channel] ?? "observing";
        const postureLabel = posture === "trading" ? "trading"
          : posture === "observing" ? "observing"
            : posture;
        const selected = selectedSlug === story.channel;
        return <g key={story.channel} className={`map-point ${posture}${selectedSlug === story.channel ? " selected" : ""}${mature ? " mature" : " early"}`}
          role="button" tabIndex={0} aria-label={`${story.channel}: ${postureLabel}; ${story.group}; ${story.sessions} sessions`}
          onClick={() => onSelect?.(story.channel)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect?.(story.channel); }}>
          {selected && <circle className="selection-ring" cx={x(story.typicalBestMovePct ?? 0)} cy={y(finish)} r={radius + 4} />}
          <circle className="posture-dot" cx={x(story.typicalBestMovePct ?? 0)} cy={y(finish)} r={radius} />
          {(selected || points.length <= 3) && <text x={x(story.typicalBestMovePct ?? 0) + radius + 6} y={y(finish) + 3}>{story.channel}</text>}
        </g>;
      })}
    </svg> : <div className="atlas-empty">{emptyMessage}</div>}
    <footer><span><i className="trading" /> trading</span><span><i className="observing" /> observing</span><span><i className="unverified" /> unverified</span><em>Research book separately identifies shadowing, researching, and paused channels · bubble size = independent sessions</em></footer>
  </section>;
}
