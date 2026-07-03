"use client";

import { useEffect, useState } from "react";
import { signedUsd } from "@/lib/format";
import { useFold } from "@/hooks/useFold";
import { useDailyReports } from "@/hooks/useDailyReports";
import type { StrategistState } from "@/lib/desk/types";
import { pmVar } from "@/lib/desk/colors";

const SEV_CLASS: Record<string, string> = { high: "au-sev-high", med: "au-sev-med", low: "au-sev-low" };
const EXP_KEY = "seve-autopsy-expanded";
const shortDate = (d: string) => d.slice(5); // "06-01"
const topExit = (ex: Record<string, number>) => {
  const e = Object.entries(ex).sort((a, b) => b[1] - a[1])[0];
  return e ? `${e[0]} ${Math.round((e[1] / Object.values(ex).reduce((a, b) => a + b, 0)) * 100)}%` : "—";
};

// Reads the daily-autopsy reports (lazy) and renders the latest (with a date
// selector) in the 909 panel idiom. COLLAPSED by default to a glanceable summary
// (market + fund + per-channel P&L/flaw chips); EXPAND reveals metrics, verdicts,
// system findings and top actions. Strategists are passed for the accent colors.
export function DailyAutopsyPanel({ strategists }: { strategists: StrategistState[] }) {
  const { reports, loading, error } = useDailyReports(8);
  const [idx, setIdx] = useState(0);
  const [folded, toggleFold] = useFold("daily-autopsy");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { try { if (window.localStorage.getItem(EXP_KEY) === "1") setExpanded(true); } catch { /* */ } }, []);
  const toggleExp = () => setExpanded((v) => { try { window.localStorage.setItem(EXP_KEY, v ? "0" : "1"); } catch { /* */ } return !v; });
  const colorOf = (slug: string) => pmVar(strategists.find((s) => s.slug === slug)?.color ?? "green");
  // Benched (86'd) channels: grey the row + chip it, so a report written when the
  // channel was live can't read as current policy (autopsies are history, not roster).
  const benched = new Set(strategists.filter((s) => s.status !== "armed").map((s) => s.slug));

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="panel">
      <div className="phead"><span className="t">Daily Autopsy</span><span className="x">end-of-day</span></div>
      <div className="pbody">{children}</div>
    </div>
  );

  if (loading) return <Frame><div className="chart-empty">loading reports…</div></Frame>;
  if (error) return <Frame><div className="chart-empty">couldn&apos;t load reports — {error}</div></Frame>;
  if (!reports.length) return <Frame><div className="chart-empty">no autopsy reports yet — generated a few minutes after each close</div></Frame>;

  const r = reports[Math.min(idx, reports.length - 1)];
  const d = r.digest, n = r.narrative;
  const traded = (d.channels ?? []).filter((c) => c.metrics.nTrades > 0);
  const dormant = (d.channels ?? []).filter((c) => c.metrics.nTrades === 0);
  const nFindings = n?.systemFindings?.length ?? 0;
  const nActions = n?.topActions?.length ?? 0;
  // collapsed view shows only the day's top movers (best/worst by realized P&L), not the
  // full channel list — the list is the bulk of the panel's height.
  const sorted = [...traded].sort((a, b) => b.metrics.realizedPnl - a.metrics.realizedPnl);
  const best = sorted[0], worst = sorted.length > 1 ? sorted[sorted.length - 1] : undefined;

  return (
    <div className={`panel${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">Daily Autopsy</span>
        <button className="au-expand" onClick={toggleExp} aria-expanded={expanded} title={expanded ? "collapse" : "expand full detail"}>
          {r.mode}{n ? "" : " · no LLM"} · {expanded ? "▾ collapse" : "▸ expand"}
        </button>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div className="pbody">
        <div className="seg au-dates" aria-label="report date">
          {reports.slice(0, 6).map((rep, i) => (
            <button key={rep.report_date} className={i === idx ? "on" : ""} onClick={() => setIdx(i)} aria-pressed={i === idx}>
              {shortDate(rep.report_date)}
            </button>
          ))}
        </div>

        {n?.marketSummary && <p className={`au-market${expanded ? "" : " au-market--clamp"}`}>{n.marketSummary}</p>}
        {d.fund && (
          <div className="au-fund">
            <span>{d.fund.trades} trades · {d.fund.channelsTraded} ch</span>
            <span className={d.fund.dayRealized < 0 ? "neg" : "pos"}>{signedUsd(d.fund.dayRealized)}</span>
            <span>win {Math.round(d.fund.winRate * 100)}%</span>
          </div>
        )}

        {expanded && (
        <div className="au-channels">
          {traded.map((c) => {
            const cn = n?.channels?.find((x) => x.slug === c.slug);
            const m = c.metrics;
            return (
              <div className={`au-ch${expanded ? "" : " au-ch--compact"}${benched.has(c.slug) ? " au-ch--benched" : ""}`} key={c.slug}>
                <div className="au-ch-head">
                  <span className="au-dot" style={{ background: colorOf(c.slug), boxShadow: `0 0 5px ${colorOf(c.slug)}` }} />
                  <span className="au-name">{c.name}</span>
                  {benched.has(c.slug) && <span className="au-chip au-benched" title="benched (draft) — no entries; this report predates the cull">86&apos;d</span>}
                  {!expanded && c.flaws.length > 0 && (
                    <span className="au-flaws au-flaws--inline">
                      {c.flaws.map((f) => <span key={f.type} className={`au-flaw ${SEV_CLASS[f.severity] ?? "au-sev-low"}`}>{f.type}</span>)}
                    </span>
                  )}
                  <span className={`au-pnl ${m.realizedPnl < 0 ? "neg" : "pos"}`}>{signedUsd(m.realizedPnl)}</span>
                </div>
                {expanded && (
                  <>
                    <div className="au-metrics">
                      {m.nTrades}t · {Math.round(m.winRate * 100)}% · hold {m.medianHoldMin.toFixed(1)}m · {m.avgR >= 0 ? "+" : ""}{m.avgR.toFixed(2)}R · exit {topExit(c.exitReasons)}
                    </div>
                    {cn?.verdict && <div className="au-verdict">{cn.verdict}</div>}
                    {c.flaws.length > 0 && (
                      <div className="au-flaws">
                        {c.flaws.map((f) => <span key={f.type} className={`au-flaw ${SEV_CLASS[f.severity] ?? "au-sev-low"}`}>{f.type}</span>)}
                      </div>
                    )}
                  </>
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
            ▾ {traded.length} channel{traded.length === 1 ? "" : "s"}{nFindings ? ` · ${nFindings} finding${nFindings === 1 ? "" : "s"}` : ""}{nActions ? ` · ${nActions} action${nActions === 1 ? "" : "s"}` : ""} — expand
          </button>
        )}

        {expanded && !!n?.systemFindings?.length && (
          <div className="au-section">
            <div className="au-sub">System findings</div>
            {n.systemFindings.map((f, i) => (
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
            <div className="au-sub">Top actions</div>
            <ul className="au-actions">{n.topActions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
