/**
 * Durable, human-attested research classifications for individual paper trades.
 *
 * These annotations never rewrite broker/execution provenance. They only decide
 * whether a position is eligible to teach strategy and portfolio research.
 */
export type PositionAnalysisClass = "operator_test" | "execution_correction";

export interface PositionResearchAnnotation {
  positionId: string;
  analysisClass: PositionAnalysisClass;
  assertedOn: string;
  note: string;
}

export const POSITION_RESEARCH_ANNOTATIONS: readonly PositionResearchAnnotation[] = [
  {
    positionId: "2c103468-da30-407f-8e39-b5ecf8b2a956",
    analysisClass: "operator_test",
    assertedOn: "2026-07-13",
    note: "Operator initiated a manual-close functionality test; the native target filled first. Preserve target_premium execution provenance, but exclude the intervention from native strategy scoring.",
  },
];

const BY_POSITION_ID = new Map(POSITION_RESEARCH_ANNOTATIONS.map((a) => [a.positionId, a]));

export function getPositionResearchAnnotation(positionId: string): PositionResearchAnnotation | null {
  return BY_POSITION_ID.get(positionId) ?? null;
}

export function isPositionExcludedFromStrategyResearch(positionId: string): boolean {
  return BY_POSITION_ID.has(positionId);
}

export function validatePositionResearchAnnotations(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const a of POSITION_RESEARCH_ANNOTATIONS) {
    if (seen.has(a.positionId)) errors.push(`duplicate positionId: ${a.positionId}`);
    seen.add(a.positionId);
    if (!/^[0-9a-f-]{36}$/i.test(a.positionId)) errors.push(`invalid positionId: ${a.positionId}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.assertedOn)) errors.push(`invalid assertedOn: ${a.positionId}`);
    if (!a.note.trim()) errors.push(`empty note: ${a.positionId}`);
  }
  return errors;
}
