"use client";

import { MobileOpsView, MobileReviewView } from "@/components/mobile2/MobileDeskSheet";
import { EventTapeWorkspace } from "@/components/perform/EventTapeWorkspace";
import { OpsWorkspace } from "@/components/perform/OpsWorkspace";
import { PerformMarketsWorkspace } from "@/components/perform/PerformMarketsWorkspace";
import { deriveSentinelDigestReceipt, SentinelWorkspace } from "@/components/perform/SentinelWorkspace";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { signedUsd } from "@/lib/format";
import { DecisionAtlasFleetPulse } from "@/components/research/DecisionAtlasFleetPulse";

function WorkspaceTitle({ eyebrow, title, detail, stats }: {
  eyebrow: string;
  title: string;
  detail: string;
  stats: Array<{ label: string; value: string | number; tone?: string }>;
}) {
  return <header className="folio-workspace-title"><span><small>{eyebrow}</small><b>{title}</b><em>{detail}</em></span><div>{stats.map((stat) => <span key={stat.label}><small>{stat.label}</small><b className={stat.tone}>{stat.value}</b></span>)}</div></header>;
}

export function FolioMarketsDesktop({ surface }: { surface: SurfaceProps }) {
  return <div className="folio-native-workspace folio-markets">
    <WorkspaceTitle eyebrow="MARKETS" title={`${surface.symbol} chart + option chain`} detail="One instrument, its live risk, and exact contract history in the same room." stats={[
      { label: "SPOT", value: surface.data.spot?.toFixed(2) ?? "—" },
      { label: "CHAIN", value: surface.data.snapshot.length },
      { label: "EXPIRIES", value: surface.data.expirations },
      { label: "OPEN", value: surface.feed.positions.length },
    ]} />
    <div className="folio-native-body"><PerformMarketsWorkspace surface={surface} /></div>
  </div>;
}

export function FolioSentinelDesktop({ surface }: { surface: SurfaceProps }) {
  const receipt = deriveSentinelDigestReceipt(surface.sentinel);
  const candidates = (surface.sentinel.scan?.promote.length ?? 0) + (surface.sentinel.scan?.fixable.length ?? 0);
  return <div className="folio-native-workspace folio-sentinel">
    <WorkspaceTitle eyebrow="SENTINEL" title="Terrain before opinion" detail="Receipt identity, deterministic evidence, and interpretation remain separate claims." stats={[
      { label: "RECEIPT", value: receipt.label, tone: receipt.tone },
      { label: "SESSION", value: surface.sentinel.session || "—" },
      { label: "FOR DATE", value: surface.sentinel.forDate || surface.sentinel.brief?.forDate || "—" },
      { label: "PROBES", value: candidates },
    ]} />
    <div className="folio-native-body"><SentinelWorkspace sentinel={surface.sentinel} symbol={surface.symbol} /></div>
  </div>;
}

export function FolioReviewDesktop({ surface }: { surface: SurfaceProps }) {
  const realized = surface.feed.recentTrades.reduce((sum, row) => sum + (row.realized_pnl ?? 0), 0);
  return <div className="folio-native-workspace folio-review">
    <WorkspaceTitle eyebrow="REVIEW" title="Tape linked to outcomes" detail="Operational events stay distinct from position evidence and after-action claims." stats={[
      { label: "EVENTS", value: surface.data.events.length },
      { label: "CLOSED TRADES", value: surface.feed.sessionTrades.closed },
      { label: "REALIZED", value: signedUsd(realized), tone: realized < 0 ? "neg" : realized > 0 ? "pos" : "" },
      { label: "CHAINS", value: surface.opsReadiness.chains.length },
    ]} />
    <DecisionAtlasFleetPulse reports={surface.decisionAtlas} purpose="review" />
    <div className="folio-native-body"><EventTapeWorkspace events={surface.data.events} health={surface.data.readHealth.events} strategists={surface.view.desk.strategists} readiness={surface.opsReadiness} /></div>
  </div>;
}

export function FolioOpsDesktop({ surface }: { surface: SurfaceProps }) {
  const reconciliation = surface.opsReadiness.evidence.find((item) => item.id === "reconciliation");
  return <div className="folio-native-workspace folio-ops">
    <WorkspaceTitle eyebrow="OPERATIONS" title="Claims need receipts" detail="Process, executor, market-read, release, and broker evidence stay independently observable." stats={[
      { label: "INCIDENT", value: surface.incident.severity.toUpperCase(), tone: surface.incident.severity },
      { label: "RUNS / 16H", value: surface.workerRuns.rowsIn16h },
      { label: "ABRUPT", value: surface.workerRuns.abrupt16h },
      { label: "BROKER", value: reconciliation?.state ?? "CHECKING", tone: reconciliation?.tone },
    ]} />
    <div className="folio-native-body"><OpsWorkspace surface={surface} /></div>
  </div>;
}

export function FolioReviewMobile({ surface, channels }: { surface: SurfaceProps; channels: SurfaceProps["view"]["desk"]["strategists"] }) {
  return <div className="folio-native-mobile folio-review-mobile"><MobileReviewView props={surface} channels={channels} livePnl={surface.livePnl} /></div>;
}

export function FolioOpsMobile({ surface, channels, onOpenSettings }: { surface: SurfaceProps; channels: SurfaceProps["view"]["desk"]["strategists"]; onOpenSettings: () => void }) {
  return <div className="folio-native-mobile folio-ops-mobile"><MobileOpsView props={surface} channels={channels} onOpenSettings={onOpenSettings} /></div>;
}
