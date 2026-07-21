import type { MarketEvent } from "@/lib/types";
import { findDay1ReleaseReceipt, type Day1ReleaseReceipt } from "@/lib/ops/releaseReceipt";

export const DAY1_RELEASE_ID = "weekend-day1-2026-07-21-rc5.3";
export const DAY1_CONFIG_HASH = "b68348407a5f4c5c351213c6cf512afe1571a20646aeb9f213c644dd15f50bf1";
export const DAY1_WORKER_VERSION = "stream-2026-07-21b";

export const DAY1_MANAGER_ARMS = [
  "LOCK20/30",
  "LOCK30/30",
  "LOCK50/30",
  "WIDE20/50",
  "BANK20/RUN50",
  "ARM20/HALF-GIVEBACK",
  "BELL/-30",
  "BELL/no-stop",
] as const;

export interface Day1RootPolicy {
  slug: string;
  accountId: string;
  accountName: string;
  familyId: string;
  underlying: "SPY" | "QQQ" | "IWM";
  priority: number;
  quantity: 2;
  entryDte: 0 | 1;
  riskBudgetUsd: number;
  premiumCap: number;
  aggregateDebitCap: number;
  premiumStopPct: 30;
  takeProfitPct: 0;
  givebackTrail: {
    engageReturnPct: 50;
    givebackPct: 33;
    retainGainPct: 67;
    priceBasis: "executable-option-bid";
  } | null;
  eodEt: "15:25";
  channelVersion: string;
  configurationEpochId: string;
  managerVersion: string;
  policyEpochId: string;
}
const roots = [
  {
    slug: "pb-ride", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "SPY-PB", underlying: "SPY", priority: 1, quantity: 2, entryDte: 1,
    riskBudgetUsd: 210, premiumCap: 3.5, aggregateDebitCap: 700,
    channelVersion: "e5e038af744d45ca8136b56ca3d625e0c5cda35c58d603fb8072785e9342c2b1",
    configurationEpochId: "d52ec95d656c2637fb38e43d624f1e3ff29444d5e82bf0f180944d6e8d734488",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "a9338a26-668d-5e71-b48c-7610a26f8c1e",
  },
  {
    slug: "orb-ustop-ctl", accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountName: "MORGUE",
    familyId: "SPY-ORB", underlying: "SPY", priority: 4, quantity: 2, entryDte: 0,
    riskBudgetUsd: 120, premiumCap: 2, aggregateDebitCap: 400,
    channelVersion: "71a7cc171a002573505cd147d42de109c4bbafb54e52d0fb6b31b2dee76c651e",
    configurationEpochId: "cb5979e26b8003127de3de9d06c7d808c53c5aea36b67994e46f308250c1851e",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "4e0d03f8-d575-58ec-b3bd-ea74d0a60a4b",
  },
  {
    slug: "grind-v3", accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountName: "MORGUE",
    familyId: "SPY-GRIND", underlying: "SPY", priority: 2, quantity: 2, entryDte: 0,
    riskBudgetUsd: 105, premiumCap: 1.75, aggregateDebitCap: 350,
    channelVersion: "43b84c0c2065d36e9e20ef473254b86c18d4fe39069865646124553d6fcad077",
    configurationEpochId: "fee5b2a305410aeee528a3dd1c52420dd7b15d98c929b06079db9f7af333d035",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "74130bee-c41d-5dfd-8c7c-b729347568a8",
  },
  {
    slug: "momo-shape", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "SPY-MOMO", underlying: "SPY", priority: 3, quantity: 2, entryDte: 0,
    riskBudgetUsd: 135, premiumCap: 2.25, aggregateDebitCap: 450,
    channelVersion: "b9259b5a5cd32448c14dc33353d3b1fcdefd57be92193fe446bd7e0b323a0f47",
    configurationEpochId: "f69df8b415b82e0738387627768fce551d8f7e65ebcd964fe7712b186d399a6a",
    managerVersion: "bda3e8a72526f9d1d44a8656733523e06735e21e726a254c935ccfddfb69ccb0",
    policyEpochId: "ff6eb502-d3a1-5fd0-ab37-25b564fd9629",
  },
  {
    slug: "orb-qqq-trail", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "QQQ-ORB", underlying: "QQQ", priority: 1, quantity: 2, entryDte: 0,
    riskBudgetUsd: 180, premiumCap: 3, aggregateDebitCap: 600,
    channelVersion: "ff1312b0c312b18a4a227ecd1eb6badad5f8d28b70d00e9d0017d3b1eb13fc2a",
    configurationEpochId: "a67d149a2b474a565638a57eec72edc66f803f6dcc77c534f19ddd12e8410c9b",
    managerVersion: "c3af49e3ce9e6653d7307ad458330293cd65a1433412057ba2715150dedea3c8",
    policyEpochId: "4ded4844-aa5e-54a3-b90e-56c8eac78126",
  },
  {
    slug: "breakout-alt-v3-iwm", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "IWM-BREAKOUT", underlying: "IWM", priority: 1, quantity: 2, entryDte: 0,
    riskBudgetUsd: 75, premiumCap: 1.25, aggregateDebitCap: 250,
    channelVersion: "75801f4cdd928d4a472b0cd205e6809aee68165eef41bba84314bbd8a7277eec",
    configurationEpochId: "c2d43fe72fc4f35a4f4692580e590f6f3671de7a3806fc5b06d3a14ed408cd9e",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "0d59b764-e7e1-538a-9bbb-6871eb60ba8b",
  },
] as const;

