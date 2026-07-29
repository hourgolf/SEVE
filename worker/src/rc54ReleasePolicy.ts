// RC5.4 paper release candidate. Pure and default-off: no broker, database,
// timer, environment, or execution access lives in this module.

import { createHash } from "node:crypto";
import type { ShadowDecision } from "./decide.js";
import type { AccountRow, ChannelConfig, PositionRow } from "./store.js";
import {
  buildAdmissionDomainsState,
  finalizeAdmissionDomains,
  type AdmissionDomainOccupancy,
  type AdmissionDomainPolicy,
  type AdmissionDomainSessionEntry,
} from "./admissionDomainModel.js";
import {
  RC54_MANAGER_POLICY_VERSION,
  RC54_MANAGER_PROFILES,
  type Rc54ManagerProfileId,
} from "./rc54ManagerPolicy.js";
import {
  RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION,
  type ReleaseEvidenceContext,
} from "./releaseEvidenceContext.js";
import { MANAGER_SHADOW_BOOK_VERSION } from "./managerShadowBookModel.js";
import { observedPolicyIdentity } from "./planShadowModel.js";
import {
  DAY1_DARK_CHANNELS,
  DAY1_ROOTS,
  DAY1_SEALED_RUNTIME_POSTURE,
  type Day1RuntimePostureInput,
} from "./day1ReleasePolicy.js";

export const RC54_RELEASE_SCHEMA_VERSION = 1 as const;
export const RC54_RELEASE_ID = "week2-2026-07-27-rc5.4" as const;
export const RC54_COHORT_ID = "rc54-executable-2026-07-27" as const;
export const RC54_COHORT_FROM = "2026-07-27" as const;
export const RC54_CONTROL_DOMAIN = "rc54-control" as const;
export const RC54_LAB_DOMAIN = "rc54-lab" as const;
export const RC54_LAB_ACCOUNT_ID = "56daa293-e6bc-447d-83ac-2bfafb4d0ac1" as const;

export const RC54_ROOTS = [
  {
    slug: "pb-ride", cohort: "control", domainId: RC54_CONTROL_DOMAIN,
    familyId: "SPY-PB", underlying: "SPY", priority: 1,
    entryDte: 1, strikeOffset: 0, quantity: 2, premiumCap: 3.50, aggregateDebitCap: 700,
    managerProfileId: "RC53-RIDE",
    strategistId: "4528343d-7151-46ae-8f0d-10c0ef9572b4",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7",
  },
  {
    slug: "orb-ustop-ctl", cohort: "control", domainId: RC54_CONTROL_DOMAIN,
    familyId: "SPY-ORB", underlying: "SPY", priority: 4,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 2.00, aggregateDebitCap: 400,
    managerProfileId: "ORB54-B30-A13",
    strategistId: "51ab6380-e0db-4e41-ad59-625b151cb9cf",
    accountId: "995aa327-b0da-4050-bede-97ab462b06cd",
  },
  {
    slug: "grind-v3", cohort: "control", domainId: RC54_CONTROL_DOMAIN,
    familyId: "SPY-GRIND", underlying: "SPY", priority: 2,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.75, aggregateDebitCap: 350,
    managerProfileId: "RC53-RIDE",
    strategistId: "1dc15beb-79a5-4f49-9b9b-9b5693c93561",
    accountId: "995aa327-b0da-4050-bede-97ab462b06cd",
  },
  {
    // Exact replay correction: the clean booked cohort favored the existing
    // full-position A13 over B30/A13 by $65. MOMO therefore does not split.
    slug: "momo-shape", cohort: "control", domainId: RC54_CONTROL_DOMAIN,
    familyId: "SPY-MOMO", underlying: "SPY", priority: 3,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 2.25, aggregateDebitCap: 450,
    managerProfileId: "RC53-A13",
    strategistId: "c2efcffa-b0bb-4cde-a3de-25209879ebe1",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7",
  },
  {
    slug: "orb-qqq-trail", cohort: "control", domainId: RC54_CONTROL_DOMAIN,
    familyId: "QQQ-ORB", underlying: "QQQ", priority: 1,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 3.00, aggregateDebitCap: 600,
    managerProfileId: "QQQ54-B20-NATIVE-ATR",
    strategistId: "62b108c8-535e-4232-8c68-af8fb5b8f932",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7",
  },
  {
    slug: "breakout-alt-v3-iwm", cohort: "control", domainId: RC54_CONTROL_DOMAIN,
    familyId: "IWM-BREAKOUT", underlying: "IWM", priority: 1,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.25, aggregateDebitCap: 250,
    managerProfileId: "RC53-RIDE",
    strategistId: "24889b0e-3ba7-4e47-9430-f73aa2c764a4",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7",
  },
  {
    slug: "vb-macd-state", cohort: "lab", domainId: RC54_LAB_DOMAIN,
    familyId: "LAB-SPY-MACD", underlying: "SPY", priority: 1,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.75, aggregateDebitCap: 350,
    managerProfileId: "LAB54-L30-L50",
    strategistId: "3f75e694-34c3-4b68-8832-4351ce1af180",
    accountId: RC54_LAB_ACCOUNT_ID,
  },
  {
    slug: "vb-squeeze-break", cohort: "lab", domainId: RC54_LAB_DOMAIN,
    familyId: "LAB-SPY-SQUEEZE", underlying: "SPY", priority: 2,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.75, aggregateDebitCap: 350,
    managerProfileId: "LAB54-L30-L50",
    strategistId: "d73d9b4c-c57e-4d24-b899-53e31df2cf9a",
    accountId: RC54_LAB_ACCOUNT_ID,
  },
  {
    slug: "vb-ribbon-cross-qqq", cohort: "lab", domainId: RC54_LAB_DOMAIN,
    familyId: "LAB-QQQ-RIBBON", underlying: "QQQ", priority: 1,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.75, aggregateDebitCap: 350,
    managerProfileId: "LAB54-B50-A13",
    strategistId: "7a5191f4-013f-48d2-b1b8-de548c12861d",
    accountId: RC54_LAB_ACCOUNT_ID,
  },
] as const satisfies readonly {
  slug: string;
  cohort: "control" | "lab";
  domainId: typeof RC54_CONTROL_DOMAIN | typeof RC54_LAB_DOMAIN;
  familyId: string;
  underlying: "SPY" | "QQQ" | "IWM";
  priority: number;
  entryDte: 0 | 1;
  strikeOffset: number;
  quantity: 2;
  premiumCap: number;
  aggregateDebitCap: number;
  managerProfileId: Rc54ManagerProfileId;
  strategistId: string;
  accountId: string;
}[];

