"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import "./console.css";
import "./mobile.css";
import "./shell.css";
import { useMarketData } from "@/hooks/useMarketData";
import { useDeskState } from "@/hooks/useDeskState";
import { useDeskFeed } from "@/hooks/useDeskFeed";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { useAccounts } from "@/hooks/useAccounts";
import { useOpsStatus } from "@/hooks/useOpsStatus";
import { useOpsEvidence } from "@/hooks/useOpsEvidence";
import { usePositionMarks } from "@/hooks/usePositionMarks";
import { usePositionPeaks } from "@/hooks/usePositionPeaks";
import { useSentinelDigest } from "@/hooks/useSentinelDigest";
import { useWorkerRuns } from "@/hooks/useWorkerRuns";
import { useKitSounds } from "@/hooks/useKitSounds";
import { channelPnl, liveFundPnl } from "@/lib/desk/derive";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DeskProvider } from "@/components/console/DeskProvider";
import { DesktopSurface } from "@/components/DesktopSurface";
import { MobileShell } from "@/components/mobile2/MobileShell";
import { WorkstationShell } from "@/components/shell/WorkstationShell";
import { FolioShell } from "@/components/skins/FolioShell";
import { usePresentation } from "@/components/skins/PresentationProvider";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { ShellProvider, useShell } from "@/hooks/useShellState";
import { marketSummary } from "@/lib/marketSummary";
import { marketSession } from "@/lib/incident/marketSession";
import { deriveIncident } from "@/lib/incident/deriveIncident";
import { positionsByExecutor } from "@/lib/incident/positionsByExecutor";
import { devIncidentFixture } from "@/lib/incident/devFixture";
import { useRefreshTick } from "@/hooks/useRefreshTick";
import { useStudioEvidence } from "@/hooks/useStudioEvidence";
import { useContractHistory } from "@/hooks/useContractHistory";
import { useShadowResearch } from "@/hooks/useShadowResearch";
import { useChannelManagerEvidence } from "@/hooks/useChannelManagerEvidence";
import { useDailyReports } from "@/hooks/useDailyReports";
import { useDecisionAtlasReports } from "@/hooks/useDecisionAtlasReports";
import { useWeeklyReports } from "@/hooks/useWeeklyReports";
import { useForensicsReport } from "@/hooks/useForensicsReport";
import { usePyramidShadow } from "@/hooks/usePyramidShadow";
import { useVirtualBench } from "@/hooks/useVirtualBench";
import { useChannelControlPlaneView } from "@/hooks/useChannelControlPlaneView";
import { useWindowedPnl, type PnlWindow } from "@/hooks/useWindowedPnl";
import type { Room } from "@/components/surfaceTypes";
import {
  deriveChannelPassports,
  scopeChannelsToAccount,
  scopeChannelWorkspace,
} from "@/lib/channels/channelPassport";
import { deriveOpsReadiness } from "@/lib/ops/readiness";
import { useAuth } from "@/hooks/useAuth";
import { AuthControl } from "@/components/AuthControl";
import { ThemeBridge } from "@/components/theme/ThemeBridge";
import type { WorkstationPresentation } from "@/lib/shell/presentation";

