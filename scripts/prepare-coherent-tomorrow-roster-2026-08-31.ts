// Local proposal preparation only. Reads one frozen audit artifact and writes
// draft manifests; it has no database, broker, deployment, or activation imports.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileReleaseManifest,
  contentHash,
  type ChannelSpecVersion,
  type CompiledReleaseManifest,
} from "../lib/channels/channelControlPlane";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
};

const auditFile = resolve(arg(
  "audit-file",
  "data/roster-evidence-audit-2026-08-31-1222/audit.json",
));
const outputFile = resolve(arg(
  "output-file",
  "/tmp/seve-coherent-tomorrow-roster-packet.json",
));
const auditText = readFileSync(auditFile, "utf8");
const audit = JSON.parse(auditText) as {
  cutoff: string;
  active: { compiled: CompiledReleaseManifest };
};
const base = audit.active.compiled;
const expected = "sha256:37b779cc9529a8c70171debc36c4fdf6bf90c149fbf01eee929a4735cbe03c98";
assert.equal(base.manifest.contentHash, expected, "active roster changed; refresh the audit first");
assert.equal(
  compileReleaseManifest({ ...base.manifest, channelSpecs: base.channelSpecs }).manifest.contentHash,
  expected,
  "frozen roster no longer round-trips",
);

type Change =
  | { slug: string; posture: "paper" | "observe-only" }
  | { slug: string; maxEntriesPerSession: number };

const alternatives: Array<{ choice: string; changes: Change[] }> = [
  {
    choice: "remove-weak",
    changes: [
      { slug: "vb-gap-drift-qqq", posture: "observe-only" },
      { slug: "vb-level-break", posture: "observe-only" },
    ],
  },
  {
    choice: "remove-weak-curl",
    changes: [
      { slug: "vb-gap-drift-qqq", posture: "observe-only" },
      { slug: "vb-level-break", posture: "observe-only" },
      { slug: "vb-curl-reversal-qqq", posture: "paper" },
    ],
  },
  {
    choice: "remove-weak-curl-vwap",
    changes: [
      { slug: "vb-gap-drift-qqq", posture: "observe-only" },
      { slug: "vb-level-break", posture: "observe-only" },
      { slug: "vb-curl-reversal-qqq", posture: "paper" },
      { slug: "vb-vwap-revert-qqq", posture: "paper" },
      { slug: "vb-vwap-revert-qqq", maxEntriesPerSession: 2 },
    ],
  },
  {
    choice: "curl-vwap-momo-cap1",
    changes: [
      { slug: "vb-gap-drift-qqq", posture: "observe-only" },
      { slug: "vb-level-break", posture: "observe-only" },
      { slug: "vb-curl-reversal-qqq", posture: "paper" },
      { slug: "vb-vwap-revert-qqq", posture: "paper" },
      { slug: "vb-vwap-revert-qqq", maxEntriesPerSession: 2 },
      { slug: "momo-shape-2", maxEntriesPerSession: 1 },
    ],
  },
  {
    choice: "curl-vwap-orb-cap1",
    changes: [
      { slug: "vb-gap-drift-qqq", posture: "observe-only" },
      { slug: "vb-level-break", posture: "observe-only" },
      { slug: "vb-curl-reversal-qqq", posture: "paper" },
      { slug: "vb-vwap-revert-qqq", posture: "paper" },
      { slug: "vb-vwap-revert-qqq", maxEntriesPerSession: 2 },
      { slug: "orb-ustop-ctl", maxEntriesPerSession: 1 },
    ],
  },
  {
    choice: "curl-vwap-macd-cap1",
    changes: [
      { slug: "vb-gap-drift-qqq", posture: "observe-only" },
      { slug: "vb-level-break", posture: "observe-only" },
      { slug: "vb-curl-reversal-qqq", posture: "paper" },
      { slug: "vb-vwap-revert-qqq", posture: "paper" },
      { slug: "vb-vwap-revert-qqq", maxEntriesPerSession: 2 },
      { slug: "vb-macd-state", maxEntriesPerSession: 1 },
    ],
  },
  {
    choice: "coherent-throttled",
    changes: [
      { slug: "vb-gap-drift-qqq", posture: "observe-only" },
      { slug: "vb-level-break", posture: "observe-only" },
      { slug: "vb-curl-reversal-qqq", posture: "paper" },
      { slug: "vb-vwap-revert-qqq", posture: "paper" },
      { slug: "vb-vwap-revert-qqq", maxEntriesPerSession: 2 },
      { slug: "momo-shape-2", maxEntriesPerSession: 1 },
      { slug: "orb-ustop-ctl", maxEntriesPerSession: 1 },
      { slug: "vb-macd-state", maxEntriesPerSession: 1 },
    ],
  },
];

