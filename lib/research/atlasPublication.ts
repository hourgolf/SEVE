import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";

// This descriptor is written with the whole bundle. It is not itself a claim
// that publishing succeeded: a reader must verify every expected row and hash.
export interface AtlasPublicationDescriptor {
  version: "atlas-publication-v1";
  throughSession: string;
  generatedAt: string;
  bundleSha256: string;
  channels: string[];
}

export interface AtlasPublicationVerification {
  state: "verified" | "unverified";
  throughSession: string;
  rows: number;
  detail: string;
  bundleSha256?: string;
}

export const stablePublicationJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stablePublicationJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stablePublicationJson(item)}`).join(",")}}`;
};

export function atlasPublicationDescriptor(bundle: ChannelDecisionBriefBundle, bundleSha256: string): AtlasPublicationDescriptor {
  const channels = Object.values(bundle.channels).map((brief) => brief.channel).sort();
  if (!channels.length || new Set(channels).size !== channels.length) throw new Error("publication channels must be nonempty and unique");
  return { version: "atlas-publication-v1", throughSession: bundle.throughSession,
    generatedAt: bundle.generatedAt, bundleSha256, channels };
}

export interface AtlasPublishedRow {
  channel_slug: string;
  brief: unknown;
  brief_sha256: string;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export async function verifyAtlasPublication(rows: AtlasPublishedRow[], throughSession: string,
  hash: (value: unknown) => Promise<string>): Promise<AtlasPublicationVerification> {
  if (!rows.length) throw new Error("Atlas publication has no channel rows");
  const seen = new Set<string>();
  for (const row of rows) {
    const brief = object(row.brief);
    if (!brief || brief.channel !== row.channel_slug || brief.throughSession !== throughSession || seen.has(row.channel_slug)) {
      throw new Error("Atlas publication channel/session identity mismatch");
    }
    seen.add(row.channel_slug);
    if (await hash(brief) !== row.brief_sha256) throw new Error(`Atlas brief hash mismatch: ${row.channel_slug}`);
  }
  const descriptors = rows.map((row) => object(object(row.brief)?.publication));
  if (descriptors.every((descriptor) => descriptor === null)) return {
    state: "unverified", throughSession, rows: rows.length,
    detail: "Stored brief hashes match; the older publisher did not record a complete-bundle receipt.",
  };
  const descriptor = descriptors[0];
  if (!descriptor || descriptor.version !== "atlas-publication-v1" || descriptor.throughSession !== throughSession
    || !/^sha256:[0-9a-f]{64}$/.test(String(descriptor.bundleSha256))
    || !Number.isFinite(Date.parse(String(descriptor.generatedAt)))
    || !Array.isArray(descriptor.channels) || descriptor.channels.some((channel) => typeof channel !== "string")
    || new Set(descriptor.channels).size !== descriptor.channels.length
    || stablePublicationJson([...seen].sort()) !== stablePublicationJson(descriptor.channels)
    || descriptors.some((item) => stablePublicationJson(item) !== stablePublicationJson(descriptor))
    || rows.some((row) => object(row.brief)?.generatedAt !== descriptor.generatedAt)) {
    throw new Error("Atlas publication is partial or combines different bundle receipts");
  }
  return { state: "verified", throughSession, rows: rows.length, bundleSha256: String(descriptor.bundleSha256),
    detail: `${rows.length} channel briefs read back with matching hashes and one complete-bundle receipt. This does not certify the separate next-session brief or every nightly stage.` };
}

export async function browserPublicationHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stablePublicationJson(value)));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
