"use client";

import "@/app/studio.css";
import { useMemo, useState } from "react";
import { ChannelInspector } from "@/components/studio/ChannelInspector";
import { StudioFleet } from "@/components/studio/StudioFleet";
import { StudioBand } from "@/components/studio/StudioBand";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { deriveStudioRows, sortStudioRows, summarizeStudioFleet, type StudioSort } from "@/lib/studio/deriveStudioView";
import type { StudioScope } from "@/components/studio/StudioFleet";

// =============================================================================
// STUDIO surface (P5 slice 4) — exception-first fleet tuning. The primary pane
// is a sortable summary table; repeated rack controls moved into the selected
// channel INSPECTOR. Desk controls + session tape live in the compact lower bar.
// Mounts INSIDE
// .shell-root[data-mode="studio"] so every rule in studio.css is scoped there.
//
// DATA: every source is REUSED from the seam (roster = view.desk.strategists
// scoped to acctId; livePnl for per-row day P&L; feed for signals + tape). No new
// subscriptions.
// =============================================================================

export function StudioSurface({ view, feed, write, livePnl, liveFund, acctId, symbol, channelWorkspace, channelControlPlane, shadowResearch, managerEvidence }: SurfaceProps) {
  void symbol;
  const { desk } = view;

  // Scope the roster to the selected account (identical to DesktopSurface).
  const channels = useMemo(
    () => (acctId ? desk.strategists.filter((s) => s.account_id === acctId) : desk.strategists),
    [desk.strategists, acctId],
  );

  const [selSlug, setSelSlug] = useState<string | null>(null);
  const [scope, setScope] = useState<StudioScope>("roots");
  const [sort, setSort] = useState<StudioSort>("attention");
  const rows = useMemo(
    () => deriveStudioRows(channels, livePnl, feed.signals, feed.updatedAt ? Date.parse(feed.updatedAt) : 0),
    [channels, livePnl, feed.signals, feed.updatedAt],
  );
  const summary = useMemo(() => summarizeStudioFleet(rows), [rows]);
  const visibleRows = useMemo(() => sortStudioRows(rows.filter((row) => {
    const lifecycle = channelWorkspace.bySlug[row.channel.slug]?.lifecycle;
    if (scope === "attention") return row.attentionReasons.length > 0;
    if (scope === "roots") return lifecycle === "paper-root";
    if (scope === "dark") return lifecycle === "dark-evidence";
    return true;
  }), sort), [rows, scope, sort, channelWorkspace]);
  const selectedRow = selSlug
    ? visibleRows.find((row) => row.channel.slug === selSlug)
    : undefined;

  return (
    <div className={`studio studio-v4 studio-v4b ${selectedRow ? "inspector-open" : "inspector-collapsed"}`}>
      <StudioFleet
        rows={visibleRows}
        summary={summary}
        selectedSlug={selectedRow?.channel.slug}
        scope={scope}
        sort={sort}
        passports={channelWorkspace}
        controlPlane={channelControlPlane}
        onScope={setScope}
        onSort={setSort}
        onSelect={(slug) => setSelSlug((current) => current === slug ? null : slug)}
      />

      <ChannelInspector strategist={selectedRow?.channel} summary={selectedRow} passport={selectedRow ? channelWorkspace.bySlug[selectedRow.channel.slug] : undefined} write={write} controlPlane={channelControlPlane} dryPowder={selectedRow ? shadowResearch.dryPowderBySlug[selectedRow.channel.slug] : undefined} managerEvidence={selectedRow ? managerEvidence.book?.channels[selectedRow.channel.slug] : undefined} onClose={() => setSelSlug(null)} />

      <StudioBand
        fund={desk.fund}
        fundPnl={liveFund}
        positions={feed.positions}
        recentTrades={feed.recentTrades}
        strategists={desk.strategists}
      />
    </div>
  );
}
