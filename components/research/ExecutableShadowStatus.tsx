"use client";

import { useExecutableShadowSummary } from "@/hooks/useExecutableShadowSummary";
import { signedUsd } from "@/lib/format";

export function ExecutableShadowStatus({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
  const { summary, state } = useExecutableShadowSummary(slug, enabled);
  if (state === "error") return <p role="alert">Executable shadow comparison is unavailable. No result has been assumed.</p>;
  if (!summary) return null;
  const primary = summary.arms.find((arm) => arm.manager === summary.primaryManager && arm.wrapper === "signal-selected-contract")
    ?? summary.arms.find((arm) => arm.manager === summary.primaryManager) ?? summary.arms[0];
  const control = summary.arms.find((arm) => arm.wrapper === primary?.wrapper && arm.manager !== primary?.manager);
  return <section className="mix-bank executable-shadow-status">
    <header>EXECUTABLE SHADOW · OBSERVING</header>
    <p>{summary.from}–{summary.through} · current configuration · one complete replay per session{summary.incompleteRuns ? ` · ${summary.incompleteRuns} incomplete runs excluded` : ""}</p>
    <p>Arm averages can include different entries; they are not a paired comparison.</p>
    <div className="mix-bank-body two-col">
      <div className="ctl"><span className="cl">coverage</span><span className="ival">{summary.sessions} sessions · {summary.scored} scored arm observations · {summary.censored} censored</span></div>
      <div className="ctl"><span className="cl">next gate</span><span className="ival">{summary.nextGate}</span></div>
      {primary && <div className="ctl"><span className="cl">primary</span><span className="ival">{primary.manager} · {primary.wrapper} · {primary.averagePerContractUsd == null ? "collecting" : `${signedUsd(primary.averagePerContractUsd)}/ct`}</span></div>}
      {control && <div className="ctl"><span className="cl">reference arm</span><span className="ival">{control.manager} · {control.wrapper} · {control.averagePerContractUsd == null ? "collecting" : `${signedUsd(control.averagePerContractUsd)}/ct`}</span></div>}
    </div>
  </section>;
}
