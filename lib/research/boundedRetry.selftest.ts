import assert from "node:assert/strict";
import { withBoundedRetry } from "./boundedRetry.js";

let passed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function main(): Promise<void> {
await test("retries a bounded transient failure sequence", async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await withBoundedRetry({
    attempts: 3,
    delaysMs: [10, 20],
    operation: async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("fetch failed");
      return "ok";
    },
    isRetryable: (error) => error instanceof TypeError,
    sleep: async (delayMs) => { delays.push(delayMs); },
  });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

await test("does not retry a non-retryable failure", async () => {
  let calls = 0;
  await assert.rejects(() => withBoundedRetry({
    attempts: 3,
    delaysMs: [10, 20],
    operation: async () => {
      calls += 1;
      throw new Error("provider refusal");
    },
    isRetryable: (error) => error instanceof TypeError,
    sleep: async () => undefined,
  }), /provider refusal/);
  assert.equal(calls, 1);
});

await test("stops after the final transient attempt", async () => {
  let calls = 0;
  await assert.rejects(() => withBoundedRetry({
    attempts: 3,
    delaysMs: [0, 0],
    operation: async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    },
    isRetryable: (error) => error instanceof TypeError,
    sleep: async () => undefined,
  }), /fetch failed/);
  assert.equal(calls, 3);
});

await test("rejects malformed retry schedules", async () => {
  await assert.rejects(() => withBoundedRetry({
    attempts: 3,
    delaysMs: [0],
    operation: async () => "never",
    isRetryable: () => true,
  }), /one non-negative delay per retry/);
});

console.log(`bounded retry selftest: ${passed}/4 PASS`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