export type Rc54Root = typeof RC54_ROOTS[number];
export type Rc54RootSlug = Rc54Root["slug"];

const rootBySlug = new Map<string, Rc54Root>(
  RC54_ROOTS.map((root) => [root.slug, root]),
);

export function rc54Root(slug: string): Rc54Root | null {
  return rootBySlug.get(slug.toLowerCase()) ?? null;
}

export function rc54ManagerProfileId(slug: string): Rc54ManagerProfileId | null {
  return rc54Root(slug)?.managerProfileId ?? null;
}

/**
 * The temporary release adapter owns RC5.4 topology and admission mechanics,
 * while the economics may come from either the sealed RC5.4 constants or one
 * receipt-bound manifest. Keeping this interface local to the admission layer
 * prevents the generic control plane from importing RC5.4.
 */
export interface Rc54AdmissionRoot {
  slug: string;
  domainId: string;
  familyId: string;
  underlying: string;
  quantity: number;
  premiumCap: number;
  aggregateDebitCap: number;
  managerProfileId: string;
  accountId: string;
  bankTargetPct: number | null;
  runnerKind: "none" | "a13" | "fixed-target" | "native-atr";
  configurationEpochId?: string | null;
}

export type Rc54AdmissionRootResolver = (
  slug: string,
) => Readonly<Rc54AdmissionRoot> | null;

export interface Rc54AdmissionCandidateIdentity {
  releaseId: string;
  configurationSha256: string;
  cohortId: string;
  cohortFrom: string;
}

function sealedRc54AdmissionRoot(slug: string): Readonly<Rc54AdmissionRoot> | null {
  const root = rc54Root(slug);
  if (!root) return null;
  const manager = RC54_MANAGER_PROFILES[root.managerProfileId];
  return {
    slug: root.slug,
    domainId: root.domainId,
    familyId: root.familyId,
    underlying: root.underlying,
    quantity: root.quantity,
    premiumCap: root.premiumCap,
    aggregateDebitCap: root.aggregateDebitCap,
    managerProfileId: root.managerProfileId,
    accountId: root.accountId,
    bankTargetPct: manager.bankTargetPct,
    runnerKind: manager.runner === "fixed-50"
      ? "fixed-target"
      : manager.runner,
    configurationEpochId: null,
  };
}

function admissionRoot(
  slug: string,
  resolver?: Rc54AdmissionRootResolver,
): Readonly<Rc54AdmissionRoot> | null {
  return resolver ? resolver(slug) : sealedRc54AdmissionRoot(slug);
}

export const RC54_CONTROL_ADMISSION_POLICY: AdmissionDomainPolicy = {
  id: RC54_CONTROL_DOMAIN,
  enabledForNewEntries: true,
  maxOpenPerFamily: 1,
  maxOpenByUnderlying: { SPY: 2, QQQ: 1, IWM: 1 },
  maxOpenGlobal: 4,
  sameOccOpenMax: 1,
  reentry: "disabled",
  sameClockMaxByUnderlying: { SPY: 1, QQQ: 1, IWM: 1 },
  priorityBySlug: Object.fromEntries(
    RC54_ROOTS.filter((root) => root.cohort === "control")
      .map((root) => [root.slug, root.priority]),
  ),
  crossDomainSameOcc: "allow-with-receipt",
};

export const RC54_LAB_ADMISSION_POLICY: AdmissionDomainPolicy = {
  id: RC54_LAB_DOMAIN,
  enabledForNewEntries: true,
  maxOpenPerFamily: 1,
  maxOpenByUnderlying: { SPY: 1, QQQ: 1, IWM: 0 },
  maxOpenGlobal: 2,
  sameOccOpenMax: 1,
  reentry: "disabled",
  sameClockMaxByUnderlying: { SPY: 1, QQQ: 1, IWM: 0 },
  priorityBySlug: Object.fromEntries(
    RC54_ROOTS.filter((root) => root.cohort === "lab")
      .map((root) => [root.slug, root.priority]),
  ),
  crossDomainSameOcc: "allow-with-receipt",
};

/** SELECT-only-derived identities for the exact overlaid nine-root roster.
 * These are checked startup authority; they do not claim the persisted rows
 * have already been changed to RC5.4. */
