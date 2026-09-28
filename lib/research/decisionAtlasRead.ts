import { pageAll } from "../../engine/pageAll";
import { etDayRangeUtc } from "./afterCloseResearch";

export interface AtlasReadCoverage {
  expectedRows: number;
  returnedRows: number;
  verifiedRows: number;
  uniqueRows: number;
}

const COUNT_TIMEOUT_MS = 60_000;

export function atlasEvidenceWindow(cohortFrom: string, throughSession: string) {
  const start = new Date(cohortFrom).toISOString();
  const end = etDayRangeUtc(throughSession).end;
  if (start >= end) throw new Error("Atlas evidence window must start before its exclusive end");
  return { start, end, throughSession };
}

// The caller supplies the SAME SELECT, filters and total order for both count
// and row reads. Head counts have no row limit. Data pagination is bounded by
// the measured cohort size, not a ceiling that grows stale with the desk.
// Count/identity checks detect truncation and changing membership; this is not
// a PostgreSQL transaction snapshot. Freeze and hash returned payloads for replay.
export async function readAtlasEvidenceRows<T>(input: {
  label: string;
  query: (head: boolean) => any;
  key: (row: T) => string;
  pageSize?: number;
}): Promise<{ rows: T[]; coverage: AtlasReadCoverage }> {
  const size = input.pageSize ?? 1_000;
  if (!Number.isSafeInteger(size) || size < 1 || size > 1_000) {
    throw new Error(`${input.label}: invalid page size`);
  }
  const count = async (): Promise<number> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await input.query(true).abortSignal(AbortSignal.timeout(COUNT_TIMEOUT_MS));
        if (result.error) {
          const detail = String(result.error.message ?? "");
          if (attempt < 2 && (!detail || /timeout|canceling statement/i.test(detail))) {
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
            continue;
          }
          throw new Error(`${input.label}: count failed — ${detail}`);
        }
        if (!Number.isSafeInteger(result.count) || result.count < 0) {
          throw new Error(`${input.label}: exact source count is unavailable`);
        }
        return result.count;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (attempt < 2 && /abort|timeout|canceling statement/i.test(detail)) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
    throw new Error(`${input.label}: exact source count failed after 3 attempts`);
  };
  const expectedRows = await count();
  // Include a terminal probe when the cohort is an exact page multiple, and
  // allow a concurrent insertion to be observed and rejected, never truncated.
  const max = (Math.floor(expectedRows / size) + 1) * size;
  const rows = await pageAll<T>(() => input.query(false), {
    pageSize: size, max, attempts: 3, retryDelaysMs: [250, 750], timeoutMs: 15_000,
  }).catch((error) => {
    throw new Error(`${input.label}: ${error instanceof Error ? error.message : String(error)}`);
  });
  const keys = rows.map(input.key);
  const uniqueRows = new Set(keys).size;
  if (keys.some((key) => typeof key !== "string" || !key) || uniqueRows !== rows.length) {
    throw new Error(`${input.label}: duplicate or missing row identity; refusing partial evidence`);
  }
  const verifiedRows = await count();
  if (rows.length !== expectedRows || verifiedRows !== expectedRows) {
    throw new Error(`${input.label}: source membership changed or read was truncated `
      + `(before ${expectedRows}, returned ${rows.length}, after ${verifiedRows})`);
  }
  return { rows, coverage: { expectedRows, returnedRows: rows.length, verifiedRows, uniqueRows } };
}
