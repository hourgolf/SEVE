export interface ExactManagerSummary {
  managerId: string;
  paths: number;
  winners: number;
  pnlPerContract: number;
  averagePerPath: number;
}

export interface ExactChannelInteraction {
  slug: string;
  managerId: string;
  paths: number;
  managerPnlPerContract: number;
  bellPnlPerContract: number;
  note: string;
}

export interface ExactShadowReceipt {
  session: string;
  state: "ok" | "partial";
  rawCandidates: number;
  exactEligible: number;
  exactCensored: number;
  exactMissing: number;
  completedManagerArms: number;
  expectedManagerArms: number;
  independentManagerPaths: number;
  vbManagerPaths: number;
  basis: string;
  candidateSha256: string;
  reportSha256: string;
  managers: ExactManagerSummary[];
  interactions: ExactChannelInteraction[];
}

/**
 * Compact, immutable summaries of completed local exact replays. The full
 * scorecards remain content-addressed under data/; this archive lets the
 * private dashboard expose the last reviewed receipt without shipping the
 * multi-megabyte provider objects to the browser.
 */
export const EXACT_SHADOW_ARCHIVE: readonly ExactShadowReceipt[] = [{
  session: "2026-07-21",
  state: "partial",
  rawCandidates: 138,
  exactEligible: 124,
  exactCensored: 14,
  exactMissing: 0,
  completedManagerArms: 995,
  expectedManagerArms: 1_107,
  independentManagerPaths: 993,
  vbManagerPaths: 830,
  basis: "Databento CBBO-1s entry ask → executable bid",
  candidateSha256: "f438c3d0874bbfd6a0fdc19ce480504dccf5fbd083e0ebb413226e4553887811",
  reportSha256: "44c5299b4660df1f8873e09b1182b5a05b4f7a634aa47b193962d790e986e6c5",
  managers: [
    { managerId: "WIDE20/50", paths: 103, winners: 65, pnlPerContract: 346, averagePerPath: 3.36 },
    { managerId: "LOCK20/30", paths: 104, winners: 63, pnlPerContract: 288, averagePerPath: 2.77 },
    { managerId: "BANK20/RUN50", paths: 104, winners: 63, pnlPerContract: 161, averagePerPath: 1.55 },
    { managerId: "BELL/no-stop", paths: 103, winners: 52, pnlPerContract: 63, averagePerPath: 0.61 },
    { managerId: "ARM20/HALF-GIVEBACK", paths: 104, winners: 63, pnlPerContract: 40, averagePerPath: 0.38 },
    { managerId: "BELL/-30", paths: 104, winners: 49, pnlPerContract: -10, averagePerPath: -0.10 },
    { managerId: "LOCK50/30", paths: 104, winners: 49, pnlPerContract: -36, averagePerPath: -0.35 },
    { managerId: "LOCK30/30", paths: 104, winners: 52, pnlPerContract: -87, averagePerPath: -0.84 },
  ],
  interactions: [
    {
      slug: "vb-gap-drift-qqq",
      managerId: "WIDE20/50",
      paths: 3,
      managerPnlPerContract: 140,
      bellPnlPerContract: 21,
      note: "wide tolerance retained materially more of three exact paths",
    },
    {
      slug: "vb-curl-reversal-qqq",
      managerId: "LOCK20/30",
      paths: 6,
      managerPnlPerContract: 53,
      bellPnlPerContract: -54,
      note: "early locking reversed a negative bell cohort",
    },
    {
      slug: "vb-macd-state-iwm",
      managerId: "LOCK20/30",
      paths: 5,
      managerPnlPerContract: 57,
      bellPnlPerContract: 37,
      note: "five of five exact paths positive under the lock arm",
    },
  ],
}] as const;

export const exactShadowReceipt = (session: string): ExactShadowReceipt | null =>
  EXACT_SHADOW_ARCHIVE.find((receipt) => receipt.session === session) ?? null;
