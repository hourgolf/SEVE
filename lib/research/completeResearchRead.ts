/** Complete, cancellable reads of an explicitly bounded cohort. UUID keysets
 * avoid offset drift. Counts are checked before and after; partial rows never
 * escape as a valid research dataset. The caller owns fixed time bounds. */
export async function completeResearchRead<T extends Record<string, unknown>>(options: {
  key: keyof T & string;
  count: () => Promise<number | null>;
  page: (after: string | null, size: number) => Promise<T[]>;
  alive?: () => boolean;
  pageSize?: number;
  rowBudget?: number;
}): Promise<T[]> {
  const size = options.pageSize ?? 1_000;
  const budget = options.rowBudget ?? 100_000;
  const check = () => { if (options.alive && !options.alive()) throw new Error("Research read canceled"); };
  check();
  const expected = await options.count();
  if (expected == null || !Number.isSafeInteger(expected) || expected < 0) throw new Error("Research source count unavailable");
  if (expected > budget) throw new Error(`Selected range contains ${expected.toLocaleString()} rows; choose a shorter date range`);
  const rows: T[] = [];
  let cursor: string | null = null;
  while (rows.length < expected) {
    check();
    const page = await options.page(cursor, Math.min(size, expected - rows.length));
    check();
    if (!page.length) throw new Error(`Research source changed during read (${rows.length}/${expected}); retry`);
    for (const row of page) {
      const key = row[options.key];
      if (typeof key !== "string" || !key || (cursor != null && key <= cursor)) throw new Error("Research pagination did not advance uniquely");
      cursor = key;
      rows.push(row);
    }
    if (rows.length > expected) throw new Error("Research source grew during read; retry");
  }
  check();
  if (await options.count() !== expected) throw new Error("Research source count changed during read; retry");
  check();
  return rows;
}

/** New York calendar-day boundaries, including both DST offsets. */
export function researchDateBounds(from: string, through: string): { from: string; until: string } {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
    && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(from) || !valid(through) || from > through) throw new Error("Choose a valid research date range");
  const midnight = (s: string) => {
    const probe = new Date(`${s}T04:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).formatToParts(probe);
    const offset = Number(parts.find(p => p.type === "hour")!.value) === 0 ? 4 : 5;
    return `${s}T0${offset}:00:00.000Z`;
  };
  const next = new Date(Date.parse(through) + 86_400_000).toISOString().slice(0, 10);
  return { from: midnight(from), until: midnight(next) };
}
