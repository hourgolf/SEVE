"use client";

import type { SurfaceProps } from "@/components/surfaceTypes";
import { PositionsSection } from "@/components/perform/PerformRail";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay } from "@/lib/format";
import { derivePositionsWorkspace } from "@/lib/perform/derivePositionsWorkspace";
import { BrokerReconciliationStrip } from "@/components/ops/OpsReadinessPanel";
import { SeveMetricStrip, SeveWorkspaceHeader, type SeveMetricTone } from "@/components/ui/Seve909";

const money = (value: number) => Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${Math.round(value)}`;
const rootOf = (occ: string) => occ.match(/^([A-Z]+)\d/)?.[1] ?? "?";
const hold = (minutes: number | null) => minutes == null ? "—" : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const reason = (value?: string | null) => {
  if (!value) return "unclassified";
  if (value === "manual") return "operator · untagged";
  if (value.startsWith("manual:")) return `operator · ${value.slice(7).replaceAll("_", " ")}`;
  return value.replaceAll("_", " ");
};

function BrokerTruthFallback({ surface }: { surface: SurfaceProps }) {
  const receipt = surface.opsReadiness.brokerReceipt;
  if (!receipt) return <section className="pf-screen pf-hardware pf-broker-truth">
    <div className="pf-head"><span className="t">BROKER TRUTH</span><span className="grow" /><span className="pf-basis">checking</span></div>
    <div className="pf-ghost">waiting for authenticated broker position evidence</div>
  </section>;
  const accounts = receipt.accounts.filter((account) => account.brokerPositions.length > 0);
  return <section className="pf-screen pf-hardware pf-broker-truth" aria-label="Current broker positions">
    <div className="pf-head"><span className="t">BROKER TRUTH · {receipt.brokerContracts} CONTRACTS</span><span className="grow" />
      <span className="pf-basis">read only · no channel fallback</span></div>
    {accounts.length === 0 ? <div className="pf-ghost">
      {receipt.allAccountsReachable ? "broker confirms no open contracts" : "broker account evidence is incomplete"}
    </div> : <div className="pf-broker-truth-list">{accounts.map((account) => <div key={account.accountId}>
      <header><b>{account.accountName}</b><span>{account.brokerContracts} contracts</span></header>
      {account.brokerPositions.map((position) => <article key={`${account.accountId}:${position.symbol}`}>
        <b>{position.symbol}</b>
        <span>×{Math.abs(position.qty)}</span>
        <span>in {position.averageEntryPrice == null ? "—" : position.averageEntryPrice.toFixed(2)}</span>
        <span>mark {position.currentPrice == null ? "—" : position.currentPrice.toFixed(2)}</span>
        <strong className={(position.unrealizedPnl ?? 0) < 0 ? "neg" : "pos"}>
          {position.unrealizedPnl == null ? "P&L —" : signedUsd(position.unrealizedPnl)}
        </strong>
      </article>)}
    </div>)}</div>}
    <footer>Broker holdings are shown without strategist attribution until immutable position routes are complete.</footer>
  </section>;
}

export function AggregateExposure({ surface }: { surface: SurfaceProps }) {
  const model = derivePositionsWorkspace(surface.feed.positions, surface.feed.recentTrades, surface.liveMarks);
  const { open, exposure } = model;
  return <section className="pf-screen pf-hardware pf-position-exposure" aria-label="Aggregate open exposure">
    <div className="pf-head"><span className="t">AGGREGATE EXPOSURE</span><span className="grow" />
      <span className="pf-basis">correlated lot · no caps</span></div>
    <div className="pf-pos-metrics">
      <span><small>OPEN LEGS</small><b>{open.count}</b></span>
      <span><small>CONTRACTS</small><b>{open.contracts}</b></span>
      <span><small>NOTIONAL</small><b>{money(open.notional)}</b></span>
      <span><small>UNREALIZED</small><b className={open.unrealized < 0 ? "neg" : open.unrealized > 0 ? "pos" : ""}>{signedUsd(open.unrealized)}</b></span>
    </div>
    {exposure.occCount === 0 ? <div className="pf-ghost">flat — no aggregate exposure</div> : <div className="pf-position-exposure-body">
      <div className="pf-pos-directions">
        {exposure.byUnderlying.map((row) => <span key={row.underlying}><b>{row.underlying}</b><i className="pos">{row.callContracts}C</i><i className="neg">{row.putContracts}P</i><em>{money(row.notional)}</em></span>)}
      </div>
      <div className="pf-pos-stacks">
        {exposure.byOcc.map((row) => <div key={row.occ} className={row.channels.length >= 4 ? "hot" : ""}>
          <b>{row.underlying} {row.strike.toFixed(0)}{row.optType === "call" ? "C" : "P"}</b>
          <span>×{Math.abs(row.contracts)}</span><span>{row.channels.length} ch</span><em>{money(row.notional)}</em>
        </div>)}
      </div>
      {exposure.maxStack && exposure.maxStack.channels.length >= 2 && <p className="pf-pos-stack-note">
        {exposure.maxStack.channels.length} channels share the heaviest contract · correlated exposure, not diversification
      </p>}
    </div>}
  </section>;
}

export function RecentExits({ surface }: { surface: SurfaceProps }) {
  const exits = derivePositionsWorkspace(surface.feed.positions, surface.feed.recentTrades, surface.liveMarks).exits;
  const colorOf = (slug: string) => pmVar(surface.view.desk.strategists.find((channel) => channel.slug === slug)?.color ?? "green");
  return <section className="pf-screen pf-hardware pf-recent-exits" aria-label="Recent closed positions">
    <div className="pf-head"><span className="t">RECENT EXITS · {exits.rows.length}</span><span className="grow" />
      <span className="pf-basis">desk attribution</span><span className={`x num ${exits.realized < 0 ? "neg" : "up"}`}>{signedUsd(exits.realized)}</span></div>
    <div className="pf-exit-summary"><span><small>WINS</small><b>{exits.wins}</b></span><span><small>LOSSES</small><b>{exits.losses}</b></span><span><small>FLAT</small><b>{exits.rows.length - exits.wins - exits.losses}</b></span></div>
    <div className="pf-exit-list">
      {exits.rows.length === 0 ? <div className="pf-ghost">no exits in the current session feed</div> : exits.rows.map((row) => {
        const trade = row.position;
        const realized = trade.realized_pnl ?? 0;
        return <article key={trade.id} style={{ ["--pm" as string]: colorOf(trade.strategist_slug) }}>
          <i /><div className="pf-exit-title"><b>{trade.strategist_slug}</b><span>{rootOf(trade.occ_symbol)} {trade.strike.toFixed(0)}{trade.opt_type === "call" ? "C" : "P"} ×{Math.abs(trade.qty)}</span></div>
          <strong className={realized < 0 ? "neg" : "pos"}>{signedUsd(realized)}</strong>
          <small>{trade.closed_at ? timeOfDay(trade.closed_at) : "—"} · held {hold(row.holdMinutes)} · {reason(trade.close_reason)}</small>
          <div className="pf-exit-stats">
            <span>in {trade.avg_entry_price.toFixed(2)} → out {trade.current_mark.toFixed(2)}</span>
            <span className={(row.returnPct ?? 0) < 0 ? "neg" : "pos"}>{row.returnPct == null ? "ret —" : `ret ${row.returnPct >= 0 ? "+" : ""}${Math.round(row.returnPct)}%`}</span>
            <span>{row.peakPct == null ? "best move —" : `best +${Math.round(row.peakPct)}%`}</span>
            <span className={row.peakExceeded || (row.givebackPct ?? 0) >= 50 ? "warn" : ""}>{row.peakExceeded ? "exit exceeded recorded best" : row.capturePct == null ? "capture unavailable" : row.capturePct < 0 ? "gave back the gain and finished below entry" : `kept ${Math.round(row.capturePct)}% of the best move`}</span>
          </div>
        </article>;
      })}
    </div>
    <footer>Per-channel realized results · broker reconciliation is shown in System status.</footer>
  </section>;
}

/** Full-stage position book. The guarded close workflow stays in the existing
 * shared open-book leaf; aggregate and exit context are read-only seam data. */
export function PerformPositionsWorkspace({ surface }: { surface: SurfaceProps }) {
  const reconciliation = surface.opsReadiness.evidence.find((item) => item.id === "reconciliation");
  const model = derivePositionsWorkspace(surface.feed.positions, surface.feed.recentTrades, surface.liveMarks, surface.positionPeaks);
  const manualExits = model.exits.rows.filter(({ position }) => position.close_reason?.startsWith("manual"));
  const lastManualReason = manualExits.at(0)?.position.close_reason?.slice("manual:".length).replaceAll("_", " ");
  const realizedTone: SeveMetricTone = model.exits.realized > 0 ? "success" : model.exits.realized < 0 ? "danger" : "neutral";
  const attributionBlocked = surface.feed.positionAttribution.state === "blocked";
  const hasOpenPositions = surface.feed.positions.length > 0;
  const hasRecentExits = model.exits.rows.length > 0;
  const isQuietBook = !attributionBlocked && !hasOpenPositions && !hasRecentExits;
  const showReconciliation = reconciliation?.tone !== "green";

  return <section className="pf-positions-shell" data-nav-target="true" tabIndex={-1}>
      <SeveWorkspaceHeader
        title="POSITIONS"
        boundary="PAPER · CONFIRM TO CLOSE"
      />
    {showReconciliation && <BrokerReconciliationStrip model={surface.opsReadiness} />}
    {isQuietBook ? <div className="pf-positions-empty" role="status"><b>NO OPEN POSITIONS</b><span>No session exits</span></div> : <>
    <SeveMetricStrip metrics={[
      { label: "REALIZED", value: attributionBlocked ? "—" : signedUsd(model.exits.realized), tone: attributionBlocked ? "attention" : realizedTone },
      { label: "WINNERS", value: attributionBlocked ? "—" : model.exits.wins },
      { label: "LOSSES", value: attributionBlocked ? "—" : model.exits.losses, tone: !attributionBlocked && model.exits.losses > 0 ? "danger" : "neutral" },
      { label: "MANUAL", value: attributionBlocked ? "—" : manualExits.length === 0 ? "0" : `${manualExits.length} ${lastManualReason ?? "TAGGED"}`, tone: !attributionBlocked && manualExits.length > 0 ? "attention" : "neutral" },
    ]} />
    <div className="pf-positions-workspace" data-has-open={hasOpenPositions || undefined} data-has-exits={hasRecentExits || undefined} data-attribution-blocked={attributionBlocked || undefined}>
      {(hasOpenPositions || attributionBlocked) && <PositionsSection
        positions={surface.feed.positions}
        strategists={surface.view.desk.strategists}
        liveMarks={surface.liveMarks}
        peaks={surface.positionPeaks}
        write={surface.write}
        targeted
        reconciliation={reconciliation}
        evidenceChains={surface.opsReadiness.chains}
        attribution={surface.feed.positionAttribution}
      />}
      <aside className="pf-positions-context">
        {attributionBlocked ? <BrokerTruthFallback surface={surface} /> : <>{hasOpenPositions && <AggregateExposure surface={surface} />}{hasRecentExits && <RecentExits surface={surface} />}</>}
      </aside>
    </div>
    </>}
  </section>;
}
