import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");
const home = read("components/perform/DecisionHomeWorkspace.tsx");
const shell = read("components/shell/WorkstationShell.tsx");
const evidence = read("components/ui/Seve909.tsx");
const sentinel = read("components/perform/SentinelWorkspace.tsx");
const ops = read("components/perform/OpsWorkspace.tsx");
const fleet = read("components/studio/StudioFleet.tsx");
const mobileRow = read("components/mobile2/MobileRackRow.tsx");
const mobileShell = read("components/mobile2/MobileShell.tsx");
const research = read("components/perform/ShadowResearchWorkspace.tsx");
const book = read("components/mobile2/MobileDeskSheet.tsx");

for (const phrase of ["WHAT CHANGED?", "WHAT NEEDS ATTENTION?", "WHAT SHOULD I DO NEXT?"]) assert.match(home, new RegExp(phrase.replace("?", "\\?")));
assert.match(shell, /label: "Home"/);
assert.match(shell, /label: "System"/);
for (const label of ["EVIDENCE", "SCOPE", "AS OF", "CONFIGURATION", "SAMPLE"]) assert.match(evidence, new RegExp(label));
assert.match(evidence, /<details className=\{`sv909-evidence-context/);
assert.match(evidence, /<summary>/);

assert(sentinel.indexOf("NEXT ACTION") < sentinel.indexOf("sntw-technical"));
assert(ops.indexOf("NEEDS ATTENTION") < ops.indexOf("opsw-technical"));
assert.match(sentinel, /<details className="sntw-technical"/);
assert.match(ops, /<details className="opsw-technical"/);

for (const heading of ["STATE", "WHY THIS STATE", "CURRENT SESSION", "NEXT REVIEW"]) assert.match(fleet, new RegExp(`>${heading}<`));
assert.doesNotMatch(fleet, />RISK \/ TRADE<|>LIVE MODE<|>CONTEXT</);
assert.doesNotMatch(fleet, /paper enabled|No unresolved exception|\$0.*attrib/);
assert.doesNotMatch(mobileRow, /DB DIFFERS|m2-rr-fires num/);
assert.match(mobileRow, /COLLECTING EVIDENCE/);
assert.doesNotMatch(mobileRow, /recommendation\.summary/);

for (const mapping of [
  'label: "HOME", sub: "MARKET"',
  'label: "CHANNELS", sub: "ROSTER"',
  'label: "POSITIONS", sub: "BOOK"',
  'label: "REVIEW", sub: "RESEARCH"',
  'label: "SYSTEM", sub: "STATUS"',
]) assert.match(mobileShell, new RegExp(mapping));

assert.match(research, /"decisions"\s*\|\s*"data"/);
assert.match(research, /SUPPORTING EVIDENCE/);
assert.doesNotMatch(research, /<em>\{brief\?\.recommendation\.nextExperiment/);
assert.match(book, /DESK FLAT/);
assert.match(book, /No capital is deployed/);

console.log("decision-first-platform-selftest: PASS");
