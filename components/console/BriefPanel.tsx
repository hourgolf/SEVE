"use client";

import { signedUsd } from "@/lib/format";
import { useFold } from "@/hooks/useFold";
import { useSentinelDigest, splitDigest, type BriefStat } from "@/hooks/useSentinelDigest";
import { SentMd } from "./SentMd";

// §04 BRIEF — the FORWARD half of the nightly sentinel (levels · events · dealer · regime priors).
// The morning-prep glance: what resolved yesterday (by book, as colored bars) + what to watch at the
// next open. Renders VISUALS from the structured meta.brief (not markdown). Regime priors + trap
// windows live behind a `base rates` fold (doctrine: descriptive base rates, never a signal). Log-only.

const cls = (v: number) => (v < 0 ? "neg" : "pos");
const md = (d: string) => (d ? d.slice(5) : "");

// One labelled, sign-colored horizontal bar (length ∝ |value| / max). The 909-native visual for a
// P&L / expectancy row — an instant red-green read instead of a number to parse.
function Bar({ label, value, max, tail }: { label: string; value: number; max: number; tail?: React.ReactNode }) {
  const w = max > 0 ? Math.max(4, Math.round((Math.abs(value) / max) * 100)) : 0;
  const neg = value < 0;
  return (
    <div className="bar-row">
      <span className="bl">{label}</span>
      <span className="bar-track"><span className={`bar-fill ${neg ? "neg" : "pos"}`} style={{ width: `${w}%` }} /></span>
      <span className={`bar-val ${neg ? "neg" : "pos"}`}>{signedUsd(value)}</span>
      {tail}
    </div>
  );
}

function PriorCell({ tag, s }: { tag: string; s: BriefStat | null }) {
  if (!s) return <span className="mut">{tag} —</span>;
  return <span>{tag} <b className={cls(s.perT)}>{signedUsd(s.perT)}</b>/t <span className="mut">{s.win}%·{s.n}t</span></span>;
}

