"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { startVisibilityPoll } from "@/lib/pollControl";

interface Relation {
  version_key?: string;
  channel_slug?: string;
  content_hash?: string;
  execution_posture?: "paper" | "observe-only" | null;
}

export interface ChannelActivationProposalView {
  id: string;
  reason: string;
  evidence_refs: string[];
  proposed_patch: Record<string, unknown>;
  approval_state: "draft" | "validated";
  created_at: string;
  base: Relation | Relation[] | null;
  proposed: Relation | Relation[] | null;
  preview: {
    id: string;
    configuration_epoch_id: string;
    prepared_at: string;
  } | null;
  latestWorkerAcknowledgement: {
    id: string;
    preview_id: string;
    acknowledged_at: string;
  } | null;
}

function related(value: Relation | Relation[] | null): Relation | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function useChannelActivationControl(input: {
  slug: string;
  baseSpecVersionId: string | null;
  baseSpecContentHash: string | null;
  executionPosture: "paper" | "observe-only";
  evidenceRefs: string[];
}) {
  const { session, operator } = useAuth();
  const [proposals, setProposals] = useState<ChannelActivationProposalView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session || !operator) {
      setProposals([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/channel-activation", {
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        proposals?: ChannelActivationProposalView[];
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "activation state read failed");
      }
      setProposals(body.proposals ?? []);
      setError(null);
    } catch (readError) {
      setError(readError instanceof Error
        ? readError.message
        : "activation state read failed");
    } finally {
      setLoading(false);
    }
  }, [operator, session]);

  useEffect(() => {
    void refresh();
    const stop = startVisibilityPoll(refresh, 15_000);
    return stop;
  }, [refresh]);

  const proposal = useMemo(() => proposals.find((item) => {
    const base = related(item.base);
    return base?.channel_slug === input.slug
      && base.version_key === input.baseSpecVersionId;
  }) ?? null, [input.baseSpecVersionId, input.slug, proposals]);

  const request = useCallback(async (
    path: string,
    body: Record<string, unknown>,
  ) => {
    if (!session || !operator) throw new Error("operator sign-in is required");
    const response = await fetch(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({})) as {
      ok?: boolean;
      error?: string;
    };
    if (!response.ok || !value.ok) {
      throw new Error(value.error ?? `activation request failed (${response.status})`);
    }
    return value as Record<string, unknown>;
  }, [operator, session]);

  const createPostureDraft = useCallback(async () => {
    if (!input.baseSpecVersionId || !input.baseSpecContentHash) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const target = input.executionPosture === "paper"
        ? "observe-only"
        : "paper";
      await request("/api/channel-proposals", {
        baseSpecVersionId: input.baseSpecVersionId,
        baseSpecContentHash: input.baseSpecContentHash,
        proposedPatch: { executionPosture: target },
        reason: target === "observe-only"
          ? "Pause new paper entries while preserving independent research collection."
          : "Resume paper entries at the next verified safe boundary.",
        evidenceRefs: input.evidenceRefs.length
          ? input.evidenceRefs
          : [`operator-decision:${input.slug}`],
        changeClass: "governed-operational-policy",
      });
      setNotice("Immutable posture draft created. Review it before validation.");
      await refresh();
    } catch (writeError) {
      setError(writeError instanceof Error
        ? writeError.message
        : "posture draft failed");
    } finally {
      setBusy(false);
    }
  }, [input, refresh, request]);

  const createEntryCapDraft = useCallback(async (
    maxEntriesPerSession: number,
    evidenceRefs: string[] = [],
  ) => {
    if (!input.baseSpecVersionId || !input.baseSpecContentHash) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await request("/api/channel-proposals", {
        baseSpecVersionId: input.baseSpecVersionId,
        baseSpecContentHash: input.baseSpecContentHash,
        proposedPatch: { maxEntriesPerSession },
        reason: `Test ${maxEntriesPerSession} same-session entr${maxEntriesPerSession === 1 ? "y" : "ies"} while keeping exit, manager, size, route, and collision policy fixed.`,
        evidenceRefs: [...new Set([...input.evidenceRefs, ...evidenceRefs])],
        changeClass: "governed-operational-policy",
      });
      setNotice("Immutable entry-cap draft created. Review it before validation.");
      await refresh();
    } catch (writeError) {
      setError(writeError instanceof Error
        ? writeError.message
        : "entry-cap draft failed");
    } finally {
      setBusy(false);
    }
  }, [input, refresh, request]);

  const preparePreview = useCallback(async () => {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await request("/api/channel-activation/preview", {
        proposalId: proposal.id,
      });
      setNotice("Validated preview sealed. Waiting for the current worker acknowledgement.");
      await refresh();
    } catch (writeError) {
      setError(writeError instanceof Error
        ? writeError.message
        : "preview failed");
    } finally {
      setBusy(false);
    }
  }, [proposal, refresh, request]);

  const apply = useCallback(async () => {
    const acknowledgement = proposal?.latestWorkerAcknowledgement;
    const preview = proposal?.preview;
    if (!proposal || !preview || !acknowledgement) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await request("/api/channel-activation/apply", {
        proposalId: proposal.id,
        previewId: preview.id,
        acknowledgementId: acknowledgement.id,
        configurationEpochId: preview.configuration_epoch_id,
        confirmation: "APPLY NEXT SAFE ENTRY",
      });
      setNotice("Activation receipt sealed. The worker will adopt it on its next governed reload.");
      await refresh();
    } catch (writeError) {
      setError(writeError instanceof Error
        ? writeError.message
        : "activation failed");
    } finally {
      setBusy(false);
    }
  }, [proposal, refresh, request]);

  const acknowledgementFresh = proposal?.latestWorkerAcknowledgement
    ? Date.now() - Date.parse(
      proposal.latestWorkerAcknowledgement.acknowledged_at,
    ) <= 300_000
    : false;

  return {
    proposal,
    loading,
    busy,
    error,
    notice,
    acknowledgementFresh,
    signedIn: Boolean(session && operator),
    createPostureDraft,
    createEntryCapDraft,
    preparePreview,
    apply,
    refresh,
  };
}
