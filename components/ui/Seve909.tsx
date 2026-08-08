import type { CSSProperties, ReactNode } from "react";

export function SeveWorkspaceHeader({
  title,
  subtitle,
  boundary,
}: {
  title: string;
  subtitle?: string;
  boundary: string;
}) {
  return <header className="sv909-workspace-head">
    <span><b>{title}</b>{subtitle && <small>{subtitle}</small>}</span>
    <em>{boundary}</em>
  </header>;
}

export type SeveEvidenceKind = "actual" | "virtual" | "mixed" | "system";
export type SeveEvidenceQuality = "live" | "complete" | "established" | "building" | "partial" | "checking";

const evidenceKindLabel: Record<SeveEvidenceKind, string> = {
  actual: "ACTUAL RESULTS",
  virtual: "VIRTUAL RESEARCH",
  mixed: "ACTUAL + RESEARCH",
  system: "SYSTEM EVIDENCE",
};

export function SeveEvidenceContext({
  kind,
  scope,
  asOf,
  era,
  sample,
  quality,
  detail,
}: {
  kind: SeveEvidenceKind;
  scope: string;
  asOf: string;
  era: string;
  sample: string;
  quality: SeveEvidenceQuality;
  detail?: string;
}) {
  return <aside className={`sv909-evidence-context quality-${quality}`} aria-label="Evidence context" title={detail}>
    <span><small>EVIDENCE</small><b>{evidenceKindLabel[kind]}</b></span>
    <span><small>SCOPE</small><b>{scope}</b></span>
    <span><small>AS OF</small><b>{asOf}</b></span>
    <span><small>CONFIGURATION</small><b>{era}</b></span>
    <span><small>SAMPLE</small><b>{sample}</b></span>
    <em>{quality.toUpperCase()}</em>
  </aside>;
}

export function SeveEmptyState({
  title,
  summary,
  facts = [],
  action,
}: {
  title: string;
  summary: string;
  facts?: string[];
  action?: ReactNode;
}) {
  return <section className="sv909-empty" role="status">
    <span><small>CURRENT STATE</small><b>{title}</b><p>{summary}</p></span>
    {facts.length > 0 && <ul>{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>}
    {action && <div>{action}</div>}
  </section>;
}

export type SeveMetricTone = "neutral" | "success" | "attention" | "danger" | "info";

export interface SeveMetric {
  label: string;
  value: ReactNode;
  tone?: SeveMetricTone;
}

export function SeveMetricStrip({ metrics }: { metrics: SeveMetric[] }) {
  return <div
    className="sv909-metrics"
    style={{ "--909-columns": metrics.length } as CSSProperties}
    aria-label="Session summary"
  >
    {metrics.map((metric) => <span key={metric.label} className={metric.tone ?? "neutral"}>
      <small>{metric.label}</small>
      <b>{metric.value}</b>
    </span>)}
  </div>;
}
