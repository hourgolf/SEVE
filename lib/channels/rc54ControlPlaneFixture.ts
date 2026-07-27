import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  type AdmissionPolicySpec,
  type ChannelRatchetPolicy,
  type ChannelSpecVersionDraft,
  type ChannelTakeProfitPolicy,
  type ReleaseManifestDraft,
} from "./channelControlPlane";

const CREATED_AT = "2026-07-27T00:00:00.000Z";
const FIRST_TEAM = "cd817549-e025-4d38-805e-d32e607052f7";
const LAB = "56daa293-e6bc-447d-83ac-2bfafb4d0ac1";
const MORGUE = "995aa327-b0da-4050-bede-97ab462b06cd";

const identity = {
  "pb-ride": {
    channel: "5559f360a30db2aa94c9e3cefb954d7ff69373ed856a086c46a27bd41e1721ea",
    manager: "6f6ce7c9a07dc751cc4bf165248df8bed17e416d31b565f0fcc25663aed1c21b",
  },
  "orb-ustop-ctl": {
    channel: "54d7feede491bc3c6754e8cf501e777584ce9fa2e0ce6e4162c9b24858e7a57c",
    manager: "73f4e0653c590eb1826c7c03a55bf161a565428f12b682c3ae43603485fb28d5",
  },
  "grind-v3": {
    channel: "52ba206051f316be8df6b9c6b05d4ba67406e112772ba72a28e85c1b9f5819f2",
    manager: "6f6ce7c9a07dc751cc4bf165248df8bed17e416d31b565f0fcc25663aed1c21b",
  },
  "momo-shape": {
    channel: "09f04815385597ebec13f4c75e997a123d7dfda0e11145896a7aa4b7c157806c",
    manager: "c01d2380b0c462ae2b1cd8cf9e9e9bdb18c0b22fcfb36ad0e976d6d69bf4c1d6",
  },
  "orb-qqq-trail": {
    channel: "b28166ce917ab8eb638c734e05b661166c84b02ae2272c39002303b0d380d69b",
    manager: "51f6cd029e46a4c512458b95bf5982c39d460a2dc874af2a80b372f069ee843a",
  },
  "breakout-alt-v3-iwm": {
    channel: "945dcd65ffb41d5c67bae84e416ce7765e26d70cd2e055ae39aca998393d6525",
    manager: "6f6ce7c9a07dc751cc4bf165248df8bed17e416d31b565f0fcc25663aed1c21b",
  },
  "vb-macd-state": {
    channel: "00347e4f8cf91201cc33976b5a18aeef85e6345ac91d5e4978543b878b5a3ddd",
    manager: "f7ae1cbe1567463ecc08854f860af0bf109c658955cb1cf41b2cab1db781c64a",
  },
  "vb-squeeze-break": {
    channel: "9583c61606f17f6cf88bf8385fab58c13c33530fa53cf8f96a3075759f2b05c2",
    manager: "f7ae1cbe1567463ecc08854f860af0bf109c658955cb1cf41b2cab1db781c64a",
  },
  "vb-ribbon-cross-qqq": {
    channel: "df470a877dd557976710e24e256ff04e1f6d7bc303215e600fda852f95874f37",
    manager: "bb4bd167538d4b946855a93ddfac334061c02d73ecf1e8e4a2b7c044df54197c",
  },
} as const;

type FixtureSlug = keyof typeof identity;

const none: ChannelRatchetPolicy = {
  kind: "none",
  engageReturnPct: null,
  givebackPct: null,
  retainGainPct: null,
  fixedTargetPct: null,
};

const a13: ChannelRatchetPolicy = {
  kind: "a13",
  engageReturnPct: 50,
  givebackPct: 33,
  retainGainPct: 67,
  fixedTargetPct: null,
};

const fixed50: ChannelRatchetPolicy = {
  kind: "fixed-target",
  engageReturnPct: null,
  givebackPct: null,
  retainGainPct: null,
  fixedTargetPct: 50,
};

const nativeAtr: ChannelRatchetPolicy = {
  kind: "native-atr",
  engageReturnPct: null,
  givebackPct: null,
  retainGainPct: null,
  fixedTargetPct: null,
};

const ride: ChannelTakeProfitPolicy = { kind: "ride", targetPct: null, fraction: 0 };
const bank = (targetPct: number): ChannelTakeProfitPolicy => ({ kind: "bank", targetPct, fraction: 0.5 });

interface FixtureInput {
  slug: FixtureSlug;
  strategistId: string;
  accountId: string;
  accountRole: "FIRST-TEAM" | "LAB" | "MORGUE";
  cohort: "control" | "lab";
  domainId: "rc54-control" | "rc54-lab";
  familyId: string;
  underlying: "SPY" | "QQQ" | "IWM";
  priority: number;
  entryDte: 0 | 1;
  premiumCap: number;
  maxDebitUsd: number;
  managerProfileId: string;
  managerLabel: string;
  takeProfit: ChannelTakeProfitPolicy;
  ratchet: ChannelRatchetPolicy;
}

