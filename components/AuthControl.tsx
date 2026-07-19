"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";

// Private single-operator login. Password is the normal path; the provisioned
// inbox receives a one-time recovery code only when explicitly requested.
export function AuthControl({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const {
    email,
    operator,
    ready,
    signInWithPassword,
    requestRecoveryCode,
    verifyRecoveryCode,
    updatePassword,
    signOut,
  } = useAuth();
  const [open, setOpen] = useState(defaultOpen);
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready) return <span className="auth-placeholder" />;

  if (email) {
    return (
      <div className="auth auth-signed">
        <div className="auth-signed-row">
          <span className="auth-email" title={email}>{operator ? "●" : "○"} {email}{operator ? "" : " · NOT AUTHORIZED"}</span>
          <button className="auth-btn" onClick={() => signOut()}>Sign out</button>
        </div>
        {operator && !passwordOpen && (
          <button className="auth-link" type="button" onClick={() => { setPasswordOpen(true); setMsg(null); }}>set / rotate password</button>
        )}
        {operator && passwordOpen && (
          <form className="auth-form" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true); setMsg(null);
            const error = await updatePassword(newPassword);
            setBusy(false);
            if (error) setMsg(error);
            else { setNewPassword(""); setPasswordOpen(false); setMsg("password updated"); }
          }}>
            <input type="password" autoComplete="new-password" minLength={12} placeholder="new password · 12+ characters" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoFocus />
            <button className="auth-btn" type="submit" disabled={busy || newPassword.length < 12}>{busy ? "…" : "Save password"}</button>
            <button className="auth-link" type="button" onClick={() => { setPasswordOpen(false); setNewPassword(""); setMsg(null); }}>cancel</button>
          </form>
        )}
        {msg && <span className="auth-msg">{msg}</span>}
      </div>
    );
  }

  async function passwordSignIn(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setBusy(true); setMsg(null);
    const error = await signInWithPassword(password);
    setBusy(false);
    if (error) setMsg(error);
    else setPassword("");
  }

  async function sendRecoveryCode() {
    setBusy(true); setMsg(null);
    const error = await requestRecoveryCode();
    setBusy(false);
    if (error) setMsg(error);
    else { setCodeSent(true); setMsg("recovery code sent to the operator inbox"); }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setMsg(null);
    const error = await verifyRecoveryCode(code);
    setBusy(false);
    if (error) setMsg(error);
  }

  return (
    <div className="auth">
      {!open ? (
        <button className="auth-btn" onClick={() => setOpen(true)}>Sign in</button>
      ) : recoveryOpen ? (
        !codeSent ? (
          <div className="auth-form auth-operator-only">
            <span className="auth-operator-label">OPERATOR RECOVERY</span>
            <button className="auth-btn" type="button" disabled={busy} onClick={sendRecoveryCode}>{busy ? "…" : "Email recovery code"}</button>
            <button className="auth-link" type="button" onClick={() => { setRecoveryOpen(false); setMsg(null); }}>back to password</button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={verify}>
            <input className="auth-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10} placeholder="recovery code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 10))} autoFocus />
            <button className="auth-btn" type="submit" disabled={busy || code.length < 6}>{busy ? "…" : "Verify"}</button>
            <button className="auth-link" type="button" onClick={() => { setCodeSent(false); setCode(""); setMsg(null); }}>request a new code</button>
          </form>
        )
      ) : (
        <form className="auth-form auth-operator-only" onSubmit={passwordSignIn}>
          <span className="auth-operator-label">AUTHORIZED OPERATOR ONLY</span>
          <input type="password" autoComplete="current-password" placeholder="operator password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
          <button className="auth-btn" type="submit" disabled={busy || !password}>{busy ? "…" : "Unlock desk"}</button>
          <button className="auth-link" type="button" onClick={() => { setRecoveryOpen(true); setMsg(null); }}>use a recovery code</button>
        </form>
      )}
      {msg && <span className="auth-msg">{msg}</span>}
    </div>
  );
}
