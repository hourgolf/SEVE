"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChannelControlPlaneViewRead } from "@/hooks/useChannelControlPlaneView";
import {
  useChannelRosterBundleControl,
  type RosterBundleView,
} from "@/hooks/useChannelRosterBundleControl";

const short = (value: string | null | undefined) => value
  ? value.slice(0, 12)
  : "—";

const fieldValue = (value: string) => value
  .replace(/^"|"$/g, "")
  .replaceAll("{", "")
  .replaceAll("}", "");

export function ChannelRosterActivationConsole({
  selectedSlug,
  controlPlane,
}: {
  selectedSlug: string;
  controlPlane?: ChannelControlPlaneViewRead;
}) {
  const roster = useChannelRosterBundleControl(controlPlane);
  const active = controlPlane?.view?.bySlug[selectedSlug] ?? null;
  const registration = roster.registrations.find((item) =>
    item.channel_slug === selectedSlug) ?? null;
  const existing = roster.changes.find((item) => item.slug === selectedSlug);
  const [posture, setPosture] = useState<"paper" | "observe-only">("observe-only");
  const [quantity, setQuantity] = useState(1);
  const [membership, setMembership] = useState<"include" | "exclude">("include");
  const [confirmation, setConfirmation] = useState("");
  const [rollbackPreview, setRollbackPreview] = useState<{
    bundle: RosterBundleView;
    session: NonNullable<typeof roster.previewSession>;
  } | null>(null);

  useEffect(() => {
    setPosture(active?.executionPosture
      ?? registration?.candidate_spec?.executionPosture
      ?? "observe-only");
    setQuantity(active?.quantity
      ?? registration?.candidate_spec?.quantity
      ?? 1);
    setMembership(active ? "include" : "include");
  }, [active, registration, selectedSlug]);

  const canStage = Boolean(active || registration?.state === "paper-eligible");
  const blockedRegistryCount = roster.registrations.filter((item) =>
    item.state === "registered-blocked").length;
  const pending = useMemo(() => roster.bundles.filter((bundle) =>
    ["draft", "validated", "approved"].includes(bundle.state)).slice(0, 5),
  [roster.bundles]);
  const activated = roster.bundles.find((bundle) =>
    ["activated", "rolled-back"].includes(bundle.state)
    && bundle.activationReceipt?.configuration_epoch_id
      === controlPlane?.view?.configurationEpochId) ?? null;

  const stage = () => {
    if (membership === "exclude") {
      roster.setTarget({ slug: selectedSlug, membership: "exclude" });
      return;
    }
    roster.setTarget({
      slug: selectedSlug,
      membership: "include",
      executionPosture: posture,
      quantity,
    });
  };

  const freshAck = (bundle: RosterBundleView) => {
    const at = bundle.latestWorkerAcknowledgement?.acknowledged_at;
    return at ? Date.now() - Date.parse(at) <= 5 * 60_000 : false;
  };

  return <section className="mix-bank roster-activation-console" aria-label="Atomic channel roster activation console">
    <header>ATOMIC ROSTER · PROSPECTIVE PAPER ENTRY</header>
    <div className="roster-console-body">
      {roster.mutationWindow && <p className={`roster-note ${
        roster.mutationWindow.allowed ? "ok" : ""
      }`}><b>{roster.mutationWindow.allowed
        ? "AFTER-CLOSE WRITE WINDOW"
        : "SESSION READ-ONLY"}</b> · {roster.mutationWindow.message}</p>}
      <div className="roster-selected">
        <span><small>SELECTED</small><b>{selectedSlug}</b></span>
        <label>MEMBERSHIP
          <select value={membership} onChange={(event) => setMembership(event.target.value as "include" | "exclude")} disabled={!active && membership === "exclude"}>
            <option value="include">INCLUDE</option>
            {active && <option value="exclude">EXCLUDE · KEEP SHADOW</option>}
          </select>
        </label>
        <label>ENTRY POSTURE
          <select value={posture} onChange={(event) => setPosture(event.target.value as "paper" | "observe-only")} disabled={membership === "exclude"}>
            <option value="observe-only">OBSERVE ONLY</option>
            <option value="paper">PAPER</option>
          </select>
        </label>
        <label>CONTRACTS
          <input type="number" min={1} max={12} step={1} value={quantity} disabled={membership === "exclude"} onChange={(event) => setQuantity(Number(event.target.value))} />
        </label>
        <button type="button" disabled={!canStage || roster.busy} onClick={stage}>{existing ? "UPDATE STAGED" : "ADD TO BUNDLE"}</button>
      </div>

      {!canStage && <p className="roster-blocked">This channel is not in the active receipt-bound manifest and has no paper-eligible registry cartridge. It remains authority-dark and keeps collecting shadow evidence.</p>}
      {registration?.state === "registered-blocked" && <details className="roster-registry-blockers">
        <summary>WHY THIS RESEARCH CHANNEL CANNOT BE PROMOTED YET · {registration.blockers.length} BLOCKER{registration.blockers.length === 1 ? "" : "S"}</summary>
        <ul>{registration.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        <footer>registration is descriptive only · shadow collection continues · zero order authority</footer>
      </details>}

      <div className="roster-registry-fact">
        <span><small>ACTIVE</small><b>{controlPlane?.view?.specs.length ?? 0}</b></span>
        <span><small>PAPER-ELIGIBLE RESEARCH</small><b>{roster.paperEligibleRegistrations.length}</b></span>
        <span><small>REGISTERED / BLOCKED</small><b>{blockedRegistryCount}</b></span>
        <span><small>CONFIG EPOCH</small><code>{short(controlPlane?.view?.configurationEpochId)}</code></span>
      </div>

      {!!roster.changes.length && <div className="roster-staged">
        <header><b>STAGED AS ONE BUNDLE</b><small>{roster.changes.length} channel{roster.changes.length === 1 ? "" : "s"}</small></header>
        {roster.changes.map((change) => <span key={change.slug}>
          <b>{change.slug}</b>
          <small>{change.membership === "exclude" ? "EXCLUDE · SHADOW PRESERVED" : `${change.executionPosture?.toUpperCase()} · ${change.quantity} ct`}</small>
          <button type="button" onClick={() => roster.removeTarget(change.slug)}>REMOVE</button>
        </span>)}
        <label>OPERATOR REASON
          <textarea maxLength={2_000} value={roster.reason} onChange={(event) => roster.setReason(event.target.value)} placeholder="Why this bounded paper roster experiment should exist (8+ characters)" />
        </label>
        <button type="button" disabled={roster.busy || roster.reason.trim().length < 8 || controlPlane?.view?.state !== "receipt-bound"} onClick={() => void roster.preview()}>{roster.busy ? "CHECKING…" : "PREVIEW FLAT BOOK + CAPACITY"}</button>
      </div>}

      {roster.previewSession && <div className={`roster-preview ${roster.previewSession.preview.state}`}>
        <header><b>{roster.previewSession.preview.state === "ready-for-worker-ack" ? "PREVIEW PASSED" : "PREVIEW BLOCKED"}</b><code>{short(roster.previewSession.preview.configurationEpochId)}</code></header>
        {roster.previewSession.preview.diffs.map((diff) => <div key={diff.slug} className="roster-diff"><b>{diff.slug}</b>{diff.fields.map((field) => <span key={field.field}><small>{field.field}</small><i>{fieldValue(field.before)} → {fieldValue(field.after)}</i></span>)}</div>)}
        {!!roster.previewSession.preview.capacity?.metrics.length && <details><summary>PORTFOLIO CAPACITY RECEIPT</summary>{roster.previewSession.preview.capacity.metrics.map((metric) => <span key={metric.id} className={metric.state}><code>{metric.id}</code><b>{metric.projected} / {metric.limit}</b></span>)}</details>}
        {!!roster.previewSession.preview.blockers.length && <ul>{roster.previewSession.preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
        {roster.previewSession.preview.state === "ready-for-worker-ack" && <button type="button" disabled={roster.busy || roster.mutationWindow?.allowed !== true} onClick={() => void roster.sealDraft()}>SEAL IMMUTABLE DRAFT</button>}
        <footer>preview only · no runtime mutation · no order authority · history untouched</footer>
      </div>}

      {!!pending.length && <div className="roster-pending">
        <header><b>PENDING RECEIPTS</b><small>one immutable worker acknowledgement · apply within five minutes</small></header>
        {pending.map((bundle) => {
          const successor = pending.find((candidate) =>
            candidate.id !== bundle.id
            && candidate.base_manifest_key === bundle.base_manifest_key
            && candidate.base_manifest_content_hash
              === bundle.base_manifest_content_hash
            && Date.parse(candidate.created_at) > Date.parse(bundle.created_at));
          return <div key={bundle.id}>
          <span><b>{bundle.state.toUpperCase()}</b><code>{short(bundle.configuration_epoch_id)}</code><small>{bundle.changes.length} change{bundle.changes.length === 1 ? "" : "s"}</small></span>
          {bundle.state === "validated" && freshAck(bundle) ? <>
            <input aria-label={`Confirmation for ${bundle.id}`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="TYPE APPLY NEXT SAFE ENTRY" />
            <button type="button" disabled={roster.busy || roster.mutationWindow?.allowed !== true || confirmation !== "APPLY NEXT SAFE ENTRY"} onClick={() => void roster.apply(bundle, confirmation)}>ATOMIC APPLY</button>
          </> : bundle.state === "validated" ? <em>worker acknowledgement expired · cancel and reseal</em> : null}
          <button type="button" disabled={roster.busy || roster.mutationWindow?.allowed !== true} onClick={() => void roster.cancel(bundle)}>CANCEL</button>
          {successor && <button type="button" disabled={roster.busy || roster.mutationWindow?.allowed !== true} onClick={() => void roster.supersede(bundle, successor)}>SUPERSEDE → {short(successor.id)}</button>}
        </div>})}
      </div>}

      {activated?.activationReceipt && <div className="roster-rollback">
        <span><small>{activated.state === "rolled-back" ? "ACTIVE ROLLBACK EPOCH" : "ACTIVE BUNDLE"}</small><b>{short(activated.id)}</b><code>{short(activated.configuration_epoch_id)}</code></span>
        {!rollbackPreview ? <button type="button" disabled={roster.busy} onClick={async () => {
          const session = await roster.rollback(activated, "preview");
          if (session) setRollbackPreview({ bundle: activated, session });
        }}>PREVIEW EXACT ROLLBACK</button> : <button type="button" disabled={roster.busy || roster.mutationWindow?.allowed !== true} onClick={async () => {
          await roster.rollback(rollbackPreview.bundle, "draft", rollbackPreview.session);
          setRollbackPreview(null);
        }}>SEAL ROLLBACK DRAFT</button>}
      </div>}

      {roster.loading && <p className="roster-note">Refreshing registry and immutable bundle receipts…</p>}
      {roster.notice && <p className="roster-note ok">{roster.notice}</p>}
      {roster.error && <p className="roster-note error">{roster.error}</p>}
    </div>
  </section>;
}
