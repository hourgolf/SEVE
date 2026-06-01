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

interface AuthValue {
  session: Session | null;
  email: string | null;
  ready: boolean;
  /** Sends a magic link + 6-digit code to `email`. Returns an error or null. */
  signIn: (email: string) => Promise<string | null>;
  /** Verifies the emailed 6-digit code (no redirect — robust on mobile). */
  verifyCode: (email: string, token: string) => Promise<string | null>;
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
      ready,
      async signIn(email: string) {
        try {
          const sb = getSupabase();
          const { error } = await sb.auth.signInWithOtp({
            email,
            // single-route app now — "/console" was merged into "/" (the old
            // route 404'd the magic link and bounced sign-in in a loop).
            options: { emailRedirectTo: window.location.origin + "/" },
          });
          return error ? error.message : null;
        } catch (e) {
          return e instanceof Error ? e.message : "Sign-in failed";
        }
      },
      async verifyCode(email: string, token: string) {
        // No redirect / no PKCE verifier — Supabase validates the emailed code
        // server-side and returns a session right here. This is why it works on
        // mobile where the magic link opens in a different browser context.
        try {
          const sb = getSupabase();
          const { error } = await sb.auth.verifyOtp({
            email: email.trim(),
            token: token.trim(),
            type: "email",
          });
          return error ? error.message : null;
        } catch (e) {
          return e instanceof Error ? e.message : "Verification failed";
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