export const RC54_ROOT_IDENTITY_SEAL = [
  {
    slug: "pb-ride",
    strategistId: "4528343d-7151-46ae-8f0d-10c0ef9572b4",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7",
    accountMode: "paper",
    channelVersion: "sha256:5559f360a30db2aa94c9e3cefb954d7ff69373ed856a086c46a27bd41e1721ea",
    managerVersion: "sha256:6f6ce7c9a07dc751cc4bf165248df8bed17e416d31b565f0fcc25663aed1c21b",
    configurationEpoch: "sha256:7e92867cfc3ea19d32448202b137462b8c415c641719d8a719b9ed3b4c00905b",
    policyEpoch: "bd3720ab-bced-5bbd-9774-c6c96a083a5d",
  },
  {
    slug: "orb-ustop-ctl",
    strategistId: "51ab6380-e0db-4e41-ad59-625b151cb9cf",
    accountId: "995aa327-b0da-4050-bede-97ab462b06cd",
    accountMode: "paper",
    channelVersion: "sha256:54d7feede491bc3c6754e8cf501e777584ce9fa2e0ce6e4162c9b24858e7a57c",
    managerVersion: "sha256:73f4e0653c590eb1826c7c03a55bf161a565428f12b682c3ae43603485fb28d5",
    configurationEpoch: "sha256:e791afc597c5fca63d04285855d810c1972af6a35ad971afcc20d7b66c4a888d",
    policyEpoch: "8de26b28-3de3-5de5-9c90-410690bd3f7c",
  },
  {
    slug: "grind-v3",
    strategistId: "1dc15beb-79a5-4f49-9b9b-9b5693c93561",
    accountId: "995aa327-b0da-4050-bede-97ab462b06cd",
    accountMode: "paper",
    channelVersion: "sha256:52ba206051f316be8df6b9c6b05d4ba67406e112772ba72a28e85c1b9f5819f2",
    managerVersion: "sha256:6f6ce7c9a07dc751cc4bf165248df8bed17e416d31b565f0fcc25663aed1c21b",
    configurationEpoch: "sha256:38cd298d78339cf85000e512427d1e493ba4fda037f00c5861b811fbd840d4e9",
    policyEpoch: "66faef66-ec9a-5451-991a-7fabd5def661",
  },
  {
    slug: "momo-shape",
    strategistId: "c2efcffa-b0bb-4cde-a3de-25209879ebe1",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7",
    accountMode: "paper",
    channelVersion: "sha256:09f04815385597ebec13f4c75e997a123d7dfda0e11145896a7aa4b7c157806c",
    managerVersion: "sha256:c01d2380b0c462ae2b1cd8cf9e9e9bdb18c0b22fcfb36ad0e976d6d69bf4c1d6",
    configurationEpoch: "sha256:2b14c6b62b70c87e1895ab82ec6a2d71f1d24f01789f2874eee04f52baa228c4",
    policyEpoch: "54a87863-e201-582e-a8a2-25f00c795cb0",
  },
  {
    slug: "orb-qqq-trail",
    strategistId: "62b108c8-535e-4232-8c68-af8fb5b8f932",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7",
    accountMode: "paper",
    channelVersion: "sha256:b28166ce917ab8eb638c734e05b661166c84b02ae2272c39002303b0d380d69b",
    managerVersion: "sha256:51f6cd029e46a4c512458b95bf5982c39d460a2dc874af2a80b372f069ee843a",
    configurationEpoch: "sha256:2912932f101f7c2539bb699ac4f438769af2f92930fff44db83b01bcb7b0063e",
    policyEpoch: "28ec5811-7aa8-574b-a468-0724a55129c7",
  },
  {
    slug: "breakout-alt-v3-iwm",
    strategistId: "24889b0e-3ba7-4e47-9430-f73aa2c764a4",
    accountId: "cd817549-e025-4d38-805e-d32e607052f7",
    accountMode: "paper",
    channelVersion: "sha256:945dcd65ffb41d5c67bae84e416ce7765e26d70cd2e055ae39aca998393d6525",
    managerVersion: "sha256:6f6ce7c9a07dc751cc4bf165248df8bed17e416d31b565f0fcc25663aed1c21b",
    configurationEpoch: "sha256:f202c25c523e5569e5aa8e3cf99c1f5b86f02ce3eb9b1eeb09e30848281a3b9c",
    policyEpoch: "a56543c2-7fad-59ea-bcad-361ab01bcf7b",
  },
  {
    slug: "vb-macd-state",
    strategistId: "3f75e694-34c3-4b68-8832-4351ce1af180",
    accountId: RC54_LAB_ACCOUNT_ID,
    accountMode: "paper",
    channelVersion: "sha256:00347e4f8cf91201cc33976b5a18aeef85e6345ac91d5e4978543b878b5a3ddd",
    managerVersion: "sha256:f7ae1cbe1567463ecc08854f860af0bf109c658955cb1cf41b2cab1db781c64a",
    configurationEpoch: "sha256:81f1900507582f5a4c975fb751705217d2ed9b444d5308528fd1c0098d560a43",
    policyEpoch: "8e34a319-dfe7-5362-9007-036457755be9",
  },
  {
    slug: "vb-squeeze-break",
    strategistId: "d73d9b4c-c57e-4d24-b899-53e31df2cf9a",
    accountId: RC54_LAB_ACCOUNT_ID,
    accountMode: "paper",
    channelVersion: "sha256:9583c61606f17f6cf88bf8385fab58c13c33530fa53cf8f96a3075759f2b05c2",
    managerVersion: "sha256:f7ae1cbe1567463ecc08854f860af0bf109c658955cb1cf41b2cab1db781c64a",
    configurationEpoch: "sha256:2ea94165f3be56aad496eb8a21a91eab7b739d8f123ca630d5c9aa12dc8295d7",
    policyEpoch: "8e372cb8-f6c5-5f7b-8895-1378a94f53ed",
  },
  {
    slug: "vb-ribbon-cross-qqq",
    strategistId: "7a5191f4-013f-48d2-b1b8-de548c12861d",
    accountId: RC54_LAB_ACCOUNT_ID,
    accountMode: "paper",
    channelVersion: "sha256:df470a877dd557976710e24e256ff04e1f6d7bc303215e600fda852f95874f37",
    managerVersion: "sha256:bb4bd167538d4b946855a93ddfac334061c02d73ecf1e8e4a2b7c044df54197c",
    configurationEpoch: "sha256:4573e756b3644ca8a201ad6a8e5127ec609712dc8745d28db7a26c8e296ae5d5",
    policyEpoch: "c8eb9055-74b0-5969-be51-e5f51ea8546a",
  },
] as const;

