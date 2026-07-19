"use client";

import "@/app/studio.css";
import { useMemo, useState } from "react";
import { ChannelInspector } from "@/components/studio/ChannelInspector";
import { StudioFleet } from "@/components/studio/StudioFleet";
import { StudioBand } from "@/components/studio/StudioBand";
import { StudioModules } from "@/components/studio/StudioModules";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { deriveStudioRows, sortStudioRows, summarizeStudioFleet, type StudioSort } from "@/lib/studio/deriveStudioView";

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

export function StudioSurface({ view, feed, write, livePnl, liveFund, acctId, symbol, incident, studioEvidence, channelWorkspace, opsReadiness }: SurfaceProps) {
  void symbol;
  const { desk } = view;

  // Scope the roster to the selected account (identical to DesktopSurface).
  const channels = useMemo(
    () => (acctId ? desk.strategists.filter((s) => s.account_id === acctId) : desk.strategists),
    [desk.strategists, acctId],
  );

  const [selSlug, setSelSlug] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(true);
  const [sort, setSort] = useState<StudioSort>("attention");
  const rows = useMemo(
    () => deriveStudioRows(channels, livePnl, feed.signals, feed.updatedAt ? Date.parse(feed.updatedAt) : 0),
    [channels, livePnl, feed.signals, feed.updatedAt],
  );
  const summary = useMemo(() => summarizeStudioFleet(rows), [rows]);
  const visibleRows = useMemo(
    () => sortStudioRows(showAll ? rows : rows.filter((row) => row.attentionReasons.length > 0), sort),
    [rows, showAll, sort],
  );
  const selectedRow = rows.find((row) => row.channel.slug === selSlug) ?? visibleRows[0] ?? rows[0];

  return (
    <div className="studio studio-v4 studio-v4b">
      <StudioFleet
        rows={visibleRows}
        summary={summary}
        selectedSlug={selectedRow?.channel.slug}
        showAll={showAll}
        sort={sort}
        passports={channelWorkspace}
        onShowAll={setShowAll}
        onSort={setSort}
        onSelect={setSelSlug}
      />

      <ChannelInspector strategist={selectedRow?.channel} summary={selectedRow} passport={selectedRow ? channelWorkspace.bySlug[selectedRow.channel.slug] : undefined} write={write} />

      <StudioModules
        selected={selectedRow}
        evidence={selectedRow ? studioEvidence.bySlug[selectedRow.channel.slug] : undefined}
        evidenceState={studioEvidence}
        positions={feed.positions}
        recentTrades={feed.recentTrades}
        incident={incident}
        passport={selectedRow ? channelWorkspace.bySlug[selectedRow.channel.slug] : undefined}
      />

      <StudioBand
        fund={desk.fund}
        fundPnl={liveFund}
        positions={feed.positions}
        recentTrades={feed.recentTrades}
        strategists={desk.strategists}
        reconciliation={opsReadiness.evidence.find((item) => item.id === "reconciliation")}
      />
    </div>
  );
}
