"use client";

import { LineChart } from "@/components/charts/LineChart";
import { useContractHistory } from "@/hooks/useContractHistory";
import { num2, timeOfDay } from "@/lib/format";
import type { OptionQuote } from "@/lib/types";

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="cd-stat">
      <span className="cd-k">{k}</span>
      <span className="cd-v num">{v}</span>
    </div>
  );
}

// Drill-down for a single contract: intraday mid history + the latest snapshot's
// quote, greeks and sizes. Opened by clicking a leg in the option chain.
export function ContractDetail({
  occSymbol,
  onClose,
}: {
  occSymbol: string;
  onClose: () => void;
}) {
  const { rows, loading, error } = useContractHistory(occSymbol);
  const last: OptionQuote | undefined = rows[rows.length - 1];
  const mids = rows
    .map((r) => r.mid)
    .filter((v): v is number => v != null)
    .map(Number);

  return (
    <div className="panel contract-detail">
      <div className="phead">
        <span className="t">{occSymbol}</span>
        <span className="phead-right">
          <span className="x">{rows.length} snaps</span>
          <button className="cd-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </span>
      </div>
      <div className="pbody">
        {error && <div className="cd-msg neg">{error}</div>}
        {!error && loading && <div className="cd-msg muted">loading…</div>}
        {!error && !loading && (
          <>
            <div className="cd-charthead">
              <span>MID</span>
              {last && (
                <span className="num">
                  {last.mid != null ? num2(last.mid) : "·"} ·{" "}
                  {last.captured_at ? timeOfDay(last.captured_at) : ""}
                </span>
              )}
            </div>
            <LineChart values={mids} height={70} id="contract" />
            {last && (
              <div className="cd-grid">
                <Stat k="Bid" v={num2(last.bid)} />
                <Stat k="Ask" v={num2(last.ask)} />
                <Stat k="Mid" v={num2(last.mid)} />
                <Stat k="Last" v={num2(last.last)} />
                <Stat
                  k="IV"
                  v={
                    last.iv != null && Number(last.iv) > 0 && Number(last.iv) <= 3
                      ? `${(Number(last.iv) * 100).toFixed(1)}%`
                      : "·"
                  }
                />
                <Stat k="Delta" v={num2(last.delta)} />
                <Stat k="Gamma" v={num2(last.gamma)} />
                <Stat k="Theta" v={num2(last.theta)} />
                <Stat k="Vega" v={num2(last.vega)} />
                <Stat k="Bid sz" v={last.bid_size != null ? String(last.bid_size) : "·"} />
                <Stat k="Ask sz" v={last.ask_size != null ? String(last.ask_size) : "·"} />
                <Stat k="Spot" v={num2(last.underlying_price)} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
