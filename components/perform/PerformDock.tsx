"use client";

import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd } from "@/lib/format";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { Lens } from "@/hooks/useSentinelDigest";

// PERFORM bottom dock (slice S2) — one chicklet per roster channel, the same
// source (useDeskState) that drives STUDIO's rack. Each carries: state dot
// (armed/muted/dark via color+opacity), the slug (NEVER ellipsized), day P&L,
// pk·win (era-4 lens, day-P&L fallback), and a real MUTE pad. The mute pad is
// the ONLY interactive control — a chicklet click is a no-op stub (expansion is
// later). Writes = optimistic dispatch(TOGGLE_MUTE) + persistConfig, RLS-gated.

// A13 = the momo giveback ratchet, live A/B (docs/pre-registered-tests-2026-07 · registry A13).
// The one sentinel-sourced ratchet armed today; a small documented constant, not a config column.
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
  ch, pnl, lens, canWrite, onMute,
}: {
  ch: StrategistState;
  pnl?: ChannelPnl;
  lens: Lens | null;
  canWrite: boolean;
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
    <div className={`pf-chick${dim}`} style={{ ["--pm" as string]: pmVar(ch.color) }} title={`${ch.slug} — ${ch.mandate}`}>
      <div className="pfc-r1">
        <span className={`pfc-dot${armed ? " on" : muted ? " stby" : ""}`} />
        <span className="pfc-slug">{ch.slug}</span>
        {A13_SLUGS.has(ch.slug) && <span className="pfc-a13">⚡A13</span>}
      </div>
      <div className={`pfc-pnl num ${dayCls}`}>{day != null ? signedUsd(day) : "—"}</div>
      <div className="pfc-r3">
        {tag ? (
          <span className={`pfc-tag ${tag === "MUTED" ? "muted" : "darkch"}`}>{tag}</span>
        ) : pk == null && win == null ? (
          <span className="pfc-pw">pk—·win—</span>
        ) : (
          <span className="pfc-pw">pk<b>{pk != null ? Math.round(pk) : "—"}</b>·win<b>{win != null ? Math.round(win) : "—"}</b></span>
        )}
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
  channels, livePnl, lens,
}: {
  channels: StrategistState[];
  livePnl: Record<string, ChannelPnl>;
  lens: Lens | null;
}) {
  const dispatch = useDeskDispatch();
  const { canWrite, persistConfig } = useDeskWrite();

  // Optimistic mute — the same write the STUDIO strip/pad fires.
  const mute = (ch: StrategistState) => {
    if (!canWrite) return;
    dispatch({ type: "TOGGLE_MUTE", slug: ch.slug });
    persistConfig(ch.id, { muted: !ch.config.muted });
  };

  return (
    <nav className="pf-dock chrome">
      <div className="pf-dock-in">
        <div className="pf-cap"><span className="silk">MIX</span></div>
        {channels.map((ch) => (
          <Chicklet
            key={ch.slug}
            ch={ch}
            pnl={livePnl[ch.slug]}
            lens={lens}
            canWrite={canWrite}
            onMute={() => mute(ch)}
          />
        ))}
      </div>
    </nav>
  );
}
