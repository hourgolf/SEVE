"use client";

import { Fragment } from "react";
import { IntradayChart } from "@/components/IntradayChart";
import { MobileDock } from "@/components/mobile2/MobileDock";
import type { useSentinelDigest } from "@/hooks/useSentinelDigest";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay } from "@/lib/format";
import type { ChannelPnl, Position, StrategistState } from "@/lib/desk/types";
import type { MarketEvent } from "@/lib/types";
import type { SurfaceProps } from "@/components/surfaceTypes";

// =============================================================================
// MOBILE · PERFORM (S5) — the watch surface as ONE vertical scroll (the gallery
// mock's perform frame): chart+SENT → positions → sentinel → tape, with the
// 2-row chicklet dock pinned above the tab bar. Every data source is REUSED from
// the seam (IntradayChart, feed.positions + usePositionPeaks, useSentinelDigest,
// data.events, the account-scoped roster). This is the phone twin of the desktop
// PerformSurface/PerformRail — parallel markup, identical semantics.
// =============================================================================

type Digest = ReturnType<typeof useSentinelDigest>;
const A13_SLUGS = new Set(["momo-shape"]); // registry A13 — momo giveback ratchet
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

// pk% glow ring — the channel-accent progress arc (mock ring()).
function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 8, c = 2 * Math.PI * r, off = c * (1 - Math.min(Math.max(pct, 0), 100) / 100);
  return (
    <svg className="m2-ring" viewBox="0 0 22 22" aria-hidden>
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
    <section className="m2-screen m2-hardware">
      <div className="m2-phead">
        <span className="t">POSITIONS · {positions.length} OPEN</span>
        <span className="grow" />
        {positions.length > 0 && <span className={`x num ${total < 0 ? "neg" : "up"}`}>Σ {signedUsd(total)}</span>}
      </div>
      <div>
        {positions.length === 0 ? (
          <div className="m2-ghost">flat — no open positions</div>
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
            <div className="m2-pos-row" key={p.id} style={{ ["--pm" as string]: pm }}>
              <span className="m2-p-dot" />
              <div className="m2-p-slug">{p.strategist_slug}</div>
              <div className={`m2-p-pnl num ${unreal < 0 ? "neg" : "pos"}`}>{signedUsd(unreal)}</div>
              <div className="m2-p-ctr">
                {occRoot(p.occ_symbol, s?.underlying ?? "SPY")} {p.strike.toFixed(0)}{p.opt_type === "call" ? "C" : "P"} ×{p.qty}{dte != null ? ` · ${dte}DTE` : ""}
              </div>
              <div className="m2-p-meta">in @{entry.toFixed(2)}{p.opened_at ? ` · ${timeOfDay(p.opened_at)}` : ""}</div>
              <div className="m2-p-tags">
                {A13_SLUGS.has(p.strategist_slug) && <span className="m2-tag amber">⚡ A13 ratchet</span>}
                <span className="m2-tag">{lock ? "LOCK" : "RIDE"}</span>
                {gavePct != null && gavePct >= 40 && <span className="m2-tag warn">giveback {Math.round(gavePct)}% of pk</span>}
              </div>
              <div className="m2-p-pk">
                {peakPct != null ? <Ring pct={peakPct} color={pm} /> : null}
                <span className="lbl">pk <b>{peakPct != null ? `+${Math.round(peakPct)}%` : "—"}</b></span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SentinelSection({ symbol, sent }: { symbol: string; sent: Digest }) {
  const { judge, scan, brief, date, state } = sent;
  const terrain = brief?.sentLevels?.[symbol];
  const above = terrain?.above ?? brief?.carry.above ?? [];
  const below = terrain?.below ?? brief?.carry.below ?? [];
  const all = [...above, ...below];
  const gamma = all.find((l) => l.label.includes("γ"));
  const swing = all.find((l) => !l.label.includes("γ"));
  const armHi = terrain?.armHi ?? brief?.carry.bandHi ?? null;

  const cand = scan?.promote?.[0] ?? scan?.fixable?.[0] ?? null;
  const n = cand ? Math.min(cand.n, 15) : 0;
  const verdict = judge?.verdict ?? "HOLD";
  const vcls = verdict === "QUEUE" ? "queue" : verdict === "WATCH" ? "watch" : "hold";

  return (
    <section className="m2-screen m2-hardware">
      <div className="m2-phead">
        <span className="t">SENTINEL</span>
        <span className="grow" />
        <span className="x">{state === "ok" && date ? `scan ${date.slice(5)} ` : "no scan "}
          {state === "ok" ? <span className="m2-ok">✓</span> : ""}</span>
      </div>
      <div className="m2-sent-body">
        {state !== "ok" || !judge ? (
          <div className="m2-ghost">no verdict yet — runs after each close</div>
        ) : (
          <>
            <div className="m2-sent-top">
              <span className={`m2-verdict ${vcls}`}>{verdict}</span>
              <span className="m2-sent-msg">{judge.soWhat}</span>
            </div>
            {cand && (
              <div className="m2-steps" title={`${cand.slug} — sample ${cand.n} toward the N=15 arm gate`}>
                {Array.from({ length: 15 }, (_, i) => <i key={i} className={i < n ? "lit" : ""} />)}
                <span className="m2-steps-n num">{n}/15</span>
              </div>
            )}
            {(gamma || swing || armHi != null) && (
              <div className="m2-ladder">
                {gamma && <span className="m2-lvl"><i style={{ background: "var(--m2-amber)" }} />γ-wall <b>{gamma.px}</b></span>}
                {swing && <span className="m2-lvl"><i style={{ background: "var(--m2-mut)" }} />{swing.label.slice(0, 10)} <b>{swing.px}</b></span>}
                {armHi != null && <span className="m2-lvl"><i style={{ background: "var(--m2-green)" }} />gap-arm <b>{armHi}</b></span>}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const KIND: Record<string, string> = { EXEC: "exec", WARN: "warn", RISK: "warn", INFO: "info", OK: "info" };

function TapeMsg({ message, strategists }: { message: string; strategists: StrategistState[] }) {
  const hit = strategists.find((s) => message.includes(s.slug));
  if (!hit) return <span className="m2-t-msg">{message}</span>;
  const i = message.indexOf(hit.slug);
  return (
    <span className="m2-t-msg">
      {message.slice(0, i)}
      <span className="ch" style={{ color: pmVar(hit.color) }}>{hit.slug}</span>
      {message.slice(i + hit.slug.length)}
    </span>
  );
}

function TapeSection({ events, strategists }: { events: MarketEvent[]; strategists: StrategistState[] }) {
  return (
    <section className="m2-screen m2-glass">
      <div className="m2-phead">
        <span className="t">TAPE</span>
        <span className="grow" />
        <span className="x"><span className="m2-livedot" />LIVE</span>
      </div>
      <div>
        {events.length === 0 ? (
          <div className="m2-ghost">no events yet</div>
        ) : events.slice(0, 40).map((e) => (
          <Fragment key={e.id}>
            <div className="m2-trow">
              <span className="m2-t-time num">{timeOfDay(e.created_at)}</span>
              <span className={`m2-t-kind ${KIND[e.level] ?? "info"}`}>{e.level === "RISK" ? "RISK" : e.level === "OK" ? "OK" : e.level}</span>
              <TapeMsg message={e.message} strategists={strategists} />
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  );
}

export function MobilePerform({
  props, channels, sent, livePnl,
}: {
  props: SurfaceProps;
  channels: StrategistState[];
  sent: Digest;
  livePnl: Record<string, ChannelPnl>;
}) {
  const { data, view, feed, spotUp, symbol, setSymbol, liveMarks } = props;

  return (
    <>
      <div className="m2-scroll">
        <section className="m2-screen">
          <div className="m2-phead">
            <span className="idx">01</span>
            <span className="t">{symbol} · LIVE</span>
            <span className="grow" />
          </div>
          <div className="m2-chart-body">
            <IntradayChart
              bars={data.bars}
              dailyBars={data.dailyBars}
              spot={data.spot}
              spotUp={spotUp}
              mobile
              trades={feed.recentTrades}
              openPositions={feed.positions}
              symbol={symbol}
              onSymbolChange={setSymbol}
            />
          </div>
        </section>

        <PositionsSection positions={feed.positions} strategists={view.desk.strategists} liveMarks={liveMarks} peaks={props.positionPeaks} />
        <SentinelSection symbol={symbol} sent={sent} />
        <TapeSection events={data.events} strategists={view.desk.strategists} />
      </div>

      <MobileDock channels={channels} livePnl={livePnl} lens={sent.lens} />
    </>
  );
}
