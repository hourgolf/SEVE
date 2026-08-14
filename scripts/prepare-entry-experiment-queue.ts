// Build and optionally persist one authority-dark Account 3 priority draft plus
// the channel-specific entry/exit research queue. This script cannot approve,
// activate, deploy, mutate a worker, or place an order.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { isDeskOperator } from "../lib/auth/operator";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow";
import {
  account3CapacityReplayVariants,
  buildAccount3PriorityDraft,
  DECISION_ATLAS_ENTRY_EXPERIMENT_QUEUE_VERSION,
  deterministicQueueUuid,
  ENTRY_EXPERIMENT_QUEUE,
} from "../lib/channels/decisionAtlasEntryExperimentQueue";
import { buildChannelRosterBundlePreview } from "../lib/channels/channelRosterBundle";
import {
  prepareRosterBundleDraftWrite,
  prepareRosterBundleLifecycleWrite,
} from "../lib/channels/channelRosterBundlePersistence";
import { loadChannelRosterBundleServerContext } from "../lib/channels/channelRosterBundleServerContext";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? String(process.argv[index + 1]) : fallback;
};
const publish = process.argv.includes("--publish-draft");
const acknowledged = process.argv.includes("--ack-authority-dark");
const supersedeIndex = process.argv.indexOf("--supersede-bundle-id");
const supersedeBundleId = supersedeIndex >= 0 && process.argv[supersedeIndex + 1]
  ? String(process.argv[supersedeIndex + 1]) : null;
const envFile = resolve(arg(
  "env-file",
  process.env.SEVE_ENV_FILE ?? ".env.local",
));
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const outDir = resolve(arg(
  "out-dir",
  "data/after-close-recovery/2026-08-13/entry-experiment-queue",
));

async function exactOperator(
  sb: ReturnType<typeof createServerSupabaseClient>,
): Promise<User> {
  const read = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (read.error) throw new Error(`operator inventory failed: ${read.error.message}`);
  const operators = read.data.users.filter(isDeskOperator);
  if (operators.length !== 1) {
    throw new Error(`expected one desk operator, observed ${operators.length}`);
  }
  return operators[0];
}

