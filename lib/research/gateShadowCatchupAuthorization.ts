import { createHash } from "node:crypto";

export interface GateShadowCatchupManifest {
  version: string;
  session: string | null;
  mode: string;
  expectedSignalIds: string[];
  presentSignalIds: string[];
  missingSignalIds: string[];
  exactWriteRequired: boolean;
  allowedWriteTableIfSeparatelyAuthorized: string;
  productionWrites: number;
}

export interface AuthorizedGateShadowCatchup {
  manifestSha256: string;
  signalIds: Set<string>;
}

export function authorizeGateShadowCatchup(
  bytes: Uint8Array,
  approvedSha256: string,
  session: string,
): AuthorizedGateShadowCatchup {
  const actualHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const approvedHash = approvedSha256.startsWith("sha256:")
    ? approvedSha256 : `sha256:${approvedSha256}`;
  if (actualHash !== approvedHash) throw new Error(`authorized catch-up manifest hash mismatch: ${actualHash}`);
  const manifest = JSON.parse(Buffer.from(bytes).toString("utf8")) as GateShadowCatchupManifest;
  const expected = new Set(manifest.expectedSignalIds);
  const present = new Set(manifest.presentSignalIds);
  const missing = new Set(manifest.missingSignalIds);
  const invalid = manifest.version !== "gate-shadow-catchup-manifest-v1"
    || manifest.session !== session
    || manifest.mode !== "read-only-select-audit"
    || manifest.productionWrites !== 0
    || manifest.allowedWriteTableIfSeparatelyAuthorized !== "virtual_trades"
    || !manifest.exactWriteRequired
    || missing.size === 0
    || expected.size !== manifest.expectedSignalIds.length
    || present.size !== manifest.presentSignalIds.length
    || missing.size !== manifest.missingSignalIds.length
    || present.size + missing.size !== expected.size
    || [...present].some((id) => missing.has(id) || !expected.has(id))
    || [...missing].some((id) => !expected.has(id));
  if (invalid) throw new Error("authorized catch-up manifest failed closed validation");
  return { manifestSha256: actualHash, signalIds: missing };
}
