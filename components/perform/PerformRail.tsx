"use client";

import { SystemHealthStrip } from "@/components/perform/SystemHealthStrip";
import { IncidentDetail } from "@/components/perform/IncidentDetail";
import type { useSentinelDigest } from "@/hooks/useSentinelDigest";
import type { Incident } from "@/lib/incident/deriveIncident";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay } from "@/lib/format";
import type { Position, StrategistState } from "@/lib/desk/types";
import type { MarketEvent } from "@/lib/types";
import { collapseEvents, type PerformSection } from "@/lib/perform/derivePerformView";
import { MANUAL_CLOSE_REASONS } from "@/lib/positions/manualClose";
import { usePositionCloseFlow } from "@/hooks/usePositionCloseFlow";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { deriveSentinelDigestReceipt } from "@/components/perform/SentinelWorkspace";
import type { OpsEvidenceChain, ReadinessItem } from "@/lib/ops/readiness";
import { deriveOpenPositionRows } from "@/lib/perform/derivePositionsWorkspace";
import type { ChannelWorkspaceModel } from "@/lib/channels/channelPassport";
import { DecisionAtlasFleetPulse } from "@/components/research/DecisionAtlasFleetPulse";
import type { DecisionAtlasReportsRead } from "@/hooks/useDecisionAtlasReports";

// PERFORM right rail (slice S2): POSITIONS (row-per-leg with pk glow ring +
// ratchet/LOCK-RIDE/giveback badges) · SENTINEL (verdict chip + one-line digest
// + promote step-pad + SENT level legend) · TAPE (live events, newest first).
// All data REUSED: feed.positions + usePositionPeaks (same peak source as the
// §03 book), useSentinelDigest (same §04 Brief/Sentinel fetch), data.events.

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

