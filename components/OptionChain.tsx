"use client";

import { useFold } from "@/hooks/useFold";
import { num2 } from "@/lib/format";
import type { OptionQuote } from "@/lib/types";

// IV is unreliable when modeled from a near-intrinsic deep-ITM mid (it blows up),
// so only show plausible values (≤300%); otherwise "·".
const ivPct = (v: number | null | undefined): string => {
  if (v == null) return "·";
  const n = Number(v);
  return n > 0 && n <= 3 ? (n * 100).toFixed(1) : "·";
};

// Live option-chain board built from the most recent snapshot: calls left,
// puts right, strike center, ATM row highlighted. Click a leg to drill in.
export function OptionChain({
  snapshot,
  spot,
  deltasModeled = false,
  selected = null,
  onSelect,
  compact = false,
  symbol = "SPY",
}: {
  snapshot: OptionQuote[];
  spot: number | null;
  /** When true, the front board's deltas were modeled (Alpaca had none — 0DTE). */
  deltasModeled?: boolean;
  selected?: string | null;
  onSelect?: (occSymbol: string) => void;
  /** Mobile: Δ + Mid only (calls | strike | puts), so it fits without scroll. */
  compact?: boolean;
  /** Instrument label for the header (SPY/QQQ). */
  symbol?: string;
}) {
  const [folded, toggleFold] = useFold("chain");
  let rows: React.ReactNode;
  let meta = "—";
  let livePricing = false;

  if (!snapshot.length) {
    rows = (
      <tr>
        <td colSpan={compact ? 5 : 11} className="muted" style={{ textAlign: "center", padding: 20 }}>
          no contracts yet
        </td>
      </tr>
    );
  } else {
    const frontExp = [...snapshot.map((r) => r.expiration)].sort()[0];
    const front = snapshot.filter((r) => r.expiration === frontExp);
    const strikes = [...new Set(front.map((r) => Number(r.strike)))].sort(
      (a, b) => a - b
    );
    const ref = spot ?? strikes[0];
    const atm = strikes.reduce(
      (p, c) => (Math.abs(c - ref) < Math.abs(p - ref) ? c : p),
      strikes[0]
    );

    // Only show the money: WING strikes at/below spot + WING above (a tight
    // window around the ATM), so the board stays short.
    const WING = 3;
    const shown = [
      ...strikes.filter((k) => k <= ref).slice(-WING),
      ...strikes.filter((k) => k > ref).slice(0, WING),
    ];

    // Delta-adjust each quote by the live spot's move since its snapshot, so the
    // marks track the underlying between 1-min snapshots (first-order; the spread
    // is preserved, delta is gamma-adjusted). IV is left as captured.
    const snapU = front.find((r) => r.underlying_price != null)?.underlying_price ?? null;
    livePricing = spot != null && snapU != null && Math.abs(spot - snapU) > 0.005;
    const liveAdj = (q: OptionQuote | undefined): OptionQuote | undefined => {
      if (!q || spot == null || q.underlying_price == null) return q;
      const move = spot - q.underlying_price;
      if (move === 0) return q;
      const shift = (q.delta ?? 0) * move;
      const px = (v: number | null) => (v == null ? v : Math.max(0, v + shift));
      let delta = q.delta;
      if (delta != null) {
        delta = delta + (q.gamma ?? 0) * move;
        delta = q.opt_type === "call" ? Math.min(1, Math.max(0, delta)) : Math.max(-1, Math.min(0, delta));
      }
      return { ...q, bid: px(q.bid), ask: px(q.ask), mid: px(q.mid), delta };
    };

    rows = shown.map((k) => {
      const c = liveAdj(front.find((r) => Number(r.strike) === k && r.opt_type === "call"));
      const p = liveAdj(front.find((r) => Number(r.strike) === k && r.opt_type === "put"));
      const cSel = !!c && selected === c.occ_symbol;
      const pSel = !!p && selected === p.occ_symbol;
      const onC = c ? () => onSelect?.(c.occ_symbol) : undefined;
      const onP = p ? () => onSelect?.(p.occ_symbol) : undefined;
      const cCls = `calls clk${cSel ? " sel" : ""}`;
      const pCls = `puts clk${pSel ? " sel" : ""}`;
      // IV-from-mid is only trustworthy on the OTM wing (calls at/above spot,
      // puts at/below); ITM legs are near-intrinsic and blow the solve up.
      const cIv = spot == null || k >= spot - 0.5 ? ivPct(c?.iv) : "·";
      const pIv = spot == null || k <= spot + 0.5 ? ivPct(p?.iv) : "·";
      if (compact) {
        return (
          <tr key={k} className={k === atm ? "atm" : undefined}>
            <td className={cCls} style={{ textAlign: "left" }} onClick={onC}>{num2(c?.delta)}</td>
            <td className={cCls} onClick={onC}>{num2(c?.mid)}</td>
            <td className="strike-col">{k.toFixed(0)}</td>
            <td className={pCls} onClick={onP}>{num2(p?.mid)}</td>
            <td className={pCls} style={{ textAlign: "right" }} onClick={onP}>{num2(p?.delta)}</td>
          </tr>
        );
      }
      return (
        <tr key={k} className={k === atm ? "atm" : undefined}>
          <td className={cCls} style={{ textAlign: "left" }} onClick={onC}>{cIv}</td>
          <td className={cCls} onClick={onC}>{num2(c?.delta)}</td>
          <td className={cCls} onClick={onC}>{num2(c?.bid)}</td>
          <td className={cCls} onClick={onC}>{num2(c?.ask)}</td>
          <td className={cCls} onClick={onC}>{num2(c?.mid)}</td>
          <td className="strike-col">{k.toFixed(0)}</td>
          <td className={pCls} onClick={onP}>{num2(p?.mid)}</td>
          <td className={pCls} onClick={onP}>{num2(p?.bid)}</td>
          <td className={pCls} onClick={onP}>{num2(p?.ask)}</td>
          <td className={pCls} onClick={onP}>{num2(p?.delta)}</td>
          <td className={pCls} style={{ textAlign: "right" }} onClick={onP}>{pIv}</td>
        </tr>
      );
    });

    // Mobile board is tight — show just the windowed count; desktop notes the
    // total available (e.g. "10 of 18") since there's room.
    meta = compact
      ? `exp ${frontExp} · ${shown.length} strikes (±${WING})`
      : `exp ${frontExp} · ${shown.length} of ${strikes.length} strikes`;
  }

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">Live {symbol} Chain</span>
        <span className="x">
          {meta}
          {livePricing && (
            <span
              title="Marks track the live spot between 1-min snapshots (delta-adjusted; spread preserved)."
              style={{ color: "var(--green, #2fd573)" }}
            >
              {" · live"}
            </span>
          )}
          {deltasModeled && snapshot.length > 0 && (
            <span
              title="Alpaca does not provide 0DTE greeks; these deltas are modeled (Black-Scholes from mid)."
              style={{ color: "var(--amber)" }}
            >
              {" · Δ model"}
            </span>
          )}
        </span>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      {!folded && (
      <div className={`table-scroll${compact ? " table-fit" : ""}`}>
        <table className="chain-table">
          <thead>
            {compact ? (
              <tr>
                <th className="calls" style={{ textAlign: "left" }}>Call Δ</th>
                <th className="calls">Mid</th>
                <th className="strike-col">Strike</th>
                <th className="puts">Mid</th>
                <th className="puts" style={{ textAlign: "right" }}>Put Δ</th>
              </tr>
            ) : (
              <tr>
                <th className="calls" style={{ textAlign: "left" }}>Call IV</th>
                <th className="calls">Δ</th>
                <th className="calls">Bid</th>
                <th className="calls">Ask</th>
                <th className="calls">Mid</th>
                <th className="strike-col">Strike</th>
                <th className="puts">Mid</th>
                <th className="puts">Bid</th>
                <th className="puts">Ask</th>
                <th className="puts">Δ</th>
                <th className="puts" style={{ textAlign: "right" }}>Put IV</th>
              </tr>
            )}
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      )}
    </div>
  );
}
