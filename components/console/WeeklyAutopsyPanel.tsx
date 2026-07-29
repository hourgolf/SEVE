"use client";

import { useEffect, useState } from "react";
import { signedUsd } from "@/lib/format";
import { useFold } from "@/hooks/useFold";
import type { useWeeklyReports } from "@/hooks/useWeeklyReports";
import type { StrategistState } from "@/lib/desk/types";
import { pmVar } from "@/lib/desk/colors";

const SEV_CLASS: Record<string, string> = { high: "au-sev-high", med: "au-sev-med", low: "au-sev-low" };
const PRI_CLASS: Record<string, string> = { high: "au-sev-high", med: "au-sev-med", low: "au-sev-low" };
const VERDICT_CLASS: Record<string, string> = { keep: "au-sev-low", watch: "au-sev-med", retune: "au-sev-med", mute: "au-sev-high" };
const EXP_KEY = "seve-weekly-expanded";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const md = (d: string) => d.slice(5); // "06-01"

// The WEEK view of the merged Autopsy panel (frame + DAY⇄WEEK seg live in AutopsyPanel).
// Headline = exit efficiency (left on the table); glance = fund line + movers; expand = full.
export function WeeklyAutopsyBody({
  strategists,
  evidence,
}: {
  strategists: StrategistState[];
  evidence: ReturnType<typeof useWeeklyReports>;
}) {
  const { reports, loading, error } = evidence;
  const [idx, setIdx] = useState(0);
  // learnings/suggestions start FOLDED — expanded reports were monopolizing the column
  const [learnFolded, toggleLearn] = useFold("weekly-learnings", true);
  const [sugFolded, toggleSug] = useFold("weekly-suggestions", true);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { try { if (window.localStorage.getItem(EXP_KEY) === "1") setExpanded(true); } catch { /* */ } }, []);
  const toggleExp = () => setExpanded((v) => { try { window.localStorage.setItem(EXP_KEY, v ? "0" : "1"); } catch { /* */ } return !v; });
  const colorOf = (slug: string) => pmVar(strategists.find((s) => s.slug === slug)?.color ?? "green");
  // Benched (86'd) channels: grey + chip — a week-old KEEP/WATCH verdict must not
  // read as current roster policy after a cull (autopsies are history, not roster).
  const benched = new Set(strategists.filter((s) => s.status !== "armed").map((s) => s.slug));

  if (loading) return <div className="chart-empty">loading weekly…</div>;
  if (error) return <div className="chart-empty">couldn&apos;t load weekly — {error}</div>;
  if (!reports.length) return <div className="chart-empty">no weekly report yet — generated after Friday&apos;s close</div>;

  const r = reports[Math.min(idx, reports.length - 1)];
  const d = r.digest, n = r.narrative;
  const ee = d.exitEfficiency;
  const traded = (d.channels ?? []).filter((c) => c.metrics.nTrades > 0).sort((a, b) => b.metrics.realizedPnl - a.metrics.realizedPnl);
  // collapsed view: top movers only (traded is already sorted desc by realized P&L)
  const wkBest = traded[0], wkWorst = traded.length > 1 ? traded[traded.length - 1] : undefined;
  const nLearn = n?.keyLearnings?.length ?? 0, nSug = n?.suggestions?.length ?? 0;

  return (
    <>
      {reports.length > 1 && (
        <div className="seg au-dates" aria-label="report week">
          {reports.map((rep, i) => (
            <button key={rep.week_end} className={i === idx ? "on" : ""} onClick={() => setIdx(i)} aria-pressed={i === idx}>
              {md(rep.week_start)}–{md(rep.week_end)}
            </button>
          ))}
        </div>
      )}

      <div className="au-fund">
        <span>{md(d.weekStart)}–{md(d.weekEnd)} · {d.days.length}d · {d.fund.trades} trades</span>
        <span className={d.fund.realized < 0 ? "neg" : "pos"}>{signedUsd(d.fund.realized)}</span>
        {d.fund.navDelta != null && <span className={d.fund.navDelta < 0 ? "neg" : "pos"}>NAV {signedUsd(d.fund.navDelta)}</span>}
        {d.fund.maxDrawdown != null && <span className="neg" title="intraday peak-to-trough drawdown">maxDD −${Math.abs(d.fund.maxDrawdown).toFixed(0)}</span>}
        <span>win {pct(d.fund.winRate)}</span>
      </div>
      {d.fund.bestDay && d.fund.worstDay && (
        <div className="wk-extremes">
          <span>best <b>{md(d.fund.bestDay.date)}</b> <span className="pos">{signedUsd(d.fund.bestDay.pnl)}</span></span>
          <span>worst <b>{md(d.fund.worstDay.date)}</b> <span className="neg">{signedUsd(d.fund.worstDay.pnl)}</span></span>
        </div>
      )}

      {n?.weekSummary && <p className={`au-market${expanded ? "" : " au-market--clamp"}`}>{n.weekSummary}</p>}

      {/* regime ledger (detail — expanded only) */}
      {expanded && (
      <div className="wk-regime">
        {d.regimeLedger.map((rg) => (
          <span key={`${rg.date}-${rg.instrument}`} className="wk-reg" title={rg.note}>
            <b>{md(rg.date)}</b> <em className="wk-inst">{rg.instrument}</em> <span className={rg.returnPct < 0 ? "neg" : "pos"}>{rg.returnPct >= 0 ? "+" : ""}{rg.returnPct.toFixed(2)}%</span> <i>eff {rg.efficiency.toFixed(2)}</i>
          </span>
        ))}
      </div>
      )}

      {/* HEADLINE — exit efficiency / left on the table */}
      <div className="wk-ee">
        <div className="au-sub">Exit efficiency — left on the table</div>
        <div className="wk-ee-top">best-case upside unrealized this week: <b className="neg">{signedUsd(-ee.totalUpsideLeft)}</b></div>
        {expanded && ee.redThatRanGreen.slice(0, 6).map((rr) => (
          <div className="wk-runner" key={`${rr.slug}-${rr.occ}`}>
            <span className="wk-arrow">⤴</span>
            <span className="au-dot" style={{ background: colorOf(rr.slug), boxShadow: `0 0 5px ${colorOf(rr.slug)}` }} />
            <span className="wk-runner-occ">{rr.occ.replace(/^([A-Z]+)\d{6}/, "$1 ")}</span>
            <span className="wk-runner-txt">exited <span className="neg">{signedUsd(rr.actual)}</span> · ran to <span className="pos">{signedUsd(rr.couldHave)}</span></span>
          </div>
        ))}
        {!ee.redThatRanGreen.length && <div className="wk-ee-note">no red trades left a big green runner — exits roughly tracked the moves</div>}
      </div>

      {/* per-channel roll-up (expanded); collapsed shows top movers only */}
      {expanded && (
      <div className="au-channels">
        {traded.map((c) => {
          const cn = n?.channels?.find((x) => x.slug === c.slug);
          const m = c.metrics, cap = c.exitEfficiency.captureRatio;
          return (
            <div className={`au-ch${benched.has(c.slug) ? " au-ch--benched" : ""}`} key={c.slug}>
              <div className="au-ch-head">
                <span className="au-dot" style={{ background: colorOf(c.slug), boxShadow: `0 0 5px ${colorOf(c.slug)}` }} />
                <span className="au-name">{c.name}</span>
                {benched.has(c.slug) && <span className="au-chip au-benched" title="benched (draft) — no entries; this verdict predates the cull">86&apos;d</span>}
                {cn?.verdict && <span className={`au-chip ${VERDICT_CLASS[cn.verdict] ?? "au-sev-low"}`}>{cn.verdict}</span>}
                <span className="wk-cap" title="exit capture — share of the available move realized">cap {pct(cap)}</span>
                <span className={`au-pnl ${m.realizedPnl < 0 ? "neg" : "pos"}`}>{signedUsd(m.realizedPnl)}</span>
              </div>
              <div className="au-metrics">
                {m.nTrades}t · {pct(m.winRate)} · hold {m.medianHoldMin.toFixed(1)}m · {m.avgR >= 0 ? "+" : ""}{m.avgR.toFixed(2)}R · best {signedUsd(m.bestTrade)}/worst {signedUsd(m.worstTrade)}
              </div>
              <div className="wk-byday">
                {c.byDay.map((b) => <span key={b.date} className={b.pnl < 0 ? "neg" : b.pnl > 0 ? "pos" : ""}>{md(b.date)} {signedUsd(b.pnl)}</span>)}
              </div>
              {cn?.exitQuality && <div className="au-verdict">exit: {cn.exitQuality}</div>}
              {cn?.note && <div className="au-verdict">{cn.note}</div>}
              {c.recurringFlaws.length > 0 && (
                <div className="au-flaws">
                  {c.recurringFlaws.map((f) => <span key={f.type} className={`au-flaw ${SEV_CLASS[f.severity] ?? "au-sev-low"}`}>{f.type} ×{f.days}d</span>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {!expanded && (wkBest || wkWorst) && (
        <div className="au-movers">
          {wkBest && (
            <span className="au-mover">
              <span className="au-dot" style={{ background: colorOf(wkBest.slug), boxShadow: `0 0 5px ${colorOf(wkBest.slug)}` }} />
              <span className="au-mv-ar pos">▲</span><span className="au-mv-name">{wkBest.name}</span>
              <span className="au-pnl pos">{signedUsd(wkBest.metrics.realizedPnl)}</span>
            </span>
          )}
          {wkWorst && (
            <span className="au-mover">
              <span className="au-dot" style={{ background: colorOf(wkWorst.slug), boxShadow: `0 0 5px ${colorOf(wkWorst.slug)}` }} />
              <span className="au-mv-ar neg">▼</span><span className="au-mv-name">{wkWorst.name}</span>
              <span className="au-pnl neg">{signedUsd(wkWorst.metrics.realizedPnl)}</span>
            </span>
          )}
          <span className="au-mv-count">{traded.length} ch</span>
        </div>
      )}

      {!expanded && (
        <button className="au-expand-foot" onClick={toggleExp}>
          ▾ {traded.length} channel{traded.length === 1 ? "" : "s"}{nLearn ? ` · ${nLearn} learning${nLearn === 1 ? "" : "s"}` : ""}{nSug ? ` · ${nSug} suggestion${nSug === 1 ? "" : "s"}` : ""} — full report
        </button>
      )}

      {expanded && !!n?.keyLearnings?.length && (
        <div className="au-section">
          <button type="button" className="au-sub au-subfold" onClick={toggleLearn} aria-expanded={!learnFolded}>
            Key learnings · {n.keyLearnings.length}
            <span className="fold-ch">{learnFolded ? "▸" : "▾"}</span>
          </button>
          {!learnFolded && <ul className="au-actions">{n.keyLearnings.map((k, i) => <li key={i}>{k}</li>)}</ul>}
        </div>
      )}

      {expanded && !!n?.suggestions?.length && (
        <div className="au-section">
          <button type="button" className="au-sub au-subfold" onClick={toggleSug} aria-expanded={!sugFolded}>
            Ranked suggestions · {n.suggestions.length}
            <span className="fold-ch">{sugFolded ? "▸" : "▾"}</span>
          </button>
          {!sugFolded && n.suggestions.map((s, i) => (
            <div className="au-finding" key={i}>
              <div className="au-finding-head">
                <span className={`au-chip ${PRI_CLASS[s.priority] ?? "au-sev-low"}`}>{s.priority}</span>
                <b className="au-ftype">{s.action}</b>
              </div>
              <div className="au-ev">{s.rationale}</div>
            </div>
          ))}
        </div>
      )}

      {expanded && <button className="au-expand-foot" onClick={toggleExp}>▴ collapse to glance</button>}
    </>
  );
}
