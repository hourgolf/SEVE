"use client";

import { MasterStrip } from "@/components/console/MasterStrip";
import { SessionSequencer } from "@/components/console/SessionSequencer";
import type { FundState, Position, StrategistState } from "@/lib/desk/types";

// =============================================================================
// STUDIO · BOTTOM BAND (PERFORM/STUDIO rebuild · slice S3)
// The mock's bottom band — MASTER · SESSION TAPE · REGISTRY (mock F .sband).
// MASTER and the SESSION TAPE are the REUSED hardware components (MasterStrip =
// KILL lives in the shared top bar; START/STOP · paper/live · NAV+day P&L here;
// SessionSequencer = the real 16-step tape off the feed, no new subscription).
// The registry band is STATIC-LITE (a small config below) — honest placeholder;
// live wiring to docs/pre-registered-tests-2026-07.md is follow-on (spec S3).
// =============================================================================

// STATIC — the armed A-tests as of the 2026-07-10 handoff. Live wiring is follow-on;
// labelled "static" in the header so nobody mistakes it for a live read.
const REGISTRY: { id: string; ok?: boolean; txt: string; dim?: string; eta: string; etaB: string; bar?: [number, number] }[] = [
  { id: "A13", txt: "momo giveback ratchet · live A/B", dim: "vs momo-shape-2", eta: "accruing", etaB: "d2" },
  { id: "A14", txt: "vb promotes — ribbon SPY ITM+1 · squeeze QQQ", dim: "kill N≥15 net<0", eta: "armed", etaB: "07-10" },
  { id: "A16", txt: "vb-curl-reversal tp 20→15", dim: "probe", eta: "armed", etaB: "07-10" },
  { id: "A6", ok: true, txt: "era-4 read", eta: "memo", etaB: "~Jul 21", bar: [12, 15] },
];

export function StudioBand({ fund, fundPnl, positions, recentTrades, strategists }: {
  fund: FundState;
  fundPnl: { nav: number; dayPnl: number };
  positions: Position[];
  recentTrades: Position[];
  strategists: StrategistState[];
}) {
  return (
    <div className="sband">
      <section className="sband-master">
        <MasterStrip fund={fund} fundPnl={fundPnl} />
      </section>

      <section className="sband-tape">
        <SessionSequencer positions={positions} recentTrades={recentTrades} strategists={strategists} />
      </section>

      <section className="registry">
        <div className="insp-head"><span className="t">REGISTRY · A-TESTS</span><span className="grow" /><span className="x">static · era 4 pristine</span></div>
        <div className="reg-body">
          {REGISTRY.map((r) => (
            <div className="regrow" key={r.id}>
              <span className={`rid${r.ok ? " grn" : ""}`}>{r.id}</span>
              <span className="rtxt">
                {r.bar && (
                  <span className="regbar">
                    {Array.from({ length: r.bar[1] }, (_, i) => <i key={i} className={i < r.bar![0] ? "lit" : ""} />)}
                  </span>
                )}
                {r.txt} {r.dim && <span className="dim">{r.dim}</span>}
              </span>
              <span className="reta">{r.eta} <b>{r.etaB}</b></span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
