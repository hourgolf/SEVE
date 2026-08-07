// SELECT-only live-baseline verification for the preregistered Priority-A
// cohort. It writes a local receipt and never changes channel configuration.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PRIORITY_A_BOUNDED_RETUNES } from "../lib/research/boundedRetuneRegistry";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const envFile = resolve(arg("env-file") ?? process.env.SEVE_ENV_FILE ?? ".env.local");
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const outputDir = resolve(arg("out-dir") ?? "data/decision-atlas/priority-a-retunes/latest");

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
const sha256 = (value: string | Buffer): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function registryBundleHash(): string {
  const files = ["engine/registry.ts", ...readdirSync("engine/strategies")
    .filter((file) => file.endsWith(".ts")).sort().map((file) => join("engine/strategies", file))];
  const hash = createHash("sha256");
  for (const file of files) hash.update(file).update("\0").update(readFileSync(file)).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("priority-a retune readiness");
  const slugs = PRIORITY_A_BOUNDED_RETUNES.map((row) => row.channel);
  const { data, error } = await sb.from("strategists")
    .select("id,slug,spec_json,strategist_config(max_contracts,premium_stop_pct,take_profit_pct)")
    .in("slug", slugs).order("slug");
  if (error) throw new Error(`strategist baseline read failed: ${error.message}`);
  const bySlug = new Map(((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => [String(row.slug), row]));
  const registryHash = registryBundleHash();
  const channels = PRIORITY_A_BOUNDED_RETUNES.map((definition) => {
    const row = bySlug.get(definition.channel);
    const configs = row?.strategist_config;
    const config = (Array.isArray(configs) ? configs[0] : configs) as Record<string, unknown> | null | undefined;
    const spec = row?.spec_json;
    const sourceContentHash = spec && typeof spec === "object" && Object.keys(spec as Record<string, unknown>).length
      ? sha256(canonical(spec)) : registryHash;
    const observed = {
      strategistId: row ? String(row.id) : null,
      sourceContentHash: row ? sourceContentHash : null,
      maxContracts: config ? Number(config.max_contracts) : null,
      configuredPremiumStopPct: config?.premium_stop_pct == null ? null : Number(config.premium_stop_pct),
      takeProfitPct: config ? Number(config.take_profit_pct) : null,
    };
    const expected = { strategistId: definition.strategistId, ...definition.baseline };
    const mismatches = (Object.keys(expected) as Array<keyof typeof expected>)
      .filter((key) => observed[key] !== expected[key]);
    return { channel: definition.channel, experimentId: definition.experimentId,
      variable: definition.variable, controlValue: definition.controlValue,
      alternativeValue: definition.alternativeValue, expected, observed,
      state: mismatches.length ? "blocked" : "ready", mismatches };
  });
  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    cohortStartSession: PRIORITY_A_BOUNDED_RETUNES[0].cohortStartSession,
    summary: { registered: channels.length, ready: channels.filter((row) => row.state === "ready").length,
      blocked: channels.filter((row) => row.state === "blocked").length },
    channels,
    productionWrites: 0,
    allowedMethods: ["SELECT", "GET"],
    executionAuthority: false,
    configurationAuthority: false,
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "readiness.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`priority-a-retune-readiness: ${receipt.summary.blocked ? "BLOCKED" : "PASS"} · ${receipt.summary.ready}/${receipt.summary.registered} exact baselines`);
  console.log(`  output: ${outputDir}`);
  if (receipt.summary.blocked) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`priority-a-retune-readiness: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

