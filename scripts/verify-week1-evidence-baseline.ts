import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  validateWeek1EvidenceBaseline,
  type Week1EvidenceBaseline,
} from "../lib/research/week1EvidenceBaseline.js";

const path = process.argv[2] ?? "docs/evidence/week1-evidence-2026-07-20--2026-07-23.json";
const bytes = readFileSync(path);
const baseline = JSON.parse(bytes.toString("utf8")) as Week1EvidenceBaseline;
const issues = validateWeek1EvidenceBaseline(baseline);
if (issues.length) throw new Error(`Week 1 baseline invalid: ${issues.join(", ")}`);
const sha256 = createHash("sha256").update(bytes).digest("hex");
console.log(`week1-evidence-baseline: PASS · ${baseline.cohort.allTrades} live entries · ${baseline.managerState.paths}/${baseline.managerState.paths} manager paths`);
console.log(`  root cohort ${baseline.release.rootProspectiveCohortStartEt} continues · era reset false · config change false`);
console.log(`  sha256 ${sha256}`);
