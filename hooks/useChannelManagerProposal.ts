"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { ChannelConfigDraftModel } from "@/lib/channels/channelConfigDraft";
import type {
  ChannelControlPlaneSpecView,
} from "@/lib/channels/channelControlPlaneOperatorView";

const MANAGER_KEYS = new Set(["take_profit_pct", "premium_stop_pct"]);
const SIZING_KEYS = new Set(["capital_pct", "max_contracts"]);

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
    const managerOnly = keys.length > 0
      && keys.every((key) => MANAGER_KEYS.has(key));
    const sizingOnly = keys.length > 0
      && keys.every((key) => SIZING_KEYS.has(key));
    if (!managerOnly && !sizingOnly) {
      return {
        ready: false,
        reason:
          "Seal either a TP/SL manager adjustment or a sizing/risk adjustment. Entry, event, latch, underlying-stop, pyramid, and mixed manager/size changes remain review-only.",
      };
    }
    const requestedTarget = model.patch.take_profit_pct;
    if (managerOnly && requestedTarget != null
        && ((spec.takeProfit.kind === "ride" && requestedTarget !== 0)
          || (spec.takeProfit.kind === "bank" && requestedTarget <= 0))) {
      return {
        ready: false,
        reason:
          "Changing between ride and bank manager families requires a separately preregistered manager profile.",
      };
    }
    return {
      ready: true,
      reason: sizingOnly
        ? "Sizing is bounded to 1–12 contracts and still requires fresh flat-book capacity validation, worker acknowledgement, and explicit next-safe-entry apply."
        : null,
    };
  }, [input.activeSpec, input.model]);

  const seal = async () => {
    const model = input.model;
    const spec = input.activeSpec;
    if (!model || !spec || !eligibility.ready || !session || !operator) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const keys = Object.keys(model.patch);
      const sizingOnly = keys.every((key) => SIZING_KEYS.has(key));
      const targetPct = model.patch.take_profit_pct;
      const catastrophePct = model.patch.premium_stop_pct;
      const quantity = model.patch.max_contracts ?? spec.quantity;
      const maxDebitUsd =
        Math.round(spec.premiumCap * quantity * 10_000) / 100;
      const currentRiskRatio = spec.maxDebitUsd > 0
        ? spec.maxRiskUsd / spec.maxDebitUsd
        : 0;
      const maxRiskUsd = model.patch.capital_pct
        ?? Math.round(maxDebitUsd * currentRiskRatio * 100) / 100;
      if (sizingOnly && maxRiskUsd > maxDebitUsd) {
        throw new Error(
          `risk / trade (${maxRiskUsd}) cannot exceed the ${quantity}-contract debit cap (${maxDebitUsd})`,
        );
      }
      const proposedPatch = sizingOnly
        ? {
          quantity,
          maxDebitUsd,
          riskLimits: {
            maxContracts: quantity,
            maxDebitUsd,
            maxRiskUsd,
          },
        }
        : {
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
          reason: sizingOnly
            ? "Operator-reviewed bounded sizing and risk adjustment from the immutable active specification."
            : "Operator-reviewed manager-only TP/SL adjustment from the immutable active specification.",
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
        throw new Error(body.error ?? "governed proposal was rejected");
      }
      setNotice(
        sizingOnly
          ? "Immutable sizing proposal created. Validate capacity and collision evidence in the activation card."
          : "Immutable manager proposal created. Validate it in the activation card.",
      );
      input.onSealed();
    } catch (writeError) {
      setError(writeError instanceof Error
        ? writeError.message
        : "governed proposal failed");
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
