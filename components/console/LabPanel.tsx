"use client";

import { useVirtualBench } from "@/hooks/useVirtualBench";
import { useFold } from "@/hooks/useFold";

// LAB · VIRTUAL BENCH — the visibility layer for the spaghetti-without-splatter fleet
// (59_virtual_bench_fleet): draft channels that signal but never trade, reconstructed
// nightly by gate-shadow into virtual_trades. Per-variant would-have stats accrue here.
// EVERY number is a capital-blind, mid/ask-basis WOULD-HAVE — labeled on the panel and
// never a basis for arming (docs/pre-registered-tests-2026-07.md). Paper only.

const usd = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(Math.round(v))}`;
const cls = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

export function LabPanel() {
  const { bench, gateBlocks, loading } = useVirtualBench();
  const [folded, toggleFold] = useFold("lab");

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
            no reconstructions yet — the vb-* fleet signals during RTH and the nightly
            gate-shadow job banks each first-signal-of-day&apos;s would-have outcome here.
          </p>
        ) : (
          <div className="fx-rows">
            {bench.map((b) => (
              <div className="fx-row" key={b.slug}>
                <span className="fx-name">{b.slug.replace(/^vb-/, "")}</span>
                <span className="fx-mid">
                  {b.scored}/{b.n} scored{b.scored > 0 ? ` · win ${Math.round((100 * b.wins) / b.scored)}%` : ""} · last {b.lastAt.slice(5, 10)}
                </span>
                <span className={`au-pnl ${cls(b.pnl)}`}>{b.scored ? `${usd(b.pnl)}/ct` : "—"}</span>
              </div>
            ))}
          </div>
        )}
        <div className="fx-foot">
          gate-shadow (armed-channel blocks): {gateBlocks.scored}/{gateBlocks.n} scored · Σ {usd(gateBlocks.pnl)}/ct — K eval at ≥30
          <br />capital-blind + mid-basis would-haves · graduation ONLY via pre-registered gates · paper trading, no edge claims
        </div>
      </div>
    </div>
  );
}