export function PositionsSection({
  positions, strategists, liveMarks, peaks, write, targeted, reconciliation, evidenceChains, channelWorkspace,
  attribution, onOpenChannel, onOpenContract,
}: {
  positions: Position[];
  strategists: StrategistState[];
  liveMarks?: Record<string, number>;
  peaks: Record<string, number>; // P5 slice 1 — from the page seam (usePositionPeaks lifted)
  write: SurfaceProps["write"];
  targeted: boolean;
  reconciliation?: ReadinessItem;
  evidenceChains?: OpsEvidenceChain[];
  channelWorkspace?: ChannelWorkspaceModel;
  attribution?: SurfaceProps["feed"]["positionAttribution"];
  onOpenChannel?: (slug: string) => void;
  onOpenContract?: (occ: string) => void;
}) {
  const closeFlow = usePositionCloseFlow(write);
  const stratOf = (slug: string) => strategists.find((s) => s.slug === slug);
  const rows = deriveOpenPositionRows(positions, liveMarks ?? {}, peaks);
  const total = rows.reduce((sum, row) => sum + row.unrealized, 0);

  return (
    <section className="pf-screen pf-hardware" id="perform-positions" data-nav-target={targeted || undefined} tabIndex={-1}>
      <div className="pf-head">
        <span className="t">POSITIONS · {attribution?.state === "blocked" ? "UNKNOWN" : `${positions.length} OPEN`}</span>
        <span className="grow" />
        <span className={`pf-basis${reconciliation ? ` reconciliation-${reconciliation.tone}` : ""}`} title={reconciliation?.detail ?? "Desk marks are operational estimates; broker reconciliation is shown in the full Book workspace."}>
          {reconciliation ? reconciliation.state.toLowerCase() : "desk marks · broker check in book"}
        </span>
        {positions.length > 0 && <span className={`x num ${total < 0 ? "neg" : "up"}`}>Σ {signedUsd(total)}</span>}
      </div>
      {attribution?.state === "recovered" && <div className="pf-position-attribution-recovered" role="status">
        <b>LEGACY ROUTE RECOVERED</b>
        <span>{attribution.issues.join(" · ")}</span>
        <small>Display attribution uses immutable opportunity and filled-entry evidence. Formal reconciliation still requires a position-bound receipt.</small>
      </div>}
      <div className="pfp-body">
        {attribution?.state === "blocked" ? (
          <div className="pf-position-attribution-blocked" role="alert">
            <b>DESK ATTRIBUTION BLOCKED</b>
            <span>{attribution.issues.join(" · ") || "immutable execution-account routing is unavailable"}</span>
            <small>No mutable channel-account fallback was used. See broker truth alongside this panel.</small>
          </div>
        ) : positions.length === 0 ? (
          <div className="pf-ghost">flat — no open positions</div>
        ) : rows.map((row) => {
          const p = row.position;
          const s = stratOf(p.strategist_slug);
          const pm = pmVar(s?.color ?? "green");
          const { mark, unrealized: unreal, returnPct, peakPct, givebackPct, capturePct, markedNotional } = row;
          const entry = p.avg_entry_price;
          const evidence = evidenceChains?.find((chain) => chain.positionId === p.id);
          const lock = (s?.config.take_profit_pct ?? 0) > 0;
          const rootPolicy = channelWorkspace?.bySlug[p.strategist_slug]?.rootPolicy;
          const a13 = rootPolicy?.runner === "a13";
          const dte = dteOf(p.expiration);
          return (
            <div className="pfp-row" key={p.id} style={{ ["--pm" as string]: pm }}>
              <span className="pfp-dot" />
              <div className="pfp-slug">{onOpenChannel ? <button type="button" onClick={() => onOpenChannel(p.strategist_slug)}>{p.strategist_slug}</button> : p.strategist_slug}</div>
              <div className={`pfp-pnl ${unreal < 0 ? "neg" : "pos"}`}>{signedUsd(unreal)}</div>
              <div className="pfp-ctr">{onOpenContract ? <button type="button" onClick={() => onOpenContract(p.occ_symbol)}>{occRoot(p.occ_symbol, s?.underlying ?? "SPY")} {p.strike.toFixed(0)}{p.opt_type === "call" ? "C" : "P"} ×{p.qty}{dte != null ? ` · ${dte}DTE` : ""}</button> : <>{occRoot(p.occ_symbol, s?.underlying ?? "SPY")} {p.strike.toFixed(0)}{p.opt_type === "call" ? "C" : "P"} ×{p.qty}{dte != null ? ` · ${dte}DTE` : ""}</>}</div>
              <div className="pfp-meta">{p.opened_at ? timeOfDay(p.opened_at) : "—"} · marked ${Math.round(markedNotional)}</div>
              <div className="pfp-decision">
                <span>IN <b>{entry.toFixed(2)}</b></span><i>→</i><span>MARK <b>{mark.toFixed(2)}</b></span>
                <span className={(returnPct ?? 0) < 0 ? "neg" : "pos"}>RET <b>{returnPct == null ? "—" : `${returnPct >= 0 ? "+" : ""}${Math.round(returnPct)}%`}</b></span>
                <span>BEST <b>{peakPct == null ? "—" : `+${Math.round(peakPct)}%`}</b></span>
                <span className={(givebackPct ?? 0) >= 40 ? "warn" : ""}>{givebackPct == null ? "CAPTURE" : "GIVEBACK"} <b>{givebackPct == null ? (capturePct == null ? "—" : `${Math.round(capturePct)}%`) : `${Math.round(givebackPct)}%`}</b></span>
              </div>
              <div className="pfp-tags">
                {rootPolicy && <span className="pfp-tag amber">{rootPolicy.managerLabel}</span>}
                <span className="pfp-tag">{a13 ? "RATCHET" : lock ? "LOCK" : "RIDE"}</span>
                {evidence && <span className={`pfp-tag evidence-${evidence.tone}`}>EVIDENCE {evidence.tone}</span>}
                {givebackPct != null && givebackPct >= 40 && <span className="pfp-tag warn">gave back {Math.round(givebackPct)}% of best gain</span>}
              </div>
              <div className="pfp-pk">
                {peakPct != null ? <Ring pct={peakPct} color={pm} /> : <span className="pfp-nopk">—</span>}
                <span className="pfp-pklbl">best <b>{peakPct != null ? `+${Math.round(peakPct)}%` : "—"}</b></span>
              </div>
              {write.canWrite && <div className="pfp-actions">
                {closeFlow.closingId === p.id ? <span className="pfp-closing">CLOSING…</span>
                  : closeFlow.confirmId === p.id ? <>
                    <button type="button" className="confirm" onClick={() => closeFlow.confirmClose(p)}>CONFIRM MARKET CLOSE</button>
                    <button type="button" onClick={closeFlow.cancelClose}>CANCEL</button>
                  </> : <button type="button" className="arm" onClick={() => closeFlow.armClose(p.id)}>CLOSE POSITION</button>}
              </div>}
            </div>
          );
        })}
      </div>
      {closeFlow.error && <div className="pfp-close-error" role="alert">POSITION ACTION FAILED · {closeFlow.error}</div>}
      {closeFlow.tagPrompt && <div className="pfp-close-reasons">
        <header><b>{closeFlow.tagPrompt.label} CLOSED</b><span>WHY DID YOU EXIT?</span></header>
        <div>{MANUAL_CLOSE_REASONS.map((reason) => <button type="button" key={reason.value} disabled={closeFlow.tagging} title={reason.hint} onClick={() => closeFlow.tagClose(reason.value)}><b>{reason.label}</b><small>{reason.hint}</small></button>)}</div>
        <button type="button" className="skip" onClick={closeFlow.dismissTag}>SKIP · LEAVE AS MANUAL</button>
      </div>}
    </section>
  );
}

