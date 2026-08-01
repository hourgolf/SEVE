"use client";

import { MobileRackRow } from "@/components/mobile2/MobileRackRow";
import { SessionSequencer } from "@/components/console/SessionSequencer";
import { CanaryCommandCenter } from "@/components/studio/CanaryCommandCenter";
import { useChannelRosterBundleControl } from "@/hooks/useChannelRosterBundleControl";
import { useEffect, useMemo, useState } from "react";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { SurfaceProps } from "@/components/surfaceTypes";

// =============================================================================
// MOBILE · STUDIO (S5) — the tune surface (the gallery mock's studio frame):
// transport strip → accordion rack (ONE inline inspector open at a time) →
// session tape. Roster is the account-scoped slice (same rule as the desktop
// StudioSurface). Session status lives here; emergency KILL remains in the
// persistent workstation hardware. All writes reuse the page-owned seam paths.
// =============================================================================

export function MobileStudio({
  props, channels, livePnl, openSlug, setOpenSlug, onAddChannel, onOpenSettings,
}: {
  props: SurfaceProps;
  channels: StrategistState[];
  livePnl: Record<string, ChannelPnl>;
  openSlug: string | null;
  setOpenSlug: (s: string | null) => void;
  onAddChannel: () => void;
  onOpenSettings: () => void;
}) {
  const { view, feed } = props;
  const { desk, anySolo, isActive } = view;
  const { canWrite, canDirectConfigure } = props.write;
  const passports = props.channelWorkspace;
  const roster = useChannelRosterBundleControl(props.channelControlPlane);
  const [scope, setScope] = useState<"roots" | "dark" | "all">("roots");
  const visibleChannels = useMemo(() => channels.filter((channel) => {
    const lifecycle = passports.bySlug[channel.slug]?.lifecycle;
    if (scope === "roots") return lifecycle === "paper-root";
    if (scope === "dark") return lifecycle === "dark-evidence";
    return true;
  }), [channels, passports, scope]);
  const selectedLifecycle = openSlug ? passports.bySlug[openSlug]?.lifecycle : undefined;

  useEffect(() => {
    if (!openSlug) return;
    setScope(selectedLifecycle === "paper-root" ? "roots" : selectedLifecycle === "dark-evidence" ? "dark" : "all");
    window.setTimeout(() => document.getElementById(`m2-channel-${openSlug}`)?.scrollIntoView({ block: "start" }), 0);
  }, [openSlug, selectedLifecycle]);

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
          <button type="button" className={scope === "roots" ? "on" : ""} onClick={() => setScope("roots")}>PAPER IN VIEW <b>{passports.roots}</b></button>
          <button type="button" className={scope === "dark" ? "on" : ""} onClick={() => setScope("dark")}>OBSERVE IN VIEW <b>{passports.dark}</b></button>
          <button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>DESK ROWS <b>{channels.length}</b></button>
        </div>
        {passports.release.state === "verified" && <p className="m2-roster-reconciliation">RECEIPT AUTHORITY · <b>{passports.release.rootSlugs.length} ROOTS</b></p>}
        <div className="m2-seam"><span className="m2-silk">{canWrite ? "TAP ROW · FORK GOVERNED DRAFT · DIRECT WRITES FENCED" : "READ ONLY · SIGN IN TO REVIEW CONTROLS"}</span><span className="ln" /></div>
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
            controlPlane={props.channelControlPlane}
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
