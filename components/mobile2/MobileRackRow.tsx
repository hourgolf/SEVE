"use client";

import { useRef } from "react";
import { FiresPill, TradeShapeBar } from "@/components/console/ChannelStrip";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, usd0 } from "@/lib/format";
import type { ChannelPnl, StrategistState, StrategistConfig } from "@/lib/desk/types";

// =============================================================================
// MOBILE · STUDIO RACK ROW (S5) — the accordion channel row + its INLINE
// inspector (the gallery mock's studio rack). Collapsed = a 56px row (dot · slug
// · mode/A13 tag · fires summary · day P&L · chevron). Tapping expands ONE
// inspector at a time (the parent enforces single-open). Inside: the REUSED
// FiresPill + TradeShapeBar write paths (identical to the desktop ChannelRackRow),
// the LOCK/RIDE matched-pair write, plus mobile-native ≥44px controls where the
// desktop hardware knobs don't suit touch — a STOP/day stepper and the operator-
// approved HORIZONTAL RISK fader. Every write is optimistic dispatch(SET_CONFIG)
// + auth-gated persistConfig; anon = read-only.
// =============================================================================

const A13_SLUGS = new Set(["momo-shape"]);
const RISK_MIN = 0, RISK_MAX = 5000, RISK_STEP = 25;

