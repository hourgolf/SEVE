export interface SessionEntryPath {
  candidateId: string;
  sessionDateEt: string;
  decisionAt: string;
}

export interface SessionEntryOrdinal<T extends SessionEntryPath> {
  path: T;
  ordinal: number;
}

export function sessionEntryOrdinals<T extends SessionEntryPath>(
  paths: readonly T[],
): SessionEntryOrdinal<T>[] {
  const counts = new Map<string, number>();
  return [...paths]
    .sort((left, right) => left.decisionAt.localeCompare(right.decisionAt)
      || left.candidateId.localeCompare(right.candidateId))
    .map((path) => {
      const ordinal = (counts.get(path.sessionDateEt) ?? 0) + 1;
      counts.set(path.sessionDateEt, ordinal);
      return { path, ordinal };
    });
}

export function selectSessionEntryCap<T extends SessionEntryPath>(
  paths: readonly T[],
  maxEntriesPerSession: number | null,
): T[] {
  if (maxEntriesPerSession != null
      && (!Number.isInteger(maxEntriesPerSession) || maxEntriesPerSession < 1)) {
    throw new Error("max entries per session must be a positive integer or null");
  }
  return sessionEntryOrdinals(paths)
    .filter(({ ordinal }) =>
      maxEntriesPerSession == null || ordinal <= maxEntriesPerSession)
    .map(({ path }) => path);
}
