"use client";

import { useEffect, useState } from "react";
import { signedUsd } from "@/lib/format";
import { useFold } from "@/hooks/useFold";
import type { useDailyReports } from "@/hooks/useDailyReports";
import type { StrategistState } from "@/lib/desk/types";
import { pmVar } from "@/lib/desk/colors";

const SEV_CLASS: Record<string, string> = { high: "au-sev-high", med: "au-sev-med", low: "au-sev-low" };
const EXP_KEY = "seve-autopsy-expanded";
const shortDate = (d: string) => d.slice(5); // "06-01"
const topExit = (ex: Record<string, number>) => {
  const e = Object.entries(ex).sort((a, b) => b[1] - a[1])[0];
  return e ? `${e[0]} ${Math.round((e[1] / Object.values(ex).reduce((a, b) => a + b, 0)) * 100)}%` : "—";
};

// The DAY view of the merged Autopsy panel (frame + DAY⇄WEEK seg live in AutopsyPanel).
// Glance = fund line + harvest meter + findings CHIPS + movers; expand = the full report.
export function DailyAutopsyBody({
  strategists,
  evidence,
}: {
  strategists: StrategistState[];
  evidence: ReturnType<typeof useDailyReports>;
}) {
  const { reports, loading, error } = evidence;
  const [idx, setIdx] = useState(0);
  // findings/actions start FOLDED — expanded reports were monopolizing the column
  const [findingsFolded, toggleFindings] = useFold("daily-findings", true);
  const [actionsFolded, toggleActions] = useFold("daily-actions", true);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { try { if (window.localStorage.getItem(EXP_KEY) === "1") setExpanded(true); } catch { /* */ } }, []);
  const toggleExp = () => setExpanded((v) => { try { window.localStorage.setItem(EXP_KEY, v ? "0" : "1"); } catch { /* */ } return !v; });
  const colorOf = (slug: string) => pmVar(strategists.find((s) => s.slug === slug)?.color ?? "green");
  // Benched (86'd) channels: grey the row + chip it, so a report written when the
  // channel was live can't read as current policy (autopsies are history, not roster).
  const benched = new Set(strategists.filter((s) => s.status !== "armed").map((s) => s.slug));

  if (loading) return <div className="chart-empty">loading reports…</div>;
  if (error) return <div className="chart-empty">couldn&apos;t load reports — {error}</div>;
  if (!reports.length) return <div className="chart-empty">no autopsy reports yet — generated a few minutes after each close</div>;

  const r = reports[Math.min(idx, reports.length - 1)];
  const d = r.digest, n = r.narrative;
  const logicalEvidence = d.evidence?.unit === "logical_trade";
  const observationLabel = logicalEvidence ? "logical trades" : "legacy position rows";
  const traded = (d.channels ?? []).filter((c) => c.metrics.nTrades > 0);
  const dormant = (d.channels ?? []).filter((c) => c.metrics.nTrades === 0);
  const nFindings = n?.systemFindings?.length ?? 0;
  const nActions = n?.topActions?.length ?? 0;
  // collapsed view shows only the day's top movers (best/worst by realized P&L), not the
  // full channel list — the list is the bulk of the panel's height.
  const sorted = [...traded].sort((a, b) => b.metrics.realizedPnl - a.metrics.realizedPnl);
  const best = sorted[0], worst = sorted.length > 1 ? sorted[sorted.length - 1] : undefined;
  // HARVEST meter — peaked-trade-weighted avg peak vs kept, across the traded channels
  // (the avg-peak lens on the day itself: how much of what the desk found did it keep).
  const hv = traded.reduce(
    (a, c) => {
      const m = c.metrics as { avgPeakPct?: number | null; peakCapturePct?: number | null; nPeaked?: number };
      if (m.avgPeakPct != null && m.peakCapturePct != null && (m.nPeaked ?? 0) > 0) {
        a.w += m.nPeaked!; a.peak += m.avgPeakPct * m.nPeaked!; a.kept += m.peakCapturePct * m.nPeaked!;
      }
      return a;
    },
    { w: 0, peak: 0, kept: 0 },
  );
  const harvest = hv.w > 0 ? { peak: Math.round(hv.peak / hv.w), kept: Math.round(hv.kept / hv.w) } : null;

  return (
    <>
      <div className="seg au-dates" aria-label="report date">
        {reports.slice(0, 6).map((rep, i) => (
          <button key={rep.report_date} className={i === idx ? "on" : ""} onClick={() => setIdx(i)} aria-pressed={i === idx}>
            {shortDate(rep.report_date)}
          </button>
        ))}
      </div>

      {d.fund && (
        <div className="au-fund">
          <span title={logicalEvidence ? `${d.evidence?.positionRows ?? 0} position rows · ${d.evidence?.runnerRowsCollapsed ?? 0} runners collapsed · immutable routes` : "This stored report predates logical-trade evidence; do not compare its count directly with current reports."}>{d.fund.trades} {observationLabel} · {d.fund.channelsTraded} ch</span>
          <span className={d.fund.dayRealized < 0 ? "neg" : "pos"}>{signedUsd(d.fund.dayRealized)}</span>
          <span>positive {Math.round(d.fund.winRate * 100)}%</span>
        </div>
      )}

      {/* HARVEST — found vs kept, the day's one-line verdict (meter, not prose) */}
      {harvest && (
        <div className="mrow" style={{ margin: "5px 0 2px" }}>
          <span className="mut" style={{ whiteSpace: "nowrap" }}>avg peak +{harvest.peak}%</span>
          <span className="meter"><i style={{ width: `${Math.min(100, Math.max(0, harvest.kept))}%`, background: harvest.kept >= 50 ? "var(--green)" : "var(--red)" }} /></span>
          <b className={harvest.kept >= 50 ? "pos" : "neg"} style={{ whiteSpace: "nowrap" }}>kept {harvest.kept}%</b>
        </div>
      )}

      {/* FINDINGS as chips — the LLM's read at a glance; evidence on hover, full text on expand */}
      {!expanded && !!n?.systemFindings?.length && (
        <div className="au-flaws" style={{ margin: "5px 0 2px" }}>
          {n.systemFindings.slice(0, 3).map((f, i) => (
            <span key={i} className={`au-flaw ${SEV_CLASS[f.severity] ?? "au-sev-low"}`} title={f.evidence}>{f.type}</span>
          ))}
        </div>
      )}
      {!expanded && n?.marketSummary && <p className="au-market au-market--clamp">{n.marketSummary}</p>}
      {expanded && n?.marketSummary && <p className="au-market">{n.marketSummary}</p>}

      {expanded && (
      <div className="au-channels">
        {traded.map((c) => {
          const cn = n?.channels?.find((x) => x.slug === c.slug);
          const m = c.metrics;
          return (
            <div className={`au-ch${benched.has(c.slug) ? " au-ch--benched" : ""}`} key={c.slug}>
              <div className="au-ch-head">
                <span className="au-dot" style={{ background: colorOf(c.slug), boxShadow: `0 0 5px ${colorOf(c.slug)}` }} />
                <span className="au-name">{c.name}</span>
                {benched.has(c.slug) && <span className="au-chip au-benched" title="benched (draft) — no entries; this report predates the cull">86&apos;d</span>}
                <span className={`au-pnl ${m.realizedPnl < 0 ? "neg" : "pos"}`}>{signedUsd(m.realizedPnl)}</span>
              </div>
              <div className="au-metrics">
                {m.nTrades}t · {Math.round(m.winRate * 100)}% · hold {m.medianHoldMin.toFixed(1)}m · {m.avgR >= 0 ? "+" : ""}{m.avgR.toFixed(2)}R · exit {topExit(c.exitReasons)}
                {m.peakCapturePct != null && (
                  <span title={`${m.nPeaked}/${m.nTrades} trades peaked above entry · avg peak +${m.avgPeakPct}% · kept ${m.peakCapturePct}% of the peak gain`}>
                    {" "}· peak +{m.avgPeakPct}% · <b className={m.peakCapturePct >= 50 ? "pos" : "neg"}>kept {m.peakCapturePct}%</b>
                  </span>
                )}
              </div>
              {cn?.verdict && <div className="au-verdict">{cn.verdict}</div>}
              {c.flaws.length > 0 && (
                <div className="au-flaws">
                  {c.flaws.map((f) => <span key={f.type} className={`au-flaw ${SEV_CLASS[f.severity] ?? "au-sev-low"}`}>{f.type}</span>)}
                </div>
              )}
            </div>
          );
        })}
        {dormant.length > 0 && (
          <div className="au-dormant">dormant: {dormant.map((c) => c.name).join(" · ")}</div>
        )}
      </div>
      )}

      {!expanded && (best || worst) && (
        <div className="au-movers">
          {best && (
            <span className="au-mover">
              <span className="au-dot" style={{ background: colorOf(best.slug), boxShadow: `0 0 5px ${colorOf(best.slug)}` }} />
              <span className="au-mv-ar pos">▲</span><span className="au-mv-name">{best.name}</span>
              <span className="au-pnl pos">{signedUsd(best.metrics.realizedPnl)}</span>
            </span>
          )}
          {worst && (
            <span className="au-mover">
              <span className="au-dot" style={{ background: colorOf(worst.slug), boxShadow: `0 0 5px ${colorOf(worst.slug)}` }} />
              <span className="au-mv-ar neg">▼</span><span className="au-mv-name">{worst.name}</span>
              <span className="au-pnl neg">{signedUsd(worst.metrics.realizedPnl)}</span>
            </span>
          )}
          <span className="au-mv-count">{traded.length} ch{dormant.length ? ` · ${dormant.length} dormant` : ""}</span>
        </div>
      )}

      {!expanded && (
        <button className="au-expand-foot" onClick={toggleExp}>
          ▾ {traded.length} channel{traded.length === 1 ? "" : "s"}{nFindings ? ` · ${nFindings} finding${nFindings === 1 ? "" : "s"}` : ""}{nActions ? ` · ${nActions} action${nActions === 1 ? "" : "s"}` : ""} — full report
        </button>
      )}

      {expanded && !!n?.systemFindings?.length && (
        <div className="au-section">
          <button type="button" className="au-sub au-subfold" onClick={toggleFindings} aria-expanded={!findingsFolded}>
            System findings · {n.systemFindings.length}
            <span className="fold-ch">{findingsFolded ? "▸" : "▾"}</span>
          </button>
          {!findingsFolded && n.systemFindings.map((f, i) => (
            <div className="au-finding" key={i}>
              <div className="au-finding-head">
                <span className={`au-chip ${SEV_CLASS[f.severity] ?? "au-sev-low"}`}>{f.category}/{f.severity}</span>
                {f.recurrence === "recurring" && <span className="au-chip au-recur">↻ recurring</span>}
                {f.recurrence === "resolved" && <span className="au-chip au-resolved">✓ resolved</span>}
                <b className="au-ftype">{f.type}</b>
                {!!f.channels?.length && <span className="au-fch">{f.channels.join(", ")}</span>}
              </div>
              <div className="au-ev">{f.evidence}</div>
              <div className="au-exp">→ {f.suggestedExperiment}</div>
            </div>
          ))}
        </div>
      )}

      {expanded && !!n?.topActions?.length && (
        <div className="au-section">
          <button type="button" className="au-sub au-subfold" onClick={toggleActions} aria-expanded={!actionsFolded}>
            Top actions · {n.topActions.length}
            <span className="fold-ch">{actionsFolded ? "▸" : "▾"}</span>
          </button>
          {!actionsFolded && <ul className="au-actions">{n.topActions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </div>
      )}

      {expanded && <button className="au-expand-foot" onClick={toggleExp}>▴ collapse to glance</button>}
    </>
  );
}
