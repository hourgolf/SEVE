export interface OperatorUserLike {
  app_metadata?: Record<string, unknown> | null;
}

export const SEVE_OPERATOR_ROLE = "operator";

// Authorization comes from Supabase app_metadata, which only an admin can
// change. Never use user_metadata here; users can edit that themselves.
export function isDeskOperator(user: OperatorUserLike | null | undefined): boolean {
  return user?.app_metadata?.seve_role === SEVE_OPERATOR_ROLE;
}
