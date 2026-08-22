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
import type { ChannelDecisionBrief } from "@/lib/research/channelDecisionBrief";
import { SeveEvidenceContext } from "@/components/ui/Seve909";
import { resolveChannelRuntimeAuthority } from "@/lib/studio/channelRuntimeAuthority";

const SORTS: { value: StudioSort; label: string }[] = [
  { value: "attention", label: "Attention" },
  { value: "pnl", label: "Session attribution" },
  { value: "risk", label: "Risk" },
  { value: "name", label: "Name" },
];

export type StudioScope = "attention" | "roots" | "dark" | "all";

export function StudioFleet({ rows, summary, runtimeCounts, accountId, selectedSlug, scope, sort, passports, controlPlane, decisions, accountName, evidenceAsOf, onScope, onSort, onSelect, onCurrentSession, onNextReview }: {
  rows: StudioChannelRow[];
  summary: StudioFleetSummary;
  runtimeCounts: { roots: number; dark: number };
  accountId: string | null;
  selectedSlug?: string;
  scope: StudioScope;
  sort: StudioSort;
  passports: ChannelWorkspaceModel;
  controlPlane?: ChannelControlPlaneViewRead;
  decisions: Record<string, ChannelDecisionBrief>;
  accountName: string;
  evidenceAsOf: string;
  onScope: (scope: StudioScope) => void;
  onSort: (sort: StudioSort) => void;
  onSelect: (slug: string) => void;
  onCurrentSession?: (slug: string) => void;
  onNextReview?: (slug: string) => void;
}) {
  const roster = useChannelRosterBundleControl(controlPlane);
  const currentManifest = controlPlane?.view?.state === "receipt-bound"
    ? controlPlane.view
    : null;
  const authorityRootSlugs = currentManifest
    ? currentManifest.specs.filter((spec) => spec.executionPosture === "paper").map((spec) => spec.slug)
    : passports.release.state === "verified" ? passports.release.rootSlugs : [];
  const deskPaperSlugs = Object.values(passports.bySlug)
    .filter((passport) => resolveChannelRuntimeAuthority(passport.slug, passport, controlPlane?.view, accountId).scope === "roots")
    .map((passport) => passport.slug);
  const outsideDeskView = authorityRootSlugs.filter((slug) =>
    !deskPaperSlugs.includes(slug));
  return (
    <section className="fleet" aria-label="Strategy channel fleet">
      <div className={`fleet-release ${passports.release.state}`} role="status">
        <span title={passports.release.fact}><i /><b>{passports.release.state === "verified" ? "RUNTIME SEALED" : passports.releaseView.label}</b></span>
      </div>
      <CanaryCommandCenter controlPlane={controlPlane} bundles={roster.bundles} compact />
      <SeveEvidenceContext kind="mixed" scope={accountName} asOf={evidenceAsOf} era="current runtime + latest nightly research" sample={`${summary.total} channels in view`} quality="live" detail="Current session results and nightly channel research remain visibly separate." />
      <header className="fleet-summary">
        <div className="fleet-title">
          <span className="fleet-kicker">STUDIO · FLEET</span>
          <strong>{summary.attention ? `${summary.attention} need attention` : "fleet nominal"}</strong>
        </div>
      </header>

      <div className="fleet-tools">
        <div className="fleet-scope" role="group" aria-label="Channel scope">
          <button type="button" className={scope === "attention" ? "on" : ""} onClick={() => onScope("attention")}>ATTENTION <b>{summary.attention}</b></button>
          <button type="button" className={scope === "roots" ? "on" : ""} onClick={() => onScope("roots")}>TRADING IN VIEW <b>{runtimeCounts.roots}</b></button>
          <button type="button" className={scope === "dark" ? "on" : ""} onClick={() => onScope("dark")}>NOT TRADING IN VIEW <b>{runtimeCounts.dark}</b></button>
          <button type="button" className={scope === "all" ? "on" : ""} onClick={() => onScope("all")}>ALL IN VIEW <b>{summary.total}</b></button>
        </div>
        <label className="fleet-sort">SORT
          <select value={sort} onChange={(event) => onSort(event.target.value as StudioSort)}>
            {SORTS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      {(currentManifest || passports.release.state === "verified") && <details className="runtime-roster-map">
        <summary>
          <b>CURRENT ENTRY AUTHORITY</b>
          <small title={currentManifest?.manifestContentHash ?? passports.release.receipt?.configHash ?? passports.release.expectedHash}>ROSTER {(currentManifest?.manifestContentHash ?? passports.releaseView.shortHash)?.replace(/^sha256:/, "").slice(0, 8)}</small>
          <em>{authorityRootSlugs.length} TRADING ROOTS</em>
          <i aria-hidden="true">▾</i>
        </summary>
        <div>
          <span><small>CHANNELS ALLOWED TO OPEN PAPER TRADES</small><b>{authorityRootSlugs.join(" · ")}</b></span>
          <span><small>TRADING ROOTS OUTSIDE THIS {summary.total}-ROW VIEW</small><b>{outsideDeskView.length ? outsideDeskView.join(" · ") : "NONE"}</b></span>
          <p>This receipt-bound roster is the current authority. Trading channels may open paper positions. Observing channels collect research only; channels absent from the roster do neither. Saved labels are supporting context.</p>
        </div>
      </details>}
      <ChannelCollectionCullPanel />

      <div className="fleet-table" role="table" aria-label={`${scope} strategy channels`}>
        <div className="fleet-grid fleet-head" role="row">
          <span role="columnheader">CHANNEL</span>
          <span role="columnheader">STATE</span>
          <span role="columnheader">WHY THIS STATE</span>
          <span role="columnheader">CURRENT SESSION</span>
          <span role="columnheader">NEXT REVIEW</span>
        </div>
        <div className="fleet-rows" role="rowgroup">
          {rows.map((row) => {
            const passport = passports.bySlug[row.channel.slug];
            const authority = resolveChannelRuntimeAuthority(row.channel.slug, passport, controlPlane?.view, accountId);
            const pnlClass = row.pnl.dayPnl < 0 ? "neg" : row.pnl.dayPnl > 0 ? "pos" : "";
            const decision = channelDecisionState(row.lastSignal);
            const brief = decisions[row.channel.slug];
            const liveMode = authority.label;
            const liveModeDetail = authority.spec?.executionPosture === "paper"
              ? `${authority.spec.quantity} CT`
              : authority.posture === "observing" ? "RESEARCH ONLY" : authority.posture === "trading-elsewhere" ? authority.spec?.accountLabel : authority.posture === "not-trading" ? "NO AUTHORITY" : null;
            const receiptSettingsActive = authority.posture === "trading"
              && Boolean(passport?.database.differsFromRuntime);
            const reasonLabel = row.attentionReasons[0]
              ?? (authority.posture === "trading-elsewhere" ? `Trades in ${authority.spec?.accountLabel}` : authority.posture === "not-trading" ? "Not in current live roster" : receiptSettingsActive ? "Live settings active" : passport?.database.differsFromRuntime ? "Saved settings differ" : decision.label === "IDLE" ? "Ready" : decision.label);
            const reasonDetail = receiptSettingsActive
              ? "Collecting clean evidence"
              : authority.posture === "observing"
              ? "Collecting only"
              : authority.posture === "not-trading"
                ? "Saved channel context only"
              : authority.posture === "trading-elsewhere"
                ? "No entry authority in this account"
              : row.lastSignal?.signal_type?.replaceAll("_", " ") ?? null;
            return (
              <div
                role="row"
                key={row.channel.slug}
                data-channel-row={row.channel.slug}
                className={`fleet-grid fleet-row${selectedSlug === row.channel.slug ? " selected" : ""}`}
                style={{ ["--pm" as string]: pmVar(row.channel.color) }}
              >
                <button type="button" className="fleet-channel fleet-cell-link" role="cell" onClick={() => onSelect(row.channel.slug)} aria-expanded={selectedSlug === row.channel.slug}><i /><b>{row.channel.slug}</b><small>{row.channel.underlying}</small></button>
                <span className="fleet-runtime" role="cell">
                  <em className={`fleet-state ${authority.posture}`}>{liveMode}</em>
                  {liveModeDetail && <small>{liveModeDetail}</small>}
                </span>
                <span className="fleet-reason" role="cell">
                  <b>{reasonLabel}</b>
                  {reasonDetail && <small>{reasonDetail}</small>}
                </span>
                <button type="button" className="fleet-position fleet-cell-link" role="cell" onClick={() => onCurrentSession?.(row.channel.slug)} aria-label={`Open ${row.channel.slug} current-session review`}>
                  <b>{row.pnl.openCount ? `${row.pnl.openCount} · ${usd0(row.pnl.exposure)}` : row.pnl.dayPnl ? "CLOSED" : "QUIET"}</b>
                  {row.pnl.dayPnl !== 0 && <small className={pnlClass} title="Current-session channel attribution from immutable routed positions; not account NAV.">{signedUsd(row.pnl.dayPnl)}</small>}
                </button>
                <button type="button" className="fleet-next fleet-cell-link" role="cell" onClick={() => onNextReview?.(row.channel.slug)} title={brief?.recommendation.summary ?? "Review after more independent evidence."}>
                  <b>{brief?.recommendation.label ?? "CONTINUE COLLECTING"}</b>
                </button>
              </div>
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
