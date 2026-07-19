import { pageAll } from "./pageAll";

let passed = 0;
function check(name: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`  PASS ${name}`);
}

type Outcome =
  | { data: number[]; error: null }
  | { data: null; error: { message: string; code?: string } }
  | Error;

function builder(outcome: Outcome, aborts: AbortSignal[], retryFlags: boolean[] = []): unknown {
  const query = {
    range: () => query,
    retry: (enabled: boolean) => {
      retryFlags.push(enabled);
      return query;
    },
    abortSignal: (signal: AbortSignal) => {
      aborts.push(signal);
      return query;
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      outcome instanceof Error
        ? Promise.reject(outcome).then(resolve, reject)
        : Promise.resolve(outcome).then(resolve, reject),
  };
  return query;
}

async function main(): Promise<void> {
  console.log("\npageAll self-test\n");

  const pages = new Map<number, number[]>([[0, [1, 2]], [2, [3]]]);
  const rows = await pageAll<number>((from) => builder({ data: pages.get(from) ?? [], error: null }, []), {
    pageSize: 2,
  });
  check("paginates to the short final page", JSON.stringify(rows) === JSON.stringify([1, 2, 3]));

  let calls = 0;
  const retryFlags: boolean[] = [];
  const recovered = await pageAll<number>(() => {
    calls++;
    const outcome: Outcome = calls === 1
      ? new Error("fetch failed")
      : calls === 2
        ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
        : { data: [7], error: null };
    return builder(outcome, [], retryFlags);
  }, { attempts: 3, retryDelaysMs: [0, 0], pageSize: 2 });
  check("retries rejected and fulfilled-error reads", calls === 3 && recovered[0] === 7);
  check("disables nested client retries when pageAll owns the budget", retryFlags.length === 3 && retryFlags.every((flag) => !flag));

  const aborts: AbortSignal[] = [];
  await pageAll<number>(() => builder({ data: [], error: null }, aborts), { timeoutMs: 25 });
  check("applies a per-attempt timeout signal", aborts.length === 1 && aborts[0] instanceof AbortSignal);

  let failed = false;
  try {
    await pageAll<number>(() => builder(new Error("fetch failed: offline"), []), {
      attempts: 2,
      retryDelaysMs: [0],
    });
  } catch (error) {
    failed = error instanceof Error
      && error.message.includes("page @0")
      && error.message.includes("after 2 attempts")
      && error.message.includes("offline");
  }
  check("fails loudly after the bounded attempt budget", failed);

  let hardFailureCalls = 0;
  try {
    await pageAll<number>(() => {
      hardFailureCalls++;
      return builder({ data: null, error: { code: "42501", message: "permission denied" } }, []);
    }, { attempts: 4, retryDelaysMs: [0, 0, 0] });
  } catch {
    /* expected */
  }
  check("does not retry permission or schema failures", hardFailureCalls === 1);

  console.log(`\n${passed}/${passed} PASS\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