function fixtureSpec(input: FixtureInput): ChannelSpecVersionDraft {
  return {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: `spec:rc54:${input.slug}`,
    channelId: input.strategistId,
    slug: input.slug,
    strategyIdentity: `builtin:${input.slug}`,
    strategyVersion: `sha256:${identity[input.slug].channel}`,
    signalVersion: "legacy:signal-version-in-channel-hash",
    managerProfileId: input.managerProfileId,
    managerVersion: `sha256:${identity[input.slug].manager}`,
    accountId: input.accountId,
    accountRole: input.accountRole,
    accountMode: "paper",
    symbolScope: [input.underlying],
    familyId: input.familyId,
    cohort: input.cohort,
    priority: input.priority,
    quantity: 2,
    maxDebitUsd: input.maxDebitUsd,
    entryParameters: {
      entryDte: input.entryDte,
      strikeOffset: 0,
      premiumCap: input.premiumCap,
    },
    exitParameters: {
      accountName: input.accountRole,
      managerLabel: input.managerLabel,
      eodEt: "15:25",
      priceBasis: "executable-option-bid",
    },
    takeProfit: input.takeProfit,
    stopLoss: { catastrophePct: 30, priceBasis: "executable-option-bid" },
    ratchetParameters: input.ratchet,
    reentryPolicy: "disabled",
    scalePolicy: { adds: 0, pyramiding: "disabled" },
    collisionDomain: input.domainId,
    riskLimits: {
      maxContracts: 2,
      maxDebitUsd: input.maxDebitUsd,
      maxRiskUsd: input.maxDebitUsd * 0.30,
    },
    validFrom: CREATED_AT,
    validUntil: null,
    createdBy: "system:rc54-fixture",
    createdAt: CREATED_AT,
    parentVersionId: null,
    status: "active",
  };
}

export const RC54_CONTROL_PLANE_SPECS: ChannelSpecVersionDraft[] = [
  fixtureSpec({
    slug: "pb-ride", strategistId: "4528343d-7151-46ae-8f0d-10c0ef9572b4",
    accountId: FIRST_TEAM, accountRole: "FIRST-TEAM", cohort: "control", domainId: "rc54-control",
    familyId: "SPY-PB", underlying: "SPY", priority: 1, entryDte: 1, premiumCap: 3.50,
    maxDebitUsd: 700, managerProfileId: "RC53-RIDE",
    managerLabel: "RIDE · CATASTROPHE / EOD ONLY", takeProfit: ride, ratchet: none,
  }),
  fixtureSpec({
    slug: "orb-ustop-ctl", strategistId: "51ab6380-e0db-4e41-ad59-625b151cb9cf",
    accountId: MORGUE, accountRole: "MORGUE", cohort: "control", domainId: "rc54-control",
    familyId: "SPY-ORB", underlying: "SPY", priority: 4, entryDte: 0, premiumCap: 2.00,
    maxDebitUsd: 400, managerProfileId: "ORB54-B30-A13",
    managerLabel: "BANK 1 @ +30% · RUN 1 ON A13", takeProfit: bank(30), ratchet: a13,
  }),
  fixtureSpec({
    slug: "grind-v3", strategistId: "1dc15beb-79a5-4f49-9b9b-9b5693c93561",
    accountId: MORGUE, accountRole: "MORGUE", cohort: "control", domainId: "rc54-control",
    familyId: "SPY-GRIND", underlying: "SPY", priority: 2, entryDte: 0, premiumCap: 1.75,
    maxDebitUsd: 350, managerProfileId: "RC53-RIDE",
    managerLabel: "RIDE · CATASTROPHE / EOD ONLY", takeProfit: ride, ratchet: none,
  }),
  fixtureSpec({
    slug: "momo-shape", strategistId: "c2efcffa-b0bb-4cde-a3de-25209879ebe1",
    accountId: FIRST_TEAM, accountRole: "FIRST-TEAM", cohort: "control", domainId: "rc54-control",
    familyId: "SPY-MOMO", underlying: "SPY", priority: 3, entryDte: 0, premiumCap: 2.25,
    maxDebitUsd: 450, managerProfileId: "RC53-A13",
    managerLabel: "FULL A13 · ARM +50% · RETAIN ⅔", takeProfit: ride, ratchet: a13,
  }),
  fixtureSpec({
    slug: "orb-qqq-trail", strategistId: "62b108c8-535e-4232-8c68-af8fb5b8f932",
    accountId: FIRST_TEAM, accountRole: "FIRST-TEAM", cohort: "control", domainId: "rc54-control",
    familyId: "QQQ-ORB", underlying: "QQQ", priority: 1, entryDte: 0, premiumCap: 3.00,
    maxDebitUsd: 600, managerProfileId: "QQQ54-B20-NATIVE-ATR",
    managerLabel: "BANK 1 @ +20% · RUN 1 ON NATIVE ATR", takeProfit: bank(20), ratchet: nativeAtr,
  }),
  fixtureSpec({
    slug: "breakout-alt-v3-iwm", strategistId: "24889b0e-3ba7-4e47-9430-f73aa2c764a4",
    accountId: FIRST_TEAM, accountRole: "FIRST-TEAM", cohort: "control", domainId: "rc54-control",
    familyId: "IWM-BREAKOUT", underlying: "IWM", priority: 1, entryDte: 0, premiumCap: 1.25,
    maxDebitUsd: 250, managerProfileId: "RC53-RIDE",
    managerLabel: "RIDE · CATASTROPHE / EOD ONLY", takeProfit: ride, ratchet: none,
  }),
  fixtureSpec({
    slug: "vb-macd-state", strategistId: "3f75e694-34c3-4b68-8832-4351ce1af180",
    accountId: LAB, accountRole: "LAB", cohort: "lab", domainId: "rc54-lab",
    familyId: "LAB-SPY-MACD", underlying: "SPY", priority: 1, entryDte: 0, premiumCap: 1.75,
    maxDebitUsd: 350, managerProfileId: "LAB54-L30-L50",
    managerLabel: "BANK 1 @ +30% · RUN 1 TO +50%", takeProfit: bank(30), ratchet: fixed50,
  }),
  fixtureSpec({
    slug: "vb-squeeze-break", strategistId: "d73d9b4c-c57e-4d24-b899-53e31df2cf9a",
    accountId: LAB, accountRole: "LAB", cohort: "lab", domainId: "rc54-lab",
    familyId: "LAB-SPY-SQUEEZE", underlying: "SPY", priority: 2, entryDte: 0, premiumCap: 1.75,
    maxDebitUsd: 350, managerProfileId: "LAB54-L30-L50",
    managerLabel: "BANK 1 @ +30% · RUN 1 TO +50%", takeProfit: bank(30), ratchet: fixed50,
  }),
  fixtureSpec({
    slug: "vb-ribbon-cross-qqq", strategistId: "7a5191f4-013f-48d2-b1b8-de548c12861d",
    accountId: LAB, accountRole: "LAB", cohort: "lab", domainId: "rc54-lab",
    familyId: "LAB-QQQ-RIBBON", underlying: "QQQ", priority: 1, entryDte: 0, premiumCap: 1.75,
    maxDebitUsd: 350, managerProfileId: "LAB54-B50-A13",
    managerLabel: "BANK 1 @ +50% · RUN 1 ON A13", takeProfit: bank(50), ratchet: a13,
  }),
];

