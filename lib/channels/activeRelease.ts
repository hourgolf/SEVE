import type { MarketEvent } from "@/lib/types";
import {
  DAY1_CONFIG_HASH,
  DAY1_MANAGER_ARMS,
  DAY1_RELEASE_ID,
  DAY1_ROOTS,
  type Day1ReleaseReadState,
  type Day1ReleaseState,
  type Day1RootPolicy,
} from "@/lib/channels/day1Release";
import {
  findSealedReleaseReceipt,
  type SealedReleaseLane,
  type SealedReleaseReceipt,
} from "@/lib/ops/releaseReceipt";

export const RC54_RELEASE_ID = "week2-2026-07-27-rc5.4";
export const RC54_CONFIG_HASH = "a1dda169e9c578e83f725c09b01af0af675d4ebc6d26e4c75fd1d520e828b227";
export const RC54_WORKER_VERSION = "stream-2026-07-27a";
export const RC54_MANAGER_POLICY_VERSION = "rc54-composite-manager-v1";

export type ActiveManagerProfileId =
  | "RC53-RIDE"
  | "RC53-A13"
  | "ORB54-B30-A13"
  | "QQQ54-B20-NATIVE-ATR"
  | "LAB54-L30-L50"
  | "LAB54-B50-A13";

export interface ActiveRootPolicy {
  slug: string;
  accountId: string;
  accountName: string;
  cohort: "control" | "lab";
  domainId: "rc54-control" | "rc54-lab" | "rc53";
  familyId: string;
  underlying: "SPY" | "QQQ" | "IWM";
  priority: number;
  quantity: 2;
  entryDte: 0 | 1;
  strikeOffset: number;
  riskBudgetUsd: number;
  premiumCap: number;
  aggregateDebitCap: number;
  premiumStopPct: 30;
  bankTargetPct: number | null;
  runner: "none" | "a13" | "fixed-50" | "native-atr";
  runnerFraction: 0 | 0.5;
  managerProfileId: ActiveManagerProfileId;
  managerLabel: string;
  givebackTrail: Day1RootPolicy["givebackTrail"];
  eodEt: "15:25";
  channelVersion: string;
  configurationEpochId: string;
  managerVersion: string;
  policyEpochId: string;
}

const a13 = {
  engageReturnPct: 50 as const,
  givebackPct: 33 as const,
  retainGainPct: 67 as const,
  priceBasis: "executable-option-bid" as const,
};

function legacyRoot(policy: Day1RootPolicy): ActiveRootPolicy {
  const hasA13 = !!policy.givebackTrail;
  return {
    ...policy,
    cohort: "control",
    domainId: "rc53",
    strikeOffset: 0,
    bankTargetPct: null,
    runner: hasA13 ? "a13" : "none",
    runnerFraction: 0,
    managerProfileId: hasA13 ? "RC53-A13" : "RC53-RIDE",
    managerLabel: hasA13 ? "FULL A13 · ARM +50% · RETAIN ⅔" : "RIDE · CATASTROPHE / EOD ONLY",
  };
}

export const DAY1_ACTIVE_ROOTS: Readonly<Record<string, ActiveRootPolicy>> = Object.fromEntries(
  Object.values(DAY1_ROOTS).map((root) => [root.slug, legacyRoot(root)]),
);

type Rc54RootPresentation = Omit<
  ActiveRootPolicy,
  "channelVersion" | "configurationEpochId" | "managerVersion" | "policyEpochId"
>;

