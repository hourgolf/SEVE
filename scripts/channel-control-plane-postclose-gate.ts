// Read-only Gate 0 packet for the disabled channel control plane.
// Default behavior is plan-only. Live reads require an explicit market-close
// acknowledgement and an explicit absolute environment-file path.

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  channelControlMutationWindow,
} from "../lib/channels/channelControlMutationWindow";

type Check = {
  label: string;
  command: string;
  args: string[];
  limitation?: string;
};

const has = (flag: string): boolean => process.argv.includes(flag);
const valueAfter = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

const runReadOnly = has("--run-read-only");
const marketClosedAcknowledged = has("--ack-market-closed");
const envFile = valueAfter("--env-file");
const tsx = resolve("node_modules/.bin/tsx");

const staticChecks: Check[] = [
  { label: "control-plane compiler/contracts", command: "npm", args: ["run", "channel-control-plane-selftest"] },
  { label: "operator activation MVP affected suite", command: "npm", args: ["run", "channel-activation-mvp-selftest"] },
  { label: "OPS evidence joins", command: "npm", args: ["run", "ops-readiness-selftest"] },
  { label: "post-close read-only boundary", command: "npm", args: ["run", "postclose-readiness-selftest"] },
  { label: "RC5.4 manager contract", command: "npm", args: ["run", "rc54-manager-policy-selftest"] },
  { label: "RC5.4 release contract", command: "npm", args: ["run", "rc54-release-policy-selftest"] },
  { label: "RC5.4 exact composite replay", command: "npm", args: ["run", "rc54-composite-replay-selftest"] },
];

const liveReadChecks = envFile ? [
  {
    label: "current RC5.4 database binding and identity seal",
    command: tsx,
    args: [`--env-file=${envFile}`, "scripts/rc54-release-bindings.ts"],
  },
  {
    label: "paper broker/desk flatness and runtime liveness",
    command: tsx,
    args: [`--env-file=${envFile}`, "scripts/preopen-readiness.ts", "--require-flat", "--broker-runtime-only"],
    limitation: "Release identity is intentionally delegated to the preceding RC5.4 binding check; this subprocess proves only paper broker/desk flatness and runtime liveness.",
  },
] satisfies Check[] : [];

const authority = {
  externalWrites: false,
  orderPathAuthorized: false,
  migrationAuthorized: false,
  deploymentAuthorized: false,
  activationAuthorized: false,
} as const;

console.log("CHANNEL CONTROL PLANE · POST-CLOSE GATE 0");
console.log(JSON.stringify({ mode: runReadOnly ? "execute-read-only" : "plan-only", authority }, null, 2));
console.log("\nPlanned checks:");
for (const check of [...staticChecks, ...(envFile ? liveReadChecks : [{
  label: "live RC5.4 binding + paper broker/desk flatness",
  command: "<requires --env-file /absolute/path>",
  args: [],
}])]) {
  console.log(`  - ${check.label}: ${check.command} ${check.args.join(" ")}`.trimEnd());
  if (check.limitation) console.log(`    LIMITATION: ${check.limitation}`);
}

if (!runReadOnly) {
  console.log("\nPLAN ONLY — no subprocesses, network reads, migrations, deployments, configuration changes, or orders were run.");
  process.exit(0);
}

if (!marketClosedAcknowledged) throw new Error("--run-read-only requires --ack-market-closed");
const verifiedWindow = channelControlMutationWindow(Date.now());
if (!verifiedWindow.allowed) {
  throw new Error(
    `post-close gate requires a machine-verified closed session: ${
      verifiedWindow.code
    }`,
  );
}
console.log(`\nMARKET SESSION VERIFIED: ${verifiedWindow.session} · ${verifiedWindow.code}`);
if (!envFile || !isAbsolute(envFile) || !existsSync(envFile)) {
  throw new Error("--run-read-only requires --env-file with an existing absolute path");
}
if (!existsSync(tsx)) throw new Error(`local tsx executable is missing: ${tsx}`);

for (const check of [...staticChecks, ...liveReadChecks]) {
  console.log(`\n== ${check.label} ==`);
  if (check.limitation) console.log(`LIMITATION: ${check.limitation}`);
  const result = spawnSync(check.command, check.args, { cwd: process.cwd(), stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\nGATE 0 BLOCKED: ${check.label} exited ${result.status ?? "without a status"}.`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nGATE 0 READS PASS — this is evidence for review only. Migration, deployment, configuration, activation, and order authority remain false.");
