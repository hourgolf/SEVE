import type { ChannelControlPlaneViewRead } from "@/hooks/useChannelControlPlaneView";
import type { RosterBundleView } from "@/hooks/useChannelRosterBundleControl";
import { money } from "@/lib/format";

const short = (value: string | null | undefined, size = 12) => value
  ? `${value.replace(/^sha256:/, "").slice(0, size)}…`
  : "—";

function takeProfit(spec: NonNullable<ChannelControlPlaneViewRead["view"]>["specs"][number]) {
  return spec.takeProfit.kind === "ride"
    ? "RIDE"
    : spec.takeProfit.targetPct == null
      ? "—"
      : `+${spec.takeProfit.targetPct}%`;
}

export function CanaryCommandCenter({
  controlPlane,
  bundles,
  compact = false,
}: {
  controlPlane?: ChannelControlPlaneViewRead;
  bundles: RosterBundleView[];
  compact?: boolean;
}) {
  const view = controlPlane?.view;
  const active = bundles.find((bundle) =>
    ["activated", "rolled-back"].includes(bundle.state)
    && bundle.activationReceipt?.configuration_epoch_id
      === view?.configurationEpochId) ?? null;
  const promoted = active?.changes
    .filter((change) => change.membership === "include"
      && change.executionPosture === "paper")
    .map((change) => ({ change, spec: view?.bySlug[change.slug] ?? null }))
    .filter((item) => item.spec) ?? [];
  const excluded = active?.changes.filter((change) =>
    change.membership === "exclude") ?? [];
  const receiptBound = view?.state === "receipt-bound"
    && Boolean(active?.activationReceipt)
    && promoted.length > 0;

  if (!active?.activationReceipt || !promoted.length) return null;

  const header = <>
    <span><small>NEXT SESSION · PAPER CANARY</small><b>{compact
      ? `CANARY · ${promoted.map(({ change }) => change.slug).join(" · ")} · ${promoted[0]?.spec?.accountLabel ?? "PAPER"} · ${promoted[0]?.spec?.quantity ?? "—"} CT`
      : "CANARY COMMAND CENTER"}</b></span>
    <em className={receiptBound ? "ready" : "blocked"}>{receiptBound ? "SEALED · PREOPEN GATE NEXT" : "AUTHORITY BLOCKED"}</em>
    {compact && <i className="canary-disclosure" aria-hidden="true">▸</i>}
  </>;
  const body = <div className="canary-command-body">
    {promoted.map(({ change, spec }) => spec && <article key={change.slug}>
      <div className="canary-command-title">
        <span><small>PROSPECTIVE PAPER ROOT</small><b>{change.slug}</b></span>
        <strong>{spec.accountLabel} · {spec.quantity} CT</strong>
      </div>
      <div className="canary-command-policy">
        <span><small>EXECUTION</small><b>PAPER · NEXT SAFE ENTRY</b></span>
        <span><small>TP / SL</small><b>{takeProfit(spec)} / −{spec.stopLoss.catastrophePct}%</b></span>
        <span><small>DEBIT / RISK</small><b>{money(spec.maxDebitUsd)} / {money(spec.maxRiskUsd)}</b></span>
        <span><small>COLLISION</small><b>{spec.capacity.domainId}</b></span>
      </div>
    </article>)}
    {!!excluded.length && <div className="canary-command-exclusions">
      <small>EXECUTION EXCLUDED · COLLECTION INDEPENDENT</small>
      <b>{excluded.map((change) => change.slug).join(" · ")}</b>
      {!compact && <span>Shadow history is preserved; this receipt grants no fill authority to the excluded root.</span>}
    </div>}
    <ol className="canary-command-sequence" aria-label="Canary operating sequence">
      <li className="done"><b>1</b><span><small>RECEIPT</small><strong>SEALED</strong></span></li>
      <li className="next"><b>2</b><span><small>PREOPEN</small><strong>FRESH GATE</strong></span></li>
      <li><b>3</b><span><small>SESSION</small><strong>OBSERVE CANARY</strong></span></li>
      <li><b>4</b><span><small>AFTER CLOSE</small><strong>REVIEW EVIDENCE</strong></span></li>
    </ol>
    {!compact && <footer>
      <span><small>ACTIVATION RECEIPT</small><code>{short(active.activationReceipt.id)}</code></span>
      <span><small>CONFIG EPOCH</small><code>{short(active.configuration_epoch_id)}</code></span>
      <span><small>ROLLBACK TARGET</small><code>{short(active.activationReceipt.rollback_target_manifest_key)}</code></span>
      <strong>Authority card, not liveness · no order placed · Monday still requires fresh broker, order, desk, worker, and receipt evidence.</strong>
    </footer>}
  </div>;

  if (compact) return <details className="canary-command-center compact" aria-label="Canary command center">
    <summary>{header}</summary>
    {body}
  </details>;

  return <section className="canary-command-center" aria-label="Canary command center">
    <header>{header}</header>
    {body}
  </section>;
}
