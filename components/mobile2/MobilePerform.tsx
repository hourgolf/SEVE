"use client";

import { Fragment } from "react";
import { IntradayChart } from "@/components/IntradayChart";
import { MobileDock } from "@/components/mobile2/MobileDock";
import { MobilePositions } from "@/components/mobile2/MobilePositions";
import type { useSentinelDigest } from "@/hooks/useSentinelDigest";
import { pmVar } from "@/lib/desk/colors";
import { timeOfDay } from "@/lib/format";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
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
  const { data, view, feed, spotUp, symbol, setSymbol } = props;

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

        <MobilePositions props={props} strategists={view.desk.strategists} />
        <SentinelSection symbol={symbol} sent={sent} />
        <TapeSection events={data.events} strategists={view.desk.strategists} />
      </div>

      <MobileDock channels={channels} livePnl={livePnl} lens={sent.lens} />
    </>
  );
}
