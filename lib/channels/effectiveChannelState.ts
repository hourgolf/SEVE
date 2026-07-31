import type { ActiveReleaseObservation, ActiveRootBinding, ActiveRootPolicy } from "./activeRelease";
import type { StrategistState } from "@/lib/desk/types";
import type { StudioChannelEvidence } from "@/lib/studio/deriveStudioEvidence";
import { paperAccountLabel } from "./paperAccountLabel";

export const EFFECTIVE_CHANNEL_STATE_VERSION = "effective-channel-state-v1" as const;

export type EffectiveExecutionPosture = "paper-executing" | "observe-only" | "unverified";
export type EffectiveEvidenceFreshness = "fresh" | "stale" | "checking" | "error" | "unavailable";

export interface EffectiveChannelEvidenceInput {
  ledger?: StudioChannelEvidence;
  asOf?: string | null;
  loading?: boolean;
  error?: boolean;
  basis?: string;
}

export interface EffectiveChannelState {
  schemaVersion: 1;
  projectionVersion: typeof EFFECTIVE_CHANNEL_STATE_VERSION;
  slug: string;
  authority: {
    state: "verified" | "unverified";
    source: "activation-receipt" | "sealed-startup-receipt" | "none";
    releaseId: string | null;
    configurationHash: string | null;
    receiptCreatedAt: string | null;
    workerVersion: string | null;
    fact: string;
  };
  execution: {
    posture: EffectiveExecutionPosture;
    label: "PAPER EXECUTING" | "OBSERVE ONLY" | "UNVERIFIED";
    canSubmitPaperEntries: boolean;
    orderAuthority: false;
    fact: string;
  };
  route: {
    accountId: string | null;
    accountName: string | null;
    source: "immutable-root-binding" | "none";
    databaseAccountId: string | null;
    differsFromDatabase: boolean;
    fact: string;
  };
  economics: {
    state: "sealed-exact" | "receipt-summary" | "unavailable";
    quantity: number | null;
    riskBudgetUsd: number | null;
    premiumStopPct: number | null;
    bankTargetPct: number | null;
    managerProfileId: string | null;
    managerVersion: string | null;
    channelSpecContentHash: string | null;
    configurationEpochId: string | null;
    fact: string;
  };
  database: {
    state: string;
    executor: "cron" | "stream";
    accountId: string | null;
    differsFromRuntime: boolean;
    differences: string[];
    fact: string;
  };
  evidence: {
    freshness: EffectiveEvidenceFreshness;
    asOf: string | null;
    basis: string;
    structuralLedger: StudioChannelEvidence | null;
    exactConfiguration: false;
    fact: string;
  };
  mutationAuthorized: false;
}

const evidenceAgeLimitMs = 10 * 60_000;

function databaseState(channel: StrategistState): string {
  if (channel.config.muted) return "MUTED";
  return channel.status.toUpperCase();
}

function evidenceFreshness(
  evidence: EffectiveChannelEvidenceInput,
  nowMs: number,
): EffectiveEvidenceFreshness {
  if (evidence.error) return "error";
  if (evidence.loading) return "checking";
  if (!evidence.asOf) return "unavailable";
  const asOf = Date.parse(evidence.asOf);
  if (!Number.isFinite(asOf)) return "error";
  return nowMs - asOf <= evidenceAgeLimitMs ? "fresh" : "stale";
}

