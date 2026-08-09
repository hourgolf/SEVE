import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const shell = read("components/shell/WorkstationShell.tsx");
const home = read("components/perform/DecisionHomeWorkspace.tsx");
const studio = read("components/studio/StudioSurface.tsx");
const fleet = read("components/studio/StudioFleet.tsx");
const research = read("components/perform/ShadowResearchWorkspace.tsx");
const pulse = read("components/research/DecisionAtlasFleetPulse.tsx");
const review = read("components/perform/ReviewWorkspace.tsx");
const ops = read("components/perform/OpsWorkspace.tsx");
const mobile = read("components/mobile2/MobileShell.tsx");

assert.match(shell, /useWorkspaceDestination/);
assert.match(shell, /window\.history\.back/);
assert.match(home, /channel: fleet\.lead\.channel/);
assert.match(studio, /onCurrentSession/);
assert.match(studio, /onNextReview/);
assert.match(fleet, /Open .* current-session review/);
assert.match(pulse, /researchFilter: "promising"/);
assert.match(pulse, /researchFilter: "review"/);
assert.match(pulse, /researchFilter: "collecting"/);
assert.match(research, /focusAxis=/);
assert.match(review, /rvw-channel-context/);
assert.match(ops, /data-system-check/);
assert.match(mobile, /roomFor\(destination\)/);
assert.match(mobile, /m2-context-back/);

console.log("workspace navigation surface selftest passed");
