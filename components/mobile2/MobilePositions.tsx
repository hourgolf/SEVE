"use client";

import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay } from "@/lib/format";
import type { StrategistState } from "@/lib/desk/types";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { MANUAL_CLOSE_REASONS } from "@/lib/positions/manualClose";
import { usePositionCloseFlow } from "@/hooks/usePositionCloseFlow";
import { deriveOpenPositionRows } from "@/lib/perform/derivePositionsWorkspace";
import { DAY1_ROOTS } from "@/lib/channels/day1Release";

const hasExecutableA13 = (slug: string) => !!DAY1_ROOTS[slug]?.givebackTrail;
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
  const closeFlow = usePositionCloseFlow(write);

  const stratOf = (slug: string) => strategists.find((s) => s.slug === slug);
  const rows = deriveOpenPositionRows(positions, liveMarks ?? {}, positionPeaks);
  const total = rows.reduce((sum, row) => sum + row.unrealized, 0);

  return <section className={`m2-screen m2-hardware m2-position-book${compact ? " compact" : ""}`}>
    <div className="m2-phead">
      <span className="t">OPEN POSITIONS · {positions.length}</span><span className="grow" />
      {positions.length > 0 && <span className={`x num ${total < 0 ? "neg" : "up"}`}>Σ {signedUsd(total)}</span>}
    </div>
    <div>
      {positions.length === 0 ? <div className="m2-ghost">flat — no open positions</div> : rows.map((row) => {
        const position = row.position;
        const strategist = stratOf(position.strategist_slug);
        const pm = pmVar(strategist?.color ?? "green");
        const { mark, unrealized: unreal, returnPct, peakPct, givebackPct, capturePct, markedNotional } = row;
        const entry = position.avg_entry_price;
        const evidence = props.opsReadiness.chains.find((chain) => chain.positionId === position.id);
        const lock = (strategist?.config.take_profit_pct ?? 0) > 0;
        const a13 = hasExecutableA13(position.strategist_slug);
        const dte = dteOf(position.expiration);
        return <div className="m2-pos-row" key={position.id} style={{ ["--pm" as string]: pm }}>
          <span className="m2-p-dot" />
          <div className="m2-p-slug">{position.strategist_slug}</div>
          <div className={`m2-p-pnl num ${unreal < 0 ? "neg" : "pos"}`}>{signedUsd(unreal)}</div>
          <div className="m2-p-ctr">{occRoot(position.occ_symbol, strategist?.underlying ?? "SPY")} {position.strike.toFixed(0)}{position.opt_type === "call" ? "C" : "P"} ×{position.qty}{dte != null ? ` · ${dte}DTE` : ""}</div>
          <div className="m2-p-meta">{position.opened_at ? timeOfDay(position.opened_at) : "—"} · ${Math.round(markedNotional)}</div>
          <div className="m2-p-decision">
            <span>IN <b>{entry.toFixed(2)}</b></span><i>→</i><span>MARK <b>{mark.toFixed(2)}</b></span>
            <span className={(returnPct ?? 0) < 0 ? "neg" : "pos"}>RET <b>{returnPct == null ? "—" : `${returnPct >= 0 ? "+" : ""}${Math.round(returnPct)}%`}</b></span>
            <span>PK <b>{peakPct == null ? "—" : `+${Math.round(peakPct)}%`}</b></span>
            <span className={(givebackPct ?? 0) >= 40 ? "warn" : ""}>{givebackPct == null ? "CAP" : "GIVE"} <b>{givebackPct == null ? (capturePct == null ? "—" : `${Math.round(capturePct)}%`) : `${Math.round(givebackPct)}%`}</b></span>
          </div>
          <div className="m2-p-tags">
            {a13 && <span className="m2-tag amber">⚡ A13 armed +50% · keep ⅔</span>}
            <span className="m2-tag">{a13 ? "RATCHET" : lock ? "LOCK" : "RIDE"}</span>
            {evidence && <span className={`m2-tag evidence-${evidence.tone}`}>EVIDENCE {evidence.tone}</span>}
            {givebackPct != null && givebackPct >= 40 && <span className="m2-tag warn">giveback {Math.round(givebackPct)}% of pk</span>}
          </div>
          <div className="m2-p-pk">{peakPct != null ? <Ring pct={peakPct} color={pm} /> : null}<span className="lbl">pk <b>{peakPct != null ? `+${Math.round(peakPct)}%` : "—"}</b></span></div>
          {write.canWrite && <div className="m2-pos-actions">
            {closeFlow.closingId === position.id ? <span className="m2-pos-closing">CLOSING…</span>
              : closeFlow.confirmId === position.id ? <><button type="button" className="confirm" onClick={() => closeFlow.confirmClose(position)}>CONFIRM CLOSE</button><button type="button" onClick={closeFlow.cancelClose}>CANCEL</button></>
              : <button type="button" className="arm" onClick={() => closeFlow.armClose(position.id)}>CLOSE POSITION</button>}
          </div>}
        </div>;
      })}
    </div>
    {closeFlow.error && <div className="m2-close-error">position action failed — {closeFlow.error}</div>}
    {closeFlow.tagPrompt && <div className="m2-close-reasons">
      <header><b>{closeFlow.tagPrompt.label} CLOSED</b><span>WHY DID YOU EXIT?</span></header>
      <div>{MANUAL_CLOSE_REASONS.map((reason) => <button type="button" key={reason.value} disabled={closeFlow.tagging} title={reason.hint} onClick={() => closeFlow.tagClose(reason.value)}><b>{reason.label}</b><small>{reason.hint}</small></button>)}</div>
      <button type="button" className="skip" onClick={closeFlow.dismissTag}>SKIP · LEAVE AS MANUAL</button>
    </div>}
  </section>;
}
