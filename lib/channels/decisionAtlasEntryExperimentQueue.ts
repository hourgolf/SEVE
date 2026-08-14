import { createHash } from "node:crypto";
import type {
  AdmissionPolicySpec,
  CompiledReleaseManifest,
} from "./channelControlPlane";
import type { ChannelRosterBundleDraft } from "./channelRosterBundle";

export const DECISION_ATLAS_ENTRY_EXPERIMENT_QUEUE_VERSION =
  "decision-atlas-entry-experiment-queue-v1" as const;

export interface EntryExperimentQueueItem {
  channel: string;
  lane: "admission" | "entry" | "exit-shadow" | "hold";
  state: "configuration-draft" | "research-queued" | "control-held";
  change: string;
  heldFixed: string[];
  evidence: string;
}

export const ENTRY_EXPERIMENT_QUEUE: readonly EntryExperimentQueueItem[] =
  Object.freeze([
    {
      channel: "orb-ustop-ctl",
      lane: "admission",
      state: "configuration-draft",
      change: "Set Account 3 SPY priority to ORB, then BREAKOUT, then GRIND; keep same-OCC protection.",
      heldFixed: ["signal", "entry parameters", "exit", "quantity", "account"],
      evidence: "Its two blocked same-clock paths totaled +$20/ct in the 2026-08-13 mid-basis shadow.",
    },
    {
      channel: "orb-ustop-ctl",
      lane: "entry",
      state: "research-queued",
      change: "Compare opportunity quality by entry number, clock, and confirmation strength before another native manager switch.",
      heldFixed: ["native exit", "quantity", "account"],
      evidence: "Five current trades produced a typical best move of only +4.48%.",
    },
    {
      channel: "grind-v3",
      lane: "entry",
      state: "research-queued",
      change: "Compare a two-entry session cap with the current three-entry cap.",
      heldFixed: ["signal", "native exit", "quantity", "account"],
      evidence: "Entry two is positive so far; entries one and three are negative in the paired cohort.",
    },
    {
      channel: "grind-v3",
      lane: "exit-shadow",
      state: "research-queued",
      change: "Continue WIDE20/50 against the native exit on identical opportunities.",
      heldFixed: ["entry", "quantity", "account", "admission policy"],
      evidence: "The challenger leads, but its session-clustered interval still crosses zero.",
    },
    {
      channel: "pb-ride",
      lane: "entry",
      state: "research-queued",
      change: "Keep the one-entry cap and compare entry quality plus a paired +10% versus native +12% exit shadow.",
      heldFixed: ["quantity", "account", "one-entry cap"],
      evidence: "Typical best move is +10.07%; both exact-current trades lost.",
    },
    {
      channel: "orb-qqq-trail",
      lane: "entry",
      state: "research-queued",
      change: "Diagnose entry timing and confirmation before changing the native manager.",
      heldFixed: ["native exit", "quantity", "account"],
      evidence: "The exact-current loss reached only +8.65% at best.",
    },
    ...["vb-macd-state", "vb-gap-drift", "breakout"].map((channel) => ({
      channel,
      lane: "hold" as const,
      state: "control-held" as const,
      change: "Keep the current entry and native exit as the control.",
      heldFixed: ["entry", "exit", "quantity", "account", "priority"],
      evidence: "Current evidence does not justify replacing the native exit.",
    })),
  ]);

export function deterministicQueueUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex")
    .slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const joined = chars.join("");
  return [
    joined.slice(0, 8), joined.slice(8, 12), joined.slice(12, 16),
    joined.slice(16, 20), joined.slice(20),
  ].join("-");
}

export function account3PriorityPolicy(
  active: CompiledReleaseManifest,
): AdmissionPolicySpec {
  const policy = active.manifest.admissionPolicies.find((row) =>
    row.id === "rc54-morgue");
  if (!policy) throw new Error("active Account 3 admission policy is missing");
  for (const slug of [
    "orb-ustop-ctl", "breakout-alt-v3-itm", "grind-v3",
  ]) {
    const spec = active.channelSpecs.find((row) => row.slug === slug);
    if (!spec || spec.collisionDomain !== policy.id
        || spec.symbolScope[0] !== "SPY") {
      throw new Error(`${slug}: active Account 3 identity drifted`);
    }
  }
  return {
    ...structuredClone(policy),
    priorityBySlug: {
      ...policy.priorityBySlug,
      "orb-ustop-ctl": 1,
      "breakout-alt-v3-itm": 2,
      "grind-v3": 3,
    },
  };
}

export function buildAccount3PriorityDraft(input: {
  active: CompiledReleaseManifest;
  operatorId: string;
  createdAt: string;
  evidenceRefs: string[];
}): ChannelRosterBundleDraft {
  const policy = account3PriorityPolicy(input.active);
  const id = deterministicQueueUuid([
    DECISION_ATLAS_ENTRY_EXPERIMENT_QUEUE_VERSION,
    input.active.manifest.contentHash,
    JSON.stringify(policy.priorityBySlug),
  ].join(":"));
  return {
    id,
    baseManifestId: input.active.manifest.id,
    baseManifestContentHash: input.active.manifest.contentHash,
    changes: [
      { slug: "orb-ustop-ctl", priority: 1 },
      { slug: "breakout-alt-v3-itm", priority: 2 },
      { slug: "grind-v3", priority: 3 },
    ],
    admissionPolicyUpserts: [policy],
    reason:
      "Set Account 3 same-clock SPY priority to orb-ustop-ctl, then breakout-alt-v3-itm, then grind-v3. Preserve entry formulas, managers, sizing, routing, same-OCC protection, and all other capacity limits.",
    evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
    operatorId: input.operatorId,
    createdAt: input.createdAt,
  };
}

export function account3CapacityReplayVariants(
  active: CompiledReleaseManifest,
): Array<Record<string, unknown>> {
  const policy = account3PriorityPolicy(active);
  return [
    {
      id: "priority-only",
      sameClockSpy: policy.sameClockMaxByUnderlying.SPY,
      maxOpenSpy: policy.maxOpenByUnderlying.SPY,
      maxOpenGlobal: policy.maxOpenGlobal,
      sameOccOpenMax: policy.sameOccOpenMax,
      description: "ORB wins the tie; all capacity stays fixed.",
    },
    {
      id: "two-spy-same-clock",
      sameClockSpy: 2,
      maxOpenSpy: policy.maxOpenByUnderlying.SPY,
      maxOpenGlobal: policy.maxOpenGlobal,
      sameOccOpenMax: policy.sameOccOpenMax,
      description: "Allow both SPY channels when contracts differ; retain same-OCC blocking.",
    },
    {
      id: "two-spy-plus-third-global-slot",
      sameClockSpy: 2,
      maxOpenSpy: policy.maxOpenByUnderlying.SPY,
      maxOpenGlobal: 3,
      sameOccOpenMax: policy.sameOccOpenMax,
      description: "Test whether the global domain cap, rather than SPY capacity, displaces later QQQ opportunities.",
    },
    {
      id: "cross-account-separation",
      sameOccOpenMax: "independent by account domain",
      description: "Replay moving one channel to another paper account; preserve independent exits and cross-account same-OCC permission.",
    },
  ];
}