export const DAY1_ROOTS: Readonly<Record<string, Day1RootPolicy>> = Object.fromEntries(
  roots.map((root) => [root.slug, {
    ...root,
    premiumStopPct: 30 as const,
    takeProfitPct: 0 as const,
    givebackTrail: root.slug === "momo-shape"
      ? {
          engageReturnPct: 50 as const,
          givebackPct: 33 as const,
          retainGainPct: 67 as const,
          priceBasis: "executable-option-bid" as const,
        }
      : null,
    eodEt: "15:25" as const,
  }]),
);

/** Operator-facing wording for the controls that actually govern the sealed
 * runtime. Keep this beside the pinned policy data so desktop and mobile do
 * not reinterpret database preview knobs as executable settings. */
export function day1RootExitLabel(policy: Day1RootPolicy, compact = false): string {
  const stop = `−${policy.premiumStopPct}%${compact ? "" : " catastrophe"}`;
  const manager = policy.givebackTrail
    ? compact
      ? `A13 +${policy.givebackTrail.engageReturnPct}%/⅔`
      : `A13 arm +${policy.givebackTrail.engageReturnPct}% / retain ⅔`
    : "RIDE";
  return `${stop} · ${manager} · ${policy.eodEt}${compact ? "" : " ET"}`;
}

export type Day1ReleaseReadState = "checking" | "ok" | "error";
export type Day1ReleaseState = "checking" | "verified" | "missing" | "mismatch" | "read-error";

export interface Day1ReleaseObservation {
  state: Day1ReleaseState;
  receipt: Day1ReleaseReceipt | null;
  releaseId: string;
  expectedHash: string;
  fact: string;
}

export function observeDay1Release(events: MarketEvent[], readState: Day1ReleaseReadState = "ok"): Day1ReleaseObservation {
  const receipt = findDay1ReleaseReceipt(events);
  // A previously observed exact receipt remains valid startup identity through
  // a transient read failure. Read degradation is surfaced separately; it must
  // not erase evidence already observed in this mounted seam.
  if (!receipt && readState === "checking") {
    return {
      state: "checking", receipt: null, releaseId: DAY1_RELEASE_ID, expectedHash: DAY1_CONFIG_HASH,
      fact: "Checking the dedicated Day 1 startup-receipt read; no runtime lifecycle claim yet.",
    };
  }
  if (!receipt && readState === "error") {
    return {
      state: "read-error", receipt: null, releaseId: DAY1_RELEASE_ID, expectedHash: DAY1_CONFIG_HASH,
      fact: "Release-receipt read failed; database rows cannot establish the active runtime lifecycle.",
    };
  }
  if (!receipt) {
    return {
      state: "missing", receipt: null, releaseId: DAY1_RELEASE_ID, expectedHash: DAY1_CONFIG_HASH,
      fact: "No Day 1 startup receipt is present in the retained event view; runtime lifecycle is unverified.",
    };
  }
  if (receipt.releaseId !== DAY1_RELEASE_ID || receipt.configHash !== DAY1_CONFIG_HASH) {
    return {
      state: "mismatch", receipt, releaseId: DAY1_RELEASE_ID, expectedHash: DAY1_CONFIG_HASH,
      fact: `Observed ${receipt.releaseId} ${receipt.configHash.slice(0, 10)}…; expected sealed ${DAY1_RELEASE_ID}.`,
    };
  }
  return {
    state: "verified", receipt, releaseId: DAY1_RELEASE_ID, expectedHash: DAY1_CONFIG_HASH,
    fact: `Exact ${DAY1_RELEASE_ID} startup receipt observed. Receipt identity is not a liveness claim.`,
  };
}
