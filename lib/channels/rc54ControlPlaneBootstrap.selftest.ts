import assert from "node:assert/strict";
import {
  buildRc54ControlPlaneBootstrap,
  reconstructRc54Bootstrap,
  renderRc54BootstrapSql,
} from "./rc54ControlPlaneBootstrap";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  console.log(`PASS ${name}`);
}

const bootstrap = buildRc54ControlPlaneBootstrap();
const reconstructed = reconstructRc54Bootstrap(bootstrap);
const sql = renderRc54BootstrapSql(bootstrap);

check("bootstrap contains the exact nine RC5.4 specs", () => {
  assert.equal(bootstrap.specs.length, 9);
  assert.equal(bootstrap.memberships.length, 9);
  assert.equal(new Set(bootstrap.specs.map((spec) => spec.versionKey)).size, 9);
});

check("bootstrap is draft-only and carries no activation authority", () => {
  assert.equal(bootstrap.activationAuthorized, false);
  assert.equal(bootstrap.manifest.status, "draft");
  assert.equal(bootstrap.specs.every((spec) => spec.status === "draft"), true);
});

check("database-shaped rows reconstruct the exact compiler manifest", () => {
  assert.equal(reconstructed.manifest.contentHash, bootstrap.manifestContentHash);
  assert.equal(reconstructed.manifest.contentHash, bootstrap.manifest.contentHash);
  assert.deepEqual(
    reconstructed.channelSpecs.map((spec) => spec.contentHash),
    bootstrap.specs.map((spec) => spec.contentHash),
  );
});

check("read-only worker and dashboard projections remain disabled", () => {
  assert.equal(reconstructed.activationAuthorized, false);
  assert.equal(reconstructed.workerProjection.activationAuthorized, false);
  assert.equal(reconstructed.dashboardProjection.activationAuthorized, false);
  assert.equal(reconstructed.workerProjection.roots.length, 9);
  assert.equal(reconstructed.dashboardProjection.roots.length, 9);
});

check("generated SQL is additive, idempotent, and receipt-free", () => {
  assert.match(sql, /GENERATED NO-CHANGE RC5\.4 BOOTSTRAP/);
  assert.match(sql, /on conflict do nothing/g);
  assert.match(sql, /status = 'draft'/);
  assert.match(sql, /expected\(version_key, content_hash\)/);
  assert.match(sql, /membership\.ordinal = expected\.ordinal/);
  assert.match(sql, /must not create activation authority/);
  assert.doesNotMatch(sql, /insert into public\.activation_receipts/i);
  assert.doesNotMatch(sql, /insert into public\.channel_change_proposals/i);
  assert.doesNotMatch(sql, /set status = 'active'/i);
});

console.log(
  `rc54-control-plane-bootstrap-selftest: ${checks}/${checks} passed · ${bootstrap.manifestContentHash}`,
);
