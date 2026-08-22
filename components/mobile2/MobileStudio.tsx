"use client";

import { MobileRackRow } from "@/components/mobile2/MobileRackRow";
import { SessionSequencer } from "@/components/console/SessionSequencer";
import { CanaryCommandCenter } from "@/components/studio/CanaryCommandCenter";
import { useChannelRosterBundleControl } from "@/hooks/useChannelRosterBundleControl";
import { useEffect, useMemo, useState } from "react";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { axisForDisposition, type WorkspaceDestination } from "@/lib/shell/workspaceDestination";
import { resolveChannelRuntimeAuthority } from "@/lib/studio/channelRuntimeAuthority";

// =============================================================================
// MOBILE · STUDIO (S5) — the tune surface (the gallery mock's studio frame):
// transport strip → accordion rack (ONE inline inspector open at a time) →
// session tape. Roster is the account-scoped slice (same rule as the desktop
// StudioSurface). Session status lives here; emergency KILL remains in the
// persistent workstation hardware. All writes reuse the page-owned seam paths.
// =============================================================================

export function MobileStudio({
  props, channels, livePnl, openSlug, setOpenSlug, destination, onNavigate, onAddChannel, onOpenSettings,
}: {
  props: SurfaceProps;
  channels: StrategistState[];
  livePnl: Record<string, ChannelPnl>;
  openSlug: string | null;
  setOpenSlug: (s: string | null) => void;
  destination?: WorkspaceDestination;
  onNavigate?: (destination: WorkspaceDestination) => void;
  onAddChannel: () => void;
  onOpenSettings: () => void;
}) {
  const { view, feed } = props;
  const { desk, anySolo, isActive } = view;
  const { canWrite, canDirectConfigure } = props.write;
  const passports = props.channelWorkspace;
  const roster = useChannelRosterBundleControl(props.channelControlPlane);
  const [scope, setScope] = useState<"roots" | "dark" | "all">("roots");
  const runtimeCounts = useMemo(() => channels.reduce((counts, channel) => {
    const authority = resolveChannelRuntimeAuthority(channel.slug, passports.bySlug[channel.slug], props.channelControlPlane?.view, props.acctId);
    if (authority.scope === "roots") counts.roots += 1;
    else counts.dark += 1;
    return counts;
  }, { roots: 0, dark: 0 }), [channels, passports, props.acctId, props.channelControlPlane?.view]);
  const visibleChannels = useMemo(() => channels.filter((channel) => {
    const authority = resolveChannelRuntimeAuthority(channel.slug, passports.bySlug[channel.slug], props.channelControlPlane?.view, props.acctId);
    if (scope === "roots") return authority.scope === "roots";
    if (scope === "dark") return authority.scope === "dark";
    return true;
  }), [channels, passports, props.acctId, props.channelControlPlane?.view, scope]);
  const selectedScope = openSlug
    ? resolveChannelRuntimeAuthority(openSlug, passports.bySlug[openSlug], props.channelControlPlane?.view, props.acctId).scope
    : undefined;

  useEffect(() => {
    if (!openSlug) return;
    setScope(selectedScope ?? "all");
    window.setTimeout(() => document.getElementById(`m2-channel-${openSlug}`)?.scrollIntoView({ block: "start" }), 0);
  }, [openSlug, selectedScope]);

  return (
    <>
      <div className="m2-scroll">
        <CanaryCommandCenter
          controlPlane={props.channelControlPlane}
          bundles={roster.bundles}
          compact
        />
        <div className="m2-studio-tools"><span>RACK · {channels.length}</span><button type="button" disabled={canWrite && !canDirectConfigure} title={canDirectConfigure ? "Add a channel" : props.write.configurationWriteFact} onClick={canDirectConfigure ? onAddChannel : onOpenSettings}>{canWrite ? "+ ADD VIA PROPOSAL" : "SIGN IN TO REVIEW"}</button></div>
        <div className="m2-channel-scope" role="group" aria-label="Channel runtime scope">
          <button type="button" className={scope === "roots" ? "on" : ""} onClick={() => setScope("roots")}>TRADING <b>{runtimeCounts.roots}</b></button>
          <button type="button" className={scope === "dark" ? "on" : ""} onClick={() => setScope("dark")}>NOT TRADING <b>{runtimeCounts.dark}</b></button>
          <button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>ALL <b>{channels.length}</b></button>
        </div>
        {(props.channelControlPlane?.view?.state === "receipt-bound" || passports.release.state === "verified") && <p className="m2-roster-reconciliation" title={props.channelControlPlane?.view?.manifestContentHash ?? passports.release.receipt?.configHash ?? passports.release.expectedHash}>DESK ROSTER {(props.channelControlPlane?.view?.manifestContentHash ?? passports.releaseView.shortHash)?.replace(/^sha256:/, "").slice(0, 8)} · <b>{props.channelControlPlane?.view?.state === "receipt-bound" ? props.channelControlPlane.view.specs.filter((spec) => spec.executionPosture === "paper").length : passports.release.rootSlugs.length} TRADING ROOTS</b></p>}
        <div className="m2-seam"><span className="m2-silk">TAP A CHANNEL FOR EVIDENCE</span><span className="ln" /></div>
        {visibleChannels.length === 0 ? (
          <div className="m2-ghost">no channels in this runtime scope</div>
        ) : visibleChannels.map((s) => (
          <MobileRackRow
            key={s.slug}
            strategist={s}
            pnl={livePnl[s.slug]}
            active={isActive(s.slug) && !(anySolo && !s.config.soloed && !s.config.muted)}
            write={props.write}
            passport={passports.bySlug[s.slug]}
            accountId={props.acctId}
            dryPowder={props.shadowResearch.dryPowderBySlug[s.slug]}
            shadowSummary={props.shadowResearch.currentCumulative?.dark.find((item) => item.slug === s.slug)}
            managerEvidence={props.managerEvidence.book?.channels[s.slug]}
            decisionBrief={props.decisionAtlas.bySlug[s.slug]}
            researchEvidence={props.shadowResearch}
            controlPlane={props.channelControlPlane}
            focusAxis={destination?.channel === s.slug ? destination.axis : undefined}
            onCurrentSession={() => onNavigate?.({ section: "tape", channel: s.slug, reviewSection: "tape", session: props.decisionAtlas.throughSession ?? undefined })}
            onNextReview={() => onNavigate?.({ section: "research", channel: s.slug, axis: axisForDisposition(props.decisionAtlas.bySlug[s.slug]?.recommendation.axis), researchMode: "decisions" })}
            open={openSlug === s.slug}
            onToggle={() => setOpenSlug(openSlug === s.slug ? null : s.slug)}
          />
        ))}
      </div>

      <div className="m2-studio-sequencer" aria-label="Session tape drawer">
        <SessionSequencer variant="dock" positions={feed.positions} recentTrades={feed.recentTrades} strategists={desk.strategists} />
      </div>
    </>
  );
}
