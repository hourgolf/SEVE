import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Rc54ComparableContractRequest } from "./rc54ComparableFreeze";
import {
  dedupeCbboQuotes,
  parsePersistedDatabentoCbboObject,
  type DatabentoCbboQuote,
} from "./databentoExactPath";

export const RC54_COMPARABLE_SOURCE_VERSION = "rc54-comparable-cbbo-source-v1" as const;

export interface Rc54ComparableSourceManifest {
  version: typeof RC54_COMPARABLE_SOURCE_VERSION;
  requestId: string;
  sessionDateEt: string;
  occSymbol: string;
  startIso: string;
  endIso: string;
  rowCount: number;
  firstQuoteAt: string;
  lastQuoteAt: string;
  contentSha256: string;
  compressedSha256: string;
  compressedBytes: number;
  source: "databento_historical_cbbo_1s";
  externalWrites: false;
  orderPathAuthorized: false;
}

export interface Rc54ComparableSourceArtifact {
  raw: Buffer;
  compressed: Buffer;
  manifest: Rc54ComparableSourceManifest;
}

const sha256 = (value: Uint8Array): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function validate(
  request: Rc54ComparableContractRequest,
  quotes: readonly DatabentoCbboQuote[],
): DatabentoCbboQuote[] {
  const startMs = Date.parse(request.startIso);
  const endMs = Date.parse(request.endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error(`invalid exact request window ${request.requestId}`);
  }
  if (!quotes.length) throw new Error(`empty exact path ${request.requestId}`);
  if (quotes.some((quote) => quote.occSymbol !== request.occSymbol
      || quote.source !== "databento_cbbo_1s"
      || !Number.isFinite(quote.atMs) || quote.atMs < startMs || quote.atMs > endMs
      || !Number.isFinite(quote.bid) || quote.bid < 0
      || !Number.isFinite(quote.ask) || quote.ask < 0
      || (quote.ask > 0 && quote.ask < quote.bid))) {
    throw new Error(`invalid exact path identity or quote ${request.requestId}`);
  }
  const deduped = dedupeCbboQuotes(quotes);
  if (deduped.length !== quotes.length) {
    throw new Error(`duplicate exact quote timestamps ${request.requestId}`);
  }
  return deduped;
}

export function buildRc54ComparableSourceArtifact(input: {
  request: Rc54ComparableContractRequest;
  quotes: readonly DatabentoCbboQuote[];
}): Rc54ComparableSourceArtifact {
  const quotes = validate(input.request, input.quotes);
  const raw = Buffer.from(`${JSON.stringify(quotes)}\n`, "utf8");
  const compressed = gzipSync(raw, { level: 9 });
  return {
    raw,
    compressed,
    manifest: {
      version: RC54_COMPARABLE_SOURCE_VERSION,
      requestId: input.request.requestId,
      sessionDateEt: input.request.sessionDateEt,
      occSymbol: input.request.occSymbol,
      startIso: input.request.startIso,
      endIso: input.request.endIso,
      rowCount: quotes.length,
      firstQuoteAt: new Date(quotes[0].atMs).toISOString(),
      lastQuoteAt: new Date(quotes[quotes.length - 1].atMs).toISOString(),
      contentSha256: sha256(raw),
      compressedSha256: sha256(compressed),
      compressedBytes: compressed.byteLength,
      source: "databento_historical_cbbo_1s",
      externalWrites: false,
      orderPathAuthorized: false,
    },
  };
}

export function readRc54ComparableSourceArtifact(input: {
  request: Rc54ComparableContractRequest;
  compressed: Buffer;
  manifest: Rc54ComparableSourceManifest;
}): DatabentoCbboQuote[] {
  if (input.manifest.version !== RC54_COMPARABLE_SOURCE_VERSION
      || input.manifest.requestId !== input.request.requestId
      || input.manifest.sessionDateEt !== input.request.sessionDateEt
      || input.manifest.occSymbol !== input.request.occSymbol
      || input.manifest.startIso !== input.request.startIso
      || input.manifest.endIso !== input.request.endIso
      || input.manifest.source !== "databento_historical_cbbo_1s"
      || input.manifest.externalWrites
      || input.manifest.orderPathAuthorized
      || input.manifest.compressedBytes !== input.compressed.byteLength
      || input.manifest.compressedSha256 !== sha256(input.compressed)) {
    throw new Error(`exact source manifest mismatch ${input.request.requestId}`);
  }
  const raw = gunzipSync(input.compressed);
  if (input.manifest.contentSha256 !== sha256(raw)) {
    throw new Error(`exact source content checksum mismatch ${input.request.requestId}`);
  }
  const parsed = parsePersistedDatabentoCbboObject(raw);
  if (parsed.invalidRows > 0 || parsed.quotes.length !== input.manifest.rowCount) {
    throw new Error(`exact source row accounting mismatch ${input.request.requestId}`);
  }
  const quotes = validate(input.request, parsed.quotes);
  if (new Date(quotes[0].atMs).toISOString() !== input.manifest.firstQuoteAt
      || new Date(quotes[quotes.length - 1].atMs).toISOString() !== input.manifest.lastQuoteAt) {
    throw new Error(`exact source boundary mismatch ${input.request.requestId}`);
  }
  return quotes;
}
