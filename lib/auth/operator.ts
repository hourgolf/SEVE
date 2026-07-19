export interface OperatorUserLike {
  app_metadata?: Record<string, unknown> | null;
}

export const SEVE_OPERATOR_ROLE = "operator";
export const SEVE_OPERATOR_EMAIL = "pobrecitopdx@gmail.com";

// Login UX enrollment guard only. Authorization must still use the immutable
// app_metadata role below on every server route and RLS policy.
export function isOperatorLoginEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === SEVE_OPERATOR_EMAIL;
}

// Authorization comes from Supabase app_metadata, which only an admin can
// change. Never use user_metadata here; users can edit that themselves.
export function isDeskOperator(user: OperatorUserLike | null | undefined): boolean {
  return user?.app_metadata?.seve_role === SEVE_OPERATOR_ROLE;
}
