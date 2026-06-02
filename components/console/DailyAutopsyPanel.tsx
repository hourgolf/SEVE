"use client";

import { useState } from "react";
import { signedUsd } from "@/lib/format";
import { useDailyReports } from "@/hooks/useDailyReports";
import type { PmColor, StrategistState } from "@/lib/desk/types";

const PM_VAR: Record<PmColor, string> = {
  green: "var(--pm-green)", blue: "var(--pm-blue)", amber: "var(--pm-amber)", cyan: "var(--pm-cyan)",
};
const SEV_CLASS: Record<string, string> = { high: "au-sev-high", med: "au-sev-med", low: "au-sev-low" };
const shortDate = (d: string) => d.slice(5); // "06-01"
const topExit = (ex: Record<string, number>) => {
  const e = Object.entries(ex).sort((a, b) => b[1] - a[1])[0];
  return e ? `${e[0]} ${Math.round((e[1] / Object.values(ex).reduce((a, b) => a + b, 0)) * 100)}%` : "—";
};

// Reads the daily-autopsy reports (lazy) and renders the latest (with a date
// selector) in the 909 panel idiom. Strategists are passed only for the accent
// colors / consistency with the rest of the desk.
export function DailyAutopsyPanel({ strategists }: { strategists: StrategistState[] }) {
  const { reports, loading, error } = useDailyReports(8);
  const [idx, setIdx] = useState(0);
  const colorOf = (slug: string) => PM_VAR[strategists.find((s) => s.slug === slug)?.color ?? "green"];

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="panel panel--screws">
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

  return (
    <div className="panel panel--screws">
      <div className="phead">
        <span className="t">Daily Autopsy</span>
        <span className="x">{r.mode}{n ? "" : " · no LLM"}</span>
      </div>
      <div className="pbody">
        <div className="seg au-dates" aria-label="report date">
          {reports.slice(0, 6).map((rep, i) => (
            <button key={rep.report_date} className={i === idx ? "on" : ""} onClick={() => setIdx(i)} aria-pressed={i === idx}>
              {shortDate(rep.report_date)}
            </button>
          ))}
        </div>

        {n?.marketSummary && <p className="au-market">{n.marketSummary}</p>}
        {d.fund && (
          <div className="au-fund">
            <span>{d.fund.trades} trades · {d.fund.channelsTraded} ch</span>
            <span className={d.fund.dayRealized < 0 ? "neg" : "pos"}>{signedUsd(d.fund.dayRealized)}</span>
            <span>win {Math.round(d.fund.winRate * 100)}%</span>
          </div>
        )}

        <div className="au-channels">
          {traded.map((c) => {
            const cn = n?.channels?.find((x) => x.slug === c.slug);
            const m = c.metrics;
            return (
              <div className="au-ch" key={c.slug}>
                <div className="au-ch-head">
                  <span className="au-dot" style={{ background: colorOf(c.slug), boxShadow: `0 0 5px ${colorOf(c.slug)}` }} />
                  <span className="au-name">{c.name}</span>
                  <span className={`au-pnl ${m.realizedPnl < 0 ? "neg" : "pos"}`}>{signedUsd(m.realizedPnl)}</span>
                </div>
                <div className="au-metrics">
                  {m.nTrades}t · {Math.round(m.winRate * 100)}% · hold {m.medianHoldMin.toFixed(1)}m · {m.avgR >= 0 ? "+" : ""}{m.avgR.toFixed(2)}R · exit {topExit(c.exitReasons)}
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

        {!!n?.systemFindings?.length && (
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

        {!!n?.topActions?.length && (
          <div className="au-section">
            <div className="au-sub">Top actions</div>
            <ul className="au-actions">{n.topActions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