const rc54Roots: readonly Rc54RootPresentation[] = [
  {
    slug: "pb-ride", cohort: "control", domainId: "rc54-control",
    familyId: "SPY-PB", underlying: "SPY", priority: 1,
    entryDte: 1, strikeOffset: 0, quantity: 2, premiumCap: 3.50, aggregateDebitCap: 700,
    riskBudgetUsd: 210, premiumStopPct: 30, bankTargetPct: null, runner: "none", runnerFraction: 0,
    managerProfileId: "RC53-RIDE", managerLabel: "RIDE · CATASTROPHE / EOD ONLY", givebackTrail: null,
    accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM", eodEt: "15:25",
  },
  {
    slug: "orb-ustop-ctl", cohort: "control", domainId: "rc54-control",
    familyId: "SPY-ORB", underlying: "SPY", priority: 4,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 2.00, aggregateDebitCap: 400,
    riskBudgetUsd: 120, premiumStopPct: 30, bankTargetPct: 30, runner: "a13", runnerFraction: 0.5,
    managerProfileId: "ORB54-B30-A13", managerLabel: "BANK 1 @ +30% · RUN 1 ON A13", givebackTrail: a13,
    accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountName: "MORGUE", eodEt: "15:25",
  },
  {
    slug: "grind-v3", cohort: "control", domainId: "rc54-control",
    familyId: "SPY-GRIND", underlying: "SPY", priority: 2,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.75, aggregateDebitCap: 350,
    riskBudgetUsd: 105, premiumStopPct: 30, bankTargetPct: null, runner: "none", runnerFraction: 0,
    managerProfileId: "RC53-RIDE", managerLabel: "RIDE · CATASTROPHE / EOD ONLY", givebackTrail: null,
    accountId: "995aa327-b0da-4050-bede-97ab462b06cd", accountName: "MORGUE", eodEt: "15:25",
  },
  {
    slug: "momo-shape", cohort: "control", domainId: "rc54-control",
    familyId: "SPY-MOMO", underlying: "SPY", priority: 3,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 2.25, aggregateDebitCap: 450,
    riskBudgetUsd: 135, premiumStopPct: 30, bankTargetPct: null, runner: "a13", runnerFraction: 0,
    managerProfileId: "RC53-A13", managerLabel: "FULL A13 · ARM +50% · RETAIN ⅔", givebackTrail: a13,
    accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM", eodEt: "15:25",
  },
  {
    slug: "orb-qqq-trail", cohort: "control", domainId: "rc54-control",
    familyId: "QQQ-ORB", underlying: "QQQ", priority: 1,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 3.00, aggregateDebitCap: 600,
    riskBudgetUsd: 180, premiumStopPct: 30, bankTargetPct: 20, runner: "native-atr", runnerFraction: 0.5,
    managerProfileId: "QQQ54-B20-NATIVE-ATR", managerLabel: "BANK 1 @ +20% · RUN 1 ON NATIVE ATR", givebackTrail: null,
    accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM", eodEt: "15:25",
  },
  {
    slug: "breakout-alt-v3-iwm", cohort: "control", domainId: "rc54-control",
    familyId: "IWM-BREAKOUT", underlying: "IWM", priority: 1,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.25, aggregateDebitCap: 250,
    riskBudgetUsd: 75, premiumStopPct: 30, bankTargetPct: null, runner: "none", runnerFraction: 0,
    managerProfileId: "RC53-RIDE", managerLabel: "RIDE · CATASTROPHE / EOD ONLY", givebackTrail: null,
    accountId: "cd817549-e025-4d38-805e-d32e607052f7", accountName: "FIRST-TEAM", eodEt: "15:25",
  },
  {
    slug: "vb-macd-state", cohort: "lab", domainId: "rc54-lab",
    familyId: "LAB-SPY-MACD", underlying: "SPY", priority: 1,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.75, aggregateDebitCap: 350,
    riskBudgetUsd: 105, premiumStopPct: 30, bankTargetPct: 30, runner: "fixed-50", runnerFraction: 0.5,
    managerProfileId: "LAB54-L30-L50", managerLabel: "BANK 1 @ +30% · RUN 1 TO +50%", givebackTrail: null,
    accountId: "56daa293-e6bc-447d-83ac-2bfafb4d0ac1", accountName: "LAB", eodEt: "15:25",
  },
  {
    slug: "vb-squeeze-break", cohort: "lab", domainId: "rc54-lab",
    familyId: "LAB-SPY-SQUEEZE", underlying: "SPY", priority: 2,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.75, aggregateDebitCap: 350,
    riskBudgetUsd: 105, premiumStopPct: 30, bankTargetPct: 30, runner: "fixed-50", runnerFraction: 0.5,
    managerProfileId: "LAB54-L30-L50", managerLabel: "BANK 1 @ +30% · RUN 1 TO +50%", givebackTrail: null,
    accountId: "56daa293-e6bc-447d-83ac-2bfafb4d0ac1", accountName: "LAB", eodEt: "15:25",
  },
  {
    slug: "vb-ribbon-cross-qqq", cohort: "lab", domainId: "rc54-lab",
    familyId: "LAB-QQQ-RIBBON", underlying: "QQQ", priority: 1,
    entryDte: 0, strikeOffset: 0, quantity: 2, premiumCap: 1.75, aggregateDebitCap: 350,
    riskBudgetUsd: 105, premiumStopPct: 30, bankTargetPct: 50, runner: "a13", runnerFraction: 0.5,
    managerProfileId: "LAB54-B50-A13", managerLabel: "BANK 1 @ +50% · RUN 1 ON A13", givebackTrail: a13,
    accountId: "56daa293-e6bc-447d-83ac-2bfafb4d0ac1", accountName: "LAB", eodEt: "15:25",
  },
];

