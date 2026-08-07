import { signedUsd } from "@/lib/format";
import type {
  CurrentExecutedSummary,
  PairedCurrentComparison,
} from "@/lib/research/shadowResearch";

const money = (value: number | null): string => value == null ? "—" : signedUsd(value);

export function CurrentEvidenceCard({
  selectedSlug,
  executed,
  comparison,
  state,
  error,
  truncated,
  compact = false,
}: {
  selectedSlug: string;
  executed?: CurrentExecutedSummary;
  comparison?: PairedCurrentComparison;
  state: "ok" | "empty" | "error";
  error: string;
  truncated: boolean;
  compact?: boolean;
}) {
  if (state === "error") return <section className={`srw-current-evidence unavailable${compact ? " compact" : ""}`}>
    <header><span><small>CURRENT EXECUTED</small><b>COMPARISON UNAVAILABLE</b></span><em>READ FAILED</em></header>
    <p>{error || "Current execution evidence could not be read."}</p>
  </section>;
  if (!executed && !comparison) return <section className={`srw-current-evidence empty${compact ? " compact" : ""}`}>
    <header><span><small>CURRENT EXECUTED</small><b>{selectedSlug}</b></span><em>NO CURRENT SAMPLE</em></header>
    <p>This channel card contains historical virtual research only. No executed trade is being implied.</p>
  </section>;

  const current = comparison ? comparison.executedSlug : executed?.slug ?? selectedSlug;
  const currentSummary = comparison ? null : executed;
  const leader = comparison
    ? comparison.executedLeads === comparison.virtualLeads
      ? "Neither path"
      : comparison.executedLeads > comparison.virtualLeads ? comparison.executedSlug : comparison.virtualSlug
    : null;
  const through = comparison?.throughSession ?? currentSummary?.throughSession ?? "—";
  return <section className={`srw-current-evidence${compact ? " compact" : ""}`}>
    <header><span><small>{comparison ? "PAIRED CURRENT CHECK" : "CURRENT EXECUTED"}</small><b>{comparison ? `${comparison.executedSlug} ↔ ${comparison.virtualSlug}` : current}</b></span>
      <em>{comparison ? `${comparison.pairs} MATCHED CLOCKS` : `${currentSummary?.opportunities ?? 0} LOGICAL TRADES`}</em></header>
    {comparison ? <>
      <div className="srw-current-pair">
        <span><small>CURRENT EXECUTED</small><b>{comparison.executedSlug}</b><strong className={comparison.executedTypicalPerContract >= 0 ? "pos" : "neg"}>{money(comparison.executedTypicalPerContract)} typical/ct</strong><em>{money(comparison.executedTotalPerContract)} total/ct · {comparison.executedWins}/{comparison.pairs} positive</em></span>
        <span><small>SAME-CLOCK VIRTUAL</small><b>{comparison.virtualSlug}</b><strong className={comparison.virtualTypicalPerContract >= 0 ? "pos" : "neg"}>{money(comparison.virtualTypicalPerContract)} typical/ct</strong><em>{money(comparison.virtualTotalPerContract)} total/ct · {comparison.virtualWins}/{comparison.pairs} positive</em></span>
      </div>
      <footer><b>{leader} {comparison.executedLeads === comparison.virtualLeads ? "split" : "led"} {Math.max(comparison.executedLeads, comparison.virtualLeads)} of {comparison.pairs}</b><span>through {through} · {comparison.executedAccountIds.length} immutable routed account{comparison.executedAccountIds.length === 1 ? "" : "s"} · independent exits · virtual side is not a fill</span></footer>
    </> : <>
      <div className="srw-current-kpis">
        <span><small>TYPICAL RESULT</small><b className={(currentSummary?.typicalPerContract ?? 0) >= 0 ? "pos" : "neg"}>{money(currentSummary?.typicalPerContract ?? null)}/ct</b></span>
        <span><small>TOTAL RESULT</small><b className={(currentSummary?.totalPerContract ?? 0) >= 0 ? "pos" : "neg"}>{money(currentSummary?.totalPerContract ?? null)}/ct</b></span>
        <span><small>POSITIVE</small><b>{currentSummary?.winners ?? 0}/{currentSummary?.opportunities ?? 0}</b></span>
        <span><small>SESSIONS</small><b>{currentSummary?.sessions ?? 0}</b></span>
      </div>
      <footer><b>LATEST CONFIGURATION</b><span>through {through} · {currentSummary?.accountIds.length ?? 0} immutable routed account{currentSummary?.accountIds.length === 1 ? "" : "s"} · logical trades</span></footer>
    </>}
    {truncated ? <p>Current execution read reached its safety cap; comparison may be partial.</p> : null}
  </section>;
}
