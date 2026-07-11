// ============================================================================
//  pageAll — the ONE way to read a possibly->1000-row table through PostgREST.
//
//  PostgREST silently caps any select at ~1000 rows — .limit(6000) does NOT
//  work (it caps at the server max and drops the rest without error). This
//  class of bug has bitten the desk repeatedly (gate-shadow blocked-signals,
//  useWindowedPnl Week==Month, day-report tape, a6-watch era-4 reads, …):
//  every fetch that can plausibly exceed 1000 rows MUST paginate. Use this.
//
//  ⚠ The query built by `make` MUST carry a TOTAL order — .order(col) PLUS a
//  unique tiebreak (usually .order("id")) — or rows straddling a page boundary
//  inside an equal-key cluster can be silently dropped or double-counted.
//
//    const rows = await pageAll<Pos>((from) => sb
//      .from("positions").select("…")
//      .gte("opened_at", since)
//      .order("opened_at", { ascending: true }).order("id"));
//
//  Fails LOUD: a page error throws (no partial-data-as-complete), and blowing
//  past `max` throws rather than silently truncating.
// ============================================================================

export async function pageAll<T>(
  make: (from: number) => any,
  opts?: { pageSize?: number; max?: number },
): Promise<T[]> {
  const size = opts?.pageSize ?? 1000;
  const max = opts?.max ?? 500_000;
  const out: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await make(from).range(from, from + size - 1);
    if (error) throw new Error(`pageAll: page @${from} failed — ${error.message}`);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < size) return out;
  }
  throw new Error(`pageAll: exceeded max rows (${max}) — raise opts.max explicitly if this is expected`);
}