// One set of data hooks, two layouts: the wide desktop chassis or the phone
// tab-shell. The data-seam pattern means neither layout re-subscribes.
function Surface({
  theme,
  setTheme,
  presentation,
}: {
  theme: "cream" | "blackout";
  setTheme: Dispatch<SetStateAction<"cream" | "blackout">>;
  presentation: WorkstationPresentation;
}) {
  // §01 market instrument (SPY default; SPY/QQQ/IWM live). One state drives the single
  // market hook + the chart/chain/spot toggle — the desk (§02/§03) is per-channel.
  const [symbol, setSymbol] = useState("SPY");
  const data = useMarketData(symbol);
  const view = useDeskState();
  // Multi-account (cockpit P3): the selected bucket scopes the live feed (NAV / signals /
  // positions / day-P&L) as well as the roster. Declared ABOVE useDeskFeed so the feed reads
  // the selected account's data, not the desk total.
  const { accounts, loading: accountsLoading } = useAccounts();
  const [acctId, setAcctId] = useState<string | null>(null);
  const configuredPaperAccountIds = useMemo(
    () => accounts.filter((account) => account.mode === "paper").map((account) => account.id),
    [accounts],
  );
  const feed = useDeskFeed(
    acctId,
    configuredPaperAccountIds,
    !accountsLoading && acctId != null,
  );
  const write = useDeskWrite();
  const isMobile = useIsMobile();
  const { mode } = useShell();
  // Active room (shell tabs) is known before the evidence hooks so deep OPS
  // ledgers can stay dormant outside the OPS workspace. This preserves the
  // single page-owned subscription seam without polling hidden workspaces.
  const [activeRoom, setActiveRoom] = useState<Room>("play");
  useEffect(() => {
    const s = localStorage.getItem("seve-room");
    if (s === "play" || s === "mix" || s === "write" || s === "tape" || s === "ops") setActiveRoom(s);
  }, []);
  useEffect(() => { localStorage.setItem("seve-room", activeRoom); }, [activeRoom]);
  const [selected, setSelected] = useState<string | null>(null);
  const contractHistory = useContractHistory(selected);

  // SPY up/down on the day: spot vs the PRIOR session's close (the conventional
  // day-change reference). Using today's first bar mis-colored it — that bar can
  // be a noisy pre-market print well above the prior close. null until ready.
  const spotUp = useMemo<boolean | null>(() => {
    const bars = data.bars;
    if (!bars.length || data.spot == null) return null;
    const today = bars[bars.length - 1].ts.slice(0, 10);
    let priorClose: number | null = null;
    for (let i = bars.length - 1; i >= 0; i--) {
      if (bars[i].ts.slice(0, 10) < today) { priorClose = bars[i].close; break; }
    }
    return priorClose != null ? data.spot >= priorClose : null;
  }, [data.bars, data.spot]);

  // Lifted to the seam — called ONCE here so the persistent shell AND both layouts
  // share one accounts/ops poll + one live-marked P&L derivation (no re-subscribe).
  const ops = useOpsStatus();
  const opsEvidence = useOpsEvidence(
    120_000,
    activeRoom === "ops" || activeRoom === "tape",
    configuredPaperAccountIds,
  );
  useEffect(() => { if (!acctId && accounts.length) setAcctId(accounts[0].id); }, [accounts, acctId]);
  const liveMarks = usePositionMarks(feed.positions);
  const livePnl = channelPnl([...feed.positions, ...feed.recentTrades], liveMarks);
  const liveFund = liveFundPnl(
    feed.fundPnl,
    [...feed.positions, ...feed.recentTrades],
    liveMarks,
    feed.fundPnl.snapshotUnrealizedPnl,
    feed.fundPnl.snapshotCapturedAt,
  );
  // P5 slice 1 — shared remote reads LIFTED to the seam (called ONCE here, carried through
  // SurfaceProps). PERFORM + mobile leaves consumed these directly before; now they never
  // subscribe. sentinel (brief/scan/judge/lens), workerRuns (crash-attribution ledger, wired
  // for the incident banner — not rendered yet, that's slice 3), positionPeaks (ratcheted MFE).
  const sentinel = useSentinelDigest();
  const workerRuns = useWorkerRuns();
  const positionPeaks = usePositionPeaks(feed.positions, liveMarks);
  const studioEvidence = useStudioEvidence(acctId, mode === "studio", configuredPaperAccountIds);
  const channelControlPlane = useChannelControlPlaneView(mode === "studio");
  // Channel runtime identity is a page-owned, skin-neutral view model. Desktop,
  // mobile, and any future visual shell receive the exact same release state,
  // lifecycle classification, evidence counts, and policy identity.
  const allChannelWorkspace = useMemo(() => deriveChannelPassports({
    channels: view.desk.strategists,
    events: data.releaseEvents,
    signals: feed.signals,
    positions: feed.positions,
    recentTrades: feed.recentTrades,
    evidenceBySlug: studioEvidence.bySlug,
    evidenceSnapshot: {
      asOf: studioEvidence.asOf,
      loading: studioEvidence.loading,
      error: studioEvidence.error,
      basis: studioEvidence.basis,
    },
    releaseReadState: data.releaseReceiptHealth.lastError
      ? "error"
      : data.releaseReceiptHealth.lastSuccessAt
        ? "ok"
        : "checking",
  }), [view.desk.strategists, data.releaseEvents, data.releaseReceiptHealth.lastError, data.releaseReceiptHealth.lastSuccessAt, feed.signals, feed.positions, feed.recentTrades, studioEvidence.asOf, studioEvidence.basis, studioEvidence.bySlug, studioEvidence.error, studioEvidence.loading]);
  const accountChannels = useMemo(
    () => scopeChannelsToAccount(view.desk.strategists, allChannelWorkspace, acctId),
    [view.desk.strategists, allChannelWorkspace, acctId],
  );
  const channelWorkspace = useMemo(
    () => scopeChannelWorkspace(allChannelWorkspace, accountChannels),
    [allChannelWorkspace, accountChannels],
  );
  // P5 slice 3 — deterministic incident, derived ONCE at the seam from ops/workerRuns/positions/fund/
  // session. A 15s tick (+ the hook polls) keeps nowMs fresh so time-based escalation re-renders.
  useRefreshTick(15_000);
  const positionsBE = positionsByExecutor(feed.positions, view.desk.strategists);
  const derivedIncident = deriveIncident({
    nowMs: Date.now(),
    session: marketSession(Date.now()),
    fund: view.desk.fund,
    ops,
    workerRuns,
    positions: positionsBE,
  });
  // DEV-ONLY (?incident=<sev>) — force a fixture incident to verify HIGH/CRITICAL in the REAL PerformSurface
  // layout. Compile-time gated by NODE_ENV, so it is dead-code-eliminated from the production bundle.
  const [devSev, setDevSev] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    setDevSev(new URLSearchParams(window.location.search).get("incident"));
  }, []);
  const incident = process.env.NODE_ENV !== "production" && devSev
    ? devIncidentFixture(devSev, positionsBE, derivedIncident.session)
    : derivedIncident;
  const opsReadiness = deriveOpsReadiness({
    nowMs: Date.now(),
    releaseEvents: data.releaseEvents,
    releaseReadState: data.releaseReceiptHealth.lastError
      ? "error"
      : data.releaseReceiptHealth.lastSuccessAt
        ? "ok"
        : "checking",
    evidence: opsEvidence,
    sentinel: {
      state: sentinel.state,
      err: sentinel.err,
      date: sentinel.date,
      forDate: sentinel.forDate,
      session: sentinel.session,
      createdAt: sentinel.createdAt,
      publishedAt: sentinel.publishedAt,
      message: sentinel.message,
      schemaVersion: sentinel.schemaVersion,
      publisherVersion: sentinel.publisherVersion,
      publisherEvidenceState: sentinel.publisherEvidenceState || undefined,
      publisherEvidenceDetail: sentinel.publisherEvidenceDetail,
      briefAsOf: sentinel.brief?.asOf,
    },
    openPositions: feed.sessionTrades.open,
    closedPositions: feed.sessionTrades.closed,
  });
  // Keep the bounded prospective ledger warm so channel-level dry-powder
  // diagnostics are already present when the operator opens an inspector.
  const shadowResearch = useShadowResearch(!accountsLoading, configuredPaperAccountIds);
  const managerEvidence = useChannelManagerEvidence(true);
  const decisionAtlas = useDecisionAtlasReports(!accountsLoading);
  const reviewEnabled = activeRoom === "tape";
  const daily = useDailyReports(8, reviewEnabled);
  const weekly = useWeeklyReports(6, reviewEnabled);
  const forensics = useForensicsReport(reviewEnabled);
  const pyramid = usePyramidShadow(14, reviewEnabled);
  const virtualBench = useVirtualBench(reviewEnabled);
  const [pnlWindow, setPnlWindow] = useState<PnlWindow>("today");
  const windowedPnl = useWindowedPnl(
    pnlWindow,
    acctId,
    configuredPaperAccountIds,
    reviewEnabled && !accountsLoading,
  );
  const reviewEvidence = {
    daily,
    weekly,
    forensics,
    pyramid,
    virtualBench,
    pnlWindow,
    setPnlWindow,
    windowedPnl,
  };
  // 909 KIT — audible fills (opt-in via the KIT pad; inert while off). At the
  // seam so desktop + mobile share one diff of the same feed.
  useKitSounds(feed.positions, feed.recentTrades);

  // Active room (shell tabs) + the DESK market-band collapse — persisted so the
  // operator returns to the same room/layout. Lifted to the seam (passed down).
  const [collapsedMarket, setCollapsedMarket] = useState(false);

  const props = { data, view, feed, write, spotUp, selected, setSelected, contractHistory, symbol, setSymbol, theme, setTheme, accounts, acctId, setAcctId, accountChannels, ops, liveMarks, livePnl, liveFund, activeRoom, setActiveRoom, collapsedMarket, setCollapsedMarket, sentinel, workerRuns, positionPeaks, incident, studioEvidence, channelWorkspace, channelControlPlane, opsReadiness, shadowResearch, managerEvidence, decisionAtlas, reviewEvidence };

  // P5 slice 2 — the legacy FIVE-room product (DesktopSurface: Play/Mix/Write/Tape/Ops) is no
  // longer MOUNTED beneath STUDIO (that duplicated the header/transport/KILL/chart/book/sequencer/
  // nav on one page). It moves behind ONE explicit entry: a "Legacy rooms" link at the foot of
  // STUDIO opens it as a full replacement view, with a way back. The PAGE-OWNED seam
  // (sentinel/workerRuns/positionPeaks) stays singular; the legacy view's OWN lazy panels
  // (Brief/Pnl/Sentinel/Positions) still perform their documented reads while it is mounted —
  // a transitional double-read that goes away when the legacy view is retired (slice 7).
  const [legacyOpen, setLegacyOpen] = useState(false);

  // Mobile (S5 rework) — the PERFORM/STUDIO phone shell. Shares the same seam
  // props + the persisted mode/skin (useShell) as desktop; MobileApp is retained
  // on disk (reviewer decides deletion at S6) but no longer mounted.
  if (isMobile) {
    return presentation === "folio"
      ? <FolioShell surface={props} dayChangePct={marketSummary(data.bars, data.spot).dayChangePct} mobile onLegacy={() => setLegacyOpen(true)} />
      : <MobileShell {...props} />;
  }

  // DESKTOP — one fixed workstation chassis spans both modes. Its inset display
  // composes the subscription-free Studio/Perform surfaces; the hardware frame,
  // telemetry, PT clock, guarded KILL, and mode switch never move between them.
  // The legacy DesktopSurface remains reachable as a replacement view (slice 2).
  const mkt = marketSummary(data.bars, data.spot);

  // LEGACY VIEW (P5 slice 2) — the full DesktopSurface as a REPLACEMENT (not a sibling
  // beneath STUDIO), so only one product/header/transport/KILL is ever on screen. Rendered
  // OUTSIDE .shell-root (its own cream chassis; shell skin tokens must not leak in). It receives
  // the page-owned seam props; note its own lazy panels still do their documented reads while
  // mounted (the transitional double-read noted above, retired with the legacy view at slice 7).
  if (legacyOpen) {
    return (
      <div className="legacy-view">
        <button type="button" className="legacy-back" onClick={() => setLegacyOpen(false)}>← Back to desk</button>
        <DesktopSurface {...props} />
      </div>
    );
  }

  return (
    <>
      {presentation === "folio"
        ? <FolioShell surface={props} dayChangePct={mkt.dayChangePct} mobile={false} onLegacy={() => setLegacyOpen(true)} />
        : <WorkstationShell surface={props} onLegacy={() => setLegacyOpen(true)} />}
      {/* ⌘K COMMAND palette (S4) — mounted ONCE inside .shell-root so it floats over EITHER
          room. Opens on the shared `seve:command-palette` event; roster scoped to the account. */}
      <CommandPalette
        channels={accountChannels}
      />
    </>
  );
}