export function BriefPanel() {
  const { brief, digest, date, forDate, state, err } = useSentinelDigest();
  const [folded, toggleFold] = useFold("brief");
  const [baseFolded, toggleBase] = useFold("brief-baserates", true);

  const Frame = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
    <div className={`panel${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">Brief</span>
        <span className="x">{sub ?? "next-open prep · log-only"}</span>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div className="pbody">{children}</div>
    </div>
  );

  if (state === "loading") return <Frame><div className="chart-empty">loading brief…</div></Frame>;
  if (state === "error") return <Frame><div className="chart-empty">couldn&apos;t load — {err}</div></Frame>;
  if (state === "empty") return <Frame><div className="chart-empty">no brief yet — runs after each close (or <code>npm run sentinel</code>)</div></Frame>;

  // legacy event (pre-structured meta): show the forward half of the markdown digest
  if (!brief) {
    const terrain = digest ? splitDigest(digest).terrain : "";
    return <Frame sub="next-open prep · log-only">{terrain ? <SentMd md={terrain} /> : <div className="chart-empty">brief pending next sentinel run</div>}</Frame>;
  }

  const b = brief;
  const bookMax = Math.max(1, ...b.compile.books.map((x) => Math.abs(x.pnl)));
  const trapMax = Math.max(1, ...b.trap.map((t) => Math.abs(t.perTrade ?? 0)));
  const sub = `next open ${md(forDate || b.forDate)} · ${md(date || b.asOf)} close`;

  return (
    <Frame sub={sub}>
      {/* DAY-TYPE — gap magnitude (direction is noise → neutral) + eligibility + RTH close */}
      <div className="brief-daytype">
        <span className={`snt-gex ${b.gap.cleared ? "short" : "long"}`} title={`gap ${b.gap.spy > 0 ? "+" : ""}${b.gap.spy}% vs the ${b.gapMin}% gate`}>
          {b.gap.cleared ? `GAP ✓ ${b.gap.spy > 0 ? "+" : ""}${b.gap.spy}%` : `GAP dark ${b.gap.spy > 0 ? "+" : ""}${b.gap.spy}%`}
        </span>
        {b.rth && <span className="brief-rth">SPY C <b>{b.rth.c}</b> <span className="mut">O {b.rth.o} · H {b.rth.h} · L {b.rth.l}</span></span>}
      </div>

      {/* COMPILE — yesterday by book, as sign-colored bars (the one unique cut of the day's result) */}
      <div className="au-sub" style={{ borderTop: "none", paddingTop: 2 }}>
        Yesterday by book <span className="au-subx">{signedUsd(b.compile.dayPnl)} · {b.compile.nTrades}t</span>
      </div>
      {b.compile.books.map((bk) => (
        <Bar key={bk.book} label={bk.book} value={bk.pnl} max={bookMax} />
      ))}
      {b.compile.flags.length > 0 && (
        <div className="au-flaws" style={{ marginTop: 6 }}>
          {b.compile.flags.map((f, i) => <span key={i} className="au-flaw au-sev-med">{f.replace(/^[⚠ℹ]\s*/, "")}</span>)}
        </div>
      )}

      {/* CARRY FORWARD — next-open readiness */}
      <div className="au-sub">Next open</div>
      {b.carry.band != null && (
        <div className="brief-band">GAP arms if open <b>≤ {b.carry.bandLo}</b> or <b>≥ {b.carry.bandHi}</b> <span className="mut">(±${b.carry.band})</span></div>
      )}
      <div className="brief-lvls">
        <div className="fx-row"><span className="bl">above</span><span className="fx-mid">{b.carry.above.map((l) => `${l.px} ${l.label}`).join("  ·  ") || "—"}</span></div>
        <div className="fx-row"><span className="bl">below</span><span className="fx-mid">{b.carry.below.map((l) => `${l.px} ${l.label}`).join("  ·  ") || "—"}</span></div>
      </div>
      <ul className="brief-watch">{b.carry.watch.map((w, i) => <li key={i}>{w}</li>)}</ul>

      {/* EVENTS */}
      <div className="au-sub">Events</div>
      <ul className="brief-watch">{b.events.map((e, i) => <li key={i}>{e}</li>)}</ul>

      {/* DEALER — IV / GEX per index */}
      <div className="au-sub">Dealer · IV / GEX</div>
      <div className="fx-rows">
        {b.dealer.map((d) => (
          <div className="fx-row" key={d.sym}>
            <span className="fx-name">{d.sym}</span>
            <span className="fx-mid">IV {d.atmIv}%{d.impliedMove != null ? ` · ±${d.impliedMove.toFixed(2)}%` : ""} · walls {d.walls.join(" / ")}</span>
            <span className={`snt-gex ${d.gexShort ? "short" : "long"}`} title={d.gexShort ? "dealers amplify → breakout book" : "dealers pin → fade/scalp"}>{d.gexShort ? "−GEX amplify" : "+GEX pin"}</span>
          </div>
        ))}
      </div>

      {/* BASE RATES — descriptive priors + trap windows, folded (doctrine: never a signal) */}
      <button type="button" className="au-sub au-subfold" onClick={toggleBase} aria-expanded={!baseFolded} style={{ width: "100%" }}>
        Base rates <span className="au-subx">priors · trap windows — descriptive, not a signal</span>
        <span className="fold-ch">{baseFolded ? "▸" : "▾"}</span>
      </button>
      {!baseFolded && (
        <>
          <div className="brief-mini">regime priors (era-4, gap-state)</div>
          <div className="fx-rows">
            {b.priors.map((p) => (
              <div className="fx-row" key={p.book}>
                <span className="fx-name">{p.book}</span>
                <span className="fx-mid"><PriorCell tag="gap" s={p.gap} /> <span className="mut">|</span> <PriorCell tag="flat" s={p.flat} /></span>
              </div>
            ))}
          </div>
          <div className="brief-mini">trap windows (expectancy by entry time)</div>
          {b.trap.map((t) => (
            <Bar key={t.label} label={t.label.split(" · ")[1] ?? t.label} value={t.perTrade ?? 0} max={trapMax}
              tail={<span className="bar-tail">{t.n ? `${t.win}%·${t.n}t` : "—"}{t.warn ? " ⚠" : ""}</span>} />
          ))}
        </>
      )}

      <div className="fx-foot">{b.accrual.join("  ·  ")}</div>
    </Frame>
  );
}
