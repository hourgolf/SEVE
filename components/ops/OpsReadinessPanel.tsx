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
    {model.chains.length > 0 && <section className="opsr-drill" aria-label="Position evidence chains">
      <header><b>POSITION EVIDENCE CHAINS</b><em>candidate → fill → capture → arms → close</em></header>
      {model.chains.map((chain) => <details key={chain.positionId} className={chain.tone}>
        <summary><i aria-hidden="true" /><span><b>{chain.channelSlug}</b><small>{chain.occSymbol}</small></span><em>{chain.opportunityId}</em></summary>
        <div>{chain.steps.map((step) => <Item key={step.id} item={step} />)}</div>
      </details>)}
    </section>}
    {model.brokerReceipt && <details className={`opsr-broker ${model.brokerReceipt.state}`}>
      <summary><b>BROKER BOOK DETAIL</b><em>{model.brokerReceipt.accounts.length} accounts · {model.brokerReceipt.mismatches.length} mismatches</em></summary>
      <div className="opsr-broker-accounts">{model.brokerReceipt.accounts.map((account) => <span key={account.accountId} className={account.reachable ? account.mismatchCount ? "drift" : "ok" : "partial"}>
        <b>{account.accountName}</b><em>{account.reachable ? `broker ${account.brokerContracts} / desk ${account.deskContracts}` : account.error || "unreachable"}</em>
      </span>)}</div>
      {model.brokerReceipt.mismatches.length > 0 && <div className="opsr-mismatches">{model.brokerReceipt.mismatches.slice(0, 12).map((row) => <span key={`${row.accountId}:${row.symbol}`}><b>{row.accountName} · {row.symbol}</b><em>broker {row.brokerQty} / desk {row.deskQty} · Δ {row.delta > 0 ? "+" : ""}{row.delta}</em></span>)}</div>}
    </details>}
    <footer><span>CAND {model.counts.candidates}</span><span>FILLS {model.counts.fills}</span><span>CAPTURE {model.counts.capturedPositions}/{model.counts.fills}</span><span>ARMS {model.counts.managerArms}/{model.counts.expectedManagerArms}</span></footer>
  </section>;
}