export function MobileRackRow({
  strategist, pnl, active, open, onToggle,
}: {
  strategist: StrategistState;
  pnl: ChannelPnl | undefined;
  active: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const dispatch = useDeskDispatch();
  const { persistConfig, canWrite } = useDeskWrite();
  const faderRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const { id, slug, color, status, config } = strategist;

  const tp = config.take_profit_pct ?? 0;
  const premStop = config.premium_stop_pct ?? 50;
  const boosted = config.boosted ?? false;
  const ride = tp === 0;
  const day = pnl?.dayPnl ?? 0;
  const pnlCls = day > 0 ? "pos" : day < 0 ? "neg" : "flat";
  const pm = pmVar(color);

  const setCfg = (patch: Partial<StrategistConfig>) => {
    dispatch({ type: "SET_CONFIG", slug, patch });
    persistConfig(id, patch);
  };
  // LOCK/RIDE writes the matched pair (giveback doctrine) — verbatim from ChannelRackRow.
  const applyLock = () => {
    const nextTp = tp > 0 ? tp : 22;
    if (nextTp !== tp || premStop !== 30) setCfg({ take_profit_pct: nextTp, premium_stop_pct: 30 });
  };
  const applyRide = () => {
    if (tp !== 0 || premStop !== 50) setCfg({ take_profit_pct: 0, premium_stop_pct: 50 });
  };

  // Horizontal RISK fader (operator-approved for mobile) → capital_pct (RISK $/trade).
  const riskFrac = Math.min(1, config.capital_pct / RISK_MAX);
  const valueFromX = (clientX: number) => {
    const el = faderRef.current;
    if (!el) return config.capital_pct;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
    return Math.round((RISK_MIN + frac * (RISK_MAX - RISK_MIN)) / RISK_STEP) * RISK_STEP;
  };
  const faderMove = (clientX: number, commit: boolean) => {
    const v = valueFromX(clientX);
    if (v === config.capital_pct && !commit) return;
    dispatch({ type: "SET_CONFIG", slug, patch: { capital_pct: v } });
    if (commit) persistConfig(id, { capital_pct: v });
  };

  const stepStop = (delta: number) => {
    const v = Math.max(0, Math.min(5000, config.daily_stop_usd + delta));
    if (v !== config.daily_stop_usd) setCfg({ daily_stop_usd: v });
  };

  const tag = config.muted ? { txt: "MUTED", cls: "muted" }
    : status === "draft" ? { txt: "BENCH", cls: "darkch" }
    : status === "disabled" ? { txt: "OFF", cls: "darkch" }
    : null;
  const dot = active && status === "armed" && !config.muted;
  const firesSummary = ride ? `−${premStop}% · ride · EOD` : `−${premStop}/+${tp} · EOD`;

  return (
    <section className={`m2-rack${config.muted ? " mutedch" : ""}${open ? " open" : ""}`} style={{ ["--pm" as string]: pm }}>
      <button type="button" className="m2-rrow" onClick={onToggle} aria-expanded={open}>
        <span className="m2-rr-left">
          <span className={`m2-rr-dot${dot ? " on" : ""}${A13_SLUGS.has(slug) ? " hot" : ""}`} />
          <span className="m2-rr-slug">{slug}</span>
          {A13_SLUGS.has(slug) && <span className="m2-rr-a13">⚡A13</span>}
          {tag && <span className={`m2-rr-tag ${tag.cls}`}>{tag.txt}</span>}
        </span>
        <span className="m2-rr-right">
          <span className="m2-rr-fires num">{firesSummary}</span>
          <span className={`m2-rr-pnl num ${pnlCls}`}>{signedUsd(day)}</span>
          <span className="m2-rr-chev">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open && (
        <div className="m2-insp">
          <div className="m2-fireslbl"><span className="fl">FIRES — the binding exits · tap a pill to edit</span><span className="ln" /></div>
          <div className="m2-fpills">
            <div className="m2-fp stop">
              <FiresPill
                value={premStop} display={`−${premStop}%`}
                onCommit={(v) => setCfg({ premium_stop_pct: v })}
                min={10} max={90} className="m2-fp-val"
                canWrite={canWrite} label="premium stop percent" title="premium stop % — the binding downside"
              />
              <span className="m2-fp-cap">prem stop</span>
            </div>
            <div className={`m2-fp ${tp > 0 ? "take" : "ride"}`}>
              <FiresPill
                value={tp} display={tp > 0 ? `+${tp}%` : "ride"}
                onCommit={(v) => setCfg({ take_profit_pct: v })}
                min={0} max={300} className="m2-fp-val"
                canWrite={canWrite} label="take profit percent" title="take-profit % (0 = ride)"
              />
              <span className="m2-fp-cap">{tp > 0 ? "take" : "no take"}</span>
            </div>
            <span className="m2-fp eod"><b>EOD</b><span className="m2-fp-cap">flatten</span></span>
          </div>

          <div className="m2-lr" role="group" aria-label="exit mode">
            {canWrite ? (
              <>
                <button type="button" className={`m2-lrbtn lock${ride ? "" : " on"}`} onClick={applyLock}
                  title="LOCK — take profit + a tight −30% stop">LOCK</button>
                <button type="button" className={`m2-lrbtn ride${ride ? " on" : ""}`} onClick={applyRide}
                  title="RIDE — no take, loose −50% stop">RIDE</button>
              </>
            ) : (
              <span className={`m2-lrbtn on ${ride ? "ride" : "lock"}`}>{ride ? "RIDE" : "LOCK"}</span>
            )}
          </div>

          <div className="m2-shape">
            <TradeShapeBar
              tp={tp} premStop={premStop} canWrite={canWrite}
              onChange={(patch) => dispatch({ type: "SET_CONFIG", slug, patch })}
              onCommit={(patch) => persistConfig(id, patch)}
            />
          </div>

          <div className="m2-dials">
            <div className="m2-stopday">
              <span className="m2-dial-lbl">stop/day</span>
              <div className="m2-stepper">
                <button type="button" disabled={!canWrite} onClick={() => stepStop(-250)} aria-label="decrease stop per day">−</button>
                <b className="num">{usd0(config.daily_stop_usd)}</b>
                <button type="button" disabled={!canWrite} onClick={() => stepStop(250)} aria-label="increase stop per day">+</button>
              </div>
            </div>
            <div className="m2-riskwrap">
              <div
                ref={faderRef}
                className="m2-hfader"
                onPointerDown={(e) => { if (!canWrite) return; e.preventDefault(); (e.currentTarget as Element).setPointerCapture(e.pointerId); dragging.current = true; faderMove(e.clientX, false); }}
                onPointerMove={(e) => { if (dragging.current) faderMove(e.clientX, false); }}
                onPointerUp={(e) => { if (dragging.current) { dragging.current = false; faderMove(e.clientX, true); try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* */ } } }}
              >
                <div className="m2-hf-track" />
                <div className="m2-hf-fill" style={{ width: `${riskFrac * 100}%` }} />
                <div className="m2-hf-cap" style={{ left: `${riskFrac * 100}%` }} />
              </div>
              <div className="m2-dial-cap"><span className="m2-dial-lbl">risk</span><b className="num">{usd0(config.capital_pct)}</b></div>
            </div>
          </div>

          <div className="m2-padrow">
            <button type="button" className={`m2-bigpad${config.muted ? " lit-m" : ""}`} disabled={!canWrite}
              onClick={() => { dispatch({ type: "TOGGLE_MUTE", slug }); persistConfig(id, { muted: !config.muted }); }}>
              {config.muted ? "MUTED" : "MUTE"}
            </button>
            <button type="button" className={`m2-bigpad${boosted ? " lit-b" : ""}`} disabled={!canWrite}
              onClick={() => { const next = !boosted; dispatch({ type: "SET_CONFIG", slug, patch: { boosted: next } }); persistConfig(id, { boosted: next }); }}>
              {boosted ? "BOOST 2×" : "BOOST"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