type Digest = ReturnType<typeof useSentinelDigest>;

function SentinelSection({ symbol, sent, targeted }: { symbol: string; sent: Digest; targeted: boolean }) {
  const { judge, scan, brief, date, state } = sent;
  const receipt = deriveSentinelDigestReceipt(sent);
  const receiptText = receipt.tone === "green" && date ? `scan ${date.slice(5)}` : receipt.label.toLowerCase();

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
    <section className="pf-screen pf-hardware" id="perform-sentinel" data-nav-target={targeted || undefined} tabIndex={-1}>
      <div className="pf-head">
        <span className="t">SENTINEL</span>
        <span className="grow" />
        <span className={`x pf-receipt-${receipt.tone}`}>{receiptText} {receipt.tone === "green" ? "✓" : "!"}</span>
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

function TapeSection({ events, strategists, targeted }: { events: MarketEvent[]; strategists: StrategistState[]; targeted: boolean }) {
  const collapsed = collapseEvents(events);
  return (
    <section className="pf-screen pf-glass" id="perform-tape" data-nav-target={targeted || undefined} tabIndex={-1}>
      <div className="pf-head">
        <span className="t">TAPE</span>
        <span className="grow" />
        <span className="x"><span className="pf-livedot" />LIVE</span>
      </div>
      <div className="pft-body">
        {collapsed.length === 0 ? (
          <div className="pf-ghost">no events yet</div>
        ) : collapsed.map((e) => (
          <div className="pft-row" key={e.id}>
            <span className="pft-time num">{timeOfDay(e.created_at)}</span>
            <span className={`pft-kind ${KIND[e.level] ?? "info"}`}>{e.level === "RISK" ? "RISK" : e.level === "OK" ? "OK" : e.level}</span>
            <TapeMsg message={e.message} strategists={strategists} />
            {e.count > 1 && <span className="pft-count" title={`${e.count} adjacent identical events`}>×{e.count}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PerformRail({
  positions, strategists, liveMarks, peaks, events, symbol, sent, incident, write, section, channelWorkspace, decisionAtlas,
}: {
  positions: Position[];
  strategists: StrategistState[];
  liveMarks?: Record<string, number>;
  peaks: Record<string, number>;
  events: MarketEvent[];
  symbol: string;
  sent: Digest;
  incident: Incident;
  write: SurfaceProps["write"];
  section: PerformSection;
  channelWorkspace: ChannelWorkspaceModel;
  decisionAtlas: DecisionAtlasReportsRead;
}) {
  return (
    <aside className="pf-rail">
      {/* P5 slice 3 — deterministic system-health strip; open-position truth visible in every state. */}
      <SystemHealthStrip incident={incident} />
      <IncidentDetail incident={incident} />
      <DecisionAtlasFleetPulse reports={decisionAtlas} />
      {positions.length > 0 && <PositionsSection positions={positions} strategists={strategists} liveMarks={liveMarks} peaks={peaks} write={write} targeted={section === "positions"} channelWorkspace={channelWorkspace} />}
      <SentinelSection symbol={symbol} sent={sent} targeted={section === "sentinel"} />
      <TapeSection events={events} strategists={strategists} targeted={section === "tape"} />
    </aside>
  );
}
