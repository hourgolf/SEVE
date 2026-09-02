// Preregistered, evidence-only comparisons for the first Decision Atlas
// retune cohort. These definitions never participate in admission, sizing,
// routing, orders, or executable exits. They only label future source signals
// so the nightly read-only Atlas can compare one alternative with its control.

export const BOUNDED_RETUNE_REGISTRY_SCHEMA = "bounded-retune-registry-v1" as const;
export const BOUNDED_RETUNE_SIGNAL_SCHEMA = "bounded-retune-signal-v1" as const;
export const PRIORITY_A_RETUNE_COHORT_START = "2026-08-10" as const;
export const PRIORITY_A_RETUNE_SECOND_COHORT_START = "2026-08-11" as const;

export type BoundedRetuneVariable = "max_entries_per_session" | "take_profit_pct";

export interface BoundedRetuneBaseline {
  sourceContentHash: string;
  maxContracts: number;
  configuredPremiumStopPct: number | null;
  takeProfitPct: number;
}

export interface BoundedRetuneExperimentDefinition {
  schema: typeof BOUNDED_RETUNE_REGISTRY_SCHEMA;
  experimentId: string;
  priority: "A";
  channel: string;
  strategistId: string;
  cohortStartSession: string;
  variable: BoundedRetuneVariable;
  controlValue: number | null;
  alternativeValue: number;
  baseline: BoundedRetuneBaseline;
  hypothesis: string;
  fixed: readonly string[];
  sourceEvidence: {
    throughSession: string;
    sessions: number;
    logicalOutcomes: number;
    configurationCertainty: "historical_unstamped";
  };
  minimumEvidence: {
    sessions: 5;
    logicalOutcomes: 10;
    pairedSessionImprovement: 0.6;
  };
  executionAuthority: false;
}

export interface BoundedRetuneSignalStamp {
  schema: typeof BOUNDED_RETUNE_SIGNAL_SCHEMA;
  experimentId: string;
  channel: string;
  cohortStartSession: string;
  variable: BoundedRetuneVariable;
  controlValue: number | null;
  alternativeValue: number;
  observedBaseline: BoundedRetuneBaseline;
  baselineMatches: boolean;
  mismatches: string[];
  executionAuthority: false;
}

type DefinitionInput = Omit<BoundedRetuneExperimentDefinition,
  "schema" | "experimentId" | "priority" | "cohortStartSession" | "minimumEvidence" | "executionAuthority">
  & { version?: number; cohortStartSession?: string };

const define = (input: DefinitionInput): BoundedRetuneExperimentDefinition => {
  const { version = 1, cohortStartSession = PRIORITY_A_RETUNE_COHORT_START, ...definition } = input;
  return Object.freeze({
    schema: BOUNDED_RETUNE_REGISTRY_SCHEMA,
    experimentId: `priority-a:${input.channel}:${input.variable}:v${version}`,
    priority: "A",
    cohortStartSession,
    minimumEvidence: { sessions: 5, logicalOutcomes: 10, pairedSessionImprovement: 0.6 } as const,
    executionAuthority: false,
    ...definition,
  });
};

const entryCap = (input: {
  channel: string; strategistId: string; sourceContentHash: string;
  takeProfitPct: number; premiumStopPct: number | null; maxContracts: number;
  cap: number; sessions: number; outcomes: number;
  version?: number; cohortStartSession?: string; throughSession?: string;
}): BoundedRetuneExperimentDefinition => define({
  channel: input.channel,
  strategistId: input.strategistId,
  variable: "max_entries_per_session",
  controlValue: null,
  alternativeValue: input.cap,
  baseline: {
    sourceContentHash: input.sourceContentHash,
    maxContracts: input.maxContracts,
    configuredPremiumStopPct: input.premiumStopPct,
    takeProfitPct: input.takeProfitPct,
  },
  hypothesis: `Limiting this channel to ${input.cap} scored entr${input.cap === 1 ? "y" : "ies"} per session will improve the typical session without worsening the weak-session tail.`,
  fixed: ["entry rules", "contract selection", "native exit", "manager", "size"],
  sourceEvidence: { throughSession: input.throughSession ?? "2026-08-07", sessions: input.sessions,
    logicalOutcomes: input.outcomes, configurationCertainty: "historical_unstamped" },
  version: input.version,
  cohortStartSession: input.cohortStartSession,
});

