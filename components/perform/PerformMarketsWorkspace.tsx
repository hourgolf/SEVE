"use client";

import { ContractDetailView } from "@/components/ContractDetail";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay } from "@/lib/format";
import { deriveMarketRisk } from "@/lib/perform/deriveMarketWorkspace";

function MarketOpenRisk({ surface }: { surface: SurfaceProps }) {
  const { feed, view, liveMarks, selected } = surface;
  const risk = deriveMarketRisk(feed.positions, view.desk.strategists, liveMarks);

  return (
    <section className="pf-market-risk pf-screen" aria-label="Open risk while inspecting contracts">
      <div className="pf-head">
        <span className="t">OPEN RISK · {feed.positions.length}</span>
        <span className="grow" />
        <span className="pf-basis">desk marks · unreconciled</span>
        {feed.positions.length > 0 && <span className={`x num ${risk.totalUnrealized < 0 ? "neg" : "up"}`}>Σ {signedUsd(risk.totalUnrealized)}</span>}
      </div>
      <div className="pf-market-risk-body">
        {risk.rows.length === 0 ? <div className="pf-ghost">flat — chain inspection has no open risk</div> : risk.rows.map(({ position, strategist, mark, unrealized, contractLabel }) => {
          return (
            <div className={`pf-market-risk-row${selected === position.occ_symbol ? " selected" : ""}`} key={position.id} style={{ ["--pm" as string]: pmVar(strategist?.color ?? "green") }}>
              <i />
              <b>{position.strategist_slug}</b>
              <span>{contractLabel}</span>
              <small>in {position.avg_entry_price.toFixed(2)} · mark {mark.toFixed(2)}{position.opened_at ? ` · ${timeOfDay(position.opened_at)}` : ""}</small>
              <strong className={unrealized < 0 ? "neg" : "pos"}>{signedUsd(unrealized)}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Full desktop Markets workspace. It keeps open exposure visible while a leg
 * is selected and reuses only page-owned market and contract-history reads. */
export function PerformMarketsWorkspace({ surface }: { surface: SurfaceProps }) {
  const { data, feed, spotUp, symbol, setSymbol, selected, setSelected, contractHistory } = surface;
  const changeSymbol = (next: string) => {
    setSelected(null);
    setSymbol(next);
  };

  return (
    <section className="pf-markets-workspace" id="perform-market" data-nav-target="true" tabIndex={-1}>
      <div className="pf-markets-chart">
        <IntradayChart
          bars={data.bars}
          dailyBars={data.dailyBars}
          spot={data.spot}
          spotUp={spotUp}
          trades={feed.recentTrades}
          openPositions={feed.positions}
          symbol={symbol}
          onSymbolChange={changeSymbol}
          fill
        />
      </div>
      <aside className="pf-markets-console" data-selected-contract={selected || undefined}>
        <MarketOpenRisk surface={surface} />
        <div className="pf-markets-chain">
          <OptionChain
            snapshot={data.snapshot}
            spot={data.spot}
            deltasModeled={data.deltasModeled}
            selected={selected}
            onSelect={(occ) => setSelected((current) => current === occ ? null : occ)}
            symbol={symbol}
          />
        </div>
        {selected && (
          <div className="pf-markets-contract">
            <ContractDetailView occSymbol={selected} onClose={() => setSelected(null)} history={contractHistory} />
          </div>
        )}
      </aside>
    </section>
  );
}
