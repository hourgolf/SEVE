export const POST_CLOSE_ARCHIVE_MIN = 975; // 16:15 ET

export interface ArchiveCycleSealInput {
  nowEtMinute: number;
  failedDays: number;
}

/**
 * The in-memory once-per-day guard may only be sealed after the current ET
 * session is complete and every candidate day was either already present,
 * uploaded successfully, or truthfully found empty (weekend/holiday).
 *
 * In particular, a pre-close boot with no prior-day work must not suppress the
 * later post-close archive, and any failed upload must remain retryable.
 */
export function archiveCycleMaySeal(input: ArchiveCycleSealInput): boolean {
  return input.nowEtMinute >= POST_CLOSE_ARCHIVE_MIN && input.failedDays === 0;
}
