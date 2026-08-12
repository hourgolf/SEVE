"use client";

import type { useSentinelDigest, ScanRow } from "@/hooks/useSentinelDigest";
import { deriveSentinelReceiptStatus } from "@/lib/sentinel/receipt";
import { deriveSentinelConfigurationFreshness } from "@/lib/sentinel/operatorPacket";
import { SeveEvidenceContext } from "@/components/ui/Seve909";

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
    publisherEvidenceState: sentinel.publisherEvidenceState || undefined,
    publisherEvidenceDetail: sentinel.publisherEvidenceDetail,
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
    <b>{row.slug}</b><span>best move {pct(row.peak)}</span><span>win {pct(row.win)}</span><span>giveback {pct(row.give)}</span><em>{row.n} trades</em>
  </div>)}</div>;
}

export function SentinelReceiptStrip({ sentinel, compact = false }: { sentinel: SentinelDigest; compact?: boolean }) {
  const receipt = deriveSentinelDigestReceipt(sentinel);
  return <div className={`sentinel-receipt ${receipt.tone}${compact ? " compact" : ""}`} role="status">
    <i /><span><b>{receipt.label}</b><small>{receipt.detail}</small></span>
    {!compact && <><span><small>SOURCE</small><b>{receipt.source}</b></span><span><small>PUBLISHED</small><b>{dateTime(receipt.publishedAt)}</b></span></>}
  </div>;
}