const proposalTime = "2026-09-01T03:00:00.000Z";
const results = alternatives.map((alternative) => {
  const changeBySlug = new Map<string, Change[]>();
  for (const change of alternative.changes) {
    changeBySlug.set(change.slug, [...(changeBySlug.get(change.slug) ?? []), change]);
  }
  const specs = base.channelSpecs.map((original) => {
    const changes = changeBySlug.get(original.slug);
    if (!changes) return structuredClone(original);
    const next = structuredClone(original);
    for (const change of changes) {
      if ("posture" in change) next.executionPosture = change.posture;
      else next.entryParameters = {
        ...next.entryParameters,
        maxEntriesPerSession: change.maxEntriesPerSession,
      };
      if (!("posture" in change)) {
        next.reentryPolicy = change.maxEntriesPerSession === 1
          ? "disabled" : "bounded";
      }
    }
    return {
      ...next,
      id: `spec:proposal:2026-09-01:${alternative.choice}:${next.slug}`,
      parentVersionId: original.id,
      status: "draft" as const,
      createdBy: "agent:coherent-tomorrow-roster-study",
      createdAt: proposalTime,
      validFrom: proposalTime,
    };
  });
  const candidate = compileReleaseManifest({
    ...base.manifest,
    id: `manifest:proposal:2026-09-01:${alternative.choice}`,
    releaseId: `release:proposal:2026-09-01:${alternative.choice}`,
    cohortId: `cohort:proposal:2026-09-01:${alternative.choice}`,
    channelSpecs: specs,
    rollbackTargetManifestId: base.manifest.id,
    parentManifestId: base.manifest.id,
    createdBy: "agent:coherent-tomorrow-roster-study",
    createdAt: proposalTime,
    status: "draft",
  });
  assert.equal(candidate.activationAuthorized, false);
  assert.equal(candidate.validationReady, false);
  assert.deepEqual(candidate.manifest.admissionPolicies, base.manifest.admissionPolicies);
  const fields = ["executionPosture", "entryParameters", "reentryPolicy"] as const;
  const diff = candidate.channelSpecs.flatMap((after) => {
    const before = base.channelSpecs.find((row) => row.slug === after.slug)!;
    for (const key of Object.keys(before) as (keyof ChannelSpecVersion)[]) {
      if ([...fields, "id", "parentVersionId", "status", "createdBy", "createdAt", "validFrom", "contentHash"].includes(key)) continue;
      assert.equal(contentHash({ value: before[key] }), contentHash({ value: after[key] }),
        `${after.slug}: unexpected ${key} change`);
    }
    return fields.flatMap((field) => contentHash({ value: before[field] }) === contentHash({ value: after[field] })
      ? [] : [{ channel: after.slug, field, before: before[field], after: after[field] }]);
  });
  return {
    choice: alternative.choice,
    changes: diff,
    afterManifestHash: candidate.manifest.contentHash,
    paperRoster: candidate.channelSpecs.filter((row) => row.executionPosture === "paper")
      .map((row) => ({ slug: row.slug, accountRole: row.accountRole, quantity: row.quantity,
        maxEntriesPerSession: Number(row.entryParameters.maxEntriesPerSession ?? 1) })),
    candidate,
  };
});

const packet = {
  version: "coherent-tomorrow-roster-study-2026-08-31-v1",
  evidenceThroughSession: "2026-08-31",
  beforeManifestHash: expected,
  sourceAuditSha256: `sha256:${createHash("sha256").update(auditText).digest("hex")}`,
  productionReads: 0,
  productionWrites: 0,
  activationAuthorized: false,
  alternativesAreNotSequential: true,
  alternatives: results,
};
mkdirSync(resolve(outputFile, ".."), { recursive: true });
const body = `${JSON.stringify(packet, null, 2)}\n`;
writeFileSync(outputFile, body);
console.log(`coherent-tomorrow-roster: PASS · ${results.length} alternatives · ${outputFile}`);
console.log(`packet sha256:${createHash("sha256").update(body).digest("hex")}`);
