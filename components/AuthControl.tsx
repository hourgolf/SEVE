"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";

// Auth widget. Signed out → email field → we email a magic LINK *and* a 6-digit
// CODE. On desktop tap the link; on mobile (where the link opens in a different
// browser and the PKCE exchange fails) just type the code — verifyOtp needs no
// redirect, so it works in the same screen. Signed in → email + "Sign out".
export function AuthControl({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const { email, operator, ready, signIn, verifyCode, signOut } = useAuth();
  const [open, setOpen] = useState(defaultOpen);
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready) return <span className="auth-placeholder" />;

  if (email) {
    return (
      <div className="auth">
        <span className="auth-email" title={email}>{operator ? "●" : "○"} {email}{operator ? "" : " · NOT AUTHORIZED"}</span>
        <button className="auth-btn" onClick={() => signOut()}>Sign out</button>
      </div>
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const addr = value.trim();
    if (!addr) return;
    setBusy(true);
    setMsg(null);
    const err = await signIn(addr);
    setBusy(false);
    if (err) { setMsg(err); return; }
    setSentTo(addr);
    setMsg("✓ Sent. Enter the code from the email (or tap the link).");
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!sentTo || !code.trim()) return;
    setBusy(true);
    setMsg(null);
    const err = await verifyCode(sentTo, code);
    setBusy(false);
    // success flips the auth state via onAuthStateChange → this re-renders signed-in
    if (err) setMsg(err);
  }

  return (
    <div className="auth">
      {!open ? (
        <button className="auth-btn" onClick={() => setOpen(true)}>Sign in</button>
      ) : !sentTo ? (
        <form className="auth-form" onSubmit={send}>
          <input
            type="email"
            inputMode="email"
            placeholder="you@email.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <button className="auth-btn" type="submit" disabled={busy}>
            {busy ? "…" : "Send code"}
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={verify}>
          <input
            className="auth-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={10}
            placeholder="email code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
            autoFocus
          />
          <button className="auth-btn" type="submit" disabled={busy || code.length < 6}>
            {busy ? "…" : "Verify"}
          </button>
          <button
            type="button"
            className="auth-link"
            onClick={() => { setSentTo(null); setCode(""); setMsg(null); }}
          >
            use a different email
          </button>
        </form>
      )}
      {msg && <span className="auth-msg">{msg}</span>}
    </div>
  );
}
