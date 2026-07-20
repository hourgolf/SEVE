import type { MarketEvent } from "@/lib/types";
import { findDay1ReleaseReceipt, type Day1ReleaseReceipt } from "@/lib/ops/releaseReceipt";

export const DAY1_RELEASE_ID = "weekend-day1-2026-07-20-rc5.1";
export const DAY1_CONFIG_HASH = "09a6090b237221b386f464830d90c4f54804d3c5717df2a384c2ea47a77f5508";
export const DAY1_WORKER_VERSION = "stream-2026-07-20a";

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
    channelVersion: "519c946e29bad1b149c80582a58e00367d3d0f340ea02e7a5136fa5e5be20f6e",
    configurationEpochId: "1dd00d58df978bf2b082462de91e435aaa2a22ec2b0ac23c56fa381c64aed9ed",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "e174f66c-da9e-52d0-bd85-15b6618b396a",
  },
  {
    slug: "orb-ustop-ctl", accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountName: "MORGUE",
    familyId: "SPY-ORB", underlying: "SPY", priority: 4, quantity: 2, entryDte: 0,
    riskBudgetUsd: 120, premiumCap: 2, aggregateDebitCap: 400,
    channelVersion: "be44b3ea314ae1cb27a44bb1a9364650def566d4bb18ec139a9f7a1adddda70e",
    configurationEpochId: "0a4b78b8f7cc249f9b5cc0159cc020041fe18d5c043b486d1fbb35bd4076854c",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "7cb5fac0-5ea9-5f94-af27-c41f80c8d2f5",
  },
  {
    slug: "grind-v3", accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountName: "MORGUE",
    familyId: "SPY-GRIND", underlying: "SPY", priority: 2, quantity: 2, entryDte: 0,
    riskBudgetUsd: 105, premiumCap: 1.75, aggregateDebitCap: 350,
    channelVersion: "53e5a0da54a86923543195cfc597b993b20de7a4340f0c66eecae9cd289908bc",
    configurationEpochId: "b6072769532f39d54ad6f9e4ce12f1aa6075dc9a6f1686bcf7965fedce9762ea",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "ed3d62d9-2eb0-55ff-b4a1-94d52d321bef",
  },
  {
    slug: "momo-shape", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "SPY-MOMO", underlying: "SPY", priority: 3, quantity: 2, entryDte: 0,
    riskBudgetUsd: 135, premiumCap: 2.25, aggregateDebitCap: 450,
    channelVersion: "cd0e795b642a1786bb82e95aacfaab85c6664d1bad46d681195e2204acf9b48f",
    configurationEpochId: "6a26f012ad594a2ee9f18185be26082cb53d4896e2bedcb861de3e1068a01f5b",
    managerVersion: "bda3e8a72526f9d1d44a8656733523e06735e21e726a254c935ccfddfb69ccb0",
    policyEpochId: "c61a1810-3dc4-5c04-9078-d3f5b2729d76",
  },
  {
    slug: "orb-qqq-trail", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "QQQ-ORB", underlying: "QQQ", priority: 1, quantity: 2, entryDte: 0,
    riskBudgetUsd: 180, premiumCap: 3, aggregateDebitCap: 600,
    channelVersion: "a82a2ea08ab6ca2472453c9276813f2928824e9b32691f124f9e7fe6bf38c276",
    configurationEpochId: "f0769761fb3a866a286eae76b691a0fc7617cd303075bd2f6fa93a6cfa0bb885",
    managerVersion: "c3af49e3ce9e6653d7307ad458330293cd65a1433412057ba2715150dedea3c8",
    policyEpochId: "7bf86200-7dcd-59c3-b757-fb9896ceefa6",
  },
  {
    slug: "breakout-alt-v3-iwm", accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM",
    familyId: "IWM-BREAKOUT", underlying: "IWM", priority: 1, quantity: 2, entryDte: 0,
    riskBudgetUsd: 75, premiumCap: 1.25, aggregateDebitCap: 250,
    channelVersion: "2e3367a92e1ba41395e6ed9a2eb932c5d22af79da0c6016f555917b12bf9c4a8",
    configurationEpochId: "07edeca18e06fd87b84297b2e0b6a6638e6d96d9a85aef5af7eca7a2a9f08b0b",
    managerVersion: "e316c75156130bb18d68828ff1d03438f4d931909ce99b47d45a2a751a4e63d7",
    policyEpochId: "1c062acc-7a6e-5f6c-96c3-035649529845",
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
      fact: `Observed ${receipt.releaseId} ${receipt.configHash.slice(0, 10)}…; expected sealed RC5.1.`,
    };
  }
  return {
    state: "verified", receipt, releaseId: DAY1_RELEASE_ID, expectedHash: DAY1_CONFIG_HASH,
    fact: "Exact RC5.1 startup receipt observed. Receipt identity is not a liveness claim.",
  };
}
