"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";
import { isDeskOperator, SEVE_OPERATOR_EMAIL } from "@/lib/auth/operator";

interface AuthValue {
  session: Session | null;
  email: string | null;
  operator: boolean;
  ready: boolean;
  /** Password sign-in for the single provisioned operator account. */
  signInWithPassword: (password: string) => Promise<string | null>;
  /** Sends a recovery magic link + 6-digit code to the provisioned operator. */
  requestRecoveryCode: () => Promise<string | null>;
  /** Verifies the operator recovery code (no redirect — robust on mobile). */
  verifyRecoveryCode: (token: string) => Promise<string | null>;
  /** Sets or rotates the password on the currently authenticated operator. */
  updatePassword: (password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

// Single source of session truth, shared via context so the nav widget and the
// console controls agree without each opening its own auth listener.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let sb;
    try {
      sb = getSupabase();
    } catch {
      setReady(true); // env not configured — auth simply unavailable
      return;
    }
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      email: session?.user?.email ?? null,
      operator: isDeskOperator(session?.user),
      ready,
      async signInWithPassword(password: string) {
        if (!password) return "password required";
        try {
          const sb = getSupabase();
          const { error } = await sb.auth.signInWithPassword({
            email: SEVE_OPERATOR_EMAIL,
            password,
          });
          return error ? error.message : null;
        } catch (e) {
          return e instanceof Error ? e.message : "Sign-in failed";
        }
      },
      async requestRecoveryCode() {
        try {
          const sb = getSupabase();
          const { error } = await sb.auth.signInWithOtp({
            email: SEVE_OPERATOR_EMAIL,
            // single-route app now — "/console" was merged into "/" (the old
            // route 404'd the magic link and bounced sign-in in a loop).
            // This is an operator console, not a public sign-up surface. Only
            // users provisioned in Supabase Auth may request a desk login.
            options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + "/" },
          });
          return error ? error.message : null;
        } catch (e) {
          return e instanceof Error ? e.message : "Sign-in failed";
        }
      },
      async verifyRecoveryCode(token: string) {
        // No redirect / no PKCE verifier — Supabase validates the emailed code
        // server-side and returns a session right here. This is why it works on
        // mobile where the magic link opens in a different browser context.
        try {
          const sb = getSupabase();
          const { error } = await sb.auth.verifyOtp({
            email: SEVE_OPERATOR_EMAIL,
            token: token.trim(),
            type: "email",
          });
          return error ? error.message : null;
        } catch (e) {
          return e instanceof Error ? e.message : "Verification failed";
        }
      },
      async updatePassword(password: string) {
        if (!isDeskOperator(session?.user)) return "operator authorization required";
        if (password.length < 12) return "use at least 12 characters";
        try {
          const { error } = await getSupabase().auth.updateUser({ password });
          return error ? error.message : null;
        } catch (e) {
          return e instanceof Error ? e.message : "Password update failed";
        }
      },
      async signOut() {
        try {
          await getSupabase().auth.signOut();
        } catch {
          /* ignore */
        }
      },
    }),
    [session, ready]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
