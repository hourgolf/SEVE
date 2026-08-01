"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { startVisibilityPoll } from "@/lib/pollControl";
import type { ChannelRosterTarget } from "@/lib/channels/channelRosterBundle";
import type { ChannelControlPlaneViewRead } from "@/hooks/useChannelControlPlaneView";

export interface RosterRegistrationView {
  id: string;
  channel_slug: string;
  state: "paper-eligible" | "registered-blocked";
  blockers: string[];
  candidate_spec: {
    quantity?: number;
    executionPosture?: "paper" | "observe-only";
    accountRole?: string;
    collisionDomain?: string;
    takeProfit?: { kind: "ride" | "bank"; targetPct: number | null; fraction: 0 | 0.5 };
    stopLoss?: { catastrophePct: number };
  } | null;
}

export interface PromotionCandidateView {
  version: "channel-promotion-candidate-v1";
  rank: 1 | 2 | 3;
  slug: string;
  displayName: string;
  underlying: "SPY" | "QQQ";
  sourceContentHash: string;
  accountLabel: "PAPER 2";
  collisionDomain: "rc54-lab";
  quantity: 1;
  executionPosture: "observe-only";
  takeProfitPct: number;
  stopLossPct: 30;
  displacedRoot: string;
  evidence: {
    observedThrough: string;
    source: string;
    sample: number;
    peakPct: number;
    winRatePct: number;
    netPerContractUsd: number;
    givebackPct: number;
    limitations: string[];
  };
  qualificationAuthority: false;
  activationAuthority: false;
  orderAuthority: false;
}

export interface RosterBundleView {
  id: string;
  base_manifest_key: string;
  base_manifest_content_hash: string;
  state: "draft" | "validated" | "approved" | "activated" | "canceled" | "superseded" | "rolled-back";
  reason: string;
  changes: ChannelRosterTarget[];
  configuration_epoch_id: string;
  created_at: string;
  lifecycle_receipt_id: string;
  latestWorkerAcknowledgement: {
    id: string;
    acknowledged_at: string;
  } | null;
  activationReceipt: {
    id: string;
    activated_at: string;
    rollback_target_manifest_key: string;
    configuration_epoch_id: string;
  } | null;
}

interface PreviewView {
  id: string;
  state: "ready-for-worker-ack" | "blocked";
  configurationEpochId: string | null;
  diffs: Array<{
    slug: string;
    fields: Array<{ field: string; before: string; after: string }>;
  }>;
  capacity: {
    state: "pass" | "block";
    blockers: string[];
    metrics: Array<{
      id: string;
      current: number;
      projected: number;
      limit: number;
      state: "pass" | "block";
    }>;
  } | null;
  blockers: string[];
  historicalEvidenceMutation: false;
  orderAuthority: false;
}

interface PreviewSession {
  bundleId: string;
  createdAt: string;
  preview: PreviewView;
}

export interface RosterMutationWindowView {
  allowed: boolean;
  session: "weekend" | "holiday" | "premarket" | "open" | "afterhours";
  calendarCoverageKnown: boolean;
  code: string;
  message: string;
}

