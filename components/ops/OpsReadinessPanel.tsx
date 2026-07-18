import type { OpsReadinessModel, ReadinessItem } from "@/lib/ops/readiness";
import "@/app/ops-readiness.css";

const ptTime = (value?: string): string => value
  ? new Date(value).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " PT"
  : "";

function Item({ item }: { item: ReadinessItem }) {
  return <div className={`opsr-item ${item.tone}`} data-readiness={item.id}>
    <i aria-hidden="true" />
    <span><small>{item.label}</small><b>{item.state}</b><em>{item.detail}</em>{item.observedAt && <time>{ptTime(item.observedAt)}</time>}</span>
  </div>;
}

/** Skin-neutral readiness content. Desktop and mobile receive the same model
 * from the page seam; this component performs no reads or health derivation. */
export function OpsReadinessPanel({ model, compact = false }: { model: OpsReadinessModel; compact?: boolean }) {
  return <section className={`opsr ${compact ? "compact" : ""}`} aria-label="Day 1 capture and observer readiness">
    <header className={`opsr-summary ${model.summary.tone}`}>
      <i aria-hidden="true" /><span><small>{model.summary.label} · SESSION {model.sessionDateEt}</small><b>{model.summary.state}</b><em>{model.summary.detail}</em></span>
    </header>
    <div className="opsr-groups">
      <section><header><b>CONFIGURED AT BOOT</b><em>receipt claims</em></header><div className="opsr-items">{model.configuration.map((item) => <Item key={item.id} item={item} />)}</div></section>
      <section><header><b>SESSION EVIDENCE</b><em>observed receipts</em></header><div className="opsr-items">{model.evidence.map((item) => <Item key={item.id} item={item} />)}</div></section>
    </div>
    <footer><span>CAND {model.counts.candidates}</span><span>FILLS {model.counts.fills}</span><span>CAPTURE {model.counts.capturedPositions}/{model.counts.fills}</span><span>ARMS {model.counts.managerArms}/{model.counts.expectedManagerArms}</span></footer>
  </section>;
}
