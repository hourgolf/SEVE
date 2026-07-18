"use client";

import type { useSentinelDigest, ScanRow } from "@/hooks/useSentinelDigest";
import { deriveSentinelReceiptStatus } from "@/lib/sentinel/receipt";

type SentinelDigest = ReturnType<typeof useSentinelDigest>;

export function deriveSentinelDigestReceipt(sentinel: SentinelDigest) {
  return deriveSentinelReceiptStatus({
    state: sentinel.state,
    err: sentinel.err,
    date: sentinel.date,
    forDate: sentinel.forDate || sentinel.brief?.forDate,
    session: sentinel.session,
    createdAt: sentinel.createdAt,
    publishedAt: sentinel.publishedAt,
    message: sentinel.message,
    schemaVersion: sentinel.schemaVersion,
    publisherVersion: sentinel.publisherVersion,
    briefAsOf: sentinel.brief?.asOf,
  });
}

const pct = (value: number | null | undefined): string => value == null ? "—" : `${Math.round(value)}%`;
const dateTime = (value: string): string => value ? new Date(value).toLocaleString("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
}) + " PT" : "—";

function EvidenceRows({ rows, empty }: { rows: ScanRow[]; empty: string }) {
  if (rows.length === 0) return <div className="sntw-empty">{empty}</div>;
  return <div className="sntw-evidence-rows">{rows.slice(0, 8).map((row) => <div key={row.slug}>
    <b>{row.slug}</b><span>pk {pct(row.peak)}</span><span>win {pct(row.win)}</span><span>give {pct(row.give)}</span><em>{row.n}t</em>
  </div>)}</div>;
}

export function SentinelReceiptStrip({ sentinel, compact = false }: { sentinel: SentinelDigest; compact?: boolean }) {
  const receipt = deriveSentinelDigestReceipt(sentinel);
  return <div className={`sentinel-receipt ${receipt.tone}${compact ? " compact" : ""}`} role="status">
    <i /><span><b>{receipt.label}</b><small>{receipt.detail}</small></span>
    {!compact && <><span><small>SOURCE</small><b>{receipt.source}</b></span><span><small>PUBLISHED</small><b>{dateTime(receipt.publishedAt)}</b></span></>}
  </div>;
}

export function SentinelWorkspace({ sentinel, symbol }: { sentinel: SentinelDigest; symbol: string }) {
  const { brief, scan, judge, state, err } = sentinel;
  const terrain = brief?.sentLevels?.[symbol];
  const above = terrain?.above ?? brief?.carry.above ?? [];
  const below = terrain?.below ?? brief?.carry.below ?? [];

  return <section className="sntw" id="perform-sentinel" tabIndex={-1} aria-label="Sentinel evidence workspace">
    <header className="sntw-head"><span><b>SENTINEL</b><small>next-open terrain · close review · evidence provenance</small></span>
      <em>DETERMINISTIC HEALTH ≠ INTERPRETIVE READ</em></header>
    <SentinelReceiptStrip sentinel={sentinel} />
    {state !== "ok" ? <div className="sntw-state"><b>{state.toUpperCase()}</b><span>{err || "Sentinel evidence is not available yet."}</span></div> : <div className="sntw-grid">
      <section className="sntw-card sntw-next">
        <header><span>01</span><b>NEXT OPEN</b><em>structured brief · deterministic inputs</em></header>
        {!brief ? <div className="sntw-empty">structured next-open brief unavailable</div> : <>
          <div className="sntw-day"><b>{brief.forDate || sentinel.forDate || "—"}</b><span>{brief.gap.cleared ? `GAP CLEARED ${brief.gap.spy >= 0 ? "+" : ""}${brief.gap.spy}%` : `GAP BOOK DARK ${brief.gap.spy >= 0 ? "+" : ""}${brief.gap.spy}%`}</span></div>
          <div className="sntw-sub">WATCH</div><ul>{brief.carry.watch.map((item, index) => <li key={index}>{item}</li>)}</ul>
          <div className="sntw-sub">LEVELS · {symbol}</div><div className="sntw-levels">
            {above.slice(0, 4).map((level) => <span key={`a-${level.px}`}><small>{level.label}</small><b>{level.px}</b></span>)}
            {below.slice(0, 4).map((level) => <span key={`b-${level.px}`}><small>{level.label}</small><b>{level.px}</b></span>)}
          </div>
          <div className="sntw-sub">EVENTS</div>{brief.events.length ? <ul>{brief.events.map((item, index) => <li key={index}>{item}</li>)}</ul> : <div className="sntw-empty inline">no scheduled event flags</div>}
          <div className="sntw-dealer">{brief.dealer.map((row) => <span key={row.sym}><b>{row.sym}</b><small>IV {row.atmIv}% · {row.gexShort ? "−GEX amplify" : "+GEX pin"}</small></span>)}</div>
        </>}
      </section>

      <section className="sntw-card sntw-read">
        <header><span>02</span><b>INTERPRETIVE READ</b><em>LLM synthesis · never a health claim</em></header>
        {!judge ? <div className="sntw-empty">interpretive judgment unavailable</div> : <>
          <div className="sntw-verdict"><b>{judge.verdict}</b><span>{judge.soWhat}</span></div>
          <div className="sntw-sub">OPPORTUNITIES</div>{judge.opportunities.length ? <ul>{judge.opportunities.map((item, index) => <li key={index}>{item}</li>)}</ul> : <div className="sntw-empty inline">nothing queued</div>}
          <div className="sntw-sub">DRIFT</div>{judge.drift.length ? <ul>{judge.drift.map((item, index) => <li key={index}>{item}</li>)}</ul> : <div className="sntw-empty inline">no doctrine drift reported</div>}
        </>}
      </section>

      <section className="sntw-card sntw-scan">
        <header><span>03</span><b>DETERMINISTIC SCAN</b><em>descriptive evidence · not an arm gate</em></header>
        {!scan ? <div className="sntw-empty">deterministic scan unavailable</div> : <div className="sntw-scan-grid">
          <div><div className="sntw-sub">PROMOTE CANDIDATES</div><EvidenceRows rows={scan.promote} empty="no promote candidates" /></div>
          <div><div className="sntw-sub">HARVEST FIXES</div><EvidenceRows rows={scan.fixable} empty="no harvest-fix candidates" /></div>
          <div><div className="sntw-sub">LIVE LEAKS</div><EvidenceRows rows={scan.leaks} empty="no live leaks" /></div>
        </div>}
      </section>
    </div>}
  </section>;
}
