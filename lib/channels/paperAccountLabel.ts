export const PAPER_ACCOUNT_SLOTS = Object.freeze({
  "cd817549-e025-4d38-805e-d32e607052f7": 1,
  "56daa293-e6bc-447d-83ac-2bfafb4d0ac1": 2,
  "995aa327-b0da-4050-bede-97ab462b06cd": 3,
} as const);

export type PaperAccountSlot = 1 | 2 | 3;

/**
 * Operator-facing account names are neutral workstation slots. Immutable
 * account UUIDs remain the routing authority; historical names and credential
 * references are deliberately not rewritten or exposed.
 */
export function paperAccountSlot(accountId: string | null | undefined): PaperAccountSlot | null {
  if (!accountId) return null;
  return PAPER_ACCOUNT_SLOTS[accountId as keyof typeof PAPER_ACCOUNT_SLOTS] ?? null;
}

export function paperAccountLabel(
  accountId: string | null | undefined,
  fallback = "PAPER",
): string {
  const slot = paperAccountSlot(accountId);
  return slot ? `PAPER ${slot}` : fallback;
}
