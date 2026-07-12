"use client";

import { useEffect, useRef, useState } from "react";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay } from "@/lib/format";
import type { Position, StrategistState } from "@/lib/desk/types";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { MANUAL_CLOSE_REASONS } from "@/lib/positions/manualClose";

const A13_SLUGS = new Set(["momo-shape"]);
const ONE_DAY = 86_400_000;
function dteOf(exp?: string | null): number | null {
  if (!exp) return null;
  const e = Date.parse(exp.slice(0, 10));
  const t = new Date();
  const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  const d = Math.round((e - today) / ONE_DAY);
  return Number.isFinite(d) ? Math.max(0, d) : null;
}

const occRoot = (occ: string, fallback: string) => (occ.match(/^([A-Z]+)\d/)?.[1] ?? fallback).toUpperCase();

function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 8, c = 2 * Math.PI * r, off = c * (1 - Math.min(Math.max(pct, 0), 100) / 100);
  return <svg className="m2-ring" viewBox="0 0 22 22" aria-hidden>
    <circle cx="11" cy="11" r={r} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="2.5" />
    <circle cx="11" cy="11" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
      strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 11 11)" style={{ filter: `drop-shadow(0 0 2px ${color})` }} />
  </svg>;
}

export function MobilePositions({ props, strategists, compact = false }: {
  props: SurfaceProps;
  strategists: StrategistState[];
  compact?: boolean;
}) {
  const { feed, liveMarks, positionPeaks, write } = props;
  const positions = feed.positions;
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  const [tagPrompt, setTagPrompt] = useState<{ id: string; label: string } | null>(null);
  const [tagging, setTagging] = useState(false);
  const disarmTimer = useRef<number | null>(null);

  const clearDisarm = () => {
    if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
    disarmTimer.current = null;
  };
  useEffect(() => () => clearDisarm(), []);

  const stratOf = (slug: string) => strategists.find((s) => s.slug === slug);
  const markOf = (p: Position) => {
    const m = liveMarks?.[p.occ_symbol];
    if (m != null && Number.isFinite(m) && m > 0) return { mark: m, unreal: (m - p.avg_entry_price) * p.qty * 100 };
    return { mark: p.current_mark, unreal: p.unrealized_pnl };
  };
  const total = positions.reduce((sum, position) => sum + markOf(position).unreal, 0);

  const armClose = (id: string) => {
    setCloseErr(null);
    setConfirmId(id);
    clearDisarm();
    disarmTimer.current = window.setTimeout(() => setConfirmId((current) => current === id ? null : current), 4_000);
  };
  const cancelClose = () => { clearDisarm(); setConfirmId(null); };
  const confirmClose = async (position: Position) => {
    clearDisarm();
    setConfirmId(null);
    setClosingId(position.id);
    setCloseErr(null);
    const result = await write.closePosition(position.id);
    setClosingId(null);
    if (!result.ok) setCloseErr(result.error ?? "close failed");
    else setTagPrompt({ id: position.id, label: `${position.strike.toFixed(0)}${position.opt_type === "call" ? "C" : "P"}` });
  };
  const tagClose = async (value: string) => {
    if (!tagPrompt) return;
    setTagging(true);
    const result = await write.tagClose(tagPrompt.id, value);
    setTagging(false);
    if (!result.ok) { setCloseErr(result.error ?? "reason tag failed"); return; }
    setTagPrompt(null);
  };

  return <section className={`m2-screen m2-hardware m2-position-book${compact ? " compact" : ""}`}>
    <div className="m2-phead">
      <span className="t">OPEN POSITIONS · {positions.length}</span><span className="grow" />
      {positions.length > 0 && <span className={`x num ${total < 0 ? "neg" : "up"}`}>Σ {signedUsd(total)}</span>}
    </div>
    <div>
      {positions.length === 0 ? <div className="m2-ghost">flat — no open positions</div> : positions.map((position) => {
        const strategist = stratOf(position.strategist_slug);
        const pm = pmVar(strategist?.color ?? "green");
        const { mark, unreal } = markOf(position);
        const entry = position.avg_entry_price;
        const peak = positionPeaks[position.occ_symbol] ?? 0;
        const peakPct = entry > 0 && peak > entry ? ((peak - entry) / entry) * 100 : null;
        const gavePct = peakPct != null && mark < peak ? Math.min(999, ((peak - mark) / (peak - entry)) * 100) : null;
        const lock = (strategist?.config.take_profit_pct ?? 0) > 0;
        const dte = dteOf(position.expiration);
        return <div className="m2-pos-row" key={position.id} style={{ ["--pm" as string]: pm }}>
          <span className="m2-p-dot" />
          <div className="m2-p-slug">{position.strategist_slug}</div>
          <div className={`m2-p-pnl num ${unreal < 0 ? "neg" : "pos"}`}>{signedUsd(unreal)}</div>
          <div className="m2-p-ctr">{occRoot(position.occ_symbol, strategist?.underlying ?? "SPY")} {position.strike.toFixed(0)}{position.opt_type === "call" ? "C" : "P"} ×{position.qty}{dte != null ? ` · ${dte}DTE` : ""}</div>
          <div className="m2-p-meta">in @{entry.toFixed(2)}{position.opened_at ? ` · ${timeOfDay(position.opened_at)}` : ""}</div>
          <div className="m2-p-tags">
            {A13_SLUGS.has(position.strategist_slug) && <span className="m2-tag amber">⚡ A13 ratchet</span>}
            <span className="m2-tag">{lock ? "LOCK" : "RIDE"}</span>
            {gavePct != null && gavePct >= 40 && <span className="m2-tag warn">giveback {Math.round(gavePct)}% of pk</span>}
          </div>
          <div className="m2-p-pk">{peakPct != null ? <Ring pct={peakPct} color={pm} /> : null}<span className="lbl">pk <b>{peakPct != null ? `+${Math.round(peakPct)}%` : "—"}</b></span></div>
          {write.canWrite && <div className="m2-pos-actions">
            {closingId === position.id ? <span className="m2-pos-closing">CLOSING…</span>
              : confirmId === position.id ? <><button type="button" className="confirm" onClick={() => confirmClose(position)}>CONFIRM CLOSE</button><button type="button" onClick={cancelClose}>CANCEL</button></>
              : <button type="button" className="arm" onClick={() => armClose(position.id)}>CLOSE POSITION</button>}
          </div>}
        </div>;
      })}
    </div>
    {closeErr && <div className="m2-close-error">close failed — {closeErr}</div>}
    {tagPrompt && <div className="m2-close-reasons">
      <header><b>{tagPrompt.label} CLOSED</b><span>WHY DID YOU EXIT?</span></header>
      <div>{MANUAL_CLOSE_REASONS.map((reason) => <button type="button" key={reason.value} disabled={tagging} title={reason.hint} onClick={() => tagClose(reason.value)}><b>{reason.label}</b><small>{reason.hint}</small></button>)}</div>
      <button type="button" className="skip" onClick={() => setTagPrompt(null)}>SKIP · LEAVE AS MANUAL</button>
    </div>}
  </section>;
}
