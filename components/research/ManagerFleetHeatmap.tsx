"use client";

import "@/app/manager-evidence.css";
import type { ChannelManagerEvidenceBook, CommonManagerId } from "@/lib/research/channelManagerEvidence";
import { COMMON_MANAGER_ARMS } from "@/lib/research/channelManagerEvidence";

const shortManager = (manager: CommonManagerId): string => manager
  .replace("HALF-GIVEBACK", "HALF-GB")
  .replace("BELL/no-stop", "BELL/OPEN");
const signed = (value: number | null): string => value == null ? "—" : `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(0)}`;

export function ManagerFleetHeatmap({ book, channelSlugs = [], selectedSlug, onSelect }: {
  book?: ChannelManagerEvidenceBook | null;
  channelSlugs?: string[];
  selectedSlug?: string;
  onSelect?: (slug: string) => void;
}) {
  if (!book) return <section className="mfh empty" aria-label="Channel by manager evidence heatmap unavailable"><header><span><b>CHANNEL × MANAGER MAP</b><small>paired median return uplift</small></span><em>AUTHENTICATED HISTORY REQUIRED</em></header></section>;
  const rows = Object.values(book.channels).sort((left, right) => {
    const state = { ready: 2, preliminary: 1, collecting: 0 } as const;
    return state[right.state] - state[left.state] || right.sessions - left.sessions || left.slug.localeCompare(right.slug);
  });
  const missing = [...new Set(channelSlugs)].filter((slug) => !book.channels[slug]).sort();
  return <section className="mfh" aria-label="Channel by manager paired return heatmap">
    <header><span><b>CHANNEL × MANAGER MAP</b><small>median paired return delta · v2 only · opacity = terminal coverage</small></span><em>{rows.length + missing.length} CHANNELS · {book.sourceRows.managerRuns.toLocaleString()} RUNS</em></header>
    <div className="mfh-scroll"><div className="mfh-grid" style={{ ["--mfh-cols" as string]: COMMON_MANAGER_ARMS.length }}>
      <div className="mfh-corner">CHANNEL · EVIDENCE</div>{COMMON_MANAGER_ARMS.map((manager) => <div key={manager} className="mfh-col" title={manager}>{shortManager(manager)}</div>)}
      {rows.flatMap((channel) => [
        <button type="button" key={`${channel.slug}:label`} className={`mfh-channel${selectedSlug === channel.slug ? " selected" : ""}`} onClick={() => onSelect?.(channel.slug)}><b>{channel.slug}</b><em>{channel.sessions}s · {Math.round(channel.coverage * 100)}% · {channel.state}</em></button>,
        ...COMMON_MANAGER_ARMS.map((managerId) => {
          const manager = channel.managers.find((row) => row.managerId === managerId)!;
          return <button type="button" key={`${channel.slug}:${managerId}`} className={`mfh-cell ${manager.verdict}`} style={{ opacity: .3 + manager.coverage * .7 }} title={`${channel.slug} · ${managerId}\nmedian Δ ${signed(manager.medianDeltaPct)} percentage points\nmean Δ ${signed(manager.meanDeltaPct)} pp\n${manager.terminalPaths} terminal paths · ${manager.sessions} sessions · ${Math.round((manager.beatRate ?? 0) * 100)}% beat executed`} onClick={() => onSelect?.(channel.slug)}><b>{signed(manager.medianDeltaPct)}</b><small>{manager.terminalPaths}</small></button>;
        }),
      ])}
      {missing.flatMap((slug) => [
        <button type="button" key={`${slug}:label`} className={`mfh-channel${selectedSlug === slug ? " selected" : ""}`} onClick={() => onSelect?.(slug)}><b>{slug}</b><em>0s · exact backfill collecting</em></button>,
        ...COMMON_MANAGER_ARMS.map((managerId) => <button type="button" key={`${slug}:${managerId}`} className="mfh-cell collecting" title={`${slug} · ${managerId}\nNo durable filled-position pair. Historical exact replay remains a separately verified source.`} onClick={() => onSelect?.(slug)}><b>—</b><small>0</small></button>),
      ])}
    </div></div>
    <footer>GREEN = POSITIVE TYPICAL UPLIFT · RED = NEGATIVE · AMBER = MIXED · GRAY = COLLECTING · CELL NUMBER IS MEDIAN Δ RETURN PERCENTAGE POINTS, NOT TOTAL P&amp;L · EXACT NO-FILL REPLAYS ARE NEVER POOLED WITH FILLED-POSITION PAIRS</footer>
  </section>;
}
