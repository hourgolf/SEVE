import { num2 } from "@/lib/format";
import type { OptionQuote } from "@/lib/types";

// Live option-chain board built from the most recent snapshot: calls left,
// puts right, strike center, ATM row highlighted. Mirrors renderChain().
export function OptionChain({
  snapshot,
  spot,
}: {
  snapshot: OptionQuote[];
  spot: number | null;
}) {
  let rows: React.ReactNode;
  let meta = "—";

  if (!snapshot.length) {
    rows = (
      <tr>
        <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 20 }}>
          no contracts yet
        </td>
      </tr>
    );
  } else {
    // Nearest expiration = front (0DTE).
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

    rows = strikes.map((k) => {
      const c = front.find((r) => Number(r.strike) === k && r.opt_type === "call");
      const p = front.find((r) => Number(r.strike) === k && r.opt_type === "put");
      return (
        <tr key={k} className={k === atm ? "atm" : undefined}>
          <td className="calls" style={{ textAlign: "left" }}>{num2(c?.delta)}</td>
          <td className="calls">{num2(c?.bid)}</td>
          <td className="calls">{num2(c?.ask)}</td>
          <td className="calls">{num2(c?.mid)}</td>
          <td className="strike-col">{k.toFixed(0)}</td>
          <td className="puts">{num2(p?.mid)}</td>
          <td className="puts">{num2(p?.bid)}</td>
          <td className="puts">{num2(p?.ask)}</td>
          <td className="puts" style={{ textAlign: "right" }}>{num2(p?.delta)}</td>
        </tr>
      );
    });

    meta = `exp ${frontExp} · ${strikes.length} strikes`;
  }

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">Live Option Chain</span>
        <span className="x">{meta}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th className="calls" style={{ textAlign: "left" }}>Call Δ</th>
            <th className="calls">Bid</th>
            <th className="calls">Ask</th>
            <th className="calls">Mid</th>
            <th className="strike-col">Strike</th>
            <th className="puts">Mid</th>
            <th className="puts">Bid</th>
            <th className="puts">Ask</th>
            <th className="puts" style={{ textAlign: "right" }}>Put Δ</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
