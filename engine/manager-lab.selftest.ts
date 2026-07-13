import { managers, type EntryPath } from "./manager-lab";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  passed++;
}
function path(points: Array<[number, number]>): EntryPath {
  return { date: "2026-07-13", entryFill: 1, returnPath: points };
}
const byName = (name: string) => {
  const manager = managers.find((m) => m.name === name);
  if (!manager) throw new Error(`manager missing: ${name}`);
  return manager;
};

check("stop precedes a later target", byName("LOCK20/30").run(path([[1, -35], [2, 25]])).reason, "stop");
check("target precedes a later stop", byName("LOCK20/30").run(path([[1, 25], [2, -35]])).reason, "target");
check("banked runner respects the breakeven floor", byName("BANK20/RUN50").run(path([[1, 21], [2, -1]])).reason, "runner_floor");
check("armed trail gives back half the peak", byName("ARM20/HALF-GIVEBACK").run(path([[1, 21], [2, 40], [3, 19]])).reason, "giveback");
check("bell control uses the final observation", byName("BELL/no-stop").run(path([[1, 10], [2, -5]])).holdMin, 2);

console.log(`manager-lab-selftest: ${passed}/5 PASS`);
