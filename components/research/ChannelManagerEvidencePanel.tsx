"use client";

import "@/app/manager-evidence.css";
import { useEffect, useMemo, useState } from "react";
import type {
  ChannelManagerArmSummary,
  ChannelManagerEvidence,
  ChannelManagerTradePoint,
  CommonManagerId,
} from "@/lib/research/channelManagerEvidence";
import { filterChannelManagerEvidenceByEpoch } from "@/lib/research/channelManagerEvidence";

const signedPct = (value: number | null, digits = 1): string => value == null
  ? "—"
  : `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(digits)}%`;
const pct = (value: number | null): string => value == null ? "—" : `${Math.round(value * 100)}%`;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const percentile = (values: readonly number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};

function bestDefault(evidence: ChannelManagerEvidence): CommonManagerId {
  return [...evidence.managers].sort((left, right) =>
    (right.medianDeltaPct ?? Number.NEGATIVE_INFINITY) - (left.medianDeltaPct ?? Number.NEGATIVE_INFINITY)
    || right.terminalPaths - left.terminalPaths)[0]?.managerId ?? "LOCK20/30";
}

function Ladder({ evidence, selected, onSelect }: {
  evidence: ChannelManagerEvidence;
  selected: CommonManagerId;
  onSelect: (manager: CommonManagerId) => void;
}) {
  const ranked = [...evidence.managers].sort((left, right) =>
    (right.medianDeltaPct ?? Number.NEGATIVE_INFINITY) - (left.medianDeltaPct ?? Number.NEGATIVE_INFINITY)
    || (right.meanDeltaPct ?? Number.NEGATIVE_INFINITY) - (left.meanDeltaPct ?? Number.NEGATIVE_INFINITY));
  const extent = Math.max(10, ...ranked.flatMap((row) => [
    Math.abs(row.deltaConfidence95.lower ?? row.medianDeltaPct ?? 0),
    Math.abs(row.deltaConfidence95.upper ?? row.medianDeltaPct ?? 0),
  ]));
  const x = (value: number | null): number => value == null ? 50 : 50 + (clamp(value, -extent, extent) / extent) * 47;
  return <div className="cme-ladder" aria-label="Eight manager paired-return ladder">
    <div className="cme-ladder-head"><span>MANAGER</span><span>PAIRED Δ RETURN · 95% SESSION INTERVAL</span><span>TYPICAL</span><span>RELIABILITY</span></div>
    {ranked.map((manager) => {
      const low = x(manager.deltaConfidence95.lower ?? manager.medianDeltaPct);
      const high = x(manager.deltaConfidence95.upper ?? manager.medianDeltaPct);
      const median = x(manager.medianDeltaPct);
      const mean = x(manager.meanDeltaPct);
      return <button type="button" key={manager.managerId} className={`cme-manager ${manager.verdict}${selected === manager.managerId ? " selected" : ""}`} onClick={() => onSelect(manager.managerId)} aria-pressed={selected === manager.managerId}>
        <span className="cme-manager-name"><b>{manager.managerId}</b><em>{manager.verdict.toUpperCase()}</em></span>
        <span className="cme-whisker" aria-label={`${manager.managerId} median paired return ${signedPct(manager.medianDeltaPct)}`}>
          <i className="zero" /><i className="range" style={{ left: `${Math.min(low, high)}%`, width: `${Math.max(1, Math.abs(high - low))}%` }} />
          <i className="mean" style={{ left: `${mean}%` }} /><i className="median" style={{ left: `${median}%` }} />
        </span>
        <span className={`cme-delta ${(manager.medianDeltaPct ?? 0) >= 0 ? "pos" : "neg"}`}><b>{signedPct(manager.medianDeltaPct)}</b><em>mean {signedPct(manager.meanDeltaPct)}</em></span>
        <span className="cme-reliability"><b>{pct(manager.beatRate)} beat</b><em>{manager.terminalPaths} paths · {manager.sessions}s · p10 {signedPct(manager.p10ReturnPct, 0)}</em></span>
      </button>;
    })}
    <footer>DOT = MEDIAN · TICK = MEAN · BAR = SESSION-CLUSTERED 95% INTERVAL · DELTA VS CANONICAL EXECUTED ROOT+RUNNER RESULT</footer>
  </div>;
}

