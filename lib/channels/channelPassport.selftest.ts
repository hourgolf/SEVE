import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { deriveChannelPassports } from "./channelPassport";
import { DAY1_CONFIG_HASH, DAY1_MANAGER_ARMS, DAY1_RELEASE_ID, DAY1_ROOTS, DAY1_WORKER_VERSION, day1RootExitLabel } from "./day1Release";
import {
  RC54_CONFIG_HASH,
  RC54_RELEASE_ID,
  RC54_ROOTS,
  activeRootRuntimeConfig,
  RC54_WORKER_VERSION,
  activeRootExitLabel,
} from "./activeRelease";
import type { StrategistState } from "@/lib/desk/types";

const channel = (slug: string, status: StrategistState["status"] = "armed", executor: StrategistState["executor"] = "stream"): StrategistState => ({
  id: slug, slug, underlying: "SPY", name: slug, mandate: "test", regime: "test", color: "green",
  status, executor, account_id: "acct", spec: null,
  config: { capital_pct: 100, aggression: 1, max_contracts: 2, daily_stop_usd: 0, muted: false, soloed: false },
  defaults: { capital_pct: 100, aggression: 1, max_contracts: 2, daily_stop_usd: 0, muted: false, soloed: false },
});

const event = (message: string, meta: Record<string, unknown> | null = null) => ({
  id: message, level: "EXEC" as const, message, created_at: "2026-07-18T15:00:00Z",
  strategist_id: null, meta,
});
const verified = [event(`stream: day1-release ACTIVE ${DAY1_RELEASE_ID} config=${DAY1_CONFIG_HASH}`)];

const result = deriveChannelPassports({
  channels: [channel("pb-ride"), channel("pb-ride-2")],
  events: verified,
  signals: [
    { id: "s1", strategist_slug: "pb-ride", level: "INFO", signal_type: "entry", message: "candidate", created_at: "2026-07-18T14:00:00Z", acted_on: true },
    { id: "s2", strategist_slug: "pb-ride-2", level: "INFO", signal_type: "entry", message: "dark", created_at: "2026-07-18T14:01:00Z", blocked_reason: "day1_dark_lifecycle" },
  ],
  positions: [], recentTrades: [], evidenceBySlug: {},
});

assert.equal(result.release.state, "verified");
assert.equal(result.releaseView.label, "SEALED RELEASE RUNTIME");
assert.equal(result.releaseView.accountLifecycleLabel, "1 EXECUTING · 1 OBSERVE ONLY");
assert.equal(result.releaseView.compactAccountLifecycleLabel, "1 EXEC · 1 OBSERVE");
assert.equal(result.releaseView.databaseOnly, false);
assert.equal(result.roots, 1);
assert.equal(result.dark, 1);
assert.equal(result.bySlug["pb-ride"].lifecycle, "paper-root");
assert.equal(result.bySlug["pb-ride"].rootPolicy?.quantity, 2);
assert.equal(result.bySlug["pb-ride"].observer.configuredArms, 8);
assert.equal(day1RootExitLabel(DAY1_ROOTS["pb-ride"]), "−30% catastrophe · RIDE · 15:25 ET");
assert.equal(day1RootExitLabel(DAY1_ROOTS["momo-shape"]), "−30% catastrophe · A13 arm +50% / retain ⅔ · 15:25 ET");
assert.equal(day1RootExitLabel(DAY1_ROOTS["momo-shape"], true), "−30% · A13 +50%/⅔ · 15:25");
assert.equal(result.bySlug["pb-ride"].evidence.actedSignals, 1);
assert.deepEqual(result.bySlug["pb-ride"].evidence.recentDecisions.map((row) => row.id), ["s1"]);
assert.equal(result.bySlug["pb-ride-2"].lifecycle, "dark-evidence");
assert.equal(result.bySlug["pb-ride-2"].evidence.darkLifecycleCensors, 1);
assert.equal(result.bySlug["pb-ride-2"].database.differsFromRuntime, true);

const decisionWindow = deriveChannelPassports({
  channels: [channel("pb-ride")], events: verified,
  signals: [1, 2, 3, 4].map((minute) => ({
    id: `decision-${minute}`, strategist_slug: "pb-ride", level: "INFO" as const,
    signal_type: "entry", message: `candidate ${minute}`, created_at: `2026-07-18T14:0${minute}:00Z`,
  })),
  positions: [], recentTrades: [], evidenceBySlug: {},
});
assert.deepEqual(decisionWindow.bySlug["pb-ride"].evidence.recentDecisions.map((row) => row.id), ["decision-4", "decision-3", "decision-2"]);

