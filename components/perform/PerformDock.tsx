"use client";

import { useMemo, useState } from "react";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd } from "@/lib/format";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import { prioritizeChannels } from "@/lib/perform/derivePerformView";

// PERFORM bottom dock (slice S2) — one chicklet per roster channel, the same
// source (useDeskState) that drives STUDIO's rack. Exposure/exceptions sort first;
// inert draft/disabled channels live behind one explicit fold. pk·win is omitted
// here on purpose: it is an exit diagnostic, not a promotion/status score. The
// only write remains the existing auth-gated MUTE pad.

// A13 = the momo giveback ratchet, live A/B (docs/pre-registered-tests-2026-07 · registry A13).
// The one sentinel-sourced ratchet armed today; a small documented constant, not a config column.
const A13_SLUGS = new Set(["momo-shape"]);

function Chicklet({
  ch, pnl, canWrite, onMute,
}: {
  ch: StrategistState;
  pnl?: ChannelPnl;
  canWrite: boolean;
  onMute: () => void;
}) {
  const muted = ch.config.muted;
  const armed = ch.status === "armed" && !muted;
  const dim = muted ? " off" : ch.status !== "armed" ? " dark" : "";
  const open = pnl?.openCount ?? 0;
  const tag = open > 0 ? `OPEN ${open}` : muted ? "MUTED" : ch.config.boosted ? "BOOSTED" : ch.status !== "armed" ? (ch.status === "disabled" ? "DARK" : "DRAFT") : "ARMED";
  const tagClass = muted ? "muted" : tag === "DARK" || tag === "DRAFT" ? "darkch" : open > 0 ? "open" : tag === "BOOSTED" ? "boosted" : "armed";
  const day = pnl?.dayPnl;
  const dayCls = day == null || day === 0 ? "flat" : day < 0 ? "neg" : "pos";

  return (
    <div className={`pf-chick${dim}`} style={{ ["--pm" as string]: pmVar(ch.color) }} title={`${ch.slug} — ${ch.mandate}`}>
      <div className="pfc-r1">
        <span className={`pfc-dot${armed ? " on" : muted ? " stby" : ""}`} />
        <span className="pfc-slug">{ch.slug}</span>
        {A13_SLUGS.has(ch.slug) && <span className="pfc-a13">⚡A13</span>}
      </div>
      <div className="pfc-mid">
        <div className={`pfc-pnl num ${dayCls}`} title="Desk-derived today P&L; not broker-reconciled.">{day != null ? signedUsd(day) : "—"}</div>
        <span className="pfc-basis">desk today</span>
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
  channels, livePnl,
}: {
  channels: StrategistState[];
  livePnl: Record<string, ChannelPnl>;
}) {
  const dispatch = useDeskDispatch();
  const { canWrite, persistConfig } = useDeskWrite();
  const [showInactive, setShowInactive] = useState(false);
  const prioritized = useMemo(() => prioritizeChannels(channels, livePnl), [channels, livePnl]);
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
              pnl={livePnl[ch.slug]}
              canWrite={canWrite}
              onMute={() => mute(ch)}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}