const profitCapture = (input: {
  channel: string; strategistId: string; sourceContentHash: string;
  control: number; alternative: number; premiumStopPct: number | null;
  maxContracts: number; sessions: number; outcomes: number;
  version?: number; cohortStartSession?: string; throughSession?: string;
}): BoundedRetuneExperimentDefinition => define({
  channel: input.channel,
  strategistId: input.strategistId,
  variable: "take_profit_pct",
  controlValue: input.control,
  alternativeValue: input.alternative,
  baseline: {
    sourceContentHash: input.sourceContentHash,
    maxContracts: input.maxContracts,
    configuredPremiumStopPct: input.premiumStopPct,
    takeProfitPct: input.control,
  },
  hypothesis: `Capturing at +${input.alternative}% instead of +${input.control}% will retain more of the channel's typical favorable move without worsening the weak-session tail.`,
  fixed: ["entry rules", "contract selection", "premium stop", "manager", "size"],
  sourceEvidence: { throughSession: input.throughSession ?? "2026-08-07", sessions: input.sessions,
    logicalOutcomes: input.outcomes, configurationCertainty: "historical_unstamped" },
  version: input.version,
  cohortStartSession: input.cohortStartSession,
});

export const PRIORITY_A_BOUNDED_RETUNES: readonly BoundedRetuneExperimentDefinition[] = Object.freeze([
  entryCap({ channel: "vb-vwap-revert", strategistId: "0c035bda-0955-4ccf-9ae8-83df6d844cbc", sourceContentHash: "sha256:0d807bcef7530aa1baf08ff6b7d5b2cc3227764c60c3ba3cb74da16d3be21eaa", takeProfitPct: 15, premiumStopPct: 30, maxContracts: 6, cap: 2, sessions: 26, outcomes: 160 }),
  profitCapture({ channel: "vb-curl-reversal-iwm", strategistId: "655b6d41-a9b8-4dfe-a99e-3b20cc71b55d", sourceContentHash: "sha256:e1e5fe2c6983a3f607d2f4098e56e8e73e0c03fd70c42afa12fd6ab38df47a85", control: 20, alternative: 15, premiumStopPct: 30, maxContracts: 6, sessions: 25, outcomes: 151 }),
  entryCap({ channel: "vb-curl-reversal-qqq", strategistId: "de9dbd11-3b5b-4d4e-afba-615b1cbf41b2", sourceContentHash: "sha256:e1e5fe2c6983a3f607d2f4098e56e8e73e0c03fd70c42afa12fd6ab38df47a85", takeProfitPct: 20, premiumStopPct: 30, maxContracts: 6, cap: 2, sessions: 25, outcomes: 149 }),
  profitCapture({ channel: "vb-pm-trend-iwm", strategistId: "a29232be-0449-4d7b-9f34-5f4f7f6ac321", sourceContentHash: "sha256:ff0c6333a62d23274b3cc90614223470f4648d3254caf2931b0cdbea332ca34b", control: 25, alternative: 15, premiumStopPct: 30, maxContracts: 6, sessions: 25, outcomes: 143 }),
  entryCap({ channel: "vb-squeeze-break", strategistId: "d73d9b4c-c57e-4d24-b899-53e31df2cf9a", sourceContentHash: "sha256:cbe3579d0fbc1639da1702b55b94e3efd4e3f55c497e3b9097f230132269ed1a", takeProfitPct: 25, premiumStopPct: 30, maxContracts: 6, cap: 2, sessions: 24, outcomes: 147 }),
  entryCap({ channel: "vb-ribbon-cross-iwm", strategistId: "7a4f2a8e-232b-49b1-83cf-5e0d7a26c502", sourceContentHash: "sha256:23c94c008c333663c94f3db986a6c2a68164a4eb6d837a5a6c2ff08e98fb93cf", takeProfitPct: 25, premiumStopPct: 30, maxContracts: 6, cap: 1, sessions: 24, outcomes: 60 }),
  entryCap({ channel: "vb-or-fail", strategistId: "a529f0ff-3208-4e1e-8ab4-9089fc114bc8", sourceContentHash: "sha256:1160a13ee12b97830bc53e907ebc26221195f41ca92787b760c85bf51d7f0852", takeProfitPct: 15, premiumStopPct: 30, maxContracts: 6, cap: 1, sessions: 22, outcomes: 58 }),
  profitCapture({ channel: "vb-macd-state-qqq", strategistId: "8f362aaf-d05a-46f9-a22d-64c1f53bb951", sourceContentHash: "sha256:cbcbe1729dc0f1e4df272ff7962307bbbd0bf8a8a6a3da30c056b901084b4dd8", control: 25, alternative: 15, premiumStopPct: 30, maxContracts: 6, sessions: 21, outcomes: 119 }),
  profitCapture({ channel: "vb-gap-drift-qqq", strategistId: "9ff7d7a4-ad33-44bd-a0f4-f6b9949329a4", sourceContentHash: "sha256:895dffdd7a8a03d583c0e4b1a1ba8dff241bb5af5fa248a8c83dee3b5034cbf3", control: 25, alternative: 15, premiumStopPct: 30, maxContracts: 6, sessions: 21, outcomes: 108 }),
  entryCap({ channel: "vb-level-break", strategistId: "9760dd1c-63ce-4837-9886-b09ee9f74445", sourceContentHash: "sha256:81a7c02831df0d4e8fe6a73575b15aad6af4c1f13582a32dade29fad7575ba18", takeProfitPct: 25, premiumStopPct: 30, maxContracts: 6, cap: 2, sessions: 20, outcomes: 92 }),
  entryCap({ channel: "vb-rsi-revert", strategistId: "1106ccc3-6eda-449e-a5bd-b76e839105df", sourceContentHash: "sha256:c2bc7660d2472ffdfbafd844e5e0b5d23bee57fd6769c36e4e23a3722a581427", takeProfitPct: 15, premiumStopPct: 30, maxContracts: 6, cap: 1, sessions: 20, outcomes: 47 }),
  profitCapture({ channel: "vb-level-break-qqq", strategistId: "9e67d860-e2f6-4048-b12a-3a1620260961", sourceContentHash: "sha256:81a7c02831df0d4e8fe6a73575b15aad6af4c1f13582a32dade29fad7575ba18", control: 25, alternative: 15, premiumStopPct: 30, maxContracts: 6, sessions: 19, outcomes: 101 }),
  entryCap({ channel: "vb-or-fail-iwm", strategistId: "cb7c6f62-6289-4b05-853b-bc1c8561bd15", sourceContentHash: "sha256:1160a13ee12b97830bc53e907ebc26221195f41ca92787b760c85bf51d7f0852", takeProfitPct: 15, premiumStopPct: 30, maxContracts: 6, cap: 1, sessions: 19, outcomes: 44 }),
  profitCapture({ channel: "vb-level-break-iwm", strategistId: "13c4dd2b-e5f8-4b7f-9dd6-2f2d9e138c36", sourceContentHash: "sha256:81a7c02831df0d4e8fe6a73575b15aad6af4c1f13582a32dade29fad7575ba18", control: 25, alternative: 15, premiumStopPct: 30, maxContracts: 6, sessions: 18, outcomes: 77 }),
  entryCap({ channel: "vb-rsi-revert-qqq", strategistId: "3127526f-2ce0-4e66-a330-db0048ede0e3", sourceContentHash: "sha256:c2bc7660d2472ffdfbafd844e5e0b5d23bee57fd6769c36e4e23a3722a581427", takeProfitPct: 15, premiumStopPct: 30, maxContracts: 6, cap: 1, sessions: 18, outcomes: 47 }),
  entryCap({ channel: "vb-rsi-revert-iwm", strategistId: "0316fc6c-facc-4ba1-8984-b1ba57f637c7", sourceContentHash: "sha256:c2bc7660d2472ffdfbafd844e5e0b5d23bee57fd6769c36e4e23a3722a581427", takeProfitPct: 15, premiumStopPct: 30, maxContracts: 6, cap: 1, sessions: 18, outcomes: 45 }),
  entryCap({ channel: "vb-curl-reversal", strategistId: "cb33b04b-4fd5-4b24-b27d-8d611806391e", sourceContentHash: "sha256:e1e5fe2c6983a3f607d2f4098e56e8e73e0c03fd70c42afa12fd6ab38df47a85", takeProfitPct: 15, premiumStopPct: 30, maxContracts: 6, cap: 4, sessions: 22, outcomes: 103, version: 2, cohortStartSession: PRIORITY_A_RETUNE_SECOND_COHORT_START, throughSession: "2026-08-10" }),
  entryCap({ channel: "vb-squeeze-break-qqq", strategistId: "b25a3cac-9b88-4a04-a08a-ed4f9cf60774", sourceContentHash: "sha256:cbe3579d0fbc1639da1702b55b94e3efd4e3f55c497e3b9097f230132269ed1a", takeProfitPct: 16, premiumStopPct: 30, maxContracts: 8, cap: 2, sessions: 16, outcomes: 89 }),
  entryCap({ channel: "breakout-alt-v3-er40", strategistId: "f6dc511a-cbe6-4c3a-b550-aefac92949d2", sourceContentHash: "sha256:19f06ab84c5f31267c1af03b0f486d927bd24f186e2079fb0cea0e2b80244185", takeProfitPct: 22, premiumStopPct: 30, maxContracts: 6, cap: 2, sessions: 15, outcomes: 39, version: 2, cohortStartSession: PRIORITY_A_RETUNE_SECOND_COHORT_START, throughSession: "2026-08-10" }),
  entryCap({ channel: "breakout-alt-v3-ctl", strategistId: "c41d7766-0ecc-4cd0-8aa4-90a97c1e811c", sourceContentHash: "sha256:39f8c4680822ac9c901459a5ae87da201f5e8fc61516b5032b0f9f83b9f8d362", takeProfitPct: 22, premiumStopPct: 30, maxContracts: 6, cap: 2, sessions: 11, outcomes: 27, cohortStartSession: PRIORITY_A_RETUNE_SECOND_COHORT_START, throughSession: "2026-08-10" }),
  entryCap({ channel: "breakout-qqq", strategistId: "d6ae3c1c-f342-4232-be37-6c8a713d147e", sourceContentHash: "sha256:fcade6680aeab67ee4d027ab5c5b00e7678b58626818330e5abde697949bccdb", takeProfitPct: 22, premiumStopPct: 30, maxContracts: 12, cap: 2, sessions: 14, outcomes: 37, cohortStartSession: PRIORITY_A_RETUNE_SECOND_COHORT_START, throughSession: "2026-08-10" }),
  entryCap({ channel: "orb-trend-rider", strategistId: "d0447495-d877-40f4-8e99-6262abe31f7c", sourceContentHash: "sha256:080b4e62927947143d1cf6ef037493097f1d9eda88be0a3deb57e9c956476f1b", takeProfitPct: 30, premiumStopPct: 35, maxContracts: 6, cap: 3, sessions: 20, outcomes: 82, cohortStartSession: PRIORITY_A_RETUNE_SECOND_COHORT_START, throughSession: "2026-08-10" }),
  entryCap({ channel: "pb-ride-2", strategistId: "f7a38527-0ed6-41ec-b3f0-32be3e9f9c93", sourceContentHash: "sha256:9bd18ffc5a9c35510fc3879d3575070aa400b489d3eb036a7c28bdefced7d0d5", takeProfitPct: 20, premiumStopPct: 30, maxContracts: 10, cap: 3, sessions: 17, outcomes: 72, cohortStartSession: PRIORITY_A_RETUNE_SECOND_COHORT_START, throughSession: "2026-08-10" }),
  entryCap({ channel: "vb-or-fail-qqq", strategistId: "5b8e4fb8-4cbf-4b9e-bdaa-c9df45701b17", sourceContentHash: "sha256:1160a13ee12b97830bc53e907ebc26221195f41ca92787b760c85bf51d7f0852", takeProfitPct: 15, premiumStopPct: 30, maxContracts: 6, cap: 2, sessions: 17, outcomes: 29, cohortStartSession: PRIORITY_A_RETUNE_SECOND_COHORT_START, throughSession: "2026-08-10" }),
  entryCap({ channel: "pb-ride-itm", strategistId: "c92a9589-8fc1-4044-8f18-dd82a655cc4c", sourceContentHash: "sha256:9bd18ffc5a9c35510fc3879d3575070aa400b489d3eb036a7c28bdefced7d0d5", takeProfitPct: 10, premiumStopPct: 30, maxContracts: 10, cap: 1, sessions: 4, outcomes: 14, version: 2, cohortStartSession: "2026-09-03", throughSession: "2026-09-02" }),
  entryCap({ channel: "grind-v3-2", strategistId: "de16c693-5e11-4dd1-96ad-623f7790e622", sourceContentHash: "sha256:9bd18ffc5a9c35510fc3879d3575070aa400b489d3eb036a7c28bdefced7d0d5", takeProfitPct: 7, premiumStopPct: 35, maxContracts: 12, cap: 1, sessions: 4, outcomes: 14, version: 2, cohortStartSession: "2026-09-03", throughSession: "2026-09-02" }),
]);