const missing = deriveChannelPassports({ channels: [channel("pb-ride")], events: [], signals: [], positions: [], recentTrades: [], evidenceBySlug: {} });
assert.equal(missing.release.state, "missing");
assert.equal(missing.bySlug["pb-ride"].lifecycle, "unverified");

const checking = deriveChannelPassports({ channels: [channel("pb-ride")], events: [], signals: [], positions: [], recentTrades: [], evidenceBySlug: {}, releaseReadState: "checking" });
assert.equal(checking.release.state, "checking");
assert.equal(checking.releaseView.label, "CHECKING RELEASE");
assert.equal(checking.releaseView.databaseOnly, true);
assert.equal(checking.bySlug["pb-ride"].lifecycle, "unverified");
assert.match(checking.release.fact, /no runtime lifecycle claim/i);

const readError = deriveChannelPassports({ channels: [channel("pb-ride")], events: [], signals: [], positions: [], recentTrades: [], evidenceBySlug: {}, releaseReadState: "error" });
assert.equal(readError.release.state, "read-error");
assert.equal(readError.bySlug["pb-ride"].lifecycle, "unverified");
assert.match(readError.release.fact, /read failed/i);

const cachedThroughError = deriveChannelPassports({ channels: [channel("pb-ride")], events: verified, signals: [], positions: [], recentTrades: [], evidenceBySlug: {}, releaseReadState: "error" });
assert.equal(cachedThroughError.release.state, "verified");
assert.equal(cachedThroughError.bySlug["pb-ride"].lifecycle, "paper-root");

const mismatch = deriveChannelPassports({
  channels: [channel("pb-ride")],
  events: [event(`stream: day1-release ACTIVE wrong-release config=${DAY1_CONFIG_HASH}`)],
  signals: [], positions: [], recentTrades: [], evidenceBySlug: {},
});
assert.equal(mismatch.release.state, "mismatch");
assert.equal(mismatch.bySlug["pb-ride"].rootPolicy, null);

const rc54Verified = [event(`stream: rc54-release ACTIVE ${RC54_RELEASE_ID} config=${RC54_CONFIG_HASH}`)];
const rc54 = deriveChannelPassports({
  channels: [
    channel("pb-ride"),
    channel("vb-macd-state", "draft", "cron"),
    channel("vb-squeeze-break", "draft", "cron"),
    channel("vb-ribbon-cross-qqq", "draft", "cron"),
    channel("vb-macd-state-qqq", "armed", "stream"),
  ],
  events: rc54Verified,
  signals: [{
    id: "rc54-dark", strategist_slug: "vb-macd-state-qqq", level: "INFO",
    signal_type: "entry", message: "dark", created_at: "2026-07-27T14:01:00Z",
    blocked_reason: "rc54_dark_lifecycle",
  }],
  positions: [], recentTrades: [], evidenceBySlug: {},
});
assert.equal(rc54.release.state, "verified");
assert.equal(rc54.release.lane, "rc54");
assert.equal(rc54.roots, 4);
assert.equal(rc54.dark, 1);
assert.equal(rc54.bySlug["vb-macd-state"].lifecycle, "paper-root");
assert.equal(rc54.bySlug["vb-macd-state"].rootPolicy?.accountName, "LAB");
assert.equal(rc54.bySlug["vb-macd-state"].rootPolicy?.managerProfileId, "LAB54-L30-L50");
assert.equal(rc54.bySlug["vb-macd-state"].rootPolicy?.bankTargetPct, 30);
assert.equal(rc54.bySlug["vb-macd-state"].rootPolicy?.runner, "fixed-50");
assert.equal(rc54.bySlug["vb-macd-state"].database.differsFromRuntime, true);
assert.equal(rc54.bySlug["vb-macd-state-qqq"].evidence.darkLifecycleCensors, 1);
assert.equal(activeRootExitLabel(RC54_ROOTS["orb-ustop-ctl"]), "−30% catastrophe · bank 1 @ +30% / A13 runner · 15:25 ET");
assert.equal(activeRootExitLabel(RC54_ROOTS["vb-macd-state"], true), "−30% · B30/R50 · 15:25");

