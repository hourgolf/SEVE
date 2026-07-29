// Read-only RC5.4 composite replay against a frozen dark exact-path report.
// The output is local evidence only. It never touches Supabase, R2, the order
// path, runtime policy, roster, or account configuration.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  RC54_COMPOSITE_REPLAY_VERSION,
  replayRc54Composite,
  type Rc54CompositeId,
  type Rc54CompositeOutcome,
  type Rc54ReplayQuote,
} from "../lib/research/rc54CompositeReplay.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const REPORT = arg("report", "");
const RECEIPT = arg("receipt", "");
const OUTPUT = arg("output", "");
const MARKDOWN = arg("markdown", "");
if (!REPORT || !RECEIPT || !OUTPUT || !MARKDOWN)
  throw new Error("--report, --receipt, --output, and --markdown are required");

interface CandidatePayload {
  id: string;
  opportunity_id: string;
  channel_slug: string;
  occ_symbol: string;
  decision_observed_at: string;
  session_date_et: string;
}

interface Scorecard {
  candidateId: string;
  opportunityId: string;
  channelSlug: string;
  exactEntryAsk: number | null;
  exactEntryQuoteAtMs: number | null;
  censors: string[];
}

interface SourceObject {
  occSymbol: string;
  objectPath: string;
  contentSha256: string;
  compressedSha256: string;
  rows: number;
  rawRows: number;
  crossedQuoteRows: number;
}

interface FrozenReport {
  generatedAt: string;
  inputs: {
    freezeFileSha256: string;
    freezeCanonicalSha256: string;
  };
  candidatePayloads: CandidatePayload[];
  scorecards: Scorecard[];
  sourceObjects: SourceObject[];
  externalWrites: false;
  orderPathAuthorized: false;
  policyChangeAuthorized: false;
}

interface FrozenReceipt {
  version: string;
  sessionDateEt: string;
  reportSha256: string;
  freezeFileSha256: string;
  freezeCanonicalSha256: string;
  externalWrites: false;
  orderPathAuthorized: false;
  policyChangeAuthorized: false;
}

const PROFILE_CHANNELS: Record<Rc54CompositeId, string[]> = {
  "B30/A13": ["orb-ustop-ctl", "momo-shape"],
  "B20/NATIVE-ATR": ["orb-qqq-trail"],
  "L30/L50": ["vb-macd-state", "vb-squeeze-break"],
  "B50/A13": ["vb-ribbon-cross-qqq"],
};

const TARGET_CHANNELS = [...new Set(Object.values(PROFILE_CHANNELS).flat())];
const EXACT_OPTION_PROFILES: Rc54CompositeId[] = ["B30/A13", "L30/L50", "B50/A13"];

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const round = (value: number): number => Math.round(value * 100) / 100;

function etWallToUtcMs(dateEt: string, hour: number, minute: number): number {
  const noon = new Date(`${dateEt}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(noon);
  const localHour = Number(parts.find((part) => part.type === "hour")?.value ?? "12") % 24;
  const localMinute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return Date.parse(
    `${dateEt}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  ) + (12 * 60 - localHour * 60 - localMinute) * 60_000;
}

function readVerifiedQuotes(source: SourceObject): Rc54ReplayQuote[] {
  const compressed = readFileSync(source.objectPath);
  if (sha(compressed) !== source.compressedSha256)
    throw new Error(`compressed checksum mismatch: ${source.occSymbol}`);
  const bytes = gunzipSync(compressed);
  if (sha(bytes) !== source.contentSha256)
    throw new Error(`content checksum mismatch: ${source.occSymbol}`);
  const parsed = JSON.parse(bytes.toString("utf8")) as Array<{
    occSymbol: string;
    atMs: number;
    bid: number;
    ask: number;
    source: string;
  }>;
  if (parsed.length !== source.rows)
    throw new Error(`row count mismatch: ${source.occSymbol} ${parsed.length}/${source.rows}`);
  if (parsed.some((row) => row.occSymbol !== source.occSymbol
      || row.source !== "databento_cbbo_1s"
      || !finite(row.atMs) || !finite(row.bid) || !finite(row.ask)
      || row.bid < 0 || row.ask < 0 || (row.ask > 0 && row.ask < row.bid)))
    throw new Error(`invalid exact quote path: ${source.occSymbol}`);
  return parsed.map((row) => ({ atMs: row.atMs, bid: row.bid }));
}

interface ExactCandidate {
  candidate: CandidatePayload;
  scorecard: Scorecard;
  quotes: Rc54ReplayQuote[];
}

interface Path {
  candidateId: string;
  opportunityId: string;
  channelSlug: string;
  profile: Rc54CompositeId;
  decisionObservedAt: string;
  entryAsk: number;
  entryAt: string;
  exitAt: string;
  pnl: number;
  pnlPerContract: number;
  lots: Rc54CompositeOutcome["lots"];
  exact: true;
  independentOpportunity: true;
}

