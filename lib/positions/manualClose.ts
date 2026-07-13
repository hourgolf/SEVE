export const MANUAL_CLOSE_REASONS = [
  { value: "target", label: "BANKED", hint: "banked the move" },
  { value: "reversal", label: "TAPE TURNED", hint: "setup reversed" },
  { value: "risk", label: "RISK CUT", hint: "defensive exit" },
  { value: "stall", label: "STALLED", hint: "no follow-through" },
  { value: "test", label: "SYSTEM TEST", hint: "operator functionality test" },
  { value: "correction", label: "EXECUTION FIX", hint: "corrected broker or desk state" },
] as const;

const VALUES = new Set<string>(MANUAL_CLOSE_REASONS.map((reason) => reason.value));

export function normalizeManualCloseTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return VALUES.has(normalized) ? normalized : null;
}
