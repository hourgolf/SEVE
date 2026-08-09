"use client";

import { ContractDetailView } from "@/components/ContractDetail";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay } from "@/lib/format";
import { deriveMarketRisk } from "@/lib/perform/deriveMarketWorkspace";
import { SeveEvidenceContext, SeveWorkspaceHeader } from "@/components/ui/Seve909";

const after = (a: string | null, b: string | null) => a != null && (b == null || Date.parse(a) > Date.parse(b));
const pacificTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Los_Angeles",
});
const pacificDateTime = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles",
}) + " PT" : "checking";

export function MarketReadStrip({ surface, compact = false }: { surface: SurfaceProps; compact?: boolean }) {
  const { data, incident } = surface;
  const health = data.readHealth.option_chain;
  const readFailed = after(health.lastFailureAt, health.lastSuccessAt);
  const closed = incident.session !== "open";
  const tone = readFailed ? "yellow" : data.snapshot.length === 0 ? "neutral" : data.status === "stale" && !closed ? "yellow" : "green";
  const label = readFailed
    ? "CHAIN READ DEGRADED"
    : data.snapshot.length === 0
      ? "CHAIN CHECKING"
      : closed
        ? "LAST SESSION SNAPSHOT"
        : data.status === "stale"
          ? "CHAIN SNAPSHOT STALE"
          : "CHAIN OBSERVED";
  const detail = data.lastIngestTs
    ? `${pacificTime(data.lastIngestTs)} PT · ${data.snapshot.length} contracts${data.deltasModeled ? " · modeled Δ" : ""}`
    : "no observed option snapshot";
  return <div className={`market-read-strip ${tone}${compact ? " compact" : ""}`} role="status" title={readFailed ? health.lastError ?? undefined : "Observed quotes only; not executable."}>
    <i /><span><b>{label}</b><small>{detail}</small></span>
  </div>;
}

export function MarketOpenRisk({ surface, compact = false }: { surface: SurfaceProps; compact?: boolean }) {
  const { feed, view, liveMarks, selected, setSelected } = surface;
  const risk = deriveMarketRisk(feed.positions, view.desk.strategists, liveMarks);
  const reconciliation = surface.opsReadiness.evidence.find((item) => item.id === "reconciliation");
  const reconciliationNeedsAttention = reconciliation?.tone !== "green";

  if (risk.rows.length === 0 && !reconciliationNeedsAttention) return null;

  return (
    <section className={`pf-market-risk pf-screen${compact ? " compact" : ""}`} aria-label="Open risk while inspecting contracts">
      <div className="pf-head">
        <span className="t">OPEN RISK · {feed.positions.length}</span>
        <span className="grow" />
        {reconciliationNeedsAttention && <span className={`pf-basis${reconciliation ? ` reconciliation-${reconciliation.tone}` : ""}`} title={reconciliation?.detail}>{reconciliation?.state.toLowerCase() ?? "reconciliation checking"}</span>}
        {feed.positions.length > 0 && <span className={`x num ${risk.totalUnrealized < 0 ? "neg" : "up"}`}>Σ {signedUsd(risk.totalUnrealized)}</span>}
      </div>
      <div className="pf-market-risk-body">
        {risk.rows.length === 0 ? <div className="pf-ghost">flat — chain inspection has no open risk</div> : risk.rows.map(({ position, strategist, mark, unrealized, contractLabel }) => {
          return (
            <button type="button" className={`pf-market-risk-row${selected === position.occ_symbol ? " selected" : ""}`} key={position.id} style={{ ["--pm" as string]: pmVar(strategist?.color ?? "green") }} onClick={() => setSelected(selected === position.occ_symbol ? null : position.occ_symbol)} aria-pressed={selected === position.occ_symbol}>
              <i />
              <b>{position.strategist_slug}</b>
              <span>{contractLabel}</span>
              <small>in {position.avg_entry_price.toFixed(2)} · mark {mark.toFixed(2)}{position.opened_at ? ` · ${timeOfDay(position.opened_at)}` : ""}</small>
              <strong className={unrealized < 0 ? "neg" : "pos"}>{signedUsd(unrealized)}</strong>
            </button>
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
      <div className="pf-markets-heading"><SeveWorkspaceHeader title="MARKETS" subtitle="prices · exposure" boundary="READ ONLY" />
        <SeveEvidenceContext kind="actual" scope={`${symbol} + selected paper account`} asOf={pacificDateTime(data.lastIngestTs)} era="current market session" sample={`${data.snapshot.length} observed contracts`} quality={data.status === "err" ? "partial" : data.status === "stale" ? "building" : "live"} detail="Observed quotes support inspection; they are not an execution promise." />
      </div>
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
          hideTitle
        />
      </div>
      <aside className="pf-markets-console" data-selected-contract={selected || undefined}>
        <MarketOpenRisk surface={surface} />
        <div className="pf-markets-chain">
          <MarketReadStrip surface={surface} />
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
