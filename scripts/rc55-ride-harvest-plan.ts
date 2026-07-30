import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadActiveCompiledControlPlane } from "../lib/channels/channelControlPlanePersistence";
import { buildRc55RideHarvestCanary } from "../lib/channels/rc55RideHarvestCanary";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

const envFile = arg("env-file") ?? process.env.SEVE_ENV_FILE ?? null;
if (envFile) {
  const path = resolve(envFile);
  if (!existsSync(path)) throw new Error(`environment file not found: ${path}`);
  process.loadEnvFile(path);
} else if (existsSync(resolve(".env.local"))) {
  process.loadEnvFile(resolve(".env.local"));
}

async function main(): Promise<void> {
  const generatedAt = arg("generated-at") ?? new Date().toISOString();
  const out = resolve(arg("out") ?? "data/rc55-ride-harvest-canary.json");
  const sb = createServerSupabaseClient("rc55-ride-harvest-plan");
  const activeRead = await loadActiveCompiledControlPlane(sb);
  if (activeRead.state !== "active" || !activeRead.compiled) {
    throw new Error(
      `rc55-ride-harvest-plan: active control plane unavailable (${activeRead.state}:${activeRead.error ?? "none"})`,
    );
  }
  const artifact = buildRc55RideHarvestCanary(activeRead.compiled, generatedAt);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(
    `rc55-ride-harvest-plan: PASS · ${artifact.channels.length} channels · ${artifact.deterministicEvidenceHash}`,
  );
  console.log(`source: ${artifact.source.releaseId} · ${artifact.source.manifestContentHash}`);
  for (const channel of artifact.channels) {
    console.log(
      `${channel.slug}: bank 1 @ +${channel.targetPct}% · run 1 on A13 · ${channel.evidenceStrength}`,
    );
  }
  console.log(`artifact: ${out}`);
  console.log("production writes: 0 · proposals created: 0 · activation authorized: false");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
