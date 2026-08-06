"use client";

import "@/app/dry-powder.css";
import { useEffect, useMemo, useState } from "react";
import { signedUsd, usd0 } from "@/lib/format";
import type { ChannelDryPowderCurve as DryPowderCurve } from "@/lib/research/shadowResearch";

const CONTRACT_CHOICES = [1, 2, 4] as const;
const pct = (wins: number, paths: number): string => paths ? `${Math.round((wins / paths) * 100)}%` : "—";

function curveRead(curve: DryPowderCurve): { label: string; tone: "positive" | "warning" | "neutral" } {
  const lead = curve.points.slice(0, 3);
  const late = curve.points.slice(3);
  const leadPnl = lead.reduce((sum, point) => sum + point.marginalPnlPerContract, 0);
  const leadPaths = lead.reduce((sum, point) => sum + point.marginalScored, 0);
  const latePnl = late.reduce((sum, point) => sum + point.marginalPnlPerContract, 0);
  const latePaths = late.reduce((sum, point) => sum + point.marginalScored, 0);
  const leadAverage = leadPaths ? leadPnl / leadPaths : 0;
  const lateAverage = latePaths ? latePnl / latePaths : null;
  if (leadPaths >= 5 && leadAverage > 0 && lateAverage != null && lateAverage < 0) return { label: "FRONT-LOADED", tone: "positive" };
  if (leadPaths >= 5 && leadAverage > 0 && lateAverage != null && lateAverage >= 0) return { label: "EDGE PERSISTS", tone: "positive" };
  if (leadPaths >= 5 && leadAverage <= 0) return { label: "EARLY DRAG", tone: "warning" };
  return { label: "COLLECTING", tone: "neutral" };
}

export function ChannelDryPowderCurve({ curve, defaultContracts = 2, compact = false }: {
  curve?: DryPowderCurve | null;
  defaultContracts?: number;
  compact?: boolean;
}) {
  const [contracts, setContracts] = useState(defaultContracts);
  const [entryBudget, setEntryBudget] = useState(3);
  useEffect(() => {
    setContracts(CONTRACT_CHOICES.includes(defaultContracts as 1 | 2 | 4) ? defaultContracts : 2);
  }, [defaultContracts]);
  useEffect(() => {
    setEntryBudget(Math.min(3, curve?.points.length ?? 1));
  }, [curve?.slug, curve?.points.length]);
  const selected = curve?.points.find((point) => point.entryBudget === entryBudget) ?? curve?.points.at(-1);
  const maxMagnitude = useMemo(() => Math.max(1, ...(curve?.points.map((point) => Math.abs(point.marginalAveragePerPath ?? 0)) ?? [])), [curve]);
  const read = curve ? curveRead(curve) : null;

  if (!curve?.points.length || !selected) return <section className={`dpc${compact ? " compact" : ""} empty`} aria-label="Dry powder curve unavailable">
    <header><span><b>DRY POWDER CURVE</b><small>capital-blind native paths</small></span><em>NO PATHS</em></header>
    <p>No prospective virtual entry sequence is available for this channel.</p>
  </section>;

  return <section className={`dpc${compact ? " compact" : ""}`} aria-label={`Dry powder curve for ${curve.slug}`}>
    <header className="dpc-head">
      <span><b>DRY POWDER CURVE</b><small>{curve.slug} · {curve.sessionCount} sessions · {curve.fromSession.slice(5)}→{curve.throughSession.slice(5)}</small></span>
      <em className={read?.tone}>{read?.label}</em>
      <div role="group" aria-label="Contracts per hypothetical entry">
        {CONTRACT_CHOICES.map((quantity) => <button type="button" key={quantity} className={contracts === quantity ? "on" : ""} onClick={() => setContracts(quantity)}>{quantity}CT</button>)}
      </div>
    </header>

    <div className="dpc-body">
      <div className="dpc-bars" aria-label="Marginal expectancy by signal ordinal">
        {curve.points.map((point) => {
          const average = point.marginalAveragePerPath ?? 0;
          const width = `${Math.max(2, (Math.abs(average) / maxMagnitude) * 50)}%`;
          return <button type="button" key={point.entryBudget} className={`${entryBudget === point.entryBudget ? "selected" : ""}${average < 0 ? " negative" : average > 0 ? " positive" : " flat"}`} onClick={() => setEntryBudget(point.entryBudget)} aria-pressed={entryBudget === point.entryBudget}>
            <span className="dpc-ordinal">S{point.entryBudget}</span>
            <span className="dpc-axis"><i className="loss" style={{ width: average < 0 ? width : 0 }} /><u /><i className="gain" style={{ width: average >= 0 ? width : 0 }} /></span>
            <strong>{signedUsd(average)}<small>/ct</small></strong>
            <em>{point.marginalWinners}/{point.marginalScored} · {pct(point.marginalWinners, point.marginalScored)}</em>
          </button>;
        })}
      </div>

      <div className="dpc-scenario">
        <span className="dpc-budget"><small>ENTRY BUDGET</small><b>≤{selected.entryBudget}/SESSION</b><em>first {selected.entryBudget} observed signals</em></span>
        <span><small>AVG / SESSION</small><b className={selected.averagePnlPerSession >= 0 ? "pos" : "neg"}>{signedUsd(selected.averagePnlPerSession * contracts)}</b><em>{contracts} ct per path</em></span>
        <span><small>PEAK STACK</small><b>{selected.peakConcurrentPositions == null ? "—" : `${selected.peakConcurrentPositions * contracts} CT`}</b><em>{selected.peakConcurrentPositions ?? "—"} native paths</em></span>
        <span><small>PEAK DEBIT</small><b>{selected.peakDebitPerContract == null ? "—" : usd0(selected.peakDebitPerContract * contracts)}</b><em>observed entry asks</em></span>
        <span><small>SELECTED PATHS</small><b>{selected.selectedScored}</b><em>{curve.sessionCount} channel sessions</em></span>
      </div>
    </div>

    <div className="dpc-gates" aria-label="Why virtual paths did not execute">
      <span><small>PRICE / DEBIT</small><b>{curve.gates.premiumOrDebit}</b></span>
      <span><small>CAPACITY</small><b>{curve.gates.concurrency}</b></span>
      <span><small>FREQUENCY</small><b>{curve.gates.frequency}</b></span>
      <span><small>DARK / MUTED</small><b>{curve.gates.lifecycle}</b></span>
      <span><small>OTHER</small><b>{curve.gates.other}</b></span>
    </div>
    <footer>ORDINAL, CORRELATED SIMULATION · NATIVE MID-BASIS EXITS · PEAK STACK USES OBSERVED PATH DURATION · NOT EXECUTABLE P&amp;L OR A MANAGER COMPARISON</footer>
  </section>;
}