// Historical definitions remain parseable so already-captured source stamps
// retain provenance. They are deliberately excluded from the active lookup
// used by the worker, readiness gate, and nightly experiment book.
export const ARCHIVED_BOUNDED_RETUNES: readonly BoundedRetuneExperimentDefinition[] = Object.freeze([
  entryCap({ channel: "vb-pm-trend", strategistId: "eb9dd168-af86-4396-bb22-c70594112a64", sourceContentHash: "sha256:ff0c6333a62d23274b3cc90614223470f4648d3254caf2931b0cdbea332ca34b", takeProfitPct: 25, premiumStopPct: 30, maxContracts: 6, cap: 2, sessions: 26, outcomes: 144 }),
  profitCapture({ channel: "power", strategistId: "9db955de-d656-4627-85fd-41126fddcd33", sourceContentHash: "sha256:9bd18ffc5a9c35510fc3879d3575070aa400b489d3eb036a7c28bdefced7d0d5", control: 75, alternative: 20, premiumStopPct: null, maxContracts: 6, sessions: 15, outcomes: 33 }),
  entryCap({ channel: "power-smart-entries", strategistId: "7e6ba601-3459-49eb-be21-b50cbaf06ad2", sourceContentHash: "sha256:d919461ac96aa52c18f9da4a9886e3faf092c68be2965c00a91d2dc4684c0b30", takeProfitPct: 70, premiumStopPct: null, maxContracts: 6, cap: 1, sessions: 15, outcomes: 32 }),
  entryCap({ channel: "breakout-alt-v3-er40", strategistId: "f6dc511a-cbe6-4c3a-b550-aefac92949d2", sourceContentHash: "sha256:19f06ab84c5f31267c1af03b0f486d927bd24f186e2079fb0cea0e2b80244185", takeProfitPct: 22, premiumStopPct: 30, maxContracts: 6, cap: 1, sessions: 15, outcomes: 39 }),
  entryCap({ channel: "vb-curl-reversal", strategistId: "cb33b04b-4fd5-4b24-b27d-8d611806391e", sourceContentHash: "sha256:e1e5fe2c6983a3f607d2f4098e56e8e73e0c03fd70c42afa12fd6ab38df47a85", takeProfitPct: 15, premiumStopPct: 30, maxContracts: 6, cap: 2, sessions: 17, outcomes: 103 }),
]);

