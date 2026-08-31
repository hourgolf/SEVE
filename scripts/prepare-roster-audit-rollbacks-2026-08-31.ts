// Local preparation only: frozen inputs, no database/client/activation imports.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileReleaseManifest, contentHash, type ChannelSpecVersion, type CompiledReleaseManifest } from "../lib/channels/channelControlPlane";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];
};
const root = resolve(arg("audit-dir", "data/roster-evidence-audit-2026-08-31-1222"));
const out = resolve(arg("out-dir", "data/roster-evidence-repairs-2026-08-31/proposals"));
const auditText = readFileSync(resolve(root, "audit.json"), "utf8");
const audit = JSON.parse(auditText) as { cutoff: string; active: { compiled: CompiledReleaseManifest } };
const base = audit.active.compiled;
const EXPECTED = "sha256:37b779cc9529a8c70171debc36c4fdf6bf90c149fbf01eee929a4735cbe03c98";
assert.equal(base.manifest.contentHash, EXPECTED, "wrong roster: re-audit before proposing changes");
const roundtrip = compileReleaseManifest({ ...base.manifest, channelSpecs: base.channelSpecs });
assert.equal(roundtrip.manifest.contentHash, EXPECTED, "base specifications do not reproduce receipt hash");
assert.deepEqual(roundtrip.channelSpecs.map(s => s.contentHash), base.channelSpecs.map(s => s.contentHash));
const sourceSha = `sha256:${createHash("sha256").update(auditText).digest("hex")}`;
const createdAt = audit.cutoff; // deterministic local draft; not an activation time
const alternatives = [
  { id: "gap-observe", channels: ["vb-gap-drift-qqq"] },
  { id: "level-two", channels: ["vb-level-break"] },
  { id: "gap-observe-level-two", channels: ["vb-gap-drift-qqq", "vb-level-break"] },
  { id: "grind-two-optional", channels: ["grind-smart-entries"] },
];
const results = alternatives.map(choice => {
  const id = `roster-audit-2026-08-31:${choice.id}`;
  const specs = base.channelSpecs.map(original => {
    if (!choice.channels.includes(original.slug)) return structuredClone(original);
    const next = structuredClone(original);
    if (original.slug === "vb-gap-drift-qqq") {
      assert.equal(original.executionPosture, "paper");
      next.executionPosture = "observe-only";
    } else {
      assert.equal(original.quantity, 4);
      next.quantity = 2; next.maxDebitUsd /= 2;
      next.riskLimits = { ...next.riskLimits, maxContracts: 2,
        maxDebitUsd: next.riskLimits.maxDebitUsd / 2, maxRiskUsd: next.riskLimits.maxRiskUsd / 2 };
    }
    return { ...next, id: `spec:proposal:${id}:${next.slug}`, parentVersionId: original.id,
      status: "draft" as const, createdBy: "agent:roster-evidence-audit", createdAt, validFrom: createdAt };
  });
  const candidate = compileReleaseManifest({ ...base.manifest,
    id: `manifest:proposal:${id}`, releaseId: `release:proposal:${id}`, cohortId: id,
    channelSpecs: specs, rollbackTargetManifestId: base.manifest.id, parentManifestId: base.manifest.id,
    createdBy: "agent:roster-evidence-audit", createdAt, status: "draft",
  }); // Dynamic gates intentionally NOT supplied: static validity is not permission.
  assert.equal(candidate.activationAuthorized, false);
  assert.equal(candidate.validationReady, false);
  assert(candidate.validationResults.filter(g => !["replay-sufficiency", "evidence-readiness", "safe-boundary"].includes(g.gate)).every(g => g.state === "pass"));
  assert.deepEqual(candidate.manifest.admissionPolicies, base.manifest.admissionPolicies);
  const fields = ["executionPosture", "quantity", "maxDebitUsd", "riskLimits"] as const;
  const changes = candidate.channelSpecs.flatMap(after => {
    const before = base.channelSpecs.find(s => s.slug === after.slug)!;
    // No entry, manager, route, priority, family, or cap changes can hide here.
    for (const key of Object.keys(before) as (keyof ChannelSpecVersion)[]) {
      if ([...fields, "id", "parentVersionId", "status", "createdBy", "createdAt", "validFrom", "contentHash"].includes(key)) continue;
      assert.equal(contentHash({ v: before[key] }), contentHash({ v: after[key] }), `${after.slug}: unexpected ${key}`);
    }
    return fields.flatMap(field => contentHash({ v: before[field] }) === contentHash({ v: after[field] }) ? []
      : [{ channel: after.slug, accountId: after.accountId, field, before: before[field], after: after[field] }]);
  });
  return { choice: choice.id, sourceAuditSha256: sourceSha, beforeManifestHash: EXPECTED,
    afterManifestHash: candidate.manifest.contentHash, changes, candidate,
    publicationAuthorized: false, activationAuthorized: false,
    deploymentAuthorized: false,
    missingGates: ["Fresh active-manifest identity and flatness check at activation.",
      "Chronological same-opportunity portfolio/displacement replay for this exact subset; no claim of uplift yet.",
      "Resolve approval of the exact subset and prospective trial-rule contract; carry unchanged channel history forward by spec identity.",
      "Regenerate a sealed compatibility projection and epoch in the established governed activation workflow; inherited legacyConfigurationHash here is base provenance, not proof of refreshed runtime compatibility."],
  };
});
const packet = { version: "roster-audit-rollbacks-2026-08-31-v1", evidenceThroughSession: "2026-08-28",
  sourceAuditSha256: sourceSha, beforeManifestHash: EXPECTED, productionReads: 0, productionWrites: 0,
  recommendedSubset: "gap-observe-level-two", optionalIndependentChoice: "grind-two-optional",
  alternativesAreNotSequential: true,
  grindRuleResolutionProposal: "Prospectively separate size from viability. After three completed sessions OR five closed trades at four contracts, negative without-best-session contribution triggers a two-contract review, not automatic retirement. Negative typical trade result or verified adverse displacement triggers a separate channel review. This resolves the wording conflict forward only; it does not rewrite the original contract or prove a size benefit.",
  coupledEffects: ["QQQ observing removes paper entry authority, not research collection or historical results.",
    "Fewer QQQ positions can free Account 2 global capacity and change which SPY/IWM signals fill.",
    "Smaller size reduces debit/stop envelopes and can alter capital admission; simply halving old P&L is not a portfolio replay.",
    "Native managers, priorities, routes, within-account OCC/family protection, cross-account OCC freedom and independent exits remain unchanged.",
    "Apply to new entries only after a governed safe boundary; never rewrite an existing position's manager or size.",
    "Every alternative starts from the same before hash; combining separately approved choices requires a new combined diff and receipt."],
  alternatives: results };
mkdirSync(out, { recursive: true });
const json = `${JSON.stringify(packet, null, 2)}\n`;
writeFileSync(resolve(out, "packet.json"), json, { flag: "wx" });
writeFileSync(resolve(out, "receipt.json"), `${JSON.stringify({ sourceAuditSha256: sourceSha,
  packetSha256: `sha256:${createHash("sha256").update(json).digest("hex")}`, productionWrites: 0 }, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(results.map(r => ({ choice: r.choice, afterHash: r.afterManifestHash, changes: r.changes, validationReady: r.candidate.validationReady })), null, 2));
