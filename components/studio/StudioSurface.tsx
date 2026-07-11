"use client";

import "@/app/studio.css";
import { useMemo, useState } from "react";
import { ChannelRackRow } from "@/components/studio/ChannelRackRow";
import { ChannelInspector } from "@/components/studio/ChannelInspector";
import { StudioBand } from "@/components/studio/StudioBand";
import type { SurfaceProps } from "@/components/surfaceTypes";

// =============================================================================
// STUDIO surface (PERFORM/STUDIO rebuild · slice S3) — the tuning room HERO.
// A full-height hero under the shared DeskShell top bar: the CHANNEL RACK (one
// ChannelRackRow per channel) + a selected-channel INSPECTOR (right) + the
// MASTER · SESSION-TAPE · REGISTRY band (bottom). Mounts INSIDE
// .shell-root[data-mode="studio"] so every rule in studio.css is scoped there.
//
// SCOPE: this is only the HERO. The legacy §01–§04 rooms (chart / chain /
// ContractDetail / autopsy / shadow book / P&L / OPS) stay REACHABLE, unchanged,
// as the sibling <DesktopSurface> rendered below the shell-root in page.tsx —
// that keeps its own anchor strip (the legacy Shell room tabs) and guarantees no
// functionality loss until each room is natively migrated (follow-on work).
//
// DATA: every source is REUSED from the seam (roster = view.desk.strategists
// scoped to acctId, same rule as DesktopSurface/PerformSurface; livePnl for the
// per-row day P&L; feed for the master + tape). No new subscriptions.
// =============================================================================

export function StudioSurface({ view, feed, livePnl, liveFund, acctId, symbol }: SurfaceProps) {
  void symbol;
  const { desk, anySolo, isActive } = view;

  // Scope the roster to the selected account (identical to DesktopSurface).
  const channels = useMemo(
    () => (acctId ? desk.strategists.filter((s) => s.account_id === acctId) : desk.strategists),
    [desk.strategists, acctId],
  );

  // Selected row → inspector. Default to the first channel of the visible roster;
  // fall back cleanly if the selected slug leaves the account scope.
  const [selSlug, setSelSlug] = useState<string | null>(null);
  const selected = channels.find((s) => s.slug === selSlug) ?? channels[0];

  return (
    <div className="studio">
      <section className="rack">
        <div className="rack-head rgrid">
          <span>Channel Rack · {channels.length}</span>
          <span>Mode</span>
          <span>Fires <span className="rh-stop">−stop</span>·<span className="rh-take">+take</span>·EOD</span>
          <span>Shape — stop | entry | take</span>
          <span title="daily realized-loss LATCH — halts NEW entries for the day once realized P&L ≤ −$X">HALT/day</span>
          <span>Risk/tr</span>
          <span style={{ textAlign: "right" }}>Day P&amp;L</span>
          <span>M·B</span>
        </div>
        <div className="rack-rows">
          {channels.map((s) => (
            <ChannelRackRow
              key={s.slug}
              strategist={s}
              pnl={livePnl[s.slug]}
              active={isActive(s.slug) && !(anySolo && !s.config.soloed && !s.config.muted)}
              selected={selected?.slug === s.slug}
              onSelect={() => setSelSlug(s.slug)}
            />
          ))}
          {channels.length === 0 && <div className="rack-empty">no channels in this account</div>}
        </div>
      </section>

      <ChannelInspector strategist={selected} />

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
