"use client";

import { useMemo, useState } from "react";
import "@/app/research-books.css";
import type { DecisionAtlasReportsRead } from "@/hooks/useDecisionAtlasReports";
import type { ChannelResearchAssignment, ChannelResearchBook } from "@/lib/research/channelResearchBooks";

const order: ChannelResearchBook[] = ["core", "experiment", "shadow", "archive"];
const copy: Record<ChannelResearchBook, { label: string; short: string }> = {
  core: { label: "PROVISIONAL CORE", short: "Controls to earn, not permanent favorites." },
  experiment: { label: "LIVE EXPERIMENTS", short: "One paper question at a time." },
  shadow: { label: "SHADOW", short: "Research assignment; runtime stays separate." },
  archive: { label: "ARCHIVE", short: "Paused until a useful question returns." },
};

function allAssignments(reports: DecisionAtlasReportsRead): Array<[string, ChannelResearchAssignment]> {
  return Object.entries(reports.bySlug)
    .flatMap(([slug, brief]) => brief.researchProgram ? [[slug, brief.researchProgram] as [string, ChannelResearchAssignment]] : [])
    .sort(([left], [right]) => left.localeCompare(right));
}

export function ChannelResearchProgramCard({ assignment, compact = false }: {
  assignment?: ChannelResearchAssignment;
  compact?: boolean;
}) {
  if (!assignment) return null;
  const progress = assignment.progress;
  const sessionProgress = Math.min(1, progress.independentSessions / progress.targetIndependentSessions);
  const opportunityProgress = Math.min(1, progress.logicalOpportunities / progress.targetLogicalOpportunities);
  return <details className={`research-program-card book-${assignment.book}${compact ? " compact" : ""}`}>
    <summary>
      <span><small>{assignment.bookLabel}</small><b>{assignment.headline}</b></span>
      <em>{progress.state === "ready_for_review" ? "REVIEW READY" : progress.state === "monitoring" ? "MONITOR" : `${progress.independentSessions}s / ${progress.logicalOpportunities}`}</em>
      <i>▾</i>
    </summary>
    <div>
      <p>{assignment.question}</p>
      <section className="research-program-progress" aria-label="Research evidence progress">
        <span><small>SESSIONS</small><b>{progress.independentSessions}/{progress.targetIndependentSessions}</b><i><u style={{ width: `${Math.round(sessionProgress * 100)}%` }} /></i></span>
        <span><small>OPPORTUNITIES</small><b>{progress.logicalOpportunities}/{progress.targetLogicalOpportunities}</b><i><u style={{ width: `${Math.round(opportunityProgress * 100)}%` }} /></i></span>
      </section>
      {assignment.challenger ? <section className="research-program-pair"><span><small>CONTROL</small><b>{assignment.control}</b></span><span><small>CHALLENGER</small><b>{assignment.challenger}</b></span></section> : null}
      <footer><small>NEXT DECISION</small><b>{assignment.nextDecision}</b><em>RESEARCH ONLY · NO RUNTIME AUTHORITY</em></footer>
    </div>
  </details>;
}

export function ResearchBookBoard({ reports, onSelect }: {
  reports: DecisionAtlasReportsRead;
  onSelect?: (slug: string) => void;
}) {
  const rows = useMemo(() => allAssignments(reports), [reports]);
  const summary = rows[0]?.[1].programSummary;
  const [selectedBook, setSelectedBook] = useState<ChannelResearchBook>("experiment");
  if (!rows.length || !summary) return null;
  const byBook: Record<ChannelResearchBook, Array<[string, ChannelResearchAssignment]>> = {
    core: rows.filter(([, row]) => row.book === "core"),
    experiment: rows.filter(([, row]) => row.book === "experiment"),
    shadow: rows.filter(([, row]) => row.book === "shadow"),
    archive: summary.archiveChannels.map((slug) => [slug, {
      book: "archive", bookLabel: "ARCHIVE", runtimePosture: "paused", headline: "Paused collector.",
      question: "Reopen only with a specific unanswered question.", control: "collection paused", challenger: null,
      keepFixed: [], progress: { independentSessions: 0, logicalOpportunities: 0, targetIndependentSessions: 5,
        targetLogicalOpportunities: 10, state: "building" }, nextDecision: "Remain paused.", metrics: [],
      operatorDecision: null, proposalOnly: true, runtimeAuthority: false,
    } satisfies ChannelResearchAssignment] as [string, ChannelResearchAssignment]),
  };
  const counts: Record<ChannelResearchBook, number> = {
    core: summary.provisionalCore,
    experiment: summary.liveExperiments,
    shadow: summary.shadowInvestigations,
    archive: summary.archivedCollectors,
  };
  const inbox = rows.filter(([, row]) => row.operatorDecision)
    .sort(([, left], [, right]) => (left.operatorDecision?.rank ?? 99) - (right.operatorDecision?.rank ?? 99))
    .slice(0, 3);
  return <section className="research-book-board" aria-label="Institutional channel research program">
    <header><span><small>RESEARCH PROGRAM</small><b>WHAT ARE WE DOING WITH EACH CHANNEL?</b></span><em className={summary.classificationComplete ? "" : "attention"}>{summary.classificationComplete ? `READ ONLY · THROUGH ${reports.throughSession ?? "—"}` : `ROSTER DRIFT · ${summary.auditMessage}`}</em></header>
    <nav aria-label="Channel research books">{order.map((book) => <button type="button" key={book} className={selectedBook === book ? "on" : ""} aria-pressed={selectedBook === book} onClick={() => setSelectedBook(book)}><b>{counts[book]}</b><span>{copy[book].label}</span><small>{copy[book].short}</small></button>)}</nav>
    <div className="research-book-current"><span><small>{copy[selectedBook].label}</small><b>{copy[selectedBook].short}</b></span><div>{byBook[selectedBook].map(([slug, row]) => <button type="button" key={slug} disabled={row.book === "archive"} onClick={() => onSelect?.(slug)}><b>{slug}</b><span>{row.book === "archive" ? "PAUSED" : row.runtimePosture.toUpperCase()}</span><small>{row.question}</small></button>)}</div></div>
    <details className="research-decision-inbox"><summary><span><small>OPERATOR INBOX</small><b>{inbox.length ? `${inbox.length} DECISIONS WORTH YOUR TIME` : "NO DECISION CLEARS THE GATE"}</b></span><em>MAXIMUM 3</em><i>▾</i></summary>{inbox.length ? <ol>{inbox.map(([slug, row]) => <li key={slug}><button type="button" onClick={() => onSelect?.(slug)}><span>{row.operatorDecision?.rank}</span><b>{slug}</b><em>{row.operatorDecision?.headline}</em></button></li>)}</ol> : <p>Keep collecting the frozen controls. Nothing needs an operator decision tonight.</p>}</details>
  </section>;
}