export const RC54_RELEASE_CONFIGURATION = {
  schemaVersion: RC54_RELEASE_SCHEMA_VERSION,
  releaseId: RC54_RELEASE_ID,
  cohortId: RC54_COHORT_ID,
  cohortFrom: RC54_COHORT_FROM,
  mode: "paper-only",
  roots: RC54_ROOTS,
  rootIdentitySeal: RC54_ROOT_IDENTITY_SEAL,
  management: {
    policyVersion: RC54_MANAGER_POLICY_VERSION,
    profiles: RC54_MANAGER_PROFILES,
    priceBasis: "executable-option-bid",
    catastropheStopPct: 30,
    admissionStopEt: "15:25",
    liquidationEt: "15:25",
    reentry: "disabled",
    adds: 0,
    pyramiding: 0,
  },
  admission: {
    policies: [RC54_CONTROL_ADMISSION_POLICY, RC54_LAB_ADMISSION_POLICY],
    globalBrokerTruthRequired: true,
    crossDomainSameOccIndependentPortfolioClaim: false,
    crossDomainCovarianceReceiptRequired: true,
  },
  evidence: {
    contextSchemaVersion: RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION,
    shadowBookVersion: MANAGER_SHADOW_BOOK_VERSION,
    heldCaptureRequired: true,
    managerShadowRequired: true,
    manualCloseAttributionRequired: true,
    historicalEraPoolingAuthorized: false,
  },
  authority: {
    liveMoneyAuthorized: false,
    automaticPromotionAuthorized: false,
    migrationAuthorized: false,
    deploymentAuthorized: false,
  },
} as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => `${JSON.stringify(name)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const RC54_RELEASE_CONFIGURATION_JSON = canonical(RC54_RELEASE_CONFIGURATION);
export const RC54_RELEASE_CONFIGURATION_SHA256 = createHash("sha256")
  .update(RC54_RELEASE_CONFIGURATION_JSON).digest("hex");

export function rc54ReleaseEvidenceContext(root: Rc54Root): ReleaseEvidenceContext {
  return {
    schemaVersion: RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION,
    releaseId: RC54_RELEASE_ID,
    configurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
    admissionDomain: root.domainId,
    cohortId: RC54_COHORT_ID,
    cohortFrom: RC54_COHORT_FROM,
    evidenceEra: root.cohort === "lab" ? "lab-executable" : "rc54-control",
    sourceQuantity: root.quantity,
    shadowBookVersion: MANAGER_SHADOW_BOOK_VERSION,
  };
}

/** Apply the sealed RC5.4 runtime view without mutating persisted config. */
export function applyRc54ReleaseChannelOverlay(channel: ChannelConfig): ChannelConfig {
  const root = rc54Root(channel.slug);
  if (!root) return channel;
  const profile = RC54_MANAGER_PROFILES[root.managerProfileId];
  return {
    ...channel,
    status: "armed",
    is_active: true,
    executor: "stream",
    account_id: root.accountId,
    underlying: root.underlying,
    capital_pct: root.aggregateDebitCap * 0.30,
    aggression: 0,
    max_contracts: root.quantity,
    daily_stop_usd: 0,
    daily_target_usd: 0,
    underlying_stop_pct: 0,
    muted: false,
    soloed: false,
    boosted: false,
    event_policy: "standdown",
    entry_dte: root.entryDte,
    strike_offset: root.strikeOffset,
    premium_stop_pct: profile.catastropheStopPct,
    take_profit_pct: profile.bankTargetPct ?? 0,
    pyramid_adds: 0,
    stall_minutes: 0,
    stall_max_favor_pct: 0,
    gap_min: 0,
    runner_frac: profile.runnerFraction,
    runner_giveback_pct: 0,
  };
}

export function applyRc54ReleaseFleetOverlay(
  channels: readonly ChannelConfig[],
): ChannelConfig[] {
  const present = new Set(channels.map((channel) => channel.slug));
  const missing = RC54_ROOTS.filter((root) => !present.has(root.slug))
    .map((root) => root.slug);
  if (missing.length) throw new Error(`RC5.4 release missing roots: ${missing.join(",")}`);
  return channels.map(applyRc54ReleaseChannelOverlay);
}

export function validateRc54SourceExecutorBoundary(
  channels: readonly Pick<ChannelConfig, "id" | "slug" | "executor" | "status" | "muted" | "account_id">[],
): string[] {
  const errors: string[] = [];
  for (const channel of channels) {
    const root = rc54Root(channel.slug);
    if (root) {
      if (channel.id !== root.strategistId) errors.push(`${channel.slug}:strategist_identity`);
      if (channel.executor !== "stream") errors.push(`${channel.slug}:source_executor_not_stream`);
      if (channel.account_id !== root.accountId) errors.push(`${channel.slug}:source_account_binding`);
      continue;
    }
    if (channel.executor === "cron" && channel.status === "armed" && !channel.muted) {
      errors.push(`${channel.slug}:dark_cron_entry_gate_open`);
    }
  }
  return errors.sort();
}

export function validateRc54AccountBindings(accounts: readonly AccountRow[]): string[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const errors: string[] = [];
  for (const root of RC54_ROOTS) {
    const account = byId.get(root.accountId);
    if (!account) errors.push(`${root.slug}:account_missing`);
    else if (account.mode.toLowerCase() !== "paper") errors.push(`${root.slug}:account_not_paper`);
  }
  return [...new Set(errors)].sort();
}

export function validateRc54IdentitySeal(input: {
  channels: readonly ChannelConfig[];
  workerVersion: string;
}): string[] {
  const channelBySlug = new Map(
    applyRc54ReleaseFleetOverlay(input.channels).map((channel) => [channel.slug, channel]),
  );
  const errors: string[] = [];
  for (const sealed of RC54_ROOT_IDENTITY_SEAL) {
    const channel = channelBySlug.get(sealed.slug);
    if (!channel) {
      errors.push(`${sealed.slug}:channel_missing`);
      continue;
    }
    const identity = observedPolicyIdentity({
      channel,
      accountId: sealed.accountId,
      workerVersion: input.workerVersion,
      executableManagerProfile: rc54ManagerProfileId(sealed.slug),
    });
    if (!identity) {
      errors.push(`${sealed.slug}:identity_unavailable`);
      continue;
    }
    if (identity.channelVersion !== sealed.channelVersion) errors.push(`${sealed.slug}:channel_version`);
    if (identity.managerVersion !== sealed.managerVersion) errors.push(`${sealed.slug}:manager_version`);
    if (identity.configurationEpochId !== sealed.configurationEpoch) {
      errors.push(`${sealed.slug}:configuration_epoch`);
    }
    if (identity.policyEpochId !== sealed.policyEpoch) errors.push(`${sealed.slug}:policy_epoch`);
  }
  return errors.sort();
}

export interface Rc54BrokerHolding {
  accountId: string;
  occSymbol: string;
  underlying: string;
  quantity: number;
}

export interface Rc54PendingOrderOccupancy {
  accountId: string;
  occSymbol: string;
  underlying: string;
}

export interface Rc54SnapshotFailure {
  accountId: string;
  kind: "account" | "positions" | "account-group-missing";
}

const rc54DomainForAccount = (accountId: string): string =>
  accountId === RC54_LAB_ACCOUNT_ID ? RC54_LAB_DOMAIN : RC54_CONTROL_DOMAIN;

/** Convert desk rows plus broker-only or quantity-uncovered lots into the
 * conservative occupancy model used by both RC5.4 admission domains. */
export function buildRc54AdmissionOccupancy(input: {
  openPositions: readonly PositionRow[];
  sessionPositions: readonly PositionRow[];
  channelById: ReadonlyMap<string, Pick<ChannelConfig, "slug" | "underlying">>;
  accountIdByStrategist: ReadonlyMap<string, string>;
  brokerPositions: readonly Rc54BrokerHolding[];
  pendingOrders: readonly Rc54PendingOrderOccupancy[];
}): {
  open: AdmissionDomainOccupancy[];
  sessionEntries: AdmissionDomainSessionEntry[];
} {
  const open: AdmissionDomainOccupancy[] = [];
  const sessionEntries: AdmissionDomainSessionEntry[] = [];
  const deskQuantityByAccountOcc = new Map<string, number>();
  const occupiedByAccountOcc = new Set<string>();

  for (const row of input.openPositions) {
    const channel = input.channelById.get(row.strategist_id);
    const root = channel ? rc54Root(channel.slug) : null;
    const accountId = input.accountIdByStrategist.get(row.strategist_id) ?? "";
    const occ = row.occ_symbol.toUpperCase();
    const key = `${accountId}|${occ}`;
    deskQuantityByAccountOcc.set(
      key,
      (deskQuantityByAccountOcc.get(key) ?? 0) + Math.abs(row.qty),
    );
    occupiedByAccountOcc.add(key);
    const domainIds = root
      ? [root.domainId]
      : accountId
        ? [rc54DomainForAccount(accountId)]
        // Unknown-account desk truth cannot safely be assigned to one isolated
        // book. Consume capacity in both domains until routing is proven.
        : [RC54_CONTROL_DOMAIN, RC54_LAB_DOMAIN];
    for (const domainId of domainIds) {
      open.push({
        domainId,
        accountId,
        // An unexpected/open dark row still consumes conservative capacity. It
        // cannot receive a root family identity or independent-portfolio claim.
        familyId: root?.familyId ?? `desk-unsealed:${row.strategist_id}`,
        underlying: (row.underlying || channel?.underlying || root?.underlying || "").toUpperCase(),
        occSymbol: occ,
      });
    }
  }

  for (const row of input.sessionPositions) {
    const channel = input.channelById.get(row.strategist_id);
    const root = channel ? rc54Root(channel.slug) : null;
    if (root) sessionEntries.push({ domainId: root.domainId, familyId: root.familyId });
  }

  for (const broker of input.brokerPositions) {
    const occ = broker.occSymbol.toUpperCase();
    const accountId = broker.accountId;
    const key = `${accountId}|${occ}`;
    const held = Math.abs(broker.quantity);
    const covered = deskQuantityByAccountOcc.get(key) ?? 0;
    if (!(held > 0) || !occ || covered >= held) continue;
    occupiedByAccountOcc.add(key);
    open.push({
      domainId: rc54DomainForAccount(accountId),
      accountId,
      familyId: `broker-uncovered:${accountId}:${occ}`,
      underlying: broker.underlying.toUpperCase(),
      occSymbol: occ,
    });
  }

  for (const order of input.pendingOrders) {
    const occ = order.occSymbol.toUpperCase();
    const key = `${order.accountId}|${occ}`;
    if (!occ || occupiedByAccountOcc.has(key)) continue;
    occupiedByAccountOcc.add(key);
    open.push({
      domainId: rc54DomainForAccount(order.accountId),
      accountId: order.accountId,
      familyId: `pending-order:${order.accountId}:${occ}`,
      underlying: order.underlying.toUpperCase(),
      occSymbol: occ,
    });
  }
  return { open, sessionEntries };
}

export interface Rc54ReleaseStartupInput {
  /** Raw persisted fleet; the validator applies the immutable overlay itself. */
  channels: readonly ChannelConfig[];
  accounts: readonly AccountRow[];
  fundMode: string | null;
  workerVersion: string;
  expectedConfigurationSha256: string;
  posture: Day1RuntimePostureInput;
  resolvedCredentialAccountIds: readonly string[];
  credentialRouteEvidenceBasis: "runtime-env-presence" | "offline-example-assumption";
  /** True only when the service-role write path is present. */
  paperExecutorWriteReady: boolean;
}

export interface Rc54ReleaseStartupResult {
  ok: boolean;
  errors: string[];
  activeSettingsReceipt: Record<string, unknown> | null;
}

export function rc54SourceFleetErrors(
  channels: readonly ChannelConfig[],
): string[] {
  const errors: string[] = [];
  const expectedSlugs = [
    ...DAY1_ROOTS.map((root) => root.slug),
    ...DAY1_DARK_CHANNELS,
  ];
  const expectedSet = new Set<string>(expectedSlugs);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const channel of channels) {
    if (seen.has(channel.slug)) duplicates.add(channel.slug);
    seen.add(channel.slug);
  }
  if (channels.length !== expectedSlugs.length) {
    errors.push(`fleet_count:${channels.length}`);
  }
  if (duplicates.size) {
    errors.push(`fleet_duplicate_slug:${[...duplicates].sort().join(",")}`);
  }
  const missing = expectedSlugs.filter((slug) => !seen.has(slug));
  const unexpected = [...seen].filter((slug) => !expectedSet.has(slug)).sort();
  if (missing.length) {
    errors.push(`fleet_missing_slug:${missing.sort().join(",")}`);
  }
  if (unexpected.length) {
    errors.push(`fleet_unexpected_slug:${unexpected.join(",")}`);
  }
  errors.push(...validateRc54SourceExecutorBoundary(channels));
  return [...new Set(errors)].sort();
}

function paperOrigin(host: string): { origin: string | null; hasCredentials: boolean } {
  try {
    const parsed = new URL(host);
    return {
      origin: parsed.origin,
      hasCredentials: !!parsed.username || !!parsed.password,
    };
  } catch {
    return { origin: null, hasCredentials: false };
  }
}

export function rc54PaperExecutorPostureErrors(input: {
  dryRun: boolean;
  liveTrading: boolean;
  paperExecutorWriteReady: boolean;
}): string[] {
  if (!input.dryRun && input.liveTrading && !input.paperExecutorWriteReady) {
    return ["paper_executor_write_posture"];
  }
  return [];
}

/**
 * Shared operational wall for both the sealed RC5.4 constants and a
 * receipt-bound successor that still runs through the temporary RC5.4
 * topology adapter. Economic identity is deliberately absent from this check.
 */
export function rc54OperationalPostureErrors(input: {
  fundMode: string | null;
  posture: Day1RuntimePostureInput;
  paperExecutorWriteReady: boolean;
  accounts: readonly AccountRow[];
  requiredAccountIds: readonly string[];
  resolvedCredentialAccountIds: readonly string[];
}): string[] {
  const errors: string[] = [];
  if ((input.fundMode ?? "").toLowerCase()
      !== DAY1_SEALED_RUNTIME_POSTURE.fundMode) {
    errors.push("fund_mode");
  }
  const host = paperOrigin(input.posture.alpacaPaperHost);
  if (host.origin !== DAY1_SEALED_RUNTIME_POSTURE.alpacaPaperOrigin
      || host.hasCredentials) {
    errors.push("alpaca_paper_origin");
  }
  if (input.posture.stockFeed !== DAY1_SEALED_RUNTIME_POSTURE.stockFeed) {
    errors.push("stock_feed");
  }
  if (input.posture.optionFeed !== DAY1_SEALED_RUNTIME_POSTURE.optionFeed) {
    errors.push("option_feed");
  }
  errors.push(...rc54PaperExecutorPostureErrors({
    dryRun: input.posture.dryRun,
    liveTrading: input.posture.liveTrading,
    paperExecutorWriteReady: input.paperExecutorWriteReady,
  }));

  const sealedCapture = DAY1_SEALED_RUNTIME_POSTURE.heldCapture;
  if (input.posture.heldCaptureEnabled !== sealedCapture.requiredEnabled) {
    errors.push("held_capture:enabled");
  }
  if (input.posture.heldCaptureEnabled) {
    const captureFields: [string, number, number][] = [
      ["flush_ms", input.posture.heldCaptureFlushMs, sealedCapture.flushMs],
      ["target_samples", input.posture.heldCaptureTargetSamples, sealedCapture.targetSamples],
      ["max_age_ms", input.posture.heldCaptureMaxAgeMs, sealedCapture.maxAgeMs],
      ["ingress_max_samples", input.posture.heldCaptureIngressMaxSamples, sealedCapture.ingressMaxSamples],
      ["ingress_max_bytes", input.posture.heldCaptureIngressMaxBytes, sealedCapture.ingressMaxBytes],
      ["state_max_samples", input.posture.heldCaptureStateMaxSamples, sealedCapture.stateMaxSamples],
      ["state_max_bytes", input.posture.heldCaptureStateMaxBytes, sealedCapture.stateMaxBytes],
      ["retry_max_attempts", input.posture.heldCaptureRetryMaxAttempts, sealedCapture.retryMaxAttempts],
      ["retry_base_delay_ms", input.posture.heldCaptureRetryBaseDelayMs, sealedCapture.retryBaseDelayMs],
      ["retry_max_delay_ms", input.posture.heldCaptureRetryMaxDelayMs, sealedCapture.retryMaxDelayMs],
      ["adapter_deadline_ms", input.posture.heldCaptureAdapterDeadlineMs, sealedCapture.adapterDeadlineMs],
      ["normal_flush_deadline_ms", input.posture.heldCaptureNormalFlushDeadlineMs, sealedCapture.normalFlushDeadlineMs],
      ["shutdown_deadline_ms", input.posture.heldCaptureShutdownDeadlineMs, sealedCapture.shutdownDeadlineMs],
    ];
    for (const [field, actual, expected] of captureFields) {
      if (actual !== expected) errors.push(`held_capture:${field}`);
    }
  }
  const sealedManager = DAY1_SEALED_RUNTIME_POSTURE.managerShadow;
  if (input.posture.managerShadowEnabled !== sealedManager.requiredEnabled) {
    errors.push("manager_shadow:enabled");
  }
  if (input.posture.managerShadowEnabled
      && input.posture.managerShadowQuoteMaxAgeMs
        !== sealedManager.quoteMaxAgeMs) {
    errors.push("manager_shadow:quote_max_age_ms");
  }

  const accountById = new Map(input.accounts.map((account) => [
    account.id,
    account,
  ]));
  const credentialAccounts = new Set(input.resolvedCredentialAccountIds);
  for (const accountId of [...new Set(input.requiredAccountIds)].sort()) {
    const account = accountById.get(accountId);
    if (!credentialAccounts.has(accountId)) {
      errors.push(`${accountId}:credential_route_unresolved`);
    }
    if (!input.posture.dryRun && input.posture.liveTrading) {
      if (!account?.is_armed) errors.push(`${accountId}:account_not_armed`);
      if (account?.is_halted) errors.push(`${accountId}:account_halted`);
    }
  }
  return [...new Set(errors)].sort();
}

/** Pure RC5.4 startup gate. This validates the raw source boundary before
 * deriving and identity-checking the in-memory release overlay. */
export function validateRc54ReleaseStartup(
  input: Rc54ReleaseStartupInput,
): Rc54ReleaseStartupResult {
  const errors: string[] = [];
  errors.push(...rc54SourceFleetErrors(input.channels));
  errors.push(...validateRc54AccountBindings(input.accounts));

  if (input.expectedConfigurationSha256 !== RC54_RELEASE_CONFIGURATION_SHA256) {
    errors.push("release_configuration_hash");
  }
  const host = paperOrigin(input.posture.alpacaPaperHost);
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const credentialAccounts = new Set(input.resolvedCredentialAccountIds);
  const requiredAccountIds = [...new Set(RC54_ROOTS.map((root) => root.accountId))].sort();
  errors.push(...rc54OperationalPostureErrors({
    fundMode: input.fundMode,
    posture: input.posture,
    paperExecutorWriteReady: input.paperExecutorWriteReady,
    accounts: input.accounts,
    requiredAccountIds,
    resolvedCredentialAccountIds: input.resolvedCredentialAccountIds,
  }));

  let overlaid: ChannelConfig[] = [];
  try {
    overlaid = applyRc54ReleaseFleetOverlay(input.channels);
    errors.push(...validateRc54IdentitySeal({
      channels: input.channels,
      workerVersion: input.workerVersion,
    }));
  } catch (cause) {
    errors.push(`release_overlay:${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const roots = RC54_ROOTS.map((root) => {
    const account = accountById.get(root.accountId);
    const channel = overlaid.find((candidate) => candidate.slug === root.slug);
    return {
      slug: root.slug,
      cohort: root.cohort,
      domainId: root.domainId,
      strategistId: channel?.id ?? null,
      accountId: root.accountId,
      accountName: account?.name ?? null,
      accountMode: account?.mode?.toLowerCase() ?? null,
      accountArmed: account?.is_armed ?? false,
      accountHalted: account?.is_halted ?? false,
      managerProfileId: root.managerProfileId,
      quantity: root.quantity,
      aggregateDebitCap: root.aggregateDebitCap,
    };
  });
  const receipt = errors.length ? null : {
    schemaVersion: RC54_RELEASE_SCHEMA_VERSION,
    workerVersion: input.workerVersion,
    releaseId: RC54_RELEASE_ID,
    cohortId: RC54_COHORT_ID,
    releaseConfigurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
    expectedConfigurationSha256: input.expectedConfigurationSha256,
    fundMode: input.fundMode,
    roots,
    credentialRouteEvidenceBasis: input.credentialRouteEvidenceBasis,
    accountRoutes: requiredAccountIds.map((accountId) => ({
      accountId,
      accountName: accountById.get(accountId)?.name ?? null,
      accountMode: accountById.get(accountId)?.mode?.toLowerCase() ?? null,
      resolved: credentialAccounts.has(accountId),
      rootSlugs: RC54_ROOTS.filter((root) => root.accountId === accountId)
        .map((root) => root.slug),
    })),
    alpacaPaperOrigin: host.origin,
    stockFeed: input.posture.stockFeed,
    optionFeed: input.posture.optionFeed,
    dryRun: input.posture.dryRun,
    liveTrading: input.posture.liveTrading,
    heldCapture: {
      enabled: input.posture.heldCaptureEnabled,
      flushMs: input.posture.heldCaptureFlushMs,
      targetSamples: input.posture.heldCaptureTargetSamples,
      maxAgeMs: input.posture.heldCaptureMaxAgeMs,
      ingressMaxSamples: input.posture.heldCaptureIngressMaxSamples,
      ingressMaxBytes: input.posture.heldCaptureIngressMaxBytes,
      stateMaxSamples: input.posture.heldCaptureStateMaxSamples,
      stateMaxBytes: input.posture.heldCaptureStateMaxBytes,
      retryMaxAttempts: input.posture.heldCaptureRetryMaxAttempts,
      retryBaseDelayMs: input.posture.heldCaptureRetryBaseDelayMs,
      retryMaxDelayMs: input.posture.heldCaptureRetryMaxDelayMs,
      adapterDeadlineMs: input.posture.heldCaptureAdapterDeadlineMs,
      normalFlushDeadlineMs: input.posture.heldCaptureNormalFlushDeadlineMs,
      shutdownDeadlineMs: input.posture.heldCaptureShutdownDeadlineMs,
    },
    managerShadow: {
      enabled: input.posture.managerShadowEnabled,
      quoteMaxAgeMs: input.posture.managerShadowQuoteMaxAgeMs,
    },
    fleetCount: input.channels.length,
    rootCount: RC54_ROOTS.length,
    controlRootCount: RC54_ROOTS.filter((root) => root.cohort === "control").length,
    labRootCount: RC54_ROOTS.filter((root) => root.cohort === "lab").length,
    unknownChannelBehavior: "dark",
    policyChangeAuthorized: false,
    liveMoneyAuthorized: false,
  };
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)].sort(),
    activeSettingsReceipt: receipt,
  };
}