function CaptureScatter({ evidence, managerId }: { evidence: ChannelManagerEvidence; managerId: CommonManagerId }) {
  const points = evidence.trades.flatMap((trade) => {
    const arm = trade.arms.find((candidate) => candidate.managerId === managerId);
    return trade.commonMfePct != null && trade.actualReturnPct != null && arm?.returnPct != null
      ? [{ trade, managerReturn: arm.returnPct }]
      : [];
  });
  if (!points.length) return <div className="cme-empty-detail">No complete common-horizon MFE pair for this manager yet.</div>;
  const xValues = points.map((point) => Math.max(0, point.trade.commonMfePct as number));
  const yValues = points.flatMap((point) => [point.managerReturn, point.trade.actualReturnPct as number]);
  const xMax = Math.max(25, percentile(xValues, .95));
  const yMin = Math.min(-30, percentile(yValues, .05));
  const yMax = Math.max(30, percentile(yValues, .95));
  const sx = (value: number) => 54 + (clamp(value, 0, xMax) / xMax) * 536;
  const sy = (value: number) => 220 - ((clamp(value, yMin, yMax) - yMin) / (yMax - yMin)) * 184;
  return <div className="cme-scatter">
    <svg viewBox="0 0 620 250" role="img" aria-label={`${managerId} opportunity capture scatter`}>
      <line className="grid" x1="54" x2="590" y1={sy(0)} y2={sy(0)} /><line className="axis" x1="54" x2="54" y1="36" y2="220" /><line className="axis" x1="54" x2="590" y1="220" y2="220" />
      <text x="54" y="238">0</text><text x="590" y="238" textAnchor="end">{Math.round(xMax)}% MFE</text>
      <text x="48" y={sy(yMax) + 3} textAnchor="end">{signedPct(yMax, 0)}</text><text x="48" y={sy(0) + 3} textAnchor="end">0</text><text x="48" y={sy(yMin) + 3} textAnchor="end">{signedPct(yMin, 0)}</text>
      <text className="axis-title" x="322" y="249" textAnchor="middle">COMMON-HORIZON PROFIT OPPORTUNITY</text>
      {points.map(({ trade, managerReturn }) => {
        const x = sx(trade.commonMfePct as number);
        const actualY = sy(trade.actualReturnPct as number);
        const managerY = sy(managerReturn);
        const clipped = (trade.commonMfePct as number) > xMax || managerReturn < yMin || managerReturn > yMax || (trade.actualReturnPct as number) < yMin || (trade.actualReturnPct as number) > yMax;
        return <g key={trade.positionId} className={clipped ? "clipped" : ""}>
          <title>{trade.session} · MFE {signedPct(trade.commonMfePct)} · executed {signedPct(trade.actualReturnPct)} · {managerId} {signedPct(managerReturn)}</title>
          <line className="pair" x1={x} x2={x} y1={actualY} y2={managerY} />
          <circle className="actual" cx={x} cy={actualY} r="4" /><circle className={managerReturn >= (trade.actualReturnPct as number) ? "manager better" : "manager worse"} cx={x} cy={managerY} r="4.5" />
        </g>;
      })}
    </svg>
    <div className="cme-legend"><span><i className="actual" />EXECUTED</span><span><i className="manager" />{managerId}</span><em>{points.length}/{evidence.positions} complete MFE pairs · edge points pin to the frame</em></div>
  </div>;
}

function TradeTape({ evidence, managerId }: { evidence: ChannelManagerEvidence; managerId: CommonManagerId }) {
  const points = evidence.trades.flatMap((trade) => {
    const arm = trade.arms.find((candidate) => candidate.managerId === managerId);
    return trade.actualReturnPct != null && arm?.returnPct != null ? [{ trade, managerReturn: arm.returnPct }] : [];
  }).slice(-12).reverse();
  if (!points.length) return <div className="cme-empty-detail">No paired terminal trades for this manager yet.</div>;
  const extent = Math.max(25, percentile(points.flatMap((point) => [Math.abs(point.managerReturn), Math.abs(point.trade.actualReturnPct as number)]), .95));
  const x = (value: number): number => 50 + (clamp(value, -extent, extent) / extent) * 47;
  return <div className="cme-tape" aria-label={`${managerId} chronological paired trade strip`}>
    <header><span>SESSION</span><span>EXECUTED ↔ SHADOW RETURN</span><span>Δ</span></header>
    {points.map(({ trade, managerReturn }) => {
      const actual = trade.actualReturnPct as number;
      const delta = managerReturn - actual;
      const left = x(Math.min(actual, managerReturn));
      const right = x(Math.max(actual, managerReturn));
      return <div key={trade.positionId}><time>{trade.session.slice(5)}</time><span className="cme-tape-track"><i className="zero" /><i className="pair" style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }} /><i className="actual" style={{ left: `${x(actual)}%` }} /><i className="manager" style={{ left: `${x(managerReturn)}%` }} /></span><b className={delta >= 0 ? "pos" : "neg"}>{signedPct(delta)}</b></div>;
    })}
    <footer>LAST {points.length} PAIRED POSITIONS · SAME ENTRY, TWO EXIT RESULTS · AXIS ±{Math.round(extent)}%</footer>
  </div>;
}

