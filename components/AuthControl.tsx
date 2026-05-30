"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";

// Magic-link auth widget in the nav. Signed out → "Sign in" → email field →
// "check your email". Signed in → email + "Sign out". Reads stay anon; signing
// in unlocks the console's write controls.
export function AuthControl() {
  const { email, ready, signIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!ready) return <span className="auth-placeholder" />;

  if (email) {
    return (
      <div className="auth">
        <span className="auth-email" title={email}>
          ● {email}
        </span>
        <button className="auth-btn" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const addr = value.trim();
    if (!addr) return;
    setSending(true);
    setMsg(null);
    const err = await signIn(addr);
    setSending(false);
    setMsg(err ?? "✓ Check your email for the magic link.");
  }

  return (
    <div className="auth">
      {!open ? (
        <button className="auth-btn" onClick={() => setOpen(true)}>
          Sign in
        </button>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <input
            type="email"
            inputMode="email"
            placeholder="you@email.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <button className="auth-btn" type="submit" disabled={sending}>
            {sending ? "…" : "Send link"}
          </button>
        </form>
      )}
      {msg && <span className="auth-msg">{msg}</span>}
    </div>
  );
}