function block(
  decision: ShadowDecision,
  reason: string,
  extra: Record<string, unknown> = {},
): ShadowDecision {
  return { ...decision, blocked: reason, detail: { ...(decision.detail ?? {}), ...extra } };
}

const mandatoryExitReasons = new Set([
  "premium_stop", "stop_premium", "eod_flatten", "rc54_eod_flatten",
  "eod_hard_flatten", "halt_flatten", "event_flatten",
]);

function managerOwnsExit(root: Readonly<Rc54AdmissionRoot>, reason: string): boolean {
  if (mandatoryExitReasons.has(reason)) return true;
  if (reason === "target_premium") {
    return root.bankTargetPct != null || root.runnerKind === "fixed-target";
  }
  if (reason === "trail_giveback") return root.runnerKind === "a13";
  if (reason === "trail_chandelier") return root.runnerKind === "native-atr";
  return false;
}

export function prepareRc54ReleaseAdmissions(input: {
  channels: readonly Pick<ChannelConfig, "id" | "slug">[];
  decisions: readonly ShadowDecision[];
  accountId: string;
  sourceBarAtMs: number;
  observedAtMs: number;
  currentEtMinute: number;
  sessionCloseEtMinute: number;
  sessionLedgerReady: boolean;
  rootResolver?: Rc54AdmissionRootResolver;
  candidateIdentity?: Readonly<Rc54AdmissionCandidateIdentity>;
}): ShadowDecision[] {
  const candidateIdentity = input.candidateIdentity ?? {
    releaseId: RC54_RELEASE_ID,
    configurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
    cohortId: RC54_COHORT_ID,
    cohortFrom: RC54_COHORT_FROM,
  };
  const channelBySlug = new Map(input.channels.map((channel) => [channel.slug, channel]));
  return input.decisions.map((decision) => {
    const root = admissionRoot(decision.slug, input.rootResolver);
    const channel = channelBySlug.get(decision.slug);
    let next: ShadowDecision = {
      ...decision,
      detail: {
        ...(decision.detail ?? {}),
        rc54Candidate: {
          releaseId: candidateIdentity.releaseId,
          configurationSha256: candidateIdentity.configurationSha256,
          cohortId: candidateIdentity.cohortId,
          cohortFrom: candidateIdentity.cohortFrom,
          domainId: root?.domainId ?? null,
          familyId: root?.familyId ?? null,
          managerProfileId: root?.managerProfileId ?? null,
          accountId: input.accountId,
          strategistId: channel?.id ?? null,
          sourceBarAt: new Date(input.sourceBarAtMs).toISOString(),
          observedAt: new Date(input.observedAtMs).toISOString(),
          originalBlockedReason: decision.blocked ?? null,
          configurationEpochId: root?.configurationEpochId ?? null,
        },
      },
    };
    if (decision.action === "add") return block(next, "rc54_adds_disabled");
    if (decision.action === "exit") {
      return root && managerOwnsExit(root, decision.reason)
        ? next
        : block(next, "rc54_exit_shadow_only", { rc54ObservedExitReason: decision.reason });
    }
    if (decision.action !== "enter") return next;
    if (!root) return block(next, "rc54_dark_lifecycle");
    if (input.accountId !== root.accountId) return block(next, "rc54_account_binding");
    const ask = typeof decision.detail?.ask === "number" ? decision.detail.ask : 0;
    const debit = root.quantity * ask * 100;
    next = {
      ...next,
      qty: root.quantity,
      detail: {
        ...(next.detail ?? {}),
        rc54Quantity: root.quantity,
        rc54AggregateDebit: debit,
      },
    };
    if (!input.sessionLedgerReady) return block(next, "rc54_session_ledger_unavailable");
    if (decision.blocked) return next;
    if (!(ask > 0)) return block(next, "rc54_unproven_entry_ask");
    if (ask > root.premiumCap || debit > root.aggregateDebitCap + 1e-9) {
      return block(next, "rc54_premium_debit_cap", {
        rc54PremiumCap: root.premiumCap,
        rc54AggregateDebitCap: root.aggregateDebitCap,
      });
    }
    const admissionStop = Math.min(15 * 60 + 25, input.sessionCloseEtMinute - 35);
    if (input.currentEtMinute >= admissionStop) return block(next, "rc54_admission_closed");
    return next;
  });
}