function sha256(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function economics(
  rootPolicy: ActiveRootPolicy | null,
  binding: ActiveRootBinding | null,
): EffectiveChannelState["economics"] {
  if (rootPolicy) {
    return {
      state: "sealed-exact",
      quantity: rootPolicy.quantity,
      riskBudgetUsd: rootPolicy.riskBudgetUsd,
      premiumStopPct: rootPolicy.premiumStopPct,
      bankTargetPct: rootPolicy.bankTargetPct,
      managerProfileId: rootPolicy.managerProfileId,
      managerVersion: sha256(rootPolicy.managerVersion),
      channelSpecContentHash: sha256(rootPolicy.channelVersion),
      configurationEpochId: sha256(rootPolicy.configurationEpochId),
      fact: "Full paper economics come from the verified sealed root policy.",
    };
  }
  if (binding) {
    return {
      state: "receipt-summary",
      quantity: binding.quantity,
      riskBudgetUsd: null,
      premiumStopPct: null,
      bankTargetPct: null,
      managerProfileId: binding.managerProfileId,
      managerVersion: binding.managerVersion,
      channelSpecContentHash: binding.channelSpecContentHash,
      configurationEpochId: binding.configurationEpochId,
      fact: "The activation receipt proves route, quantity, manager, channel hash, and epoch; unstamped economics are withheld.",
    };
  }
  return {
    state: "unavailable",
    quantity: null,
    riskBudgetUsd: null,
    premiumStopPct: null,
    bankTargetPct: null,
    managerProfileId: null,
    managerVersion: null,
    channelSpecContentHash: null,
    configurationEpochId: null,
    fact: "No verified executable configuration applies to this observe-only channel.",
  };
}

export function deriveEffectiveChannelState(input: {
  channel: StrategistState;
  release: ActiveReleaseObservation;
  evidence?: EffectiveChannelEvidenceInput;
  nowMs?: number;
}): EffectiveChannelState {
  const { channel, release } = input;
  const verified = release.state === "verified";
  const runtimeRoot = verified && release.rootSlugs.includes(channel.slug);
  const rootPolicy = runtimeRoot ? release.roots[channel.slug] ?? null : null;
  const binding = runtimeRoot ? release.rootBindings[channel.slug] ?? null : null;
  const posture: EffectiveExecutionPosture = !verified
    ? "unverified"
    : runtimeRoot
      ? "paper-executing"
      : "observe-only";
  const source = !verified
    ? "none"
    : release.receipt?.meta?.state === "receipt-bound"
      ? "activation-receipt"
      : "sealed-startup-receipt";
  const executor = channel.executor ?? "cron";
  const dbState = databaseState(channel);
  const databaseAccountId = channel.account_id ?? null;
  const differences: string[] = [];

  if (runtimeRoot) {
    if (channel.status !== "armed") differences.push(`database lifecycle is ${channel.status}, runtime executes paper`);
    if (channel.config.muted) differences.push("database mute does not govern the sealed root");
    if (executor !== "stream") differences.push(`database executor is ${executor}, runtime executor is stream`);
    if (binding && databaseAccountId !== binding.accountId) differences.push("database account differs from immutable root route");
  } else if (verified && channel.status === "armed" && !channel.config.muted) {
    differences.push("database says armed, sealed runtime is observe-only");
  }

  const evidence = input.evidence ?? {};
  const freshness = evidenceFreshness(evidence, input.nowMs ?? Date.now());
  const ledger = evidence.ledger ?? null;
  const evidenceFact = freshness === "error"
    ? "Recent gross evidence could not be read; no performance conclusion is available."
    : freshness === "checking"
      ? "Recent gross evidence is loading."
      : freshness === "unavailable"
        ? "No recent gross evidence snapshot is available."
        : `${freshness === "stale" ? "Stale" : "Fresh"} recent gross evidence is structural only and is not an exact-configuration verdict.`;
  const routeLabel = binding
    ? paperAccountLabel(binding.accountId, "PAPER ACCOUNT")
    : null;
  const routeFact = binding
    ? `${routeLabel} is bound by the immutable ${binding.source === "activation-receipt" ? "activation receipt" : "sealed root policy"}.`
    : verified
      ? "The verified release authorizes no broker route for this channel."
      : "Route is withheld until runtime authority is verified.";
  const executionFact = posture === "paper-executing"
    ? "This channel may submit paper entries under the verified runtime."
    : posture === "observe-only"
      ? "Candidate and shadow evidence may continue, but this release authorizes no fills."
      : "A matching startup receipt is required before execution posture can be asserted.";

  return {
    schemaVersion: 1,
    projectionVersion: EFFECTIVE_CHANNEL_STATE_VERSION,
    slug: channel.slug,
    authority: {
      state: verified ? "verified" : "unverified",
      source,
      releaseId: verified ? release.releaseId : null,
      configurationHash: verified ? release.receipt?.configHash ?? release.expectedHash : null,
      receiptCreatedAt: verified ? release.receipt?.createdAt ?? null : null,
      workerVersion: verified ? release.workerVersion : null,
      fact: release.fact,
    },
    execution: {
      posture,
      label: posture === "paper-executing" ? "PAPER EXECUTING" : posture === "observe-only" ? "OBSERVE ONLY" : "UNVERIFIED",
      canSubmitPaperEntries: posture === "paper-executing",
      orderAuthority: false,
      fact: executionFact,
    },
    route: {
      accountId: binding?.accountId ?? null,
      accountName: routeLabel,
      source: binding ? "immutable-root-binding" : "none",
      databaseAccountId,
      differsFromDatabase: !!binding && databaseAccountId !== binding.accountId,
      fact: routeFact,
    },
    economics: economics(rootPolicy, binding),
    database: {
      state: dbState,
      executor,
      accountId: databaseAccountId,
      differsFromRuntime: differences.length > 0,
      differences,
      fact: differences.length
        ? differences.join("; ")
        : verified
          ? "Mutable database metadata does not contradict the effective runtime projection."
          : "Database metadata is shown for context only; it cannot establish runtime authority.",
    },
    evidence: {
      freshness,
      asOf: evidence.asOf ?? null,
      basis: evidence.basis ?? "recent gross desk attribution",
      structuralLedger: ledger,
      exactConfiguration: false,
      fact: evidenceFact,
    },
    mutationAuthorized: false,
  };
}
