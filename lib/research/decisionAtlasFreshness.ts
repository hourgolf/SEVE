export type DecisionAtlasFreshness = "current" | "stale" | "unknown";

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function etSessionDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return ET_DATE.format(date);
}

export function decisionAtlasFreshness(
  reportThroughSession: string | null,
  evidenceThroughSession: string | null,
): DecisionAtlasFreshness {
  if (!reportThroughSession || !evidenceThroughSession) return "unknown";
  return reportThroughSession >= evidenceThroughSession ? "current" : "stale";
}

export function decisionAtlasFreshnessLabel(input: {
  freshness: DecisionAtlasFreshness;
  reportThroughSession: string | null;
  evidenceThroughSession: string | null;
}): string {
  if (input.freshness === "current") return "CURRENT";
  if (input.freshness === "stale") {
    const report = input.reportThroughSession?.slice(5).replace("-", "/") ?? "—";
    const evidence = input.evidenceThroughSession?.slice(5).replace("-", "/") ?? "—";
    return `STALE · REPORT ${report} · DATA ${evidence}`;
  }
  return "FRESHNESS UNKNOWN";
}

export function decisionAtlasFreshnessShortLabel(input: {
  freshness: DecisionAtlasFreshness;
  reportThroughSession: string | null;
}): string {
  if (input.freshness === "current") return "CURRENT";
  if (input.freshness === "stale") return `STALE · ${input.reportThroughSession?.slice(5).replace("-", "/") ?? "—"}`;
  return "CHECKING";
}
