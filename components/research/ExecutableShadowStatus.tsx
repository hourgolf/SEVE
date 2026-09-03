"use client";

import { useExecutableShadowSummary } from "@/hooks/useExecutableShadowSummary";
import { signedUsd } from "@/lib/format";

export function ExecutableShadowStatus({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
  const { summary } = useExecutableShadowSummary(slug, enabled);
  if (!summary) return null;
  const primary = summary.arms.find((arm) => arm.manager === summary.primaryManager) ?? summary.arms[0];
  const control = summary.arms.find((arm) => arm.wrapper === primary?.wrapper && arm.manager !== primary?.manager);
  return <section className="mix-bank executable-shadow-status">
    <header>EXECUTABLE SHADOW · OBSERVING</header>
    <div className="mix-bank-body two-col">
      <div className="ctl"><span className="cl">coverage</span><span className="ival">{summary.sessions}s · {summary.scored} scored · {summary.censored} censored</span></div>
      <div className="ctl"><span className="cl">next gate</span><span className="ival">{summary.nextGate}</span></div>
      {primary && <div className="ctl"><span className="cl">primary</span><span className="ival">{primary.manager} · {primary.averagePerContractUsd == null ? "collecting" : `${signedUsd(primary.averagePerContractUsd)}/ct`}</span></div>}
      {control && <div className="ctl"><span className="cl">matched control</span><span className="ival">{control.manager} · {control.averagePerContractUsd == null ? "collecting" : `${signedUsd(control.averagePerContractUsd)}/ct`}</span></div>}
    </div>
  </section>;
}