function markdown(packet: Record<string, unknown>): string {
  const queue = packet.queue as typeof ENTRY_EXPERIMENT_QUEUE;
  const variants = packet.capacityReplay as Array<Record<string, unknown>>;
  const preview = packet.priorityDraft as Record<string, unknown>;
  return [
    "# Entry and admission experiment queue · 2026-08-13",
    "",
    "**PREPARED ONLY · NO ACTIVATION · NO ORDER AUTHORITY**",
    "",
    `Account 3 priority draft: **${preview.state}**. `
      + "Account 3 priority becomes ORB, then BREAKOUT, then GRIND; only BREAKOUT may use the bounded overflow slot, while same-OCC protection remains fixed.",
    "",
    "| Channel | Lane | Queued change | Held fixed |",
    "|---|---|---|---|",
    ...queue.map((row) => `| \`${row.channel}\` | ${row.lane} | ${row.change} | ${row.heldFixed.join(", ")} |`),
    "",
    "## Account 3 capacity replay",
    "",
    ...variants.map((row) => `- **${row.id}:** ${row.description}`),
    "",
    "The capacity replay is research-only. It does not loosen same-OCC protection or change a production account.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  if (publish && !acknowledged) {
    throw new Error("publishing the authority-dark draft requires --ack-authority-dark");
  }
  const generatedAt = new Date().toISOString();
  const window = channelControlMutationWindow(Date.parse(generatedAt));
  if (publish && !window.allowed) throw new Error(window.message);
  const sb = createServerSupabaseClient("prepare-entry-experiment-queue");
  const [activeRead, operator] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    exactOperator(sb),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error("one exact active control-plane manifest is required");
  }
  const context = await loadChannelRosterBundleServerContext({
    sb,
    active: activeRead.compiled,
    now: generatedAt,
  });
  const evidenceRefs = [
    "decision-atlas:entry-drift:through-2026-08-13",
    "decision-atlas:gate-shadow:2026-08-13:morgue-same-clock",
    "decision-atlas:channel-native-shadow-evaluation:2026-08-13",
    ...context.evidenceRefs,
  ];
  const draft = buildAccount3PriorityDraft({
    active: activeRead.compiled,
    operatorId: operator.id,
    createdAt: generatedAt,
    evidenceRefs,
  });
  const preview = buildChannelRosterBundlePreview({
    active: activeRead.compiled,
    registry: context.registry,
    draft,
    envelope: context.envelope,
    live: context.live,
    collectionStates: context.collectionStates,
  });
  if (preview.state !== "ready-for-worker-ack") {
    const failures = preview.candidate?.validationResults
      .filter((row) => row.state !== "pass")
      .map((row) => `${row.code}:${row.fact}`) ?? [];
    throw new Error([...preview.blockers, ...failures].join("; "));
  }

  let storageReceipt: unknown = null;
  let supersessionReceipt: unknown = null;
  if (publish) {
    const write = prepareRosterBundleDraftWrite({
      draft,
      preview,
      registry: context.registry,
      initialReceiptId: deterministicQueueUuid(
        `entry-queue-initial-receipt:${preview.configurationEpochId}`,
      ),
    });
    const stored = await sb.rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      if (stored.error.code !== "23505") {
        throw new Error(`entry queue draft rejected: ${stored.error.message}`);
      }
      const existing = await sb.from("channel_roster_bundle_current")
        .select("id,base_manifest_content_hash,configuration_epoch_id,candidate_manifest")
        .eq("id", draft.id).maybeSingle();
      const candidate = existing.data?.candidate_manifest as {
        contentHash?: string;
      } | null;
      if (existing.error || !existing.data
          || existing.data.base_manifest_content_hash
            !== draft.baseManifestContentHash
          || existing.data.configuration_epoch_id !== preview.configurationEpochId
          || candidate?.contentHash !== preview.candidate?.manifest.contentHash) {
        throw new Error("existing entry queue draft is not an exact replay");
      }
      storageReceipt = {
        state: "already-current",
        id: existing.data.id,
        configurationEpochId: existing.data.configuration_epoch_id,
      };
    } else storageReceipt = stored.data;

    if (supersedeBundleId) {
      if (supersedeBundleId === draft.id) {
        throw new Error("a queue draft cannot supersede itself");
      }
      const old = await sb.from("channel_roster_bundle_current")
        .select("id,state,order_authority,runtime_mutation_authorized")
        .eq("id", supersedeBundleId).single();
      if (old.error) throw new Error(`superseded draft read failed: ${old.error.message}`);
      if (old.data.order_authority !== false
          || old.data.runtime_mutation_authorized !== false) {
        throw new Error("superseded draft unexpectedly carries runtime authority");
      }
      if (old.data.state === "superseded") {
        supersessionReceipt = { state: "already-superseded", id: old.data.id };
      } else {
        if (!["draft", "validated"].includes(old.data.state)) {
          throw new Error(`superseded draft has incompatible state: ${old.data.state}`);
        }
        const transition = prepareRosterBundleLifecycleWrite({
          receiptId: deterministicQueueUuid(
            `entry-queue-supersession:${supersedeBundleId}:${draft.id}`,
          ),
          bundleId: supersedeBundleId,
          targetState: "superseded",
          successorBundleId: draft.id,
          reason:
            "Operator corrected Account 3 priority to orb-ustop-ctl, then breakout-alt-v3-itm, then grind-v3.",
          evidenceRefs,
          operatorId: operator.id,
          effectiveAt: new Date().toISOString(),
        });
        const transitioned = await sb.rpc(transition.rpc, transition.args)
          .abortSignal(AbortSignal.timeout(8_000)).single();
        if (transitioned.error) {
          throw new Error(`old queue supersession rejected: ${transitioned.error.message}`);
        }
        supersessionReceipt = transitioned.data;
      }
    }
  }

  const packet = {
    schemaVersion: 1,
    version: DECISION_ATLAS_ENTRY_EXPERIMENT_QUEUE_VERSION,
    generatedAt,
    priorityDraft: {
      state: publish ? "persisted-authority-dark" : "preview-ready",
      draft,
      preview,
      storageReceipt,
      supersessionReceipt,
    },
    queue: ENTRY_EXPERIMENT_QUEUE,
    capacityReplay: account3CapacityReplayVariants(activeRead.compiled),
    authority: {
      configurationDraftWrite: publish,
      activation: false,
      workerMutation: false,
      orderAuthority: false,
      researchProductionWrite: false,
    },
  };
  const canonical = JSON.stringify(packet);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "queue.json"), `${JSON.stringify(packet, null, 2)}\n`);
  writeFileSync(resolve(outDir, "queue.md"), markdown(packet));
  writeFileSync(resolve(outDir, "receipt.json"), `${JSON.stringify({
    generatedAt,
    contentSha256: createHash("sha256").update(canonical).digest("hex"),
    configurationEpochId: preview.configurationEpochId,
    candidateManifestContentHash: preview.candidate?.manifest.contentHash,
    storageState: publish ? "persisted-authority-dark" : "preview-only",
    activation: false,
    orderAuthority: false,
  }, null, 2)}\n`);
  console.log(`prepare-entry-experiment-queue: PASS · ${publish ? "draft persisted" : "preview only"}`);
  console.log(`  Account 3 priority: orb-ustop-ctl 1 · breakout-alt-v3-itm 2 · grind-v3 3`);
  console.log(`  queue items: ${ENTRY_EXPERIMENT_QUEUE.length}`);
  console.log(`  output: ${outDir}`);
}

main().catch((error) => {
  console.error(`prepare-entry-experiment-queue: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