const receiptBoundHash = "c".repeat(64);
const receiptBoundEpoch = `sha256:${"d".repeat(64)}`;
const receiptBoundReleaseId = "release:candidate:receipt-bound-test";
const receiptBoundRoots = Object.values(RC54_ROOTS).map((root) => ({
  slug: root.slug,
  accountId: root.accountId,
  quantity: root.quantity,
  managerProfileId: root.managerProfileId,
  managerVersion: `sha256:${root.managerVersion}`,
  channelSpecContentHash: `sha256:${root.channelVersion}`,
  configurationEpochId: receiptBoundEpoch,
  maxEntriesPerSession: root.slug === "pb-ride" ? 3 : 1,
}));
const receiptBoundEvents = [event(
  `stream: rc54-release ACTIVE ${receiptBoundReleaseId} config=sha256:${receiptBoundHash}`,
  {
    state: "receipt-bound",
    paperOnly: true,
    releaseId: receiptBoundReleaseId,
    manifestContentHash: `sha256:${receiptBoundHash}`,
    configurationEpochId: receiptBoundEpoch,
    activationReceiptId: "activation-receipt-test",
    workerCompatibilityVersion: RC54_WORKER_VERSION,
    roots: receiptBoundRoots,
  },
)];
const receiptBound = deriveChannelPassports({
  channels: [channel("pb-ride"), channel("pb-ride-2")],
  events: receiptBoundEvents,
  signals: [], positions: [], recentTrades: [], evidenceBySlug: {},
});
assert.equal(receiptBound.release.state, "verified");
assert.equal(receiptBound.release.expectedHash, receiptBoundHash);
assert.equal(receiptBound.release.releaseId, receiptBoundReleaseId);
assert.equal(receiptBound.roots, 1);
assert.equal(receiptBound.dark, 1);
assert.equal(receiptBound.bySlug["pb-ride"].lifecycle, "paper-root");
assert.equal(receiptBound.bySlug["pb-ride"].rootPolicy, null);
assert.match(receiptBound.bySlug["pb-ride"].lifecycleFact, /immutable activation receipt/i);
assert.equal(receiptBound.bySlug["pb-ride-2"].lifecycle, "dark-evidence");

const invalidReceiptBound = deriveChannelPassports({
  channels: [channel("pb-ride")],
  events: [event(
    `stream: rc54-release ACTIVE ${receiptBoundReleaseId} config=sha256:${receiptBoundHash}`,
    {
      ...receiptBoundEvents[0].meta,
      roots: receiptBoundRoots.map((root) =>
        root.slug === "pb-ride" ? { ...root, accountId: "mutable-account-route" } : root),
    },
  )],
  signals: [], positions: [], recentTrades: [], evidenceBySlug: {},
});
assert.equal(invalidReceiptBound.release.state, "mismatch");
assert.equal(invalidReceiptBound.bySlug["pb-ride"].lifecycle, "unverified");

// Keep browser code free of worker/Node dependencies, but pin every displayed
// release field to the sealed machine receipts so a future RC cannot silently
// make the dashboard lie.
const prereg = JSON.parse(readFileSync(new URL("../../docs/weekend-day1-rc5-preregistration-receipt-2026-07-17.json", import.meta.url), "utf8"));
const hotfix = JSON.parse(readFileSync(new URL("../../docs/weekend-day1-rc5-3-operational-hotfix-2026-07-20.json", import.meta.url), "utf8"));
const sealed = prereg.content.evidence.releaseConfiguration;
assert.equal(DAY1_RELEASE_ID, hotfix.releaseId);
assert.equal(DAY1_CONFIG_HASH, hotfix.releaseConfigurationSha256);
assert.equal(DAY1_WORKER_VERSION, hotfix.workerVersion);
assert.equal(hotfix.strategyConfigurationChanged, false);
assert.deepEqual(DAY1_MANAGER_ARMS, sealed.management.shadowManagerArms);
assert.deepEqual(DAY1_ROOTS["momo-shape"].givebackTrail, hotfix.executableMomoRatchet);
assert.equal(DAY1_ROOTS["pb-ride"].givebackTrail, null);
assert.equal(Object.keys(DAY1_ROOTS).length, prereg.content.roots.length);
for (const sealedRoot of prereg.content.roots) {
  const clientRoot = DAY1_ROOTS[sealedRoot.slug];
  assert.equal(clientRoot.slug, sealedRoot.slug);
  assert.equal(clientRoot.familyId, sealedRoot.familyId);
  assert.equal(clientRoot.underlying, sealedRoot.underlying);
  assert.equal(clientRoot.priority, sealedRoot.priority);
  assert.equal(clientRoot.quantity, sealedRoot.quantity);
  assert.equal(clientRoot.entryDte, sealedRoot.entryDte);
  assert.equal(clientRoot.premiumCap, sealedRoot.premiumCap);
  assert.equal(clientRoot.aggregateDebitCap, sealedRoot.aggregateDebitCap);
  assert.equal(clientRoot.riskBudgetUsd, sealedRoot.policyIdentity.policyJson.channel.riskBudgetUsd);
  const binding = hotfix.rootBindings.find((row: { slug: string }) => row.slug === sealedRoot.slug);
  assert.ok(binding);
  assert.equal(clientRoot.accountId, binding.accountId);
  assert.equal(clientRoot.accountName, sealedRoot.account.name);
  assert.equal(clientRoot.channelVersion, binding.channelVersion.replace("sha256:", ""));
  assert.equal(clientRoot.configurationEpochId, binding.configurationEpoch.replace("sha256:", ""));
  assert.equal(clientRoot.managerVersion, binding.managerVersion.replace("sha256:", ""));
  assert.equal(clientRoot.policyEpochId, binding.policyEpoch);
}

