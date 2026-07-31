import "@/app/channel-decision.css";
import {
  CHANNEL_DECISION_AS_OF,
  buildChannelDecisionCardModel,
  type DecisionEvidenceLayer,
} from "@/lib/channels/channelDecisionEvidence";
import type { EffectiveChannelState } from "@/lib/channels/effectiveChannelState";
import type { ChannelControlPlaneViewRead } from "@/hooks/useChannelControlPlaneView";
import { signedUsd, usd0 } from "@/lib/format";

const short = (value: string | null): string => value ? `${value.replace(/^sha256:/, "").slice(0, 10)}…` : "—";
const comparisonLabel: Record<DecisionEvidenceLayer["comparability"], string> = {
  "exact-current": "EXACT CURRENT",
  "exact-comparable": "EXACT COMPARABLE",
  approximate: "APPROXIMATE",
  "mixed-config": "MIXED CONFIG",
};

function EvidenceLayer({ layer }: { layer: DecisionEvidenceLayer }) {
  const expectancy = layer.expectancyUsd == null
    ? "—"
    : `${signedUsd(layer.expectancyUsd)} / ${layer.expectancyUnit === "contract" ? "ct" : "trade"}`;
  return (
    <span className={`decision-evidence-layer ${layer.comparability}`}>
      <small>{layer.label}</small>
      <b>{expectancy}</b>
      <em>{layer.observations} {layer.kind === "prospective-shadow" || layer.kind === "exact-t1-replay" ? "paths" : "trades"} · {layer.sessions} sessions</em>
      {layer.totalUsd != null && <i>{signedUsd(layer.totalUsd)} total</i>}
      {layer.interval95 && <i>95% [{signedUsd(layer.interval95.lower)}, {signedUsd(layer.interval95.upper)}]</i>}
      <mark>{comparisonLabel[layer.comparability]}</mark>
      <p>{layer.fact}</p>
    </span>
  );
}

export function ChannelDecisionCard({ effective, controlPlane, compact = false }: {
  effective: EffectiveChannelState;
  controlPlane?: ChannelControlPlaneViewRead;
  compact?: boolean;
}) {
  const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const model = buildChannelDecisionCardModel(effective, todayEt);
  const economics = effective.economics;
  const activeSpec = controlPlane?.view?.bySlug[effective.slug] ?? null;
  const activationState = controlPlane?.loading
    ? "CHECKING CONTROL PLANE"
    : controlPlane?.error || controlPlane?.view?.state === "blocked"
      ? "CONTROL PLANE BLOCKED"
      : activeSpec
        ? "EXISTING ROOT · DRAFT READY"
        : "PROMOTION PREREGISTRATION REQUIRED";
  return (
    <details className={`channel-decision-card ${model.tone}${compact ? " compact" : ""}`} open={!compact}>
      <summary>
        <span><small>READ-ONLY DECISION · {CHANNEL_DECISION_AS_OF}</small><b>{model.label}</b></span>
        <em>{model.confidence === "reviewable-experiment" ? "EXPERIMENT REVIEW" : "NO DECISION FLOOR"}</em>
        <i aria-hidden="true">▾</i>
      </summary>
      <div className="channel-decision-body">
        <p className="channel-decision-summary">{model.summary}</p>
        <div className="channel-decision-axes" aria-label="Effective channel state">
          <span><small>EXECUTION</small><b>{effective.execution.label}</b><i>{effective.execution.fact}</i></span>
          <span><small>ROUTE</small><b>{effective.route.accountName ?? "NO ORDER ROUTE"}</b><i>{effective.route.differsFromDatabase ? "immutable route differs from DB" : effective.route.fact}</i></span>
          <span><small>ECONOMICS</small><b>{economics.quantity == null ? "NOT EXECUTABLE" : `${economics.quantity} ct · ${economics.riskBudgetUsd == null ? "receipt summary" : usd0(economics.riskBudgetUsd)}`}</b><i>{economics.managerProfileId ?? economics.fact}</i></span>
        </div>
        <div className="channel-decision-evidence" aria-label="Decision evidence layers">
          {model.layers.map((layer) => <EvidenceLayer key={`${layer.kind}:${layer.label}`} layer={layer} />)}
          {!model.layers.length && <span className="decision-evidence-empty">No comparable versioned evidence layer is present in this packet.</span>}
        </div>
        <section className={`channel-activation-readiness ${activeSpec ? "ready" : "blocked"}`} aria-label="Activation and capacity readiness">
          <header><small>ACTIVATION LAYER · READ ONLY</small><b>{activationState}</b></header>
          {activeSpec ? <div>
            <span><small>ROUTE / SIZE</small><b>{activeSpec.accountLabel} · {activeSpec.quantity} ct</b><i>{usd0(activeSpec.maxRiskUsd)} risk · {usd0(activeSpec.maxDebitUsd)} debit cap</i></span>
            <span><small>COLLISION DOMAIN</small><b>{activeSpec.capacity.domainId}</b><i>{activeSpec.capacity.familyId} · priority {activeSpec.capacity.priority}</i></span>
            <span><small>CAPACITY</small><b>{activeSpec.capacity.underlying} {activeSpec.capacity.maxOpenUnderlying} open · clock {activeSpec.capacity.sameClockMax}</b><i>family {activeSpec.capacity.maxOpenPerFamily} · domain {activeSpec.capacity.maxOpenGlobal} · OCC {activeSpec.capacity.sameOccOpenMax}</i></span>
            <span><small>ENTRY FREQUENCY</small><b>{activeSpec.maxEntriesPerSession} / session</b><i>{activeSpec.capacity.crossDomainSameOcc === "block" ? "cross-domain same OCC blocked" : "cross-domain same OCC requires receipt"}</i></span>
          </div> : <p>{controlPlane?.error ?? (effective.execution.posture === "observe-only"
            ? "This observe-only channel has no preregistered active specification. It cannot be promoted by flipping its mutable database status."
            : "Exact receipt-bound specification and collision policy are unavailable; configuration must fail closed.")}</p>}
          <footer>
            <span>Manager-only drafts can prove capacity preservation statically.</span>
            <span>Sizing, re-entry, route, or roster changes require fresh positions, orders, desk inventory, and admission simulation.</span>
            <strong>APPLY BLOCKED UNTIL PREVIEW + WORKER ACK + EXPLICIT APPROVAL + RECEIPT</strong>
          </footer>
        </section>
        {!!model.secondary.length && <ul>{model.secondary.map((item) => <li key={item}>{item}</li>)}</ul>}
        <footer>
          <span>CONFIG EPOCH <code>{short(economics.configurationEpochId)}</code></span>
          <span>REVIEW RECEIPTS <code>{model.receiptRefs.length ? `${short(model.receiptRefs[0])}${model.receiptRefs.length > 1 ? ` +${model.receiptRefs.length - 1}` : ""}` : "none"}</code></span>
          <strong>{model.stale ? "HISTORICAL REVIEW · REFRESH BEFORE ACTION" : "REVIEW CURRENT THROUGH CLOSE"}</strong>
          <b>NO APPLY AUTHORITY</b>
        </footer>
      </div>
    </details>
  );
}