const readError = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export function useChannelRosterBundleControl(
  controlPlane: ChannelControlPlaneViewRead | undefined,
) {
  const { session, operator } = useAuth();
  const [registrations, setRegistrations] = useState<RosterRegistrationView[]>([]);
  const [candidates, setCandidates] = useState<PromotionCandidateView[]>([]);
  const [bundles, setBundles] = useState<RosterBundleView[]>([]);
  const [mutationWindow, setMutationWindow] =
    useState<RosterMutationWindowView | null>(null);
  const [changes, setChanges] = useState<ChannelRosterTarget[]>([]);
  const [reason, setReason] = useState("");
  const [previewSession, setPreviewSession] = useState<PreviewSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const headers = useCallback(() => {
    if (!session || !operator) throw new Error("operator sign-in is required");
    return {
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
    };
  }, [operator, session]);

  const refresh = useCallback(async () => {
    if (!session || !operator) {
      setRegistrations([]);
      setCandidates([]);
      setBundles([]);
      setMutationWindow(null);
      return;
    }
    setLoading(true);
    try {
      const auth = { authorization: `Bearer ${session.access_token}` };
      const [bundleResponse, registryResponse, candidateResponse] = await Promise.all([
        fetch("/api/channel-roster-bundles", { headers: auth, cache: "no-store" }),
        fetch("/api/research-channel-registry", { headers: auth, cache: "no-store" }),
        fetch("/api/channel-promotion-candidates", { headers: auth, cache: "no-store" }),
      ]);
      const bundleBody = await bundleResponse.json().catch(() => ({})) as {
        ok?: boolean; error?: string; bundles?: RosterBundleView[];
        mutationWindow?: RosterMutationWindowView;
      };
      const registryBody = await registryResponse.json().catch(() => ({})) as {
        ok?: boolean; error?: string; registrations?: RosterRegistrationView[];
      };
      const candidateBody = await candidateResponse.json().catch(() => ({})) as {
        ok?: boolean; error?: string; candidates?: PromotionCandidateView[];
      };
      if (!bundleResponse.ok || !bundleBody.ok) {
        throw new Error(bundleBody.error ?? "roster bundle read failed");
      }
      if (!registryResponse.ok || !registryBody.ok) {
        throw new Error(registryBody.error ?? "research registry read failed");
      }
      if (!candidateResponse.ok || !candidateBody.ok) {
        throw new Error(candidateBody.error ?? "promotion candidate read failed");
      }
      setBundles(bundleBody.bundles ?? []);
      setMutationWindow(bundleBody.mutationWindow ?? null);
      setRegistrations(registryBody.registrations ?? []);
      setCandidates(candidateBody.candidates ?? []);
      setError(null);
    } catch (readFailure) {
      setError(readError(readFailure, "operator activation state read failed"));
    } finally {
      setLoading(false);
    }
  }, [operator, session]);

  useEffect(() => {
    void refresh();
    return startVisibilityPoll(refresh, 15_000);
  }, [refresh]);

  const invalidatePreview = useCallback(() => {
    setPreviewSession(null);
    setNotice(null);
  }, []);

  const setTarget = useCallback((target: ChannelRosterTarget) => {
    setChanges((current) => [
      ...current.filter((change) => change.slug !== target.slug),
      target,
    ].sort((left, right) => left.slug.localeCompare(right.slug)));
    invalidatePreview();
  }, [invalidatePreview]);

  const removeTarget = useCallback((slug: string) => {
    setChanges((current) => current.filter((change) => change.slug !== slug));
    invalidatePreview();
  }, [invalidatePreview]);

  const request = useCallback(async (
    path: string,
    payload: Record<string, unknown>,
    idempotent = false,
  ) => {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        ...headers(),
        ...(idempotent ? { "idempotency-key": crypto.randomUUID() } : {}),
      },
      body: JSON.stringify(payload),
    });
    const value = await response.json().catch(() => ({})) as {
      ok?: boolean; error?: string; preview?: unknown;
    };
    if (!response.ok || !value.ok) {
      const failure = new Error(value.error ?? `activation request failed (${response.status})`);
      Object.assign(failure, { preview: value.preview });
      throw failure;
    }
    return value;
  }, [headers]);

  const preview = useCallback(async () => {
    const view = controlPlane?.view;
    if (!view?.manifestId || !view.manifestContentHash) {
      setError("receipt-bound active manifest is unavailable");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const bundleId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    try {
      const value = await request("/api/channel-roster-bundles/preview", {
        action: "preview",
        baseManifestContentHash: view.manifestContentHash,
        baseManifestId: view.manifestId,
        bundleId,
        changes,
        createdAt,
        evidenceRefs: [`configuration-epoch:${view.configurationEpochId}`],
        reason,
      });
      const exact = value.preview as PreviewView | undefined;
      if (!exact) throw new Error("server omitted the exact preview");
      setPreviewSession({ bundleId, createdAt, preview: exact });
      setNotice("Fresh flat-book and portfolio-capacity preview passed. No runtime change occurred.");
    } catch (previewFailure) {
      const blocked = (previewFailure as Error & { preview?: PreviewView }).preview;
      if (blocked) setPreviewSession({ bundleId, createdAt, preview: blocked });
      setError(readError(previewFailure, "roster preview failed closed"));
    } finally {
      setBusy(false);
    }
  }, [changes, controlPlane?.view, reason, request]);

  const sealDraft = useCallback(async () => {
    const view = controlPlane?.view;
    const current = previewSession;
    if (!view?.manifestId || !view.manifestContentHash
        || !current?.preview.configurationEpochId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await request("/api/channel-roster-bundles/preview", {
        action: "draft",
        baseManifestContentHash: view.manifestContentHash,
        baseManifestId: view.manifestId,
        bundleId: current.bundleId,
        changes,
        createdAt: current.createdAt,
        evidenceRefs: [`configuration-epoch:${view.configurationEpochId}`],
        expectedConfigurationEpochId: current.preview.configurationEpochId,
        reason,
      }, true);
      setChanges([]);
      setPreviewSession(null);
      setReason("");
      setNotice("Immutable bundle draft sealed. Waiting for a fresh no-authority worker acknowledgement.");
      await refresh();
    } catch (draftFailure) {
      setError(readError(draftFailure, "roster draft failed closed"));
    } finally {
      setBusy(false);
    }
  }, [changes, controlPlane?.view, previewSession, reason, refresh, request]);

  const cancel = useCallback(async (bundle: RosterBundleView) => {
    setBusy(true);
    setError(null);
    try {
      await request("/api/channel-roster-bundles", {
        action: "cancel",
        bundleId: bundle.id,
        evidenceRefs: [`operator-cancel:${bundle.id}`],
        reason: "Operator canceled the unapplied roster bundle before activation.",
      }, true);
      setNotice("Bundle canceled. Active runtime and evidence history are unchanged.");
      await refresh();
    } catch (cancelFailure) {
      setError(readError(cancelFailure, "bundle cancel failed closed"));
    } finally {
      setBusy(false);
    }
  }, [refresh, request]);

  const supersede = useCallback(async (
    bundle: RosterBundleView,
    successor: RosterBundleView,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await request("/api/channel-roster-bundles", {
        action: "supersede",
        bundleId: bundle.id,
        evidenceRefs: [`operator-supersede:${bundle.id}:${successor.id}`],
        reason: "Operator superseded this unapplied bundle with a newer reviewed bundle on the same active base.",
        successorBundleId: successor.id,
      }, true);
      setNotice("Older bundle superseded. The named successor remains separately governed and unapplied.");
      await refresh();
    } catch (supersedeFailure) {
      setError(readError(supersedeFailure, "bundle supersession failed closed"));
    } finally {
      setBusy(false);
    }
  }, [refresh, request]);

  const apply = useCallback(async (
    bundle: RosterBundleView,
    confirmation: string,
  ) => {
    const ack = bundle.latestWorkerAcknowledgement;
    if (!ack || confirmation !== "APPLY NEXT SAFE ENTRY") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await request("/api/channel-roster-bundles/apply", {
        activationReceiptId: crypto.randomUUID(),
        approvalEvidenceRef: `operator-ui:APPLY NEXT SAFE ENTRY:${bundle.id}`,
        approvalId: crypto.randomUUID(),
        approvedLifecycleReceiptId: crypto.randomUUID(),
        bundleId: bundle.id,
        workerAcknowledgementId: ack.id,
      });
      setNotice("Atomic activation receipt sealed for prospective new entries only.");
      await refresh();
    } catch (applyFailure) {
      setError(readError(applyFailure, "atomic activation failed closed"));
    } finally {
      setBusy(false);
    }
  }, [refresh, request]);

  const rollback = useCallback(async (
    bundle: RosterBundleView,
    action: "preview" | "draft",
    existing?: PreviewSession,
  ) => {
    if (!bundle.activationReceipt) return null;
    const bundleId = existing?.bundleId ?? crypto.randomUUID();
    const createdAt = existing?.createdAt ?? new Date().toISOString();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const value = await request("/api/channel-roster-bundles/rollback", {
        action,
        bundleId,
        createdAt,
        evidenceRefs: [`activation-receipt:${bundle.activationReceipt.id}`],
        ...(action === "draft" ? {
          expectedConfigurationEpochId:
            existing?.preview.configurationEpochId,
        } : {}),
        reason: "Operator requested exact rollback to the immutable prior roster epoch.",
        rollbackActivationReceiptId: bundle.activationReceipt.id,
      }, action === "draft");
      const rollbackView = value.preview as {
        bundlePreview?: PreviewView | null;
      } | undefined;
      const exact = rollbackView?.bundlePreview;
      if (!exact) throw new Error("server omitted the exact rollback bundle preview");
      const next = { bundleId, createdAt, preview: exact };
      setNotice(action === "preview"
        ? "Exact rollback preview passed. Review and seal it as a new governed bundle."
        : "Immutable rollback bundle sealed. It still requires worker acknowledgement and explicit apply.");
      if (action === "draft") await refresh();
      return next;
    } catch (rollbackFailure) {
      setError(readError(rollbackFailure, "exact rollback failed closed"));
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh, request]);

  const qualifyCandidate = useCallback(async (
    candidate: PromotionCandidateView,
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await request("/api/channel-promotion-candidates", {
        expectedSourceContentHash: candidate.sourceContentHash,
        slug: candidate.slug,
      }, true);
      setNotice(
        `${candidate.slug} is now paper-eligible and remains observe-only, authority-dark, and unapplied.`,
      );
      await refresh();
    } catch (qualificationFailure) {
      setError(readError(
        qualificationFailure,
        "candidate qualification failed closed",
      ));
    } finally {
      setBusy(false);
    }
  }, [refresh, request]);

  const activeOrEligible = useMemo(() => {
    const active = new Set(controlPlane?.view?.specs.map((spec) => spec.slug) ?? []);
    return registrations.filter((registration) =>
      registration.state === "paper-eligible" && !active.has(registration.channel_slug));
  }, [controlPlane?.view?.specs, registrations]);

  return {
    registrations,
    candidates,
    paperEligibleRegistrations: activeOrEligible,
    bundles,
    mutationWindow,
    changes,
    reason,
    setReason: (value: string) => { setReason(value); invalidatePreview(); },
    previewSession,
    loading,
    busy,
    error,
    notice,
    signedIn: Boolean(session && operator),
    setTarget,
    removeTarget,
    preview,
    sealDraft,
    cancel,
    supersede,
    apply,
    rollback,
    qualifyCandidate,
    refresh,
  };
}
