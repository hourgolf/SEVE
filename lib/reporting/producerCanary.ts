export const REPORTING_PRODUCER_CANARY_VERSION = "reporting-producer-canary-v1" as const;
export type ReportingProducerKind = "daily" | "weekly";

export interface ReportingProducerCanaryInput {
  kind: ReportingProducerKind;
  targetDate: string;
  row: Record<string, unknown> | null;
  publicationVersions: readonly { report_kind: string; report_date: string; archived_at: string; payload: Record<string, unknown> }[];
}

export interface ReportingProducerCanaryResult {
  version: typeof REPORTING_PRODUCER_CANARY_VERSION;
  kind: ReportingProducerKind;
  targetDate: string;
  state: "pass" | "pending" | "fail";
  checks: Array<{ id: string; state: "pass" | "fail"; detail: string }>;
  blockers: string[];
  productionWrites: 0;
}

const object = (value: unknown): Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value != null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
};
const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`));

export function assessReportingProducerCanary(input: ReportingProducerCanaryInput): ReportingProducerCanaryResult {
  if (!validDate(input.targetDate)) throw new Error("reporting canary targetDate must be YYYY-MM-DD");
  if (!input.row) return { version: REPORTING_PRODUCER_CANARY_VERSION, kind: input.kind,
    targetDate: input.targetDate, state: "pending", checks: [], blockers: ["target report has not been published"], productionWrites: 0 };
  const row = input.row;
  const digest = object(row.digest);
  const evidence = object(digest.evidence);
  const dateField = input.kind === "daily" ? "report_date" : "week_end";
  const digestDateField = input.kind === "daily" ? "date" : "weekEnd";
  const checks: ReportingProducerCanaryResult["checks"] = [];
  const check = (id: string, condition: boolean, detail: string): void => {
    checks.push({ id, state: condition ? "pass" : "fail", detail });
  };
  check("row-date", row[dateField] === input.targetDate, `${dateField}=${String(row[dateField] ?? "missing")}`);
  check("digest-date", digest[digestDateField] === input.targetDate, `${digestDateField}=${String(digest[digestDateField] ?? "missing")}`);
  check("paper-mode", row.mode === "paper" && digest.mode === "paper", `row=${String(row.mode)} digest=${String(digest.mode)}`);
  check("producer-version", evidence.producerVersion === "seve-reporting-v3", `producerVersion=${String(evidence.producerVersion ?? "missing")}`);
  check("schema", evidence.schemaVersion === 3, `schemaVersion=${String(evidence.schemaVersion ?? "missing")}`);
  check("unit", evidence.unit === "logical_trade", `unit=${String(evidence.unit ?? "missing")}`);
  check("layer", evidence.layer === "historical_executed", `layer=${String(evidence.layer ?? "missing")}`);
  check("scope", evidence.scope === "all_configured_paper_accounts", `scope=${String(evidence.scope ?? "missing")}`);
  check("money-unit", evidence.moneyUnit === "whole_position_usd_gross", `moneyUnit=${String(evidence.moneyUnit ?? "missing")}`);
  check("timezone", evidence.sessionTimezone === "America/New_York", `sessionTimezone=${String(evidence.sessionTimezone ?? "missing")}`);
  check("modern-boundary", evidence.historicalAttribution == null && evidence.historicalBoundaryWarning == null,
    "modern report must not be projected through the historical broker-audit boundary");
  check("fund", Number.isFinite(Number(object(digest.fund).trades)) && Number(object(digest.fund).trades) >= 0,
    `fund.trades=${String(object(digest.fund).trades ?? "missing")}`);
  check("channels", Array.isArray(digest.channels), `channels=${Array.isArray(digest.channels) ? digest.channels.length : "missing"}`);
  if (input.kind === "weekly") {
    check("weekly-requested-through", evidence.requestedThrough === input.targetDate,
      `requestedThrough=${String(evidence.requestedThrough ?? "missing")}`);
    check("weekly-source-days", Array.isArray(evidence.sourceDailyReports) && evidence.sourceDailyReports.length > 0,
      `sourceDailyReports=${Array.isArray(evidence.sourceDailyReports) ? evidence.sourceDailyReports.length : "missing"}`);
  }
  const versions = input.publicationVersions.filter((version) => version.report_kind === input.kind && version.report_date === input.targetDate);
  check("publication-version", versions.length > 0, `versions=${versions.length}`);
  const rowDigest = canonical(row.digest);
  check("publication-payload", versions.some((version) => canonical(version.payload?.digest) === rowDigest),
    "an immutable publication version must contain the current digest");
  const blockers = checks.filter((item) => item.state === "fail").map((item) => `${item.id}: ${item.detail}`);
  return { version: REPORTING_PRODUCER_CANARY_VERSION, kind: input.kind, targetDate: input.targetDate,
    state: blockers.length ? "fail" : "pass", checks, blockers, productionWrites: 0 };
}