const BY_CHANNEL = new Map(PRIORITY_A_BOUNDED_RETUNES.map((row) => [row.channel, row]));
const BY_ID = new Map([...PRIORITY_A_BOUNDED_RETUNES, ...ARCHIVED_BOUNDED_RETUNES]
  .map((row) => [row.experimentId, row]));

export const boundedRetuneForChannel = (channel: string): BoundedRetuneExperimentDefinition | null =>
  BY_CHANNEL.get(channel) ?? null;

export const boundedRetuneById = (experimentId: string): BoundedRetuneExperimentDefinition | null =>
  BY_ID.get(experimentId) ?? null;

export function buildBoundedRetuneSignalStamp(input: {
  channel: string;
  sourceContentHash: string;
  maxContracts: number;
  configuredPremiumStopPct: number | null;
  takeProfitPct: number;
}): BoundedRetuneSignalStamp | null {
  const definition = boundedRetuneForChannel(input.channel);
  if (!definition) return null;
  const observedBaseline: BoundedRetuneBaseline = {
    sourceContentHash: input.sourceContentHash,
    maxContracts: input.maxContracts,
    configuredPremiumStopPct: input.configuredPremiumStopPct,
    takeProfitPct: input.takeProfitPct,
  };
  const mismatches = (Object.keys(definition.baseline) as Array<keyof BoundedRetuneBaseline>)
    .filter((key) => observedBaseline[key] !== definition.baseline[key]);
  return {
    schema: BOUNDED_RETUNE_SIGNAL_SCHEMA,
    experimentId: definition.experimentId,
    channel: definition.channel,
    cohortStartSession: definition.cohortStartSession,
    variable: definition.variable,
    controlValue: definition.controlValue,
    alternativeValue: definition.alternativeValue,
    observedBaseline,
    baselineMatches: mismatches.length === 0,
    mismatches,
    executionAuthority: false,
  };
}

export function parseBoundedRetuneSignalStamp(value: unknown): BoundedRetuneSignalStamp | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const definition = typeof row.experimentId === "string" ? boundedRetuneById(row.experimentId) : null;
  if (!definition || row.schema !== BOUNDED_RETUNE_SIGNAL_SCHEMA || row.channel !== definition.channel
    || row.cohortStartSession !== definition.cohortStartSession || row.variable !== definition.variable
    || row.controlValue !== definition.controlValue || row.alternativeValue !== definition.alternativeValue
    || row.executionAuthority !== false || typeof row.baselineMatches !== "boolean"
    || !Array.isArray(row.mismatches) || !row.observedBaseline || typeof row.observedBaseline !== "object") return null;
  const baseline = row.observedBaseline as Record<string, unknown>;
  if (typeof baseline.sourceContentHash !== "string" || typeof baseline.maxContracts !== "number"
    || (baseline.configuredPremiumStopPct != null && typeof baseline.configuredPremiumStopPct !== "number")
    || typeof baseline.takeProfitPct !== "number") return null;
  return row as unknown as BoundedRetuneSignalStamp;
}