const RC54_ROOT_IDENTITIES: Readonly<Record<string, Pick<
  ActiveRootPolicy,
  "channelVersion" | "configurationEpochId" | "managerVersion" | "policyEpochId"
>>> = {
  "pb-ride": {
    channelVersion: "5559f360a30db2aa94c9e3cefb954d7ff69373ed856a086c46a27bd41e1721ea",
    managerVersion: "6f6ce7c9a07dc751cc4bf165248df8bed17e416d31b565f0fcc25663aed1c21b",
    configurationEpochId: "7e92867cfc3ea19d32448202b137462b8c415c641719d8a719b9ed3b4c00905b",
    policyEpochId: "bd3720ab-bced-5bbd-9774-c6c96a083a5d",
  },
  "orb-ustop-ctl": {
    channelVersion: "54d7feede491bc3c6754e8cf501e777584ce9fa2e0ce6e4162c9b24858e7a57c",
    managerVersion: "73f4e0653c590eb1826c7c03a55bf161a565428f12b682c3ae43603485fb28d5",
    configurationEpochId: "e791afc597c5fca63d04285855d810c1972af6a35ad971afcc20d7b66c4a888d",
    policyEpochId: "8de26b28-3de3-5de5-9c90-410690bd3f7c",
  },
  "grind-v3": {
    channelVersion: "52ba206051f316be8df6b9c6b05d4ba67406e112772ba72a28e85c1b9f5819f2",
    managerVersion: "6f6ce7c9a07dc751cc4bf165248df8bed17e416d31b565f0fcc25663aed1c21b",
    configurationEpochId: "38cd298d78339cf85000e512427d1e493ba4fda037f00c5861b811fbd840d4e9",
    policyEpochId: "66faef66-ec9a-5451-991a-7fabd5def661",
  },
  "momo-shape": {
    channelVersion: "09f04815385597ebec13f4c75e997a123d7dfda0e11145896a7aa4b7c157806c",
    managerVersion: "c01d2380b0c462ae2b1cd8cf9e9e9bdb18c0b22fcfb36ad0e976d6d69bf4c1d6",
    configurationEpochId: "2b14c6b62b70c87e1895ab82ec6a2d71f1d24f01789f2874eee04f52baa228c4",
    policyEpochId: "54a87863-e201-582e-a8a2-25f00c795cb0",
  },
  "orb-qqq-trail": {
    channelVersion: "b28166ce917ab8eb638c734e05b661166c84b02ae2272c39002303b0d380d69b",
    managerVersion: "51f6cd029e46a4c512458b95bf5982c39d460a2dc874af2a80b372f069ee843a",
    configurationEpochId: "2912932f101f7c2539bb699ac4f438769af2f92930fff44db83b01bcb7b0063e",
    policyEpochId: "28ec5811-7aa8-574b-a468-0724a55129c7",
  },
  "breakout-alt-v3-iwm": {
    channelVersion: "945dcd65ffb41d5c67bae84e416ce7765e26d70cd2e055ae39aca998393d6525",
    managerVersion: "6f6ce7c9a07dc751cc4bf165248df8bed17e416d31b565f0fcc25663aed1c21b",
    configurationEpochId: "f202c25c523e5569e5aa8e3cf99c1f5b86f02ce3eb9b1eeb09e30848281a3b9c",
    policyEpochId: "a56543c2-7fad-59ea-bcad-361ab01bcf7b",
  },
  "vb-macd-state": {
    channelVersion: "00347e4f8cf91201cc33976b5a18aeef85e6345ac91d5e4978543b878b5a3ddd",
    managerVersion: "f7ae1cbe1567463ecc08854f860af0bf109c658955cb1cf41b2cab1db781c64a",
    configurationEpochId: "81f1900507582f5a4c975fb751705217d2ed9b444d5308528fd1c0098d560a43",
    policyEpochId: "8e34a319-dfe7-5362-9007-036457755be9",
  },
  "vb-squeeze-break": {
    channelVersion: "9583c61606f17f6cf88bf8385fab58c13c33530fa53cf8f96a3075759f2b05c2",
    managerVersion: "f7ae1cbe1567463ecc08854f860af0bf109c658955cb1cf41b2cab1db781c64a",
    configurationEpochId: "2ea94165f3be56aad496eb8a21a91eab7b739d8f123ca630d5c9aa12dc8295d7",
    policyEpochId: "8e372cb8-f6c5-5f7b-8895-1378a94f53ed",
  },
  "vb-ribbon-cross-qqq": {
    channelVersion: "df470a877dd557976710e24e256ff04e1f6d7bc303215e600fda852f95874f37",
    managerVersion: "bb4bd167538d4b946855a93ddfac334061c02d73ecf1e8e4a2b7c044df54197c",
    configurationEpochId: "4573e756b3644ca8a201ad6a8e5127ec609712dc8745d28db7a26c8e296ae5d5",
    policyEpochId: "c8eb9055-74b0-5969-be51-e5f51ea8546a",
  },
};

