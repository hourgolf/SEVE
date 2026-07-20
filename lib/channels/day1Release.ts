import type { MarketEvent } from "@/lib/types";
import { findDay1ReleaseReceipt, type Day1ReleaseReceipt } from "@/lib/ops/releaseReceipt";

export const DAY1_RELEASE_ID = "weekend-day1-2026-07-21-rc5.2";
export const DAY1_CONFIG_HASH = "a51d16679de8fcd4e39b25e29cca7d4e2c60a243f25912bd668a0eee2c13d888";
export const DAY1_WORKER_VERSION = "stream-2026-07-21a";

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
    channelVersion: "62509928e3806740f5d156360e2565148f75523b6f2a5c6c0403153cd5f15f9c",
    configurationEpochId: "d2a79e86bfede3e39519dbdbda41134f94c2492a4b6f09ea2717e385b780ac40",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "89388e12-b16f-5f58-aabb-08fcecda67ef",
  },
  {
    slug: "orb-ustop-ctl", accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountName: "MORGUE",
    familyId: "SPY-ORB", underlying: "SPY", priority: 4, quantity: 2, entryDte: 0,
    riskBudgetUsd: 120, premiumCap: 2, aggregateDebitCap: 400,
    channelVersion: "6437b8c55c3b17cc05c08287c878bf9ca9208c5f10b009ff090c74cc8a70b110",
    configurationEpochId: "4c56e9195d3461767bdfefe73b9d7d31d602e90db872fe3d8b3b7bb3e34764c7",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "37c035a9-b4e9-5a8c-9568-195651331685",
  },
  {
    slug: "grind-v3", accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountName: "MORGUE",
    familyId: "SPY-GRIND", underlying: "SPY", priority: 2, quantity: 2, entryDte: 0,
    riskBudgetUsd: 105, premiumCap: 1.75, aggregateDebitCap: 350,
    channelVersion: "d378582a69a89956e83fabc9811b16bfc9c8a85ef4aa3db4671b8a188dcf92a1",
    configurationEpochId: "c5a444b1f0d5f7fa6f8f848ed8e6dbcccb82643eab3c15c032a4a4072ef6311f",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "07bf321f-454c-5933-9bec-5932243e54cc",
  },
  {
    slug: "momo-shape", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "SPY-MOMO", underlying: "SPY", priority: 3, quantity: 2, entryDte: 0,
    riskBudgetUsd: 135, premiumCap: 2.25, aggregateDebitCap: 450,
    channelVersion: "692d70560ad44cd0126c42fc3d96b61ea288f17b48706ecabb52d3f8f1349862",
    configurationEpochId: "bb3999b1c8462d55bb7d6ac62962b036284290a1a1e4ba4f9199811568d73b85",
    managerVersion: "bda3e8a72526f9d1d44a8656733523e06735e21e726a254c935ccfddfb69ccb0",
    policyEpochId: "e3cb7aab-4df6-5bc1-a888-f13fd7e34d8a",
  },
  {
    slug: "orb-qqq-trail", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "QQQ-ORB", underlying: "QQQ", priority: 1, quantity: 2, entryDte: 0,
    riskBudgetUsd: 180, premiumCap: 3, aggregateDebitCap: 600,
    channelVersion: "bd2e4d7df3aa6add56d287d03668fa85ad098d1f08b94139160166c42472ac9e",
    configurationEpochId: "d50b95cb3c94ea0b7c6050906e73cae9c2f9bdc8db4795bc0fee0590db8e7286",
    managerVersion: "c3af49e3ce9e6653d7307ad458330293cd65a1433412057ba2715150dedea3c8",
    policyEpochId: "02aff8c7-003f-59f6-a255-695b440578c3",
  },
  {
    slug: "breakout-alt-v3-iwm", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "IWM-BREAKOUT", underlying: "IWM", priority: 1, quantity: 2, entryDte: 0,
    riskBudgetUsd: 75, premiumCap: 1.25, aggregateDebitCap: 250,
    channelVersion: "7c38d181f6d1a470a52794ea01472092ffe5c459fa624b3ddd6bf9dff01055ad",
    configurationEpochId: "9df46a84a8ba8c109623ce419810c83dc8fe5dc316f5437d74dd3e8be0e06c97",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "8464d393-5aa2-56a7-a4fc-c205c983a4f2",
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
