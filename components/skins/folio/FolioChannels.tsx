"use client";

import "@/app/studio.css";
import { useMemo, useState } from "react";
import { MobileStudio } from "@/components/mobile2/MobileStudio";
import { ChannelInspector } from "@/components/studio/ChannelInspector";
import { StudioModules } from "@/components/studio/StudioModules";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, usd0 } from "@/lib/format";
import { channelDecisionState } from "@/lib/studio/channelDecision";
import { deriveStudioRows, sortStudioRows, summarizeStudioFleet, type StudioSort } from "@/lib/studio/deriveStudioView";
import { resolveChannelRuntimeAuthority } from "@/lib/studio/channelRuntimeAuthority";

const SORTS: Array<{ value: StudioSort; label: string }> = [
  { value: "attention", label: "Attention" },
  { value: "pnl", label: "P&L" },
  { value: "risk", label: "Risk" },
  { value: "name", label: "Name" },
];

export function FolioChannelsDesktop({ surface }: { surface: SurfaceProps }) {
  const channels = surface.accountChannels;
  const [scope, setScope] = useState<"roots" | "dark" | "all">("roots");
  const [sort, setSort] = useState<StudioSort>("attention");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const rows = useMemo(
    () => deriveStudioRows(channels, surface.livePnl, surface.feed.signals, surface.feed.updatedAt ? Date.parse(surface.feed.updatedAt) : 0),
    [channels, surface.livePnl, surface.feed.signals, surface.feed.updatedAt],
  );
  const visible = useMemo(() => sortStudioRows(rows.filter((row) => {
    const authority = resolveChannelRuntimeAuthority(row.channel.slug, surface.channelWorkspace.bySlug[row.channel.slug], surface.channelControlPlane?.view, surface.acctId);
    return scope === "all" || authority.scope === scope;
  }), sort), [rows, scope, sort, surface.acctId, surface.channelControlPlane?.view, surface.channelWorkspace.bySlug]);
  const selected = rows.find((row) => row.channel.slug === selectedSlug) ?? visible[0] ?? rows[0];
  const summary = summarizeStudioFleet(rows);
  const runtimeCounts = rows.reduce((counts, row) => {
    const authority = resolveChannelRuntimeAuthority(row.channel.slug, surface.channelWorkspace.bySlug[row.channel.slug], surface.channelControlPlane?.view, surface.acctId);
    counts[authority.scope] += 1;
    return counts;
  }, { roots: 0, dark: 0 });
  const release = surface.channelWorkspace.releaseView;

  return (
    <div className="folio-channels folio-channels-desktop" data-nav-target="true" tabIndex={-1}>
      <header className="folio-workspace-title">
        <span><small>CHANNEL PORTFOLIO</small><b>{release.label}</b><em>{release.accountLifecycleLabel} · {release.shortHash}</em></span>
        <div>
          <span><small>TRADING</small><b>{runtimeCounts.roots}</b></span>
          <span><small>NOT TRADING</small><b>{runtimeCounts.dark}</b></span>
          <span><small>OPEN</small><b>{summary.openPositions}</b></span>
          <span><small>SESSION ATTRIB</small><b className={summary.dayPnl < 0 ? "neg" : summary.dayPnl > 0 ? "pos" : ""}>{signedUsd(summary.dayPnl)}</b></span>
        </div>
      </header>

      <div className="folio-channel-grid">
        <section className="folio-channel-list">
          <header><div role="group" aria-label="Channel lifecycle"><button className={scope === "roots" ? "on" : ""} onClick={() => setScope("roots")}>TRADING</button><button className={scope === "dark" ? "on" : ""} onClick={() => setScope("dark")}>NOT TRADING</button><button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>ALL</button></div><label>SORT<select value={sort} onChange={(event) => setSort(event.target.value as StudioSort)}>{SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></header>
          <div className="folio-channel-rows">
            {visible.map((row) => {
              const passport = surface.channelWorkspace.bySlug[row.channel.slug];
              const authority = resolveChannelRuntimeAuthority(row.channel.slug, passport, surface.channelControlPlane?.view, surface.acctId);
              const decision = channelDecisionState(row.lastSignal);
              return <button type="button" key={row.channel.slug} className={selected?.channel.slug === row.channel.slug ? "selected" : ""} style={{ ["--pm" as string]: pmVar(row.channel.color) }} onClick={() => setSelectedSlug(row.channel.slug)}>
                <i /><span><b>{row.channel.slug}</b><small>{passport?.rootPolicy?.familyId ?? row.channel.regime ?? "research lane"}</small></span>
                <em data-lifecycle={authority.posture}>{authority.label}</em>
                <span className="folio-channel-decision"><small>{decision.label}</small><b>{row.lastSignal?.signal_type ?? "No recent candidate"}</b></span>
                <span className="folio-channel-money"><b className={row.pnl.dayPnl < 0 ? "neg" : row.pnl.dayPnl > 0 ? "pos" : ""}>{signedUsd(row.pnl.dayPnl)}</b><small>{row.pnl.openCount ? `${row.pnl.openCount} open · ${usd0(row.pnl.exposure)}` : "flat"}</small></span>
              </button>;
            })}
            {visible.length === 0 && <p>No channels match this lifecycle.</p>}
          </div>
        </section>
        <ChannelInspector strategist={selected?.channel} summary={selected} passport={selected ? surface.channelWorkspace.bySlug[selected.channel.slug] : undefined} accountId={surface.acctId} write={surface.write} controlPlane={surface.channelControlPlane} dryPowder={selected ? surface.shadowResearch.dryPowderBySlug[selected.channel.slug] : undefined} shadowSummary={selected ? surface.shadowResearch.currentCumulative?.dark.find((item) => item.slug === selected.channel.slug) : undefined} managerEvidence={selected ? surface.managerEvidence.book?.channels[selected.channel.slug] : undefined} decisionBrief={selected ? surface.decisionAtlas.bySlug[selected.channel.slug] : undefined} researchEvidence={surface.shadowResearch} />
      </div>
      <StudioModules selected={selected} evidence={selected ? surface.studioEvidence.bySlug[selected.channel.slug] : undefined} evidenceState={surface.studioEvidence} positions={surface.feed.positions} recentTrades={surface.feed.recentTrades} incident={surface.incident} passport={selected ? surface.channelWorkspace.bySlug[selected.channel.slug] : undefined} />
    </div>
  );
}

export function FolioChannelsMobile({ surface, openSlug, setOpenSlug, onAddChannel, onOpenSettings }: {
  surface: SurfaceProps;
  openSlug: string | null;
  setOpenSlug: (slug: string | null) => void;
  onAddChannel: () => void;
  onOpenSettings: () => void;
}) {
  const channels = surface.accountChannels;
  return <div className="folio-channels folio-channels-mobile"><MobileStudio props={surface} channels={channels} livePnl={surface.livePnl} openSlug={openSlug} setOpenSlug={setOpenSlug} onAddChannel={onAddChannel} onOpenSettings={onOpenSettings} /></div>;
}