export const RC54_ROOTS: Readonly<Record<string, ActiveRootPolicy>> = Object.fromEntries(
  rc54Roots.map((root) => [root.slug, { ...root, ...RC54_ROOT_IDENTITIES[root.slug] }]),
);

export interface ActiveReleaseObservation {
  state: Day1ReleaseState;
  lane: SealedReleaseLane | null;
  receipt: SealedReleaseReceipt | null;
  releaseId: string;
  expectedHash: string;
  workerVersion: string;
  roots: Readonly<Record<string, ActiveRootPolicy>>;
  configuredManagerArms: number;
  fact: string;
}

const expectedFor = (lane: SealedReleaseLane) => lane === "rc54"
  ? {
      releaseId: RC54_RELEASE_ID,
      hash: RC54_CONFIG_HASH,
      workerVersion: RC54_WORKER_VERSION,
      roots: RC54_ROOTS,
      arms: DAY1_MANAGER_ARMS.length,
    }
  : {
      releaseId: DAY1_RELEASE_ID,
      hash: DAY1_CONFIG_HASH,
      workerVersion: "stream-2026-07-21b",
      roots: DAY1_ACTIVE_ROOTS,
      arms: DAY1_MANAGER_ARMS.length,
    };

export function observeActiveRelease(
  events: MarketEvent[],
  readState: Day1ReleaseReadState = "ok",
): ActiveReleaseObservation {
  const receipt = findSealedReleaseReceipt(events);
  const fallback = expectedFor("rc54");
  if (!receipt) {
    const state = readState === "checking" ? "checking" : readState === "error" ? "read-error" : "missing";
    return {
      state,
      lane: null,
      receipt: null,
      releaseId: fallback.releaseId,
      expectedHash: fallback.hash,
      workerVersion: fallback.workerVersion,
      roots: {},
      configuredManagerArms: 0,
      fact: state === "checking"
        ? "Checking the sealed startup-receipt read; no runtime lifecycle claim yet."
        : state === "read-error"
          ? "Release-receipt read failed; database rows cannot establish the active runtime lifecycle."
          : "No sealed startup receipt is present in the retained event view; runtime lifecycle is unverified.",
    };
  }
  const expected = expectedFor(receipt.lane);
  if (receipt.releaseId !== expected.releaseId || receipt.configHash !== expected.hash) {
    return {
      state: "mismatch",
      lane: receipt.lane,
      receipt,
      releaseId: expected.releaseId,
      expectedHash: expected.hash,
      workerVersion: expected.workerVersion,
      roots: {},
      configuredManagerArms: 0,
      fact: `Observed ${receipt.releaseId} ${receipt.configHash.slice(0, 10)}…; expected sealed ${expected.releaseId}.`,
    };
  }
  return {
    state: "verified",
    lane: receipt.lane,
    receipt,
    releaseId: expected.releaseId,
    expectedHash: expected.hash,
    workerVersion: expected.workerVersion,
    roots: expected.roots,
    configuredManagerArms: expected.arms,
    fact: `Exact ${expected.releaseId} startup receipt observed. Receipt identity is not a liveness claim.`,
  };
}

export function activeRootExitLabel(policy: ActiveRootPolicy, compact = false): string {
  const stop = `−${policy.premiumStopPct}%${compact ? "" : " catastrophe"}`;
  const manager = policy.managerProfileId === "RC53-RIDE"
    ? "RIDE"
    : policy.managerProfileId === "RC53-A13"
      ? compact ? "A13 +50%/⅔" : "A13 arm +50% / retain ⅔"
      : policy.managerProfileId === "ORB54-B30-A13"
        ? compact ? "B30/A13" : "bank 1 @ +30% / A13 runner"
        : policy.managerProfileId === "QQQ54-B20-NATIVE-ATR"
          ? compact ? "B20/ATR" : "bank 1 @ +20% / native ATR runner"
          : policy.managerProfileId === "LAB54-L30-L50"
            ? compact ? "B30/R50" : "bank 1 @ +30% / runner @ +50%"
            : compact ? "B50/A13" : "bank 1 @ +50% / A13 runner";
  return `${stop} · ${manager} · ${policy.eodEt}${compact ? "" : " ET"}`;
}
