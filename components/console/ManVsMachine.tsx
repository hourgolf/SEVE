"use client";

import { signedUsd } from "@/lib/format";
import { isManualChannel, baseSlugOf } from "@/lib/desk/manual";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";

// Live man-vs-machine scorecard for the manual-exit A/B. For each `<base>-manual` twin
// (operator-closed) it pairs the SAME-entry programmed base (machine) and shows today's
// P&L for each + the edge (you − machine). Uses the per-channel P&L already derived off
// the live marks, so it tracks intraday. Renders nothing until a `-manual` twin exists.
export function ManVsMachine({
  strategists,
  pnl,
}: {
  strategists: StrategistState[];
  pnl: Record<string, ChannelPnl>;
}) {
  const pairs = strategists
    .filter((s) => isManualChannel(s.slug))
    .map((twin) => {
      const baseSlug = baseSlugOf(twin.slug);
      const base = strategists.find((s) => s.slug === baseSlug);
      const machine = pnl[baseSlug]?.dayPnl ?? 0;
      const human = pnl[twin.slug]?.dayPnl ?? 0;
      return { key: twin.slug, name: base?.name ?? baseSlug, machine, human, edge: human - machine };
    });
  if (!pairs.length) return null;

  const tot = pairs.reduce(
    (a, p) => ({ machine: a.machine + p.machine, human: a.human + p.human, edge: a.edge + p.edge }),
    { machine: 0, human: 0, edge: 0 },
  );

  return (
    <div className="panel mvm">
      <div className="phead"><span>Man vs Machine · today</span></div>
      <table className="mvm-tbl">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>channel</th>
            <th>machine</th>
            <th>you ✋</th>
            <th>your edge</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr key={p.key}>
              <td style={{ textAlign: "left" }}>{p.name}</td>
              <td className={p.machine < 0 ? "neg" : "pos"}>{signedUsd(p.machine)}</td>
              <td className={p.human < 0 ? "neg" : "pos"}>{signedUsd(p.human)}</td>
              <td className={p.edge < 0 ? "neg" : "pos"}><strong>{signedUsd(p.edge)}</strong></td>
            </tr>
          ))}
          <tr className="mvm-tot">
            <td style={{ textAlign: "left" }}>TOTAL</td>
            <td className={tot.machine < 0 ? "neg" : "pos"}>{signedUsd(tot.machine)}</td>
            <td className={tot.human < 0 ? "neg" : "pos"}>{signedUsd(tot.human)}</td>
            <td className={tot.edge < 0 ? "neg" : "pos"}><strong>{signedUsd(tot.edge)}</strong></td>
          </tr>
        </tbody>
      </table>
      <div className="mvm-note">same entries · you own the exits · today only (cumulative in the backend)</div>
    </div>
  );
}