interface Censor {
  candidateId: string | null;
  channelSlug: string;
  profile: Rc54CompositeId;
  code: string;
  fact: string;
}

const reportBytes = readFileSync(REPORT);
const report = JSON.parse(reportBytes.toString("utf8")) as FrozenReport;
const receipt = JSON.parse(readFileSync(RECEIPT, "utf8")) as FrozenReceipt;
if (sha(reportBytes) !== receipt.reportSha256) throw new Error("report checksum mismatch");
if (report.inputs.freezeFileSha256 !== receipt.freezeFileSha256
    || report.inputs.freezeCanonicalSha256 !== receipt.freezeCanonicalSha256)
  throw new Error("freeze identity mismatch");
if (report.externalWrites !== false || report.orderPathAuthorized !== false
    || report.policyChangeAuthorized !== false
    || receipt.externalWrites !== false || receipt.orderPathAuthorized !== false
    || receipt.policyChangeAuthorized !== false)
  throw new Error("input receipt does not preserve the no-write/no-order/no-policy boundary");

const scorecards = new Map(report.scorecards.map((row) => [row.candidateId, row]));
const sources = new Map(report.sourceObjects.map((row) => [row.occSymbol, row]));
const quoteCache = new Map<string, Rc54ReplayQuote[]>();
const exactCandidates: ExactCandidate[] = [];
const censors: Censor[] = [];

for (const candidate of report.candidatePayloads
  .filter((row) => TARGET_CHANNELS.includes(row.channel_slug))
  .sort((a, b) => Date.parse(a.decision_observed_at) - Date.parse(b.decision_observed_at)
    || a.id.localeCompare(b.id))) {
  const profile = (Object.entries(PROFILE_CHANNELS)
    .find(([, channels]) => channels.includes(candidate.channel_slug))?.[0] ?? "B30/A13") as Rc54CompositeId;
  const scorecard = scorecards.get(candidate.id);
  if (!scorecard || scorecard.opportunityId !== candidate.opportunity_id
      || scorecard.channelSlug !== candidate.channel_slug
      || scorecard.censors.length || !finite(scorecard.exactEntryAsk)
      || scorecard.exactEntryAsk <= 0 || !finite(scorecard.exactEntryQuoteAtMs)) {
    censors.push({
      candidateId: candidate.id,
      channelSlug: candidate.channel_slug,
      profile,
      code: "candidate_scorecard_ineligible",
      fact: scorecard?.censors.join(",") || "missing or invalid exact scorecard",
    });
    continue;
  }
  const source = sources.get(candidate.occ_symbol);
  if (!source) {
    censors.push({
      candidateId: candidate.id,
      channelSlug: candidate.channel_slug,
      profile,
      code: "missing_verified_source_object",
      fact: candidate.occ_symbol,
    });
    continue;
  }
  let quotes = quoteCache.get(candidate.occ_symbol);
  if (!quotes) {
    quotes = readVerifiedQuotes(source);
    quoteCache.set(candidate.occ_symbol, quotes);
  }
  exactCandidates.push({ candidate, scorecard, quotes });
}

const paths: Path[] = [];
const activeUntil = new Map<string, number>();
for (const row of exactCandidates) {
  const decisionAtMs = Date.parse(row.candidate.decision_observed_at);
  const entryAtMs = row.scorecard.exactEntryQuoteAtMs as number;
  const flattenAtMs = etWallToUtcMs(row.candidate.session_date_et, 15, 25);
  for (const profile of EXACT_OPTION_PROFILES) {
    const result = replayRc54Composite({
      profile,
      entryAsk: row.scorecard.exactEntryAsk as number,
      entryAtMs,
      flattenAtMs,
      quotes: row.quotes,
    });
    if (!result.exact || result.exitAtMs == null || result.pnl == null
        || result.pnlPerContract == null) {
      censors.push({
        candidateId: row.candidate.id,
        channelSlug: row.candidate.channel_slug,
        profile,
        code: "composite_incomplete",
        fact: result.censors.join(",") || "unknown",
      });
      continue;
    }
    const lane = `${row.candidate.session_date_et}\u0000${row.candidate.channel_slug}\u0000${profile}`;
    const priorExitAt = activeUntil.get(lane);
    if (priorExitAt != null && decisionAtMs < priorExitAt) {
      censors.push({
        candidateId: row.candidate.id,
        channelSlug: row.candidate.channel_slug,
        profile,
        code: "sequential_reentry_active",
        fact: new Date(priorExitAt).toISOString(),
      });
      continue;
    }
    activeUntil.set(lane, result.exitAtMs);
    paths.push({
      candidateId: row.candidate.id,
      opportunityId: row.candidate.opportunity_id,
      channelSlug: row.candidate.channel_slug,
      profile,
      decisionObservedAt: row.candidate.decision_observed_at,
      entryAsk: result.entryAsk,
      entryAt: new Date(result.entryAtMs).toISOString(),
      exitAt: new Date(result.exitAtMs).toISOString(),
      pnl: result.pnl,
      pnlPerContract: result.pnlPerContract,
      lots: result.lots,
      exact: true,
      independentOpportunity: true,
    });
  }
}

