"use client";

import { Fragment } from "react";
import type { useSentinelDigest } from "@/hooks/useSentinelDigest";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay } from "@/lib/format";
import type { Position, StrategistState } from "@/lib/desk/types";
import type { MarketEvent } from "@/lib/types";

// PERFORM right rail (slice S2): POSITIONS (row-per-leg with pk glow ring +
// ratchet/LOCK-RIDE/giveback badges) · SENTINEL (verdict chip + one-line digest
// + promote step-pad + SENT level legend) · TAPE (live events, newest first).
// All data REUSED: feed.positions + usePositionPeaks (same peak source as the
// §03 book), useSentinelDigest (same §04 Brief/Sentinel fetch), data.events.

const A13_SLUGS = new Set(["momo-shape"]); // registry A13 — momo giveback ratchet (live A/B)
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

// pk% glow ring — a small progress arc in the channel accent (mock's ring()).
function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 8, c = 2 * Math.PI * r, off = c * (1 - Math.min(Math.max(pct, 0), 100) / 100);
  return (
    <svg className="pfp-ring" viewBox="0 0 22 22" aria-hidden>
      <circle cx="11" cy="11" r={r} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="2.5" />
      <circle cx="11" cy="11" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 11 11)" style={{ filter: `drop-shadow(0 0 2px ${color})` }} />
    </svg>
  );
}

