import { RESEARCH_AGENDA } from "@/lib/research/channelResearchAgenda";
export function ResearchAgenda({ onSelect }: { onSelect?: (slug: string) => void }) {
  return <section className="research-book-board" aria-label="Frozen forward research agenda">
    <header><span><small>PLANNED RESEARCH · {RESEARCH_AGENDA.version}</small><b>Native stops preserved; no roster or manager changes</b></span><em>Frozen {RESEARCH_AGENDA.frozenAt.slice(0,10)} · prospective from {RESEARCH_AGENDA.prospectiveFrom}</em></header>
    <p>{RESEARCH_AGENDA.firstReview}</p>
    <div className="research-book-current">{RESEARCH_AGENDA.studies.map(study => <div key={study.channels[0]} style={{ padding: 12 }}>
      <b>{study.question}</b><p>{study.fixed}</p>
      {study.channels.map(channel => <button type="button" key={channel} onClick={() => onSelect?.(channel)} disabled={!onSelect}>{channel}</button>)}
    </div>)}</div><p>{RESEARCH_AGENDA.exclusions}</p><small>{RESEARCH_AGENDA.owner} Forward collection progress is unverified here; historical counts do not fill the forward sample.</small>
  </section>;
}
