"use client";

import { useState } from "react";
import { useVirtualBench } from "@/hooks/useVirtualBench";
import { useFold } from "@/hooks/useFold";

// LAB · VIRTUAL BENCH — the visibility layer for the spaghetti-without-splatter fleet
// (59_virtual_bench_fleet): draft channels that signal but never trade, reconstructed
// by gate-shadow into virtual_trades. Per-variant would-have stats accrue here on a
// today (signal_at ET) ⇄ cumulative toggle (the override-scorecard convention).
// EVERY number is a capital-blind, mid/ask-basis WOULD-HAVE — labeled on the panel and
// never a basis for arming (docs/pre-registered-tests-2026-07.md). Paper only.

const usd = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(Math.round(v))}`;
const cls = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

export function LabPanel() {
  const { bench, benchToday, todayET, since, gateBlocks, loading } = useVirtualBench();
  const [folded, toggleFold] = useFold("lab", true); // secondary — folded by default (§04 tidy)
  // aggregate window: today's ET slice ⇄ the cumulative book (scorecard convention)
  const [win, setWin] = useState<"today" | "cum">("today");

  const hasToday = benchToday.length > 0;
  const showToday = win === "today" && hasToday;
  const rows = showToday ? benchToday : bench;

  return (
    <div className={`panel${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">Lab · Virtual Bench</span>
        <span className="x">would-have, mid-basis — not tradable evidence</span>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div style={{ padding: "10px 12px" }}>
        {loading ? (
          <p className="au-market">loading…</p>
        ) : bench.length === 0 ? (
          <p className="au-market">
            no reconstructions yet — the vb-* fleet signals during RTH and the
            gate-shadow job banks each signal&apos;s would-have outcome here.
          </p>
        ) : (
          <>
            <div className="au-sub" style={{ borderTop: "none", paddingTop: 0 }}>
              Bench
              <span className="roster-toggle sc-toggle" title="today's signals (ET) vs the accrued book">
                <button type="button" className={showToday ? "on" : ""} disabled={!hasToday} onClick={() => setWin("today")}
                  title={hasToday ? undefined : "no bench signals today yet"}>today</button>
                <button type="button" className={!showToday ? "on" : ""} onClick={() => setWin("cum")}>cumulative</button>
              </span>
              <span style={{ fontWeight: 700, opacity: 0.6, fontSize: "0.82em" }}> {showToday ? `today · ${todayET.slice(5)}` : `cumulative${since ? ` · since ${since.slice(5)}` : ""}`}</span>
            </div>
            <div className="fx-rows">
              {rows.map((b) => (
                <div className="fx-row" key={b.slug}>
                  <span className="fx-name">{b.slug.replace(/^vb-/, "")}</span>
                  <span className="fx-mid">
                    {b.scored}/{b.n} scored{b.scored > 0 ? ` · win ${Math.round((100 * b.wins) / b.scored)}%` : ""}{showToday ? "" : ` · last ${b.lastAt.slice(5, 10)}`}
                  </span>
                  <span className={`au-pnl ${cls(b.pnl)}`}>{b.scored ? `${usd(b.pnl)}/ct` : "—"}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="fx-foot">
          gate-shadow (armed-channel blocks): {gateBlocks.scored}/{gateBlocks.n} scored · Σ {usd(gateBlocks.pnl)}/ct — K eval at ≥30
          <br />capital-blind + mid-basis would-haves · graduation ONLY via pre-registered gates · paper trading, no edge claims
        </div>
      </div>
    </div>
  );
}