// The chassis theme (cream | blackout) is now the shell SKIN — the same union,
// one source of truth. The FRAME switch (`F`) and the OPS settings toggle both
// flip it; the page stamps it as data-theme on .console-root (the legacy
// [data-theme="blackout"] override still re-skins the whole chassis) and the
// shell mirrors it as data-skin. ShellProvider owns the persisted state.
function PageInner({ presentation }: { presentation: WorkstationPresentation }) {
  const { skin, setSkin } = useShell();
  // Dispatch-shaped adapter so the shared SurfaceProps type is unchanged — the
  // OPS/mobile toggles call it value-form, but honour functional updaters too.
  const setTheme: Dispatch<SetStateAction<"cream" | "blackout">> = (v) =>
    setSkin(typeof v === "function" ? v(skin) : v);
  return (
    <div className="console-root" data-theme={skin}>
      <DeskProvider>
        <Surface theme={skin} setTheme={setTheme} presentation={presentation} />
        <ThemeBridge skin={skin} setSkin={setSkin} />
      </DeskProvider>
    </div>
  );
}

function OperatorWorkstation({ presentation }: { presentation: WorkstationPresentation }) {
  const { ready, operator } = useAuth();

  // The desk is private, not a public dashboard with privileged buttons. Do not
  // mount any data hook/subscription until Supabase has verified the immutable
  // operator claim on the restored or newly-created session.
  if (!ready) {
    return <main className="operator-gate"><div className="operator-gate__status">VERIFYING OPERATOR SESSION…</div></main>;
  }
  if (!operator) {
    return (
      <main className="operator-gate">
        <section className="operator-gate__panel" aria-label="private operator access">
          <div className="operator-gate__brand"><b>SEVE DESK</b><span>PRIVATE PAPER-TRADING WORKSTATION</span></div>
          <p>Operator authentication is required before market, position, strategy, or system data is loaded.</p>
          <AuthControl defaultOpen />
        </section>
      </main>
    );
  }

  return (
    <ShellProvider>
      <PageInner presentation={presentation} />
    </ShellProvider>
  );
}

export default function Page() {
  const presentation = usePresentation();
  return <OperatorWorkstation presentation={presentation} />;
}
