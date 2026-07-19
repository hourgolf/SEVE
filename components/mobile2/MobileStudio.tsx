"use client";

import { MobileRackRow } from "@/components/mobile2/MobileRackRow";
import { SessionSequencer } from "@/components/console/SessionSequencer";
import { signedUsd } from "@/lib/format";
import { useMemo, useState } from "react";
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
  const { view, feed, liveFund } = props;
  const { desk, anySolo, isActive } = view;
  const { canWrite } = props.write;
  const passports = props.channelWorkspace;
  const [scope, setScope] = useState<"roots" | "dark" | "all">("roots");
  const visibleChannels = useMemo(() => channels.filter((channel) => {
    const lifecycle = passports.bySlug[channel.slug]?.lifecycle;
    if (scope === "roots") return lifecycle === "paper-root";
    if (scope === "dark") return lifecycle === "dark-evidence";
    return true;
  }), [channels, passports, scope]);

  const dayCls = liveFund.dayPnl > 0 ? "pos" : liveFund.dayPnl < 0 ? "neg" : "flat";

  return (
    <div className="m2-scroll">
      <section className="m2-screen">
        <div className="m2-phead">
          <span className="idx">02</span>
          <span className="t">MASTER · SESSION</span>
          <span className="grow" />
          <span className="x">{desk.fund.mode === "live" ? "LIVE" : "PAPER"}</span>
        </div>
        <div className="m2-transport">
          <button type="button" className="m2-xbtn start on" disabled title="The paper session is automatic; this is status, not a worker control.">AUTO</button>
          <button type="button" className="m2-xbtn" disabled title="Pause-new-entries is not connected yet. KILL remains the emergency flatten-and-halt control.">PAUSE</button>
          <span className="m2-vsep" />
          <div className="m2-transport-day">
            <span className="m2-dial-lbl">day p&amp;l</span>
            <b className={`num ${dayCls}`}>{signedUsd(liveFund.dayPnl)}</b>
          </div>
        </div>
      </section>

      <section className={`m2-release-card ${passports.release.state}`} aria-label="Runtime release identity">
        <span><i /><b>{passports.releaseView.label}</b></span>
        <strong>{passports.releaseView.compactAccountLifecycleLabel}</strong>
        <small>{passports.release.fact}</small>
        <code>{passports.releaseView.shortHash}</code>
      </section>

      <div className="m2-studio-tools"><span>RACK · {channels.length}</span><button type="button" onClick={canWrite ? onAddChannel : onOpenSettings}>{canWrite ? "+ ADD CHANNEL" : "SIGN IN TO TUNE"}</button></div>
      <div className="m2-channel-scope" role="group" aria-label="Channel runtime scope">
        <button type="button" className={scope === "roots" ? "on" : ""} onClick={() => setScope("roots")}>ROOTS <b>{passports.roots}</b></button>
        <button type="button" className={scope === "dark" ? "on" : ""} onClick={() => setScope("dark")}>DARK <b>{passports.dark}</b></button>
        <button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>ALL <b>{channels.length}</b></button>
      </div>
      <div className="m2-seam"><span className="m2-silk">{canWrite ? "TAP ROW · REVIEW CONTROLS · FORK DRAFT TO EDIT SEALED ROOTS" : "READ ONLY · SIGN IN TO CHANGE CONTROLS"}</span><span className="ln" /></div>
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
          open={openSlug === s.slug}
          onToggle={() => setOpenSlug(openSlug === s.slug ? null : s.slug)}
        />
      ))}

      <div className="m2-seam"><span className="m2-silk">SESSION TAPE — LIT = TODAY&apos;S ENTRIES</span><span className="ln" /></div>
      <section className="m2-screen m2-tape-screen">
        <SessionSequencer variant="dock" positions={feed.positions} recentTrades={feed.recentTrades} strategists={desk.strategists} />
      </section>
    </div>
  );
}