for (const [profile, channels] of Object.entries(PROFILE_CHANNELS) as Array<[Rc54CompositeId, string[]]>) {
  for (const channelSlug of channels) {
    if (!report.candidatePayloads.some((row) => row.channel_slug === channelSlug)) {
      censors.push({
        candidateId: null,
        channelSlug,
        profile,
        code: "channel_absent_from_friday_freeze",
        fact: "zero frozen decision clocks",
      });
    }
  }
}
censors.push({
  candidateId: null,
  channelSlug: "orb-qqq-trail",
  profile: "B20/NATIVE-ATR",
  code: "native_atr_path_unavailable",
  fact: "the frozen option CBBO archive contains no underlying ATR/chandelier trail state",
});

interface Summary {
  channelSlug: string;
  profile: Rc54CompositeId;
  rawClocks: number;
  independentPaths: number;
  overlapCensors: number;
  incompleteCensors: number;
  pnl: number | null;
  avgPerPath: number | null;
  avgPerContract: number | null;
  wins: number;
  losses: number;
  winRatePct: number | null;
  exitMix: Record<string, number>;
}

const matrix: Summary[] = [];
for (const channelSlug of TARGET_CHANNELS) {
  for (const profile of EXACT_OPTION_PROFILES) {
    const rows = paths.filter((row) => row.channelSlug === channelSlug && row.profile === profile);
    const channelCensors = censors.filter((row) => row.channelSlug === channelSlug && row.profile === profile);
    const pnl = rows.length ? round(rows.reduce((sum, row) => sum + row.pnl, 0)) : null;
    const wins = rows.filter((row) => row.pnl > 0).length;
    const losses = rows.filter((row) => row.pnl < 0).length;
    const exitMix: Record<string, number> = {};
    for (const path of rows)
      for (const lot of path.lots)
        exitMix[lot.exitReason] = (exitMix[lot.exitReason] ?? 0) + 1;
    matrix.push({
      channelSlug,
      profile,
      rawClocks: report.candidatePayloads.filter((row) => row.channel_slug === channelSlug).length,
      independentPaths: rows.length,
      overlapCensors: channelCensors.filter((row) => row.code === "sequential_reentry_active").length,
      incompleteCensors: channelCensors.filter((row) => row.code !== "sequential_reentry_active").length,
      pnl,
      avgPerPath: pnl == null ? null : round(pnl / rows.length),
      avgPerContract: pnl == null ? null : round(pnl / rows.length / 2),
      wins,
      losses,
      winRatePct: rows.length ? round((wins / rows.length) * 100) : null,
      exitMix,
    });
  }
}

const intended = (Object.entries(PROFILE_CHANNELS) as Array<[Rc54CompositeId, string[]]>)
  .flatMap(([profile, channels]) => channels.map((channelSlug) => {
    if (profile === "B20/NATIVE-ATR") return {
      channelSlug,
      profile,
      state: "CENSORED" as const,
      reason: "native ATR/chandelier state is absent; option CBBO cannot substitute",
      summary: null,
    };
    const summary = matrix.find((row) => row.channelSlug === channelSlug && row.profile === profile) ?? null;
    return {
      channelSlug,
      profile,
      state: summary && summary.independentPaths > 0 ? "EXACT" as const : "NO_SAMPLE" as const,
      reason: summary && summary.independentPaths > 0
        ? "Databento CBBO-1s, sequenced per channel/profile"
        : "no Friday frozen decision clocks",
      summary,
    };
  }));

