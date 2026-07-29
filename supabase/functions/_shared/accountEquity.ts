export interface AccountEquitySnapshot {
  account_id: string | null;
  net_liquidation: number | string;
  captured_at: string;
}

export interface AccountEquityPoint {
  capturedAt: string;
  nav: number;
}

export interface AccountEquitySeries {
  points: AccountEquityPoint[];
  daily: { date: string; nav: number }[];
  maxDrawdown: number;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Build a desk NAV series without mixing mutable or unscoped account identity.
 * A point is admitted only when every configured paper account has a fresh
 * account-scoped snapshot inside the same bounded capture cohort.
 */
export function deriveAccountCongruentEquity(
  rows: readonly AccountEquitySnapshot[],
  configuredPaperAccountIds: readonly string[],
  requiredDates: readonly string[],
  maxComponentSkewMs = 15_000,
): AccountEquitySeries {
  const accountIds = [...new Set(configuredPaperAccountIds)].sort();
  if (accountIds.length === 0) throw new Error("configured paper accounts unavailable");
  if (!Number.isFinite(maxComponentSkewMs) || maxComponentSkewMs < 0) {
    throw new Error("equity component skew must be a non-negative duration");
  }

  const configured = new Set(accountIds);
  const normalized = rows
    .filter((row) => row.account_id != null && configured.has(row.account_id))
    .map((row) => ({
      accountId: row.account_id as string,
      nav: Number(row.net_liquidation),
      capturedAt: row.captured_at,
      capturedMs: Date.parse(row.captured_at),
    }))
    .filter((row) => Number.isFinite(row.nav) && Number.isFinite(row.capturedMs))
    .sort((a, b) => a.capturedMs - b.capturedMs || a.accountId.localeCompare(b.accountId));

  const latest = new Map<string, { nav: number; capturedMs: number }>();
  const points: AccountEquityPoint[] = [];
  for (const row of normalized) {
    latest.set(row.accountId, { nav: row.nav, capturedMs: row.capturedMs });
    if (latest.size !== accountIds.length) continue;
    const components = accountIds.map((accountId) => latest.get(accountId)!);
    const oldestMs = Math.min(...components.map((component) => component.capturedMs));
    const newestMs = Math.max(...components.map((component) => component.capturedMs));
    if (newestMs - oldestMs > maxComponentSkewMs) continue;
    points.push({
      capturedAt: new Date(newestMs).toISOString(),
      nav: components.reduce((sum, component) => sum + component.nav, 0),
    });
  }

  const byDay = new Map<string, AccountEquityPoint>();
  for (const point of points) byDay.set(ET_DATE.format(new Date(point.capturedAt)), point);
  const missingDates = [...new Set(requiredDates)].filter((date) => !byDay.has(date));
  if (missingDates.length) {
    throw new Error(`account-complete equity snapshots missing for ${missingDates.join(", ")}`);
  }

  const daily = [...new Set(requiredDates)].map((date) => ({
    date,
    nav: Math.round(byDay.get(date)!.nav),
  }));
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.nav);
    maxDrawdown = Math.max(maxDrawdown, peak - point.nav);
  }
  return { points, daily, maxDrawdown: Math.round(maxDrawdown) };
}