function PositionsSection({
  positions, strategists, liveMarks, peaks,
}: {
  positions: Position[];
  strategists: StrategistState[];
  liveMarks?: Record<string, number>;
  peaks: Record<string, number>; // P5 slice 1 — from the page seam (usePositionPeaks lifted)
}) {
  const stratOf = (slug: string) => strategists.find((s) => s.slug === slug);
  const markOf = (p: Position) => {
    const m = liveMarks?.[p.occ_symbol];
    if (m != null && Number.isFinite(m) && m > 0) return { mark: m, unreal: (m - p.avg_entry_price) * p.qty * 100 };
    return { mark: p.current_mark, unreal: p.unrealized_pnl };
  };
  const total = positions.reduce((a, p) => a + markOf(p).unreal, 0);

  return (
    <section className="pf-screen">
      <div className="pf-head">
        <span className="t">POSITIONS · {positions.length} OPEN</span>
        <span className="grow" />
        {positions.length > 0 && <span className={`x num ${total < 0 ? "neg" : "up"}`}>Σ {signedUsd(total)}</span>}
      </div>
      <div className="pfp-body">
        {positions.length === 0 ? (
          <div className="pf-ghost">flat — no open positions</div>
        ) : positions.map((p) => {
          const s = stratOf(p.strategist_slug);
          const pm = pmVar(s?.color ?? "green");
          const { mark, unreal } = markOf(p);
          const entry = p.avg_entry_price;
          const peak = peaks[p.occ_symbol] ?? 0;
          const peakPct = entry > 0 && peak > entry ? ((peak - entry) / entry) * 100 : null;
          const gavePct = peakPct != null && mark < peak ? Math.min(999, ((peak - mark) / (peak - entry)) * 100) : null;
          const lock = (s?.config.take_profit_pct ?? 0) > 0;
          const dte = dteOf(p.expiration);
          return (
            <div className="pfp-row" key={p.id} style={{ ["--pm" as string]: pm }}>
              <span className="pfp-dot" />
              <div className="pfp-slug">{p.strategist_slug}</div>
              <div className={`pfp-pnl ${unreal < 0 ? "neg" : "pos"}`}>{signedUsd(unreal)}</div>
              <div className="pfp-ctr">
                {occRoot(p.occ_symbol, s?.underlying ?? "SPY")} {p.strike.toFixed(0)}{p.opt_type === "call" ? "C" : "P"} ×{p.qty}{dte != null ? ` · ${dte}DTE` : ""}
              </div>
              <div className="pfp-meta">in @{entry.toFixed(2)}{p.opened_at ? ` · ${timeOfDay(p.opened_at)}` : ""}</div>
              <div className="pfp-tags">
                {A13_SLUGS.has(p.strategist_slug) && <span className="pfp-tag amber">⚡ A13 ratchet</span>}
                <span className="pfp-tag">{lock ? "LOCK" : "RIDE"}</span>
                {gavePct != null && gavePct >= 40 && <span className="pfp-tag warn">giveback {Math.round(gavePct)}% of pk</span>}
              </div>
              <div className="pfp-pk">
                {peakPct != null ? <Ring pct={peakPct} color={pm} /> : <span className="pfp-nopk">—</span>}
                <span className="pfp-pklbl">pk <b>{peakPct != null ? `+${Math.round(peakPct)}%` : "—"}</b></span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type Digest = ReturnType<typeof useSentinelDigest>;

function SentinelSection({ symbol, sent }: { symbol: string; sent: Digest }) {
  const { judge, scan, brief, date, state } = sent;

  // SENT level legend — the same terrain the §01 SENT chip draws (per-index
  // sentLevels; carry fallback). γ-wall amber · PD/swing grey · gap-arm green.
  const terrain = brief?.sentLevels?.[symbol];
  const above = terrain?.above ?? brief?.carry.above ?? [];
  const below = terrain?.below ?? brief?.carry.below ?? [];
  const all = [...above, ...below];
  const gamma = all.find((l) => l.label.includes("γ"));
  const swing = all.find((l) => !l.label.includes("γ"));
  const armHi = terrain?.armHi ?? brief?.carry.bandHi ?? null;

  // promote step-pad — the nearest bench candidate's sample toward the N=15 arm gate.
  const cand = scan?.promote?.[0] ?? scan?.fixable?.[0] ?? null;
  const n = cand ? Math.min(cand.n, 15) : 0;

  const verdict = judge?.verdict ?? "HOLD";
  const vcls = verdict === "QUEUE" ? "queue" : verdict === "WATCH" ? "watch" : "hold";

  return (
    <section className="pf-screen">
      <div className="pf-head">
        <span className="t">SENTINEL</span>
        <span className="grow" />
        <span className="x">{state === "ok" && date ? `scan ${date.slice(5)} ` : "no scan "}
          {state === "ok" ? <span className="pf-ok">✓</span> : ""}</span>
      </div>
      <div className="pfs-body">
        {state !== "ok" || !judge ? (
          <div className="pf-ghost">no verdict yet — runs after each close</div>
        ) : (
          <>
            <div className="pfs-top">
              <span className={`pfs-verdict ${vcls}`}>{verdict}</span>
              <span className="pfs-msg">{judge.soWhat}</span>
            </div>
            {cand && (
              <div className="pfs-steps" title={`${cand.slug} — sample ${cand.n} toward the N=15 arm gate`}>
                {Array.from({ length: 15 }, (_, i) => <i key={i} className={i < n ? "lit" : ""} />)}
                <span className="pfs-steps-n num">{n}/15</span>
              </div>
            )}
            {(gamma || swing || armHi != null) && (
              <div className="pfs-ladder">
                {gamma && <span className="pfs-lvl"><i style={{ background: "var(--pf-amber)" }} />γ-wall <b>{gamma.px}</b></span>}
                {swing && <span className="pfs-lvl"><i style={{ background: "var(--dk-mut)" }} />{swing.label.slice(0, 10)} <b>{swing.px}</b></span>}
                {armHi != null && <span className="pfs-lvl"><i style={{ background: "var(--pf-green)" }} />gap-arm <b>{armHi}</b></span>}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const KIND: Record<string, string> = { EXEC: "exec", WARN: "warn", RISK: "warn", INFO: "info", OK: "info" };

// Light slug highlight — color the channel name where it appears in the message.
function TapeMsg({ message, strategists }: { message: string; strategists: StrategistState[] }) {
  const hit = strategists.find((s) => message.includes(s.slug));
  if (!hit) return <span className="pft-msg">{message}</span>;
  const i = message.indexOf(hit.slug);
  return (
    <span className="pft-msg">
      {message.slice(0, i)}
      <span className="pft-ch" style={{ color: pmVar(hit.color) }}>{hit.slug}</span>
      {message.slice(i + hit.slug.length)}
    </span>
  );
}

function TapeSection({ events, strategists }: { events: MarketEvent[]; strategists: StrategistState[] }) {
  return (
    <section className="pf-screen">
      <div className="pf-head">
        <span className="t">TAPE</span>
        <span className="grow" />
        <span className="x"><span className="pf-livedot" />LIVE</span>
      </div>
      <div className="pft-body">
        {events.length === 0 ? (
          <div className="pf-ghost">no events yet</div>
        ) : events.map((e) => (
          <Fragment key={e.id}>
            <div className="pft-row">
              <span className="pft-time num">{timeOfDay(e.created_at)}</span>
              <span className={`pft-kind ${KIND[e.level] ?? "info"}`}>{e.level === "RISK" ? "RISK" : e.level === "OK" ? "OK" : e.level}</span>
              <TapeMsg message={e.message} strategists={strategists} />
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  );
}

export function PerformRail({
  positions, strategists, liveMarks, peaks, events, symbol, sent,
}: {
  positions: Position[];
  strategists: StrategistState[];
  liveMarks?: Record<string, number>;
  peaks: Record<string, number>;
  events: MarketEvent[];
  symbol: string;
  sent: Digest;
}) {
  return (
    <aside className="pf-rail">
      <PositionsSection positions={positions} strategists={strategists} liveMarks={liveMarks} peaks={peaks} />
      <SentinelSection symbol={symbol} sent={sent} />
      <TapeSection events={events} strategists={strategists} />
    </aside>
  );
}
