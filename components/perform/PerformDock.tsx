"use client";

import { useMemo, useState } from "react";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd } from "@/lib/format";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { ChannelWorkspaceModel } from "@/lib/channels/channelPassport";

// PERFORM bottom dock (slice S2) — one chicklet per roster channel, the same
// source (useDeskState) that drives STUDIO's rack. Exposure/exceptions sort first;
// inert draft/disabled channels live behind one explicit fold. pk·win is omitted
// here on purpose: it is an exit diagnostic, not a promotion/status score. The
// only write remains the existing auth-gated MUTE pad.

function Chicklet({
  ch, pnl, canWrite, onMute, a13, passport,
}: {
  ch: StrategistState;
  passport?: ChannelWorkspaceModel["bySlug"][string];
  pnl?: ChannelPnl;
  canWrite: boolean;
  onMute: () => void;
  a13: boolean;
}) {
  const muted = passport?.lifecycle === "dark-evidence";
  const armed = passport?.lifecycle === "paper-root";
  const dim = armed ? "" : " dark";
  const open = pnl?.openCount ?? 0;
  const tag = open > 0 ? `OPEN ${open}` : passport?.lifecycleLabel ?? "UNVERIFIED";
  const tagClass = open > 0 ? "open" : armed ? "armed" : "darkch";
  const day = pnl?.dayPnl;
  const dayCls = day == null || day === 0 ? "flat" : day < 0 ? "neg" : "pos";

  return (
    <div className={`pf-chick${dim}`} style={{ ["--pm" as string]: pmVar(ch.color) }} title={`${ch.slug} — ${ch.mandate}`}>
      <div className="pfc-r1">
        <span className={`pfc-dot${armed ? " on" : muted ? " stby" : ""}`} />
        <span className="pfc-slug">{ch.slug}</span>
        {a13 && <span className="pfc-a13">⚡A13</span>}
      </div>
      <div className="pfc-mid">
        <div className={`pfc-pnl num ${dayCls}`} title="Current-session channel attribution from immutable routed positions; not account NAV.">{day != null ? signedUsd(day) : "—"}</div>
        <span className="pfc-basis">session attrib</span>
      </div>
      <div className="pfc-r3">
        <span className={`pfc-tag ${tagClass}`}>{tag}</span>
        <button
          type="button"
          className={`pfc-mute${muted ? " lit" : ""}`}
          title={canWrite ? `${muted ? "un-mute" : "mute"} ${ch.slug}` : "sign in to mute"}
          aria-pressed={muted}
          disabled={!canWrite}
          onClick={onMute}
        >
          M
        </button>
      </div>
    </div>
  );
}

export function PerformDock({
  channels, livePnl, channelWorkspace,
}: {
  channels: StrategistState[];
  livePnl: Record<string, ChannelPnl>;
  channelWorkspace: ChannelWorkspaceModel;
}) {
  const dispatch = useDeskDispatch();
  const { canDirectConfigure: canWrite, persistConfig } = useDeskWrite();
  const [showInactive, setShowInactive] = useState(false);
  const prioritized = useMemo(() => ({
    visible: channels.filter(ch => channelWorkspace.bySlug[ch.slug]?.lifecycle === "paper-root" || (livePnl[ch.slug]?.openCount ?? 0) > 0 || (livePnl[ch.slug]?.dayPnl ?? 0) !== 0),
    inactive: channels.filter(ch => channelWorkspace.bySlug[ch.slug]?.lifecycle !== "paper-root" && !(livePnl[ch.slug]?.openCount) && !(livePnl[ch.slug]?.dayPnl)),
  }), [channels, livePnl, channelWorkspace]);
  const shown = showInactive ? [...prioritized.visible, ...prioritized.inactive] : prioritized.visible;

  // Optimistic mute — the same write the STUDIO strip/pad fires.
  const mute = (ch: StrategistState) => {
    if (!canWrite) return;
    dispatch({ type: "TOGGLE_MUTE", slug: ch.slug });
    persistConfig(ch.id, { muted: !ch.config.muted });
  };

  return (
    <nav className="pf-dock chrome">
      <div className="pf-dock-in">
        <div className="pf-cap">
          <span className="silk">MIX · {prioritized.visible.length}/{channels.length}</span>
          {prioritized.inactive.length > 0 && (
            <button type="button" className="pf-fold" aria-expanded={showInactive} onClick={() => setShowInactive((v) => !v)}>
              {showInactive ? "hide inactive" : `+${prioritized.inactive.length} inactive`}
            </button>
          )}
        </div>
        <div className="pf-cards">
          {shown.map((ch) => (
            <Chicklet
              key={ch.slug}
              ch={ch}
              passport={channelWorkspace.bySlug[ch.slug]}
              pnl={livePnl[ch.slug]}
              canWrite={canWrite}
              onMute={() => mute(ch)}
              a13={channelWorkspace.bySlug[ch.slug]?.rootPolicy?.runner === "a13"}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}
