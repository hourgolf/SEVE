import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SingleFlightReload } from "./singleFlightReload.js";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

async function main(): Promise<void> {
  const gate = deferred<void>();
  const reload = new SingleFlightReload();
  let attempts = 0;
  let validatedAuthority = "release:old";

  const first = reload.run(async () => {
    attempts += 1;
    const nextAuthority = "release:new";
    await gate.promise;
    validatedAuthority = nextAuthority;
  });
  const joined = reload.run(async () => {
    attempts += 1;
    validatedAuthority = "invalid-second-flight";
  });

  assert.equal(first, joined, "concurrent callers must join one reload attempt");
  assert.equal(reload.active, true);
  assert.equal(attempts, 1);
  assert.equal(
    validatedAuthority,
    "release:old",
    "last-known-good authority must remain visible while validation is in flight",
  );

  gate.resolve();
  await first;
  assert.equal(validatedAuthority, "release:new");
  assert.equal(reload.active, false);

  let failedAttempts = 0;
  await assert.rejects(
    reload.run(async () => {
      failedAttempts += 1;
      throw new Error("transient read failure");
    }),
    /transient read failure/,
  );
  assert.equal(validatedAuthority, "release:new");
  assert.equal(reload.active, false);

  await reload.run(async () => {
    failedAttempts += 1;
    validatedAuthority = "release:retry";
  });
  assert.equal(failedAttempts, 2, "a failed flight must not wedge later retries");
  assert.equal(validatedAuthority, "release:retry");

  const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const reloadBody = indexSource.slice(
    indexSource.indexOf("async function reloadConfigAttempt"),
    indexSource.indexOf("async function refreshChain"),
  );
  assert.ok(reloadBody.length > 0, "reload implementation must remain inspectable");
  assert.doesNotMatch(
    reloadBody,
    /releaseSourceExecutorBoundaryReady\s*=\s*false/,
    "an in-flight reload must never clear a previously validated boundary",
  );
  assert.match(
    reloadBody,
    /releaseSourceExecutorBoundaryReady\s*=\s*nextSourceExecutorBoundaryReady/,
    "validated readiness must be committed from the completed candidate",
  );
  assert.match(
    indexSource,
    /return configReloadSingleFlight\.run\(reloadConfigAttempt\)/,
    "every reload caller must pass through the single-flight coordinator",
  );

  console.log("single-flight release reload selftest: PASS");
}

await main();