const output = {
  schemaVersion: 1,
  replayVersion: RC54_COMPOSITE_REPLAY_VERSION,
  generatedAt: new Date().toISOString(),
  sessionDateEt: receipt.sessionDateEt,
  source: {
    reportPath: REPORT,
    receiptPath: RECEIPT,
    reportSha256: receipt.reportSha256,
    freezeFileSha256: receipt.freezeFileSha256,
    freezeCanonicalSha256: receipt.freezeCanonicalSha256,
    verifiedSourceObjectsRead: quoteCache.size,
    verifiedSourceRowsRead: [...quoteCache.values()].reduce((sum, quotes) => sum + quotes.length, 0),
    crossedQuoteRowsExcludedUpstream: [...quoteCache.keys()]
      .reduce((sum, symbol) => sum + (sources.get(symbol)?.crossedQuoteRows ?? 0), 0),
    entryBasis: "last published executable ask at or before decision clock",
    exitBasis: "first executable bid crossing rule; otherwise last executable bid at or before 15:25 ET",
    sequencing: "candidate clocks sequenced independently per channel and composite profile",
  },
  profiles: {
    "B30/A13": "lot 1 +30%; lot 2 A13 arm +50% retain two thirds; -30% pre-arm; 15:25 ET",
    "B20/NATIVE-ATR": "lot 1 +20%; lot 2 native ATR/chandelier; -30%; 15:25 ET",
    "L30/L50": "lot 1 +30%; lot 2 +50%; -30%; 15:25 ET",
    "B50/A13": "lot 1 +50%; lot 2 A13 arm +50% retain two thirds; -30% pre-arm; 15:25 ET",
  },
  intended,
  matrix,
  paths,
  censors: censors.sort((a, b) => a.channelSlug.localeCompare(b.channelSlug)
    || a.profile.localeCompare(b.profile) || String(a.candidateId).localeCompare(String(b.candidateId))),
  interpretation: {
    exactMeans: "historical executable option CBBO replay under preregistered composite rules",
    doesNotMean: "production authorization, predicted future performance, or exact native ATR reconstruction",
    coverageBoundary: "Friday 2026-07-24 frozen dark decisions only",
  },
  externalWrites: false,
  orderPathAuthorized: false,
  policyChangeAuthorized: false,
  rosterChangeAuthorized: false,
};
writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);

const money = (value: number | null): string =>
  value == null ? "—" : `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(0)}`;
const pct = (value: number | null): string => value == null ? "—" : `${value.toFixed(1)}%`;
const md: string[] = [
  "# RC5.4 composite-manager exact replay",
  "",
  `Frozen session: **${receipt.sessionDateEt}**  `,
  `Replay: **${RC54_COMPOSITE_REPLAY_VERSION}**  `,
  `Report SHA-256: \`${receipt.reportSha256}\``,
  "",
  "## Bottom line",
  "",
  "- Three option-only composites were replayed exactly against verified Databento CBBO-1s paths.",
  "- Each profile kept its own channel lane; overlapping decision clocks were censored until the prior two-lot composite had fully exited.",
  "- `B20/NATIVE-ATR` is **CENSORED**, not estimated: the archive has option CBBO but no underlying ATR/chandelier trail state.",
  "- `momo-shape` and `orb-qqq-trail` had no Friday frozen decision clocks, so Friday alone cannot score them.",
  "",
  "## Intended assignment",
  "",
  "| Channel | Proposed composite | State | Independent paths | P&L | Avg/path | Win rate |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...intended.map((row) => {
    const summary = row.summary;
    return `| ${row.channelSlug} | ${row.profile} | ${row.state} | ${summary?.independentPaths ?? 0} | ${money(summary?.pnl ?? null)} | ${money(summary?.avgPerPath ?? null)} | ${pct(summary?.winRatePct ?? null)} |`;
  }),
  "",
  "## Cross-profile Friday matrix",
  "",
  "| Channel | Composite | Raw clocks | Independent | Overlap censors | P&L | Avg/path | Win rate |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  ...matrix.filter((row) => row.rawClocks > 0).map((row) =>
    `| ${row.channelSlug} | ${row.profile} | ${row.rawClocks} | ${row.independentPaths} | ${row.overlapCensors} | ${money(row.pnl)} | ${money(row.avgPerPath)} | ${pct(row.winRatePct)} |`),
  "",
  "## Interpretation guardrails",
  "",
  "- P&L is the sum of two one-contract lots and preserves actual bid overshoot at the first executable crossing.",
  "- Zero samples are not losses and are not evidence of fitness.",
  "- Friday is a one-session directional read, not the cumulative dossier.",
  "- This artifact changes no configuration, policy, roster, account, or order state.",
  "",
  `Verified source objects read: **${output.source.verifiedSourceObjectsRead}**  `,
  `Verified CBBO rows read: **${output.source.verifiedSourceRowsRead.toLocaleString()}**  `,
  `Upstream crossed rows excluded: **${output.source.crossedQuoteRowsExcludedUpstream}**`,
  "",
];
writeFileSync(MARKDOWN, `${md.join("\n")}\n`);

console.log(`rc54-composite-exact-replay: ${paths.length} independent exact paths`);
console.log(`  verified source objects: ${quoteCache.size}`);
console.log(`  censors: ${censors.length}`);
console.log(`  json: ${OUTPUT}`);
console.log(`  markdown: ${MARKDOWN}`);
console.log("  external writes: NONE — local evidence only; no orders/policy/roster changes");