export function ChannelManagerEvidencePanel({ evidence, currentManagerLabel, currentConfigurationEpochId, compact = false }: {
  evidence?: ChannelManagerEvidence | null;
  currentManagerLabel?: string | null;
  currentConfigurationEpochId?: string | null;
  compact?: boolean;
}) {
  const [selectedManager, setSelectedManager] = useState<CommonManagerId>("LOCK20/30");
  const [detail, setDetail] = useState<"capture" | "tape">("capture");
  const currentEpochAvailable = !!evidence && !!currentConfigurationEpochId
    && evidence.configurationEpochs.some((epoch) => epoch.id === currentConfigurationEpochId);
  const [scope, setScope] = useState<"current" | "all">("current");
  const scopedEvidence = useMemo(() => evidence && scope === "current" && currentEpochAvailable
    ? filterChannelManagerEvidenceByEpoch(evidence, currentConfigurationEpochId ?? null)
    : evidence, [evidence, scope, currentEpochAvailable, currentConfigurationEpochId]);
  useEffect(() => {
    if (!currentEpochAvailable) setScope("all");
  }, [evidence?.slug, currentConfigurationEpochId, currentEpochAvailable]);
  useEffect(() => { if (scopedEvidence) setSelectedManager(bestDefault(scopedEvidence)); }, [scopedEvidence?.slug, scopedEvidence?.positions, scope]);
  const selected = useMemo(() => scopedEvidence?.managers.find((manager) => manager.managerId === selectedManager), [scopedEvidence, selectedManager]);

  if (!evidence) return <section className={`cme${compact ? " compact" : ""} empty`} aria-label="Eight-arm manager evidence unavailable">
    <header className="cme-head"><span><b>EIGHT-ARM MANAGER LAB</b><small>MANAGER COUNTERFACTUAL · paired executable-bid paths</small></span><em>COLLECTING</em></header>
    <p>No durable filled-position manager cohort exists for this channel yet. Native shadow evidence remains visible; exact eight-arm backfill is queued separately.</p>
  </section>;

  if (!scopedEvidence) return null;
  return <section className={`cme${compact ? " compact" : ""}`} aria-label={`Eight-arm manager evidence for ${scopedEvidence.slug}`}>
    <header className="cme-head">
      <span><b>EIGHT-ARM MANAGER LAB</b><small>MANAGER COUNTERFACTUAL · {scopedEvidence.slug} · {scopedEvidence.positions} positions · {scopedEvidence.sessions} sessions · {scopedEvidence.shadowBookVersion.replace("manager-shadow-book-", "")}</small></span>
      <em className={scopedEvidence.state}>{scopedEvidence.state.toUpperCase()}</em>
      <span className="cme-coverage"><b>{scopedEvidence.terminalArms}/{scopedEvidence.expectedArms}</b><small>terminal arms · {Math.round(scopedEvidence.coverage * 100)}%</small></span>
    </header>
    <div className="cme-scope" role="group" aria-label="Configuration era">
      <span>CONFIGURATION ERA</span>
      <button type="button" disabled={!currentEpochAvailable} aria-pressed={scope === "current"} className={scope === "current" ? "on" : ""} onClick={() => setScope("current")}>CURRENT</button>
      <button type="button" aria-pressed={scope === "all"} className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>ALL V2 · {evidence.configurationEpochs.length} ERA{evidence.configurationEpochs.length === 1 ? "" : "S"}</button>
      {!currentEpochAvailable && <em>current epoch has no completed pair yet</em>}
    </div>
    {currentManagerLabel && <div className="cme-current"><span>CURRENT EXECUTED MANAGER</span><b>{currentManagerLabel}</b><em>shadow arms compare against canonical executed root+runner results</em></div>}
    <Ladder evidence={scopedEvidence} selected={selectedManager} onSelect={setSelectedManager} />
    <div className="cme-detail-head"><span><b>{selectedManager}</b><em>{selected?.terminalPaths ?? 0} paths · {selected?.sessions ?? 0} sessions · {pct(selected?.beatRate ?? null)} beat executed</em></span><div role="group" aria-label="Manager evidence detail"><button type="button" className={detail === "capture" ? "on" : ""} onClick={() => setDetail("capture")}>CAPTURE MAP</button><button type="button" className={detail === "tape" ? "on" : ""} onClick={() => setDetail("tape")}>TRADE STRIP</button></div></div>
    {detail === "capture" ? <CaptureScatter evidence={scopedEvidence} managerId={selectedManager} /> : <TradeTape evidence={scopedEvidence} managerId={selectedManager} />}
    <footer className="cme-boundary">READ ONLY · {scope === "current" ? "CURRENT CONFIG ERA ONLY" : "ALL V2 ERAS; USE CURRENT FOR A LIKE-FOR-LIKE DECISION"} · V1 EXCLUDED · CENSORS STAY IN COVERAGE · TOTAL P&amp;L IS NOT THE RANKING METRIC</footer>
  </section>;
}