export function SentinelWorkspace({ sentinel, symbol, activeConfigurationHash }: { sentinel: SentinelDigest; symbol: string; activeConfigurationHash?: string | null }) {
  const { brief, scan, judge, operatorPacket, state, err } = sentinel;
  const deterministic = sentinel.interpretiveProvider === "none" || operatorPacket != null;
  const terrain = brief?.sentLevels?.[symbol];
  const above = terrain?.above ?? brief?.carry.above ?? [];
  const below = terrain?.below ?? brief?.carry.below ?? [];
  const receipt = deriveSentinelDigestReceipt(sentinel);
  const findings = operatorPacket?.findings ?? [];
  const configurationFreshness = deriveSentinelConfigurationFreshness(
    operatorPacket?.release.configurationSha256,
    activeConfigurationHash,
  );
  const packetSuperseded = configurationFreshness.state === "superseded";
  const nextAction = packetSuperseded
    ? "New paper settings are active. Hold them fixed for the next session and collect clean evidence; the older replay remains queued separately."
    : judge?.soWhat ?? (findings.some((finding) => finding.action === "replay")
    ? "Complete the queued replay before changing the paper configuration."
    : "Keep the current paper configuration while evidence collects.");
  const plainFinding = (action: string): string => action === "replay" ? "Replay required"
    : action === "collect" ? "Continue collecting" : action.replaceAll("_", " ");

  return <section className="sntw" id="perform-sentinel" tabIndex={-1} aria-label="Sentinel evidence workspace">
    <header className="sntw-head"><span><b>NEXT-SESSION BRIEF</b><small>NEXT ACTION · EXCEPTIONS</small></span>
      <em>READ ONLY</em></header>
    <SeveEvidenceContext kind="system" scope="all paper accounts" asOf={receipt.publishedAt ? dateTime(receipt.publishedAt) : "checking"} era="next-session packet" sample={`${findings.length || scan?.promote.length || 0} findings`} quality={packetSuperseded ? "partial" : receipt.tone === "green" ? "complete" : receipt.tone === "yellow" ? "partial" : "checking"} detail={packetSuperseded ? "This brief predates the active paper configuration. Its evidence remains valid history, but its configuration instruction is no longer current." : receipt.detail} />
    <section className={`sntw-priority ${packetSuperseded ? "yellow" : receipt.tone}`}><span><small>NEXT ACTION</small><b>{packetSuperseded ? "COLLECT" : judge?.verdict ?? (receipt.tone === "green" ? "REVIEW" : "WAIT")}</b><p>{nextAction}</p></span><em>{operatorPacket?.forDate ?? brief?.forDate ?? sentinel.forDate ?? "next session"}</em></section>
    <div className="sntw-simple-grid">
      <section><small>BRIEF CURRENT?</small><b>{packetSuperseded ? "SUPERSEDED" : configurationFreshness.state === "current" ? "YES" : receipt.tone === "green" ? "YES" : "PARTIAL"}</b><p>{packetSuperseded ? "A newer receipt-bound configuration is active. This packet is retained as historical evidence." : operatorPacket ? `${operatorPacket.liveBook.closed} closed trades reconciled; ${operatorPacket.liveBook.open} remain open.` : receipt.detail}</p></section>
      <section><small>WHAT NEEDS REVIEW?</small><b>{findings.length || judge?.drift.length || 0} ITEMS</b><ul>{findings.slice(0, 3).map((finding) => <li key={finding.code}>{finding.title} · {plainFinding(finding.action)}</li>)}{!findings.length && judge?.drift.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section><small>{packetSuperseded ? "ACTIVE PLAN" : "WHAT STAYS FIXED?"}</small><b>{packetSuperseded ? "NEW SETTINGS · COLLECT CLEAN SESSION" : "ENTRY · EXIT · MANAGER · SIZE · ROSTER"}</b></section>
    </div>
    <details className="sntw-technical"><summary><span><small>SUPPORTING EVIDENCE</small><b>Receipts, paths, levels, and deterministic scan</b></span><em>OPEN FOR DETAIL</em><i>▾</i></summary><div>
    <SentinelReceiptStrip sentinel={sentinel} />
    {state !== "ok" ? <div className="sntw-state"><b>{state.toUpperCase()}</b><span>{err || "Sentinel evidence is not available yet."}</span></div> : <div className="sntw-grid">
      <section className="sntw-card sntw-next">
        <header><span>01</span><b>NEXT OPEN</b><em>structured brief · deterministic inputs</em></header>
        {!brief && operatorPacket ? <>
          <div className="sntw-day"><b>{operatorPacket.forDate}</b><span>evidence {operatorPacket.overallState.replaceAll("_", " ")}</span></div>
          <div className="sntw-sub">SESSION RECEIPT</div>
          <ul>
            <li>release {operatorPacket.release.releaseId ?? "missing"} · {operatorPacket.release.state}{packetSuperseded ? " · superseded by active runtime" : ""}</li>
            <li>
              live {operatorPacket.liveBook.closed}/{operatorPacket.liveBook.opened} closed · {operatorPacket.liveBook.open} open
              {operatorPacket.liveBook.positionRows == null
                ? " · legacy position-row denominator"
                : ` · ${operatorPacket.liveBook.positionRows} position rows`}
            </li>
            <li>manager {operatorPacket.managerBook.terminal}/{operatorPacket.managerBook.observed} terminal · {operatorPacket.managerBook.censored} censored</li>
            <li>dark {operatorPacket.darkBook.rawDecisions} frozen · {operatorPacket.darkBook.exactContracts} exact contracts · {operatorPacket.darkBook.state.replaceAll("_", " ")}</li>
          </ul>
        </> : !brief ? <div className="sntw-empty">structured next-open brief unavailable</div> : <>
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
        <header><span>02</span><b>{deterministic ? "OPERATOR QUEUE" : "INTERPRETIVE READ"}</b><em>{deterministic ? "deterministic packet · no model authority" : "LLM synthesis · never a health claim"}</em></header>
        {!judge ? <div className="sntw-empty">{deterministic ? "operator queue unavailable" : "interpretive judgment unavailable"}</div> : <>
          <div className="sntw-verdict"><b>{judge.verdict}</b><span>{judge.soWhat}</span></div>
          <div className="sntw-sub">OPPORTUNITIES</div>{judge.opportunities.length ? <ul>{judge.opportunities.map((item, index) => <li key={index}>{item}</li>)}</ul> : <div className="sntw-empty inline">nothing queued</div>}
          <div className="sntw-sub">DRIFT</div>{judge.drift.length ? <ul>{judge.drift.map((item, index) => <li key={index}>{item}</li>)}</ul> : <div className="sntw-empty inline">no doctrine drift reported</div>}
        </>}
      </section>

      <section className="sntw-card sntw-scan">
        <header><span>03</span><b>DETERMINISTIC SCAN</b><em>descriptive evidence · not an arm gate</em></header>
        {operatorPacket ? <div className="sntw-scan-grid">
          <div><div className="sntw-sub">REVIEW QUEUE</div><div className="sntw-evidence-rows">{operatorPacket.findings.slice(0, 8).map((finding) => <div key={finding.code}>
            <b>{finding.title}</b><span>{finding.action.replaceAll("_", " ")}</span><em>{finding.tone}</em>
          </div>)}</div></div>
        </div> : !scan ? <div className="sntw-empty">deterministic scan unavailable</div> : <div className="sntw-scan-grid">
          <div><div className="sntw-sub">PROMOTE CANDIDATES</div><EvidenceRows rows={scan.promote} empty="no promote candidates" /></div>
          <div><div className="sntw-sub">HARVEST FIXES</div><EvidenceRows rows={scan.fixable} empty="no harvest-fix candidates" /></div>
          <div><div className="sntw-sub">LIVE LEAKS</div><EvidenceRows rows={scan.leaks} empty="no live leaks" /></div>
        </div>}
      </section>
    </div>}
    </div></details>
  </section>;
}
