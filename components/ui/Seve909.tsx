import type { CSSProperties, ReactNode } from "react";

export function SeveWorkspaceHeader({
  title,
  subtitle,
  boundary,
}: {
  title: string;
  subtitle: string;
  boundary: string;
}) {
  return <header className="sv909-workspace-head">
    <span><b>{title}</b><small>{subtitle}</small></span>
    <em>{boundary}</em>
  </header>;
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
