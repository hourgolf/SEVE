import type { MarketEvent } from "@/lib/types";
import { findDay1ReleaseReceipt, type Day1ReleaseReceipt } from "@/lib/ops/releaseReceipt";

export const DAY1_RELEASE_ID = "weekend-day1-2026-07-20-rc5";
export const DAY1_CONFIG_HASH = "5a4112fd5991b470aa185d8c9271a57e82b975f9999d89096b29e76b9ad64eba";
export const DAY1_WORKER_VERSION = "stream-2026-07-17g";

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
    channelVersion: "0890122702487404a599d3b78e0774d4b9a9bc90b57806ee32c72a38ddf4fa34",
    configurationEpochId: "7b908a25ed1838f19ac32167dab3c74238ded00b3f39ec375cb213905784838f",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "2c2787b7-4e0b-5628-8ff6-183da8014239",
  },
  {
    slug: "orb-ustop-ctl", accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountName: "MORGUE",
    familyId: "SPY-ORB", underlying: "SPY", priority: 4, quantity: 2, entryDte: 0,
    riskBudgetUsd: 120, premiumCap: 2, aggregateDebitCap: 400,
    channelVersion: "b9ce9e1a01886637a7a04d1a0e80008a7fba8d6f001adc4d201601ce87ab5591",
    configurationEpochId: "20b29fd8b19e56a6cfeed868753caa68b9a14ccef3490531ed3e59dc8cdbfeb0",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "150ee8f4-cd5f-58e4-bf72-920ca906fc2f",
  },
  {
    slug: "grind-v3", accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountName: "MORGUE",
    familyId: "SPY-GRIND", underlying: "SPY", priority: 2, quantity: 2, entryDte: 0,
    riskBudgetUsd: 105, premiumCap: 1.75, aggregateDebitCap: 350,
    channelVersion: "cd2f40c4394d3a55e12ab9a42d66182550887552f1401d043ef93c0f9bf1ce21",
    configurationEpochId: "77f8a7c81f390dbc7c4977b06af6db199734f136f2fe5fb62d8095a9c3b2c658",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "4efe3eb8-0683-5f9e-ba7b-d1965a45727b",
  },
  {
    slug: "momo-shape", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "SPY-MOMO", underlying: "SPY", priority: 3, quantity: 2, entryDte: 0,
    riskBudgetUsd: 135, premiumCap: 2.25, aggregateDebitCap: 450,
    channelVersion: "4f0f694ba52357e237a5b40162014a47089d049c5cc5cbc98c131670f71c65d8",
    configurationEpochId: "85ef6b8789050b4b2a4843840b8011b9c2da9a50f84e64c6cf886e0820277c56",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "3b9c36e4-320f-5f91-904a-96ae2d1d83bc",
  },
  {
    slug: "orb-qqq-trail", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "QQQ-ORB", underlying: "QQQ", priority: 1, quantity: 2, entryDte: 0,
    riskBudgetUsd: 180, premiumCap: 3, aggregateDebitCap: 600,
    channelVersion: "b08df73baec4896dee3f81017ffca16da52f01eb22a44632793b3397eddf1879",
    configurationEpochId: "915b876a53ae745f18b5e6178c46f3d77fc2e2c6eb4b5f1188923e710486fa1b",
    managerVersion: "c3af49e3ce9e6653d7307ad458330293cd65a1433412057ba2715150dedea3c8",
    policyEpochId: "6d17038a-1761-571a-ab12-247d40c6c4cd",
  },
  {
    slug: "breakout-alt-v3-iwm", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "IWM-BREAKOUT", underlying: "IWM", priority: 1, quantity: 2, entryDte: 0,
    riskBudgetUsd: 75, premiumCap: 1.25, aggregateDebitCap: 250,
    channelVersion: "c09ce06f0886641344258bff0a2d2c1b5920fa90aabca9391581424cffa82c7d",
    configurationEpochId: "f355002d33f366775329ba8deb8c00d2c26754e91aa6ab3ff6e238cad6fe9b4c",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "a7c37735-8de2-51ab-8a02-e50aad93303f",
  },
] as const;

export const DAY1_ROOTS: Readonly<Record<string, Day1RootPolicy>> = Object.fromEntries(
  roots.map((root) => [root.slug, {
    ...root,
    premiumStopPct: 30 as const,
    takeProfitPct: 0 as const,
    eodEt: "15:25" as const,
  }]),
);

export type Day1ReleaseState = "verified" | "missing" | "mismatch";

export interface Day1ReleaseObservation {
  state: Day1ReleaseState;
  receipt: Day1ReleaseReceipt | null;
  releaseId: string;
  expectedHash: string;
  fact: string;
}

export function observeDay1Release(events: MarketEvent[]): Day1ReleaseObservation {
  const receipt = findDay1ReleaseReceipt(events);
  if (!receipt) {
    return {
      state: "missing", receipt: null, releaseId: DAY1_RELEASE_ID, expectedHash: DAY1_CONFIG_HASH,
      fact: "No Day 1 startup receipt is present in the retained event view; runtime lifecycle is unverified.",
    };
  }
  if (receipt.releaseId !== DAY1_RELEASE_ID || receipt.configHash !== DAY1_CONFIG_HASH) {
    return {
      state: "mismatch", receipt, releaseId: DAY1_RELEASE_ID, expectedHash: DAY1_CONFIG_HASH,
      fact: `Observed ${receipt.releaseId} ${receipt.configHash.slice(0, 10)}…; expected sealed RC5.`,
    };
  }
  return {
    state: "verified", receipt, releaseId: DAY1_RELEASE_ID, expectedHash: DAY1_CONFIG_HASH,
    fact: "Exact RC5 startup receipt observed. Receipt identity is not a liveness claim.",
  };
}
