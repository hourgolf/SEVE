"use client";

import { useState } from "react";
import { MobileRackRow } from "@/components/mobile2/MobileRackRow";
import { SessionSequencer } from "@/components/console/SessionSequencer";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { signedUsd } from "@/lib/format";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { SurfaceProps } from "@/components/surfaceTypes";

// =============================================================================
// MOBILE · STUDIO (S5) — the tune surface (the gallery mock's studio frame):
// transport strip → accordion rack (ONE inline inspector open at a time) →
// session tape. Roster is the account-scoped slice (same rule as the desktop
// StudioSurface). START/STOP/KILL: START/STOP live here; KILL lives in COMMAND
// (hold-2s) per the operator ruling. All writes reuse the seam paths.
// =============================================================================

export function MobileStudio({
  props, channels, livePnl, openSlug, setOpenSlug,
}: {
  props: SurfaceProps;
  channels: StrategistState[];
  livePnl: Record<string, ChannelPnl>;
  openSlug: string | null;
  setOpenSlug: (s: string | null) => void;
}) {
  const { view, feed, liveFund } = props;
  const { desk, anySolo, isActive } = view;
  const dispatch = useDeskDispatch();
  const { canWrite, persistFund } = useDeskWrite();
  const [busy, setBusy] = useState(false);

  const running = desk.fund.running && !desk.fund.is_halted;
  const setRun = (run: boolean) => {
    if (!canWrite || busy) return;
    setBusy(true);
    dispatch({ type: run ? "START" : "STOP" });
    Promise.resolve(persistFund({ running: run })).finally(() => setBusy(false));
  };

  const dayCls = liveFund.dayPnl > 0 ? "pos" : liveFund.dayPnl < 0 ? "neg" : "flat";

  return (
    <div className="m2-scroll">
      <section className="m2-screen">
        <div className="m2-phead">
          <span className="idx">02</span>
          <span className="t">MASTER · TRANSPORT</span>
          <span className="grow" />
          <span className="x">{desk.fund.mode === "live" ? "LIVE" : "PAPER"}</span>
        </div>
        <div className="m2-transport">
          <button type="button" className={`m2-xbtn start${running ? " on" : ""}`} disabled={!canWrite || busy} onClick={() => setRun(true)}>START</button>
          <button type="button" className={`m2-xbtn${!running ? " on-stop" : ""}`} disabled={!canWrite || busy} onClick={() => setRun(false)}>STOP</button>
          <span className="m2-vsep" />
          <div className="m2-transport-day">
            <span className="m2-dial-lbl">day p&amp;l</span>
            <b className={`num ${dayCls}`}>{signedUsd(liveFund.dayPnl)}</b>
          </div>
        </div>
      </section>

      <div className="m2-seam"><span className="m2-silk">RACK · {channels.length} — TAP A ROW TO INSPECT</span><span className="ln" /></div>
      {channels.length === 0 ? (
        <div className="m2-ghost">no channels in this account</div>
      ) : channels.map((s) => (
        <MobileRackRow
          key={s.slug}
          strategist={s}
          pnl={livePnl[s.slug]}
          active={isActive(s.slug) && !(anySolo && !s.config.soloed && !s.config.muted)}
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
