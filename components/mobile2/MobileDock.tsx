"use client";

import { useState } from "react";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd } from "@/lib/format";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { Lens } from "@/hooks/useSentinelDigest";
import type { SurfaceProps } from "@/components/surfaceTypes";

// =============================================================================
// MOBILE · PERFORM DOCK (S5) — the chicklet dock pinned above the tab bar. Per
// the operator's LOCKED ruling the 11+-channel dock takes ROWS, not a
// horizontal scroll: a 2-column grid that wraps down (vertical overflow only),
// every channel visible, the slug NEVER ellipsized, the MUTE pad ≥44px. Same
// data source (useDeskState roster) and the same optimistic write
// (dispatch(TOGGLE_MUTE) + persistConfig) the desktop PerformDock/StudioRack fire.
// =============================================================================

const A13_SLUGS = new Set(["momo-shape"]);

function pkWin(slug: string, lens: Lens | null, pnl?: ChannelPnl): { pk: number | null; win: number | null } {
  const l = lens?.[slug];
  if (l && l.n > 0) return { pk: l.p, win: l.w };
  if (pnl && pnl.trades > 0) {
    return { pk: pnl.pkN > 0 ? pnl.pkSum / pnl.pkN : null, win: (pnl.wins / pnl.trades) * 100 };
  }
  return { pk: null, win: null };
}

function Chicklet({
  ch, pnl, lens, canWrite, onOpen, onMute,
}: {
  ch: StrategistState;
  pnl?: ChannelPnl;
  lens: Lens | null;
  canWrite: boolean;
  onOpen?: () => void;
  onMute: () => void;
}) {
  const muted = ch.config.muted;
  const armed = ch.status === "armed" && !muted;
  const dim = muted ? " off" : ch.status !== "armed" ? " dark" : "";
  const tag = muted ? "MUTED" : ch.status !== "armed" ? (ch.status === "disabled" ? "DARK" : "DRAFT") : null;
  const { pk, win } = pkWin(ch.slug, lens, pnl);
  const day = pnl?.dayPnl;
  const dayCls = day == null || day === 0 ? "flat" : day < 0 ? "neg" : "pos";

  return (
    <div className={`m2-chick${dim}`} style={{ ["--pm" as string]: pmVar(ch.color) }} title={`${ch.slug} — ${ch.mandate}`}>
      <button type="button" className="m2-chick-main" onClick={onOpen} disabled={!onOpen} aria-label={`Open ${ch.slug} in Studio`}>
        <div className="m2-chick-r1">
          <span className={`m2-chick-dot${armed ? " on" : muted ? " stby" : ""}`} />
          <span className="m2-chick-slug">{ch.slug}</span>
          {A13_SLUGS.has(ch.slug) && <span className="m2-chick-a13">⚡A13</span>}
        </div>
        <div className={`m2-chick-pnl num ${dayCls}`}>{day != null ? signedUsd(day) : "—"}</div>
        {tag ? (
          <span className={`m2-chick-tag ${tag === "MUTED" ? "muted" : "darkch"}`}>{tag}</span>
        ) : pk == null && win == null ? (
          <span className="m2-chick-pw">pk—·win—</span>
        ) : (
          <span className="m2-chick-pw">pk<b>{pk != null ? Math.round(pk) : "—"}</b>·win<b>{win != null ? Math.round(win) : "—"}</b></span>
        )}
      </button>
      <button
        type="button"
        className={`m2-chick-mute${muted ? " lit" : ""}`}
        title={canWrite ? `${muted ? "un-mute" : "mute"} ${ch.slug}` : "sign in to mute"}
        aria-pressed={muted}
        disabled={!canWrite}
        onClick={onMute}
      >
        M
      </button>
    </div>
  );
}

export function MobileDock({
  channels, livePnl, lens, write, onOpenChannel,
}: {
  channels: StrategistState[];
  livePnl: Record<string, ChannelPnl>;
  lens: Lens | null;
  write: SurfaceProps["write"];
  onOpenChannel?: (slug: string) => void;
}) {
  const dispatch = useDeskDispatch();
  const { canWrite, persistConfig } = write;
  const [open, setOpen] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const muted = channels.filter((channel) => channel.config.muted).length;

  const mute = (ch: StrategistState) => {
    if (!canWrite) return;
    setWriteError(null);
    dispatch({ type: "TOGGLE_MUTE", slug: ch.slug });
    void persistConfig(ch.id, { muted: !ch.config.muted }).then((result) => {
      if (result.ok) return;
      dispatch({ type: "TOGGLE_MUTE", slug: ch.slug });
      setWriteError(result.error ?? "mute write failed");
    });
  };

  return (
    <nav className={`m2-dock${open ? " open" : " collapsed"}`} aria-label="channel dock">
      <button type="button" className="m2-dock-cap" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="m2-silk">MIX · {channels.length}</span>
        <small className={writeError ? "error" : ""} title={writeError ?? undefined}>{writeError ? "WRITE FAILED" : `${muted ? `${muted} MUTED · ` : ""}${open ? "TAP TO COLLAPSE" : "TAP TO EXPAND"}`}</small>
        <b>{open ? "▾" : "▴"}</b>
      </button>
      {open && <div className="m2-dock-grid">
        {channels.map((ch) => (
          <Chicklet
            key={ch.slug}
            ch={ch}
            pnl={livePnl[ch.slug]}
            lens={lens}
            canWrite={canWrite}
            onOpen={onOpenChannel ? () => onOpenChannel(ch.slug) : undefined}
            onMute={() => mute(ch)}
          />
        ))}
      </div>}
    </nav>
  );
}