export interface Rc54PreparedDecision {
  accountId: string;
  sourceBarAtMs: number;
  decision: ShadowDecision;
  executionEligible?: boolean;
  executionIneligibleReason?: string | null;
}

export type Rc54ArbitrationPosture = "shadow-counterfactual" | "paper-executor";

export function finalizeRc54ReleaseAdmissions(input: {
  prepared: readonly Rc54PreparedDecision[];
  open: readonly AdmissionDomainOccupancy[];
  sessionEntries: readonly AdmissionDomainSessionEntry[];
  globalPositionTruthComplete: boolean;
  globalOrderTruthComplete: boolean;
  globalSnapshotFailures?: readonly Rc54SnapshotFailure[];
  globalOrderFailureAccountIds?: readonly string[];
  posture?: Rc54ArbitrationPosture;
  rootResolver?: Rc54AdmissionRootResolver;
}): Rc54PreparedDecision[] {
  const posture = input.posture ?? "paper-executor";
  const state = buildAdmissionDomainsState({
    open: input.open,
    sessionEntries: input.sessionEntries,
  });
  const candidates = input.prepared.map((row) => {
    const root = admissionRoot(row.decision.slug, input.rootResolver);
    return {
      domainId: root?.domainId ?? "unknown",
      accountId: row.accountId,
      familyId: root?.familyId ?? "unknown",
      underlying: root?.underlying ?? "",
      sourceBarAtMs: row.sourceBarAtMs,
      decision: row.decision.action === "enter" && !row.decision.blocked
        && posture === "paper-executor" && row.executionEligible === false
        ? block(row.decision, row.executionIneligibleReason ?? "rc54_execution_ineligible")
        : row.decision,
    };
  });
  const finalized = finalizeAdmissionDomains({
    candidates,
    policies: new Map([
      [RC54_CONTROL_DOMAIN, RC54_CONTROL_ADMISSION_POLICY],
      [RC54_LAB_DOMAIN, RC54_LAB_ADMISSION_POLICY],
    ]),
    state,
    globalPositionTruthComplete: posture === "shadow-counterfactual"
      ? true
      : input.globalPositionTruthComplete,
    globalOrderTruthComplete: posture === "shadow-counterfactual"
      ? true
      : input.globalOrderTruthComplete,
  });
  return finalized.map((row, index) => ({
    ...input.prepared[index],
    decision: {
      ...row.decision,
      detail: {
        ...(row.decision.detail ?? {}),
        rc54CovarianceReceipts: row.covarianceReceipts,
        rc54Arbitration: {
          posture,
          strategyEligible: row.decision.action === "enter" && !row.decision.blocked,
          executionEligible: input.prepared[index].executionEligible ?? true,
          executionIneligibleReason: input.prepared[index].executionIneligibleReason ?? null,
          brokerExecutable: posture === "paper-executor"
            && (input.prepared[index].executionEligible ?? true)
            && input.globalPositionTruthComplete
            && input.globalOrderTruthComplete,
          counterfactualOnly: posture === "shadow-counterfactual",
          globalPositionTruthComplete: input.globalPositionTruthComplete,
          globalOrderTruthComplete: input.globalOrderTruthComplete,
          globalSnapshotFailures: input.globalSnapshotFailures ?? [],
          globalOrderFailureAccountIds: input.globalOrderFailureAccountIds ?? [],
        },
      },
    },
  }));
}

export function rc54ReleaseEodDue(
  slug: string,
  currentEtMinute: number,
  sessionCloseEtMinute: number,
): boolean {
  return rc54Root(slug) != null && currentEtMinute >= sessionCloseEtMinute - 35;
}
