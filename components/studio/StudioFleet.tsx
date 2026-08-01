"use client";

import { pmVar } from "@/lib/desk/colors";
import { signedUsd, usd0 } from "@/lib/format";
import type { StudioChannelRow, StudioFleetSummary, StudioSort } from "@/lib/studio/deriveStudioView";
import { channelDecisionState } from "@/lib/studio/channelDecision";
import type { ChannelWorkspaceModel } from "@/lib/channels/channelPassport";
import { ChannelCollectionCullPanel } from "@/components/studio/ChannelCollectionCullPanel";
import { CanaryCommandCenter } from "@/components/studio/CanaryCommandCenter";
import { useChannelRosterBundleControl } from "@/hooks/useChannelRosterBundleControl";
import type { ChannelControlPlaneViewRead } from "@/hooks/useChannelControlPlaneView";

const SORTS: { value: StudioSort; label: string }[] = [
  { value: "attention", label: "Attention" },
  { value: "pnl", label: "Day P&L" },
  { value: "risk", label: "Risk" },
  { value: "name", label: "Name" },
];

export type StudioScope = "attention" | "roots" | "dark" | "all";

export function StudioFleet({ rows, summary, selectedSlug, scope, sort, passports, controlPlane, onScope, onSort, onSelect }: {
  rows: StudioChannelRow[];
  summary: StudioFleetSummary;
  selectedSlug?: string;
  scope: StudioScope;
  sort: StudioSort;
  passports: ChannelWorkspaceModel;
  controlPlane?: ChannelControlPlaneViewRead;
  onScope: (scope: StudioScope) => void;
  onSort: (sort: StudioSort) => void;
  onSelect: (slug: string) => void;
}) {
  const roster = useChannelRosterBundleControl(controlPlane);
  const authorityRootSlugs = passports.release.state === "verified"
    ? passports.release.rootSlugs
    : [];
  const deskPaperSlugs = Object.values(passports.bySlug)
    .filter((passport) => passport.lifecycle === "paper-root")
    .map((passport) => passport.slug);
  const outsideDeskView = authorityRootSlugs.filter((slug) =>
    !deskPaperSlugs.includes(slug));
  return (
    <section className="fleet" aria-label="Strategy channel fleet">
      <div className={`fleet-release ${passports.release.state}`} role="status">
        <span title={passports.release.fact}><i /><b>{passports.release.state === "verified" ? "RUNTIME SEALED" : passports.releaseView.label}</b></span>
      </div>
      <CanaryCommandCenter controlPlane={controlPlane} bundles={roster.bundles} compact />
      <header className="fleet-summary">
        <div className="fleet-title">
          <span className="fleet-kicker">STUDIO · FLEET</span>
          <strong>{summary.attention ? `${summary.attention} need attention` : "fleet nominal"}</strong>
        </div>
        <div className="fleet-metrics" aria-label="Fleet summary">
          <span><small>ARMED</small><b>{summary.armed}</b></span>
          <span><small>MUTED</small><b>{summary.muted}</b></span>
          <span><small>BOOST</small><b>{summary.boosted}</b></span>
        </div>
      </header>

      <div className="fleet-tools">
        <div className="fleet-scope" role="group" aria-label="Channel scope">
          <button type="button" className={scope === "attention" ? "on" : ""} onClick={() => onScope("attention")}>ATTENTION <b>{summary.attention}</b></button>
          <button type="button" className={scope === "roots" ? "on" : ""} onClick={() => onScope("roots")}>PAPER IN VIEW <b>{passports.roots}</b></button>
          <button type="button" className={scope === "dark" ? "on" : ""} onClick={() => onScope("dark")}>OBSERVE IN VIEW <b>{passports.dark}</b></button>
          <button type="button" className={scope === "all" ? "on" : ""} onClick={() => onScope("all")}>DESK ROWS <b>{summary.total}</b></button>
        </div>
        <label className="fleet-sort">SORT
          <select value={sort} onChange={(event) => onSort(event.target.value as StudioSort)}>
            {SORTS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      {passports.release.state === "verified" && <details className="runtime-roster-map">
        <summary>
          <b>RECEIPT AUTHORITY</b>
          <em>{authorityRootSlugs.length} ROOTS</em>
          <i aria-hidden="true">▾</i>
        </summary>
        <div>
          <span><small>IMMUTABLE RECEIPT AUTHORITY</small><b>{authorityRootSlugs.join(" · ")}</b></span>
          <span><small>NOT PRESENT IN THE {summary.total}-ROW DESK VIEW</small><b>{outsideDeskView.length ? outsideDeskView.join(" · ") : "NONE"}</b></span>
          <p>The receipt list governs paper entry authority. The desk rows are a curated operating view; their counts must not be read as the full runtime roster.</p>
        </div>
      </details>}
      <ChannelCollectionCullPanel />

      <div className="fleet-table" role="table" aria-label={`${scope} strategy channels`}>
        <div className="fleet-grid fleet-head" role="row">
          <span role="columnheader">CHANNEL</span>
          <span role="columnheader">RECEIPT / DATABASE</span>
          <span role="columnheader">POSITION</span>
          <span className="fc-risk" role="columnheader">RISK / TRADE</span>
          <span className="fc-signal" role="columnheader">DECISION</span>
          <span className="fc-tune" role="columnheader">POSTURE / POLICY</span>
        </div>
        <div className="fleet-rows" role="rowgroup">
          {rows.map((row) => {
            const passport = passports.bySlug[row.channel.slug];
            const pnlClass = row.pnl.dayPnl < 0 ? "neg" : row.pnl.dayPnl > 0 ? "pos" : "";
            const decision = channelDecisionState(row.lastSignal);
            return (
              <button
                type="button"
                role="row"
                key={row.channel.slug}
                className={`fleet-grid fleet-row${selectedSlug === row.channel.slug ? " selected" : ""}`}
                style={{ ["--pm" as string]: pmVar(row.channel.color) }}
                onClick={() => onSelect(row.channel.slug)}
              >
                <span className="fleet-channel" role="cell"><i /><b>{row.channel.slug}</b><small>{row.channel.underlying}</small></span>
                <span className="fleet-runtime" role="cell">
                  <em className={`fleet-state ${passport?.effective.execution.posture ?? row.stateLabel.toLowerCase()}`}>{passport?.effective.execution.label ?? row.stateLabel}</em>
                  <small className={passport?.database.differsFromRuntime ? "diff" : ""}>DB {passport?.database.state ?? row.stateLabel} · {passport?.database.executor ?? row.channel.executor ?? "cron"}</small>
                </span>
                <span className="fleet-position" role="cell">
                  <b>{row.pnl.openCount ? `${row.pnl.openCount} · ${usd0(row.pnl.exposure)}` : "—"}</b>
                  <small className={pnlClass}>{row.pnl.dayPnl ? signedUsd(row.pnl.dayPnl) : "$0"} day</small>
                </span>
                <span className="fc-risk fleet-value" role="cell">{usd0(passport?.rootPolicy?.riskBudgetUsd ?? row.channel.config.capital_pct)}</span>
                <span className="fc-signal fleet-signal" role="cell" title={row.lastSignal?.message}>
                  <b className={decision.tone}>{decision.label}</b><small>{row.lastSignal?.signal_type ?? "no recent candidate"}</small>
                </span>
                <span className="fc-tune fleet-tags" role="cell">
                  {row.attentionReasons.length
                    ? row.attentionReasons.slice(0, 3).map((reason) => <i key={reason}>{reason}</i>)
                    : passport?.database.differsFromRuntime
                      ? <i className="runtime">runtime overlay differs</i>
                    : row.configDiffs.length
                      ? row.configDiffs.slice(0, 2).map((diff) => <i className="context" key={diff}>{diff}</i>)
                      : <span>nominal</span>}
                </span>
              </button>
            );
          })}
          {rows.length === 0 && (
            <div className="fleet-empty">
              <strong>NO {scope.toUpperCase()} CHANNELS</strong>
              <span>This account has no channels in the selected runtime scope.</span>
              <button type="button" onClick={() => onScope("all")}>SHOW ALL CHANNELS</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
