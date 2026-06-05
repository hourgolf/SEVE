"use client";

import { useMemo, useState } from "react";
import {
  parseFrontmatter,
  capabilityCheck,
  structureSupported,
  resolveUnderlying,
  SUPPORTED_UNDERLYINGS,
  type StrategySpec,
} from "@/lib/desk/strategySpec";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import type { PmColor, StrategistConfig } from "@/lib/desk/types";
import { PM_COLORS, pmVar } from "@/lib/desk/colors";

// Add-Channel sheet: paste/upload a thesis .md → instant frontmatter preview →
// "Compile" (server-side LLM) → StrategySpec + capability check → "Backtest"
// (inline modeled quick-check on real bars, plus the real-fills CLI command) →
// "Arm" (persist as a live channel) or "Save draft" (stored, never trades).

// Conservative starting mixer for a freshly-added channel (tune via the knobs).
const NEW_CHANNEL_CONFIG: StrategistConfig = {
  capital_pct: 10,
  aggression: 40,
  max_contracts: 4,
  daily_stop_usd: 80,
  muted: false,
  soloed: false,
};

interface GateMetrics {
  sessions: number; trades: number; tradesPerDay: number; winRate: number;
  avgWin: number; avgLoss: number; expectancy: number; totalPnl: number;
  maxDrawdown: number; byReason: Record<string, number>;
}
interface GateResult {
  modeled: boolean; partial: boolean; unsupported: string[]; runnable: boolean;
  span: string; metrics: GateMetrics;
  robustness: { month: string; pnl: number; trades: number }[];
  cliCommand: string;
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString();

export function AddChannel({
  onClose,
  existingSlugs = [],
}: {
  onClose: () => void;
  existingSlugs?: string[];
}) {
  const { canWrite, createChannel } = useDeskWrite();
  const [md, setMd] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [spec, setSpec] = useState<StrategySpec | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [repairs, setRepairs] = useState<string[]>([]);

  const [gating, setGating] = useState(false);
  const [gate, setGate] = useState<GateResult | null>(null);
  const [gateErr, setGateErr] = useState<string | null>(null);

  const [accent, setAccent] = useState<PmColor>("cyan");
  const [arming, setArming] = useState(false);
  const [armErr, setArmErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const fm = parseFrontmatter(md);
  const hasFm = Object.keys(fm).length > 0;
  const cap = spec ? capabilityCheck(spec) : null;
  // Which market this channel trades (the .md declares it via `underlying:` / `instrument:`).
  const underlying = resolveUnderlying(fm, spec);
  const underlyingOk = SUPPORTED_UNDERLYINGS.includes(underlying);

  const slug = useMemo(
    () => slugify(spec?.meta.strategyId || fm.strategy_id || fm.name || ""),
    [spec, fm.strategy_id, fm.name]
  );
  const collision = !!slug && existingSlugs.includes(slug);
  const name = spec?.meta.name || fm.name || slug || "untitled";

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setMd(await f.text());
  }

  function resetDownstream() {
    setSpec(null); setGate(null); setGateErr(null); setArmErr(null); setDone(null); setRepairs([]);
  }

  async function compile() {
    setCompiling(true); setErr(null); setNeedsKey(false); resetDownstream();
    try {
      const r = await fetch("/api/compile-strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ md }),
      });
      const j = await r.json();
      if (j.needsKey) setNeedsKey(true);
      else if (j.error) setErr(j.error);
      else { setSpec(j.spec as StrategySpec); setRepairs(Array.isArray(j.repairs) ? j.repairs : []); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "compile failed");
    } finally {
      setCompiling(false);
    }
  }

