"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { ChannelConfigDraftModel } from "@/lib/channels/channelConfigDraft";
import type {
  ChannelControlPlaneSpecView,
} from "@/lib/channels/channelControlPlaneOperatorView";

const MANAGER_KEYS = new Set(["take_profit_pct", "premium_stop_pct"]);

export function useChannelManagerProposal(input: {
  model: ChannelConfigDraftModel | null;
  activeSpec: ChannelControlPlaneSpecView | null;
  onSealed: () => void;
}) {
  const { session, operator } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const eligibility = useMemo(() => {
    const model = input.model;
    const spec = input.activeSpec;
    if (!model || !spec || model.state !== "reviewable") {
      return { ready: false, reason: "Create a reviewable draft first." };
    }
    const keys = Object.keys(model.patch);
    if (!keys.length || keys.some((key) => !MANAGER_KEYS.has(key))) {
      return {
        ready: false,
        reason:
          "This activation slice seals premium-stop and take-profit manager changes only; risk, size, entry, event, latch, underlying-stop, and pyramid controls remain review-only.",
      };
    }
    const requestedTarget = model.patch.take_profit_pct;
    if (requestedTarget != null
        && ((spec.takeProfit.kind === "ride" && requestedTarget !== 0)
          || (spec.takeProfit.kind === "bank" && requestedTarget <= 0))) {
      return {
        ready: false,
        reason:
          "Changing between ride and bank manager families requires a separately preregistered manager profile.",
      };
    }
    return { ready: true, reason: null };
  }, [input.activeSpec, input.model]);

  const seal = async () => {
    const model = input.model;
    const spec = input.activeSpec;
    if (!model || !spec || !eligibility.ready || !session || !operator) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const targetPct = model.patch.take_profit_pct;
      const catastrophePct = model.patch.premium_stop_pct;
      const proposedPatch = {
        managerPolicy: {
          managerProfileId: spec.managerProfileId,
          managerLabel: spec.managerLabel,
          takeProfit: targetPct == null
            ? spec.takeProfit
            : spec.takeProfit.kind === "ride"
              ? { kind: "ride" as const, targetPct: null, fraction: 0 as const }
              : {
                ...spec.takeProfit,
                targetPct,
              },
          stopLoss: catastrophePct == null
            ? spec.stopLoss
            : {
              ...spec.stopLoss,
              catastrophePct,
            },
          ratchetParameters: spec.ratchetParameters,
        },
      };
      const response = await fetch("/api/channel-proposals", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          baseSpecVersionId: spec.channelSpecVersionId,
          baseSpecContentHash: spec.channelSpecContentHash,
          proposedPatch,
          reason:
            "Operator-reviewed manager-only TP/SL adjustment from the immutable active specification.",
          evidenceRefs: [
            ...new Set([
              ...model.diffs.map((diff) =>
                `operator-draft:${model.slug}:${diff.key}:${diff.before}->${diff.after}`),
              `configuration-epoch:${model.source.configurationEpochId}`,
            ]),
          ],
          changeClass: "bounded-parameter",
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "manager proposal was rejected");
      }
      setNotice("Immutable manager proposal created. Validate it in the activation card.");
      input.onSealed();
    } catch (writeError) {
      setError(writeError instanceof Error
        ? writeError.message
        : "manager proposal failed");
    } finally {
      setBusy(false);
    }
  };

  return {
    canSeal: eligibility.ready && Boolean(session && operator),
    reason: eligibility.reason,
    busy,
    error,
    notice,
    seal,
  };
}