// Pin the browser presentation to the worker sources without importing the
// worker graph into Next's typecheck. A direct import reaches worker-only
// dependencies such as dotenv even though the runtime UI is client-safe.
const rc54PolicySource = readFileSync(new URL("../../worker/src/rc54ReleasePolicy.ts", import.meta.url), "utf8");
const rc54ManagerSource = readFileSync(new URL("../../worker/src/rc54ManagerPolicy.ts", import.meta.url), "utf8");
const rc54VersionSource = readFileSync(new URL("../../worker/src/version.ts", import.meta.url), "utf8");
const rc54Dossier = readFileSync(new URL("../../docs/rc54-release-candidate-2026-07-27.md", import.meta.url), "utf8");
assert.match(rc54PolicySource, new RegExp(`RC54_RELEASE_ID = "${RC54_RELEASE_ID}"`));
assert.ok(rc54PolicySource.includes(`configurationSha256: RC54_RELEASE_CONFIGURATION_SHA256`));
assert.ok(rc54VersionSource.includes(`RC54_WORKER_VERSION = "${RC54_WORKER_VERSION}"`));
assert.ok(rc54Dossier.includes(`\`${RC54_CONFIG_HASH}\``));
assert.equal(Object.keys(RC54_ROOTS).length, 9);
for (const clientRoot of Object.values(RC54_ROOTS)) {
  assert.ok(rc54PolicySource.includes(`slug: "${clientRoot.slug}"`));
  assert.ok(rc54PolicySource.includes(`familyId: "${clientRoot.familyId}"`));
  assert.ok(rc54PolicySource.includes(`managerProfileId: "${clientRoot.managerProfileId}"`));
  assert.ok(rc54PolicySource.includes(`channelVersion: "sha256:${clientRoot.channelVersion}"`));
  assert.ok(rc54PolicySource.includes(`managerVersion: "sha256:${clientRoot.managerVersion}"`));
  assert.ok(rc54PolicySource.includes(`configurationEpoch: "sha256:${clientRoot.configurationEpochId}"`));
  assert.ok(rc54PolicySource.includes(`policyEpoch: "${clientRoot.policyEpochId}"`));
  assert.ok(rc54ManagerSource.includes(`"${clientRoot.managerProfileId}": {`));
  assert.ok(rc54Dossier.includes(`\`${clientRoot.slug}\``));
  assert.equal(clientRoot.riskBudgetUsd, clientRoot.aggregateDebitCap * 0.30);
}

const databaseConfig = {
  capital_pct: 1_200,
  aggression: 1,
  max_contracts: 10,
  daily_stop_usd: 3_000,
  daily_target_usd: 2_000,
  muted: true,
  soloed: true,
  boosted: true,
  executor: "cron" as const,
  event_policy: "ignore" as const,
  entry_dte: 0,
  strike_offset: 1,
  premium_stop_pct: 50,
  take_profit_pct: 10,
  underlying_stop_pct: 0.35,
  pyramid_adds: 3,
  stall_minutes: 15,
  stall_max_favor_pct: 10,
};
const runtimeConfig = activeRootRuntimeConfig(databaseConfig, RC54_ROOTS["pb-ride"]);
assert.equal(runtimeConfig.capital_pct, 210);
assert.equal(runtimeConfig.max_contracts, 2);
assert.equal(runtimeConfig.daily_stop_usd, 0);
assert.equal(runtimeConfig.entry_dte, 1);
assert.equal(runtimeConfig.premium_stop_pct, 30);
assert.equal(runtimeConfig.take_profit_pct, 0);
assert.equal(runtimeConfig.underlying_stop_pct, 0);
assert.equal(runtimeConfig.event_policy, "standdown");
assert.equal(runtimeConfig.muted, false);
assert.equal(runtimeConfig.boosted, false);
assert.equal(runtimeConfig.pyramid_adds, 0);

console.log("channel-passport-selftest: RC5.3 + RC5.4 contracts passed");