export const RC54_CONTROL_PLANE_ADMISSION_POLICIES: AdmissionPolicySpec[] = [
  {
    id: "rc54-control",
    enabledForNewEntries: true,
    maxOpenPerFamily: 1,
    maxOpenByUnderlying: { SPY: 2, QQQ: 1, IWM: 1 },
    maxOpenGlobal: 4,
    sameOccOpenMax: 1,
    reentry: "disabled",
    sameClockMaxByUnderlying: { SPY: 1, QQQ: 1, IWM: 1 },
    priorityBySlug: {
      "pb-ride": 1,
      "grind-v3": 2,
      "momo-shape": 3,
      "orb-ustop-ctl": 4,
      "orb-qqq-trail": 1,
      "breakout-alt-v3-iwm": 1,
    },
    crossDomainSameOcc: "allow-with-receipt",
  },
  {
    id: "rc54-lab",
    enabledForNewEntries: true,
    maxOpenPerFamily: 1,
    maxOpenByUnderlying: { SPY: 1, QQQ: 1, IWM: 0 },
    maxOpenGlobal: 2,
    sameOccOpenMax: 1,
    reentry: "disabled",
    sameClockMaxByUnderlying: { SPY: 1, QQQ: 1, IWM: 0 },
    priorityBySlug: {
      "vb-macd-state": 1,
      "vb-squeeze-break": 2,
      "vb-ribbon-cross-qqq": 1,
    },
    crossDomainSameOcc: "allow-with-receipt",
  },
];

/** Frozen compatibility fixture only. Neither runtime imports this value. */
export const RC54_CONTROL_PLANE_FIXTURE: ReleaseManifestDraft = {
  schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  id: "manifest:week2-2026-07-27-rc5.4",
  releaseId: "week2-2026-07-27-rc5.4",
  cohortId: "rc54-executable-2026-07-27",
  workerCompatibilityVersion: "stream-2026-07-27a",
  legacyConfigurationHash: "a1dda169e9c578e83f725c09b01af0af675d4ebc6d26e4c75fd1d520e828b227",
  paperLiveAuthority: "paper-only",
  admissionPolicyVersion: "rc54-admission-domain-v1",
  collisionPolicyVersion: "rc54-cross-domain-occ-v1",
  activationBoundary: "next-safe-entry",
  rollbackTargetManifestId: "legacy:weekend-day1-2026-07-21-rc5.3",
  channelSpecs: RC54_CONTROL_PLANE_SPECS,
  admissionPolicies: RC54_CONTROL_PLANE_ADMISSION_POLICIES,
  createdBy: "system:rc54-fixture",
  createdAt: CREATED_AT,
  parentManifestId: null,
  status: "active",
};
