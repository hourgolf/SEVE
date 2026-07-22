/** Database-boundary semantics for deterministic execution-observation IDs.
 * `ignoreDuplicates` is insert-if-absent: an existing immutable receipt is
 * retained byte-for-byte rather than updated by a retry. */
export const EXECUTION_OBSERVATION_WRITE_OPTIONS = Object.freeze({
  onConflict: "id",
  ignoreDuplicates: true,
} as const);
