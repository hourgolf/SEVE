// Authority-dark registration of the current non-active research fleet.
// Plan-only by default. Apply is after-close-only and cannot create a paper-
// eligible cartridge, change runtime configuration, or place an order.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { channelControlMutationWindow } from "../lib/channels/channelControlMutationWindow.js";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence.js";
import { prepareResearchChannelRegistrationWrite } from "../lib/channels/channelRosterBundlePersistence.js";
import {
  planResearchChannelPreregistration,
  type ExistingResearchRegistration,
  type InventoryResearchChannel,
} from "../lib/channels/researchChannelPreregistration.js";

const has = (flag: string): boolean => process.argv.includes(flag);
const valueAfter = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const inventoryPath = resolve(valueAfter("--inventory")
  ?? "data/channel-cartridge-inventories/2026-07-31.json");
const apply = has("--apply");
const acknowledged = has("--ack-authority-dark");

interface InventoryReceipt {
  generatedAt: string;
  inventory: { channels: InventoryResearchChannel[] };
}

async function main(): Promise<void> {
  const parsed = JSON.parse(readFileSync(inventoryPath, "utf8")) as InventoryReceipt;
  if (!parsed.inventory?.channels?.length
      || !Number.isFinite(Date.parse(parsed.generatedAt))) {
    throw new Error("current-channel inventory receipt is missing or invalid");
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [activeRead, existingRead, currentRead] = await Promise.all([
    loadActiveCompiledControlPlane(sb),
    sb.from("research_channel_registrations")
      .select("registration_key,channel_id,state")
      .order("registered_at"),
    sb.from("research_channel_registration_current")
      .select("registration_key,channel_id,state"),
  ]);
  if (!activeRead.compiled || activeRead.state !== "active") {
    throw new Error("one exact active control-plane manifest is required");
  }
  if (existingRead.error) {
    throw new Error(`research registration inventory failed: ${existingRead.error.message}`);
  }
  if (currentRead.error) {
    throw new Error(`current research registry failed: ${currentRead.error.message}`);
  }
  const currentKeys = new Set((currentRead.data ?? []).map((row) =>
    String(row.registration_key)));
  const existing = (existingRead.data ?? []).map((row): ExistingResearchRegistration => ({
    registrationKey: String(row.registration_key),
    channelId: String(row.channel_id).toLowerCase(),
    state: String(row.state) as ExistingResearchRegistration["state"],
    isCurrent: currentKeys.has(String(row.registration_key)),
  }));
  const registeredAt = new Date().toISOString();
  const plan = planResearchChannelPreregistration({
    inventory: parsed.inventory.channels,
    activeChannelIds: new Set(activeRead.compiled.channelSpecs.map((spec) =>
      spec.channelId.toLowerCase())),
    activeSlugs: new Set(activeRead.compiled.channelSpecs.map((spec) => spec.slug)),
    existing,
    registeredAt,
    registeredBy: `system:current-channel-inventory:${parsed.generatedAt.slice(0, 10)}`,
  });
  console.log(JSON.stringify({
    mode: apply ? "apply-authority-dark" : "plan-only",
    inventoryGeneratedAt: parsed.generatedAt,
    activeSkipped: plan.skippedActive.length,
    exactInventorySkipped: plan.skippedExactInventory.length,
    paperEligibleSkipped: plan.skippedCurrentPaperEligible.length,
    registrations: plan.registrations.length,
    states: [...new Set(plan.registrations.map((row) => row.registration.state))],
    executionAuthority: plan.executionAuthority,
    runtimeMutationAuthorized: plan.runtimeMutationAuthorized,
    orderAuthority: plan.orderAuthority,
  }, null, 2));
  if (!apply) return;
  const window = channelControlMutationWindow(Date.now());
  if (!acknowledged) throw new Error("--apply requires --ack-authority-dark");
  if (!window.allowed) throw new Error(window.message);
  let inserted = 0;
  for (const item of plan.registrations) {
    const write = prepareResearchChannelRegistrationWrite(item);
    const stored = await sb.rpc(write.rpc, write.args)
      .abortSignal(AbortSignal.timeout(8_000)).single();
    if (stored.error) {
      throw new Error(`research registration failed ${item.registration.slug}: ${stored.error.message}`);
    }
    inserted += 1;
  }
  console.log(JSON.stringify({
    receipt: "authority-dark-research-preregistration",
    inserted,
    inventoryGeneratedAt: parsed.generatedAt,
    registeredAt,
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