  async function runBacktest() {
    if (!spec) return;
    setGating(true); setGateErr(null); setGate(null); setArmErr(null);
    try {
      const r = await fetch("/api/backtest-strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      const j = await r.json();
      if (j.error) setGateErr(j.error);
      else setGate(j as GateResult);
    } catch (e) {
      setGateErr(e instanceof Error ? e.message : "backtest failed");
    } finally {
      setGating(false);
    }
  }

  async function persist(status: "armed" | "draft") {
    if (!spec || !slug) return;
    setArming(true); setArmErr(null);
    const res = await createChannel({
      slug,
      underlying,
      name,
      mandate: `Compiled spec — ${spec.meta.regime || spec.meta.direction || spec.meta.structure}`,
      regime: spec.meta.regime || "",
      accent,
      sortOrder: 100 + existingSlugs.length,
      status,
      spec,
      thesisMd: md,
      config: NEW_CHANNEL_CONFIG,
    });
    setArming(false);
    if (res.ok) {
      setDone(`${name} ${status === "armed" ? "armed" : "saved as draft"} — reloading…`);
      setTimeout(() => { onClose(); window.location.reload(); }, 1000);
    } else {
      setArmErr(res.error ?? "save failed");
    }
  }

  const canArm = !!spec && !!cap?.runnable && underlyingOk && !!gate && canWrite && !!slug && !collision && !arming && !done;
  const canDraft = !!spec && canWrite && !!slug && !collision && !arming && !done;
  const m = gate?.metrics;

  // Why ARM is disabled — surfaced at the button so it's never a mystery.
  const armReason: string | null = done
    ? null
    : !canWrite
      ? "Sign in to arm or save a channel."
      : !spec
        ? null
        : collision
          ? null // the slug-collision error already shows above
          : cap && !cap.runnable
            ? `Can't arm — needs ${cap.unsupported.join(" · ")}. Save it as a draft (won't trade), or drop those rules from the thesis.`
            : !underlyingOk
              ? `Can't arm — ${underlying} has no live data feed (supported: ${SUPPORTED_UNDERLYINGS.join(", ")}). Add it to market-ingest first, or save as a draft.`
              : !gate
                ? "Run the backtest gate to enable Arm."
                : null;

  return (
    <div className="ac-scrim" onClick={onClose}>
      <div className="add-channel" onClick={(e) => e.stopPropagation()}>
        <div className="ac-head">
          <span className="ac-title">Add Channel</span>
          <button className="ac-x" onClick={onClose} aria-label="close">✕</button>
        </div>
        <p className="ac-sub">
          Paste or upload a strategy-thesis <code>.md</code>. It compiles to executable rules;
          inputs the desk can&apos;t run yet (multi-leg, GEX, TICK, event calendar) are flagged.
        </p>

        <input className="ac-file" type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={onFile} />
        <textarea
          className="ac-md"
          value={md}
          onChange={(e) => { setMd(e.target.value); }}
          placeholder={"---\nname: \"My Strategy\"\nstructure: single-leg\n...\n---\n\n## Thesis ..."}
          spellCheck={false}
        />

        {hasFm && !spec && (
          <div className="ac-preview">
            <div className="ac-name">{fm.name || fm.strategy_id || "untitled"}</div>
            <div className="ac-tags">
              <span className="ac-tag ac-tag--ticker">{underlying}</span>
              {fm.structure && <span className="ac-tag">{fm.structure}</span>}
              {fm.direction && <span className="ac-tag">{fm.direction}</span>}
              {fm.dte_range && <span className="ac-tag">DTE {fm.dte_range}</span>}
              {fm.regime && <span className="ac-tag">{fm.regime}</span>}
            </div>
            {!underlyingOk && (
              <div className="ac-gap">⚠ {underlying} has no live data feed — supported: {SUPPORTED_UNDERLYINGS.join(", ")}</div>
            )}
            {fm.structure && !structureSupported(fm.structure) && (
              <div className="ac-gap">⚠ {fm.structure} is multi-leg — not executable yet (backtest-only)</div>
            )}
          </div>
        )}

        <div className="ac-actions">
          <button className="ac-compile" disabled={!md.trim() || compiling} onClick={compile}>
            {compiling ? "Compiling…" : spec ? "Re-compile" : "Compile thesis"}
          </button>
        </div>

        {needsKey && (
          <div className="ac-note">
            Set <code>ANTHROPIC_API_KEY</code> in Vercel to compile the full rule-set. The
            frontmatter preview above works without it.
          </div>
        )}
        {err && <div className="ac-err">{err}</div>}

        {spec && cap && (
          <div className="ac-spec">
            <div className="ac-spec-head">
              Compiled · <span className="ac-tag ac-tag--ticker">{underlying}</span> · {spec.entries?.length ?? 0} entry rule(s), {spec.exits?.length ?? 0} exit(s)
              {cap.isSmart && <> · <span className="ac-tag">smart</span></>}
              {slug && <> · <code>{slug}</code></>}
            </div>
            {repairs.length > 0 && (
              <div className="ac-note">✓ auto-corrected on compile: {repairs.join(" · ")}</div>
            )}
            {cap.managementErrors.length > 0 && (
              <div className="ac-err">management invalid: {cap.managementErrors.join(" · ")}</div>
            )}
            <div className={cap.runnable ? "ac-ok" : "ac-warn"}>
              {cap.runnable
                ? "✓ fully runnable on current data"
                : `needs: ${cap.unsupported.join(" · ")} — backtest/draft only`}
            </div>
            {collision && <div className="ac-err">slug “{slug}” already exists — rename the thesis</div>}
            <ul className="ac-rules">
              {(spec.entries ?? []).map((e, i) => (
                <li key={i}>
                  <span className={`ac-dir ac-${e.direction}`}>{e.direction}</span>
                  {e.all.map((c) => c.kind).join(", ")}
                </li>
              ))}
            </ul>

            {/* ---- backtest gate ---- */}
            <div className="ac-gate">
              <button className="ac-btn" disabled={gating} onClick={runBacktest}>
                {gating ? "Backtesting…" : gate ? "Re-run backtest" : "Run backtest gate"}
              </button>
              {gateErr && <div className="ac-err">{gateErr}</div>}
              {m && (
                <div className="ac-stats">
                  <div className="ac-stat-note">
                    modeled chains · {gate?.span}{gate?.partial ? " · subset only (unsupported rules skipped)" : ""}
                  </div>
                  <div className="ac-grid">
                    <span>Expectancy/trade</span><b className={m.expectancy >= 0 ? "pos" : "neg"}>{usd(m.expectancy)}</b>
                    <span>Total P&amp;L</span><b className={m.totalPnl >= 0 ? "pos" : "neg"}>{usd(m.totalPnl)}</b>
                    <span>Win rate</span><b>{m.winRate}%</b>
                    <span>Trades</span><b>{m.trades} ({m.tradesPerDay}/day)</b>
                    <span>Max drawdown</span><b className="neg">{usd(m.maxDrawdown)}</b>
                  </div>
                  {gate && gate.robustness.length > 1 && (
                    <div className="ac-months">
                      {gate.robustness.map((r) => (
                        <span key={r.month} className={`ac-mo ${r.pnl >= 0 ? "pos" : "neg"}`} title={`${r.trades} trades`}>
                          {r.month.slice(2)} {usd(r.pnl)}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.expectancy < 0 && (
                    <div className="ac-warn">⚠ modeled edge is negative — confirm on real fills before arming</div>
                  )}
                  <div className="ac-foot">
                    Real-fills confirmation (run locally, needs backfilled option_bars):<br />
                    <code>{gate?.cliCommand}</code>
                  </div>
                </div>
              )}
            </div>

            {/* ---- accent + persist ---- */}
            <div className="ac-arm">
              <div className="ac-accent">
                <span>accent</span>
                {PM_COLORS.map((t) => (
                  <button
                    key={t}
                    className={`ac-swatch${accent === t ? " on" : ""}`}
                    style={{ background: pmVar(t) }}
                    onClick={() => setAccent(t)}
                    aria-label={`accent ${t}`}
                    title={t}
                  />
                ))}
              </div>
              <div className="ac-arm-btns">
                <button className="ac-btn ac-draft" disabled={!canDraft} onClick={() => persist("draft")}>
                  Save draft
                </button>
                <button className="ac-btn ac-armbtn" disabled={!canArm} onClick={() => persist("armed")}>
                  {arming ? "Saving…" : "Arm channel"}
                </button>
              </div>
              {armReason && (
                <div className={cap && !cap.runnable ? "ac-warn" : "ac-foot"}>{armReason}</div>
              )}
              {armErr && <div className="ac-err">{armErr}</div>}
              {done && <div className="ac-ok">{done}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
