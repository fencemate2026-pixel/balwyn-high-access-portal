"use client";
// One-time password setup for a per-person account.
// The administrator creates the account in Access & users and passes the person
// a link: /setup?token=…  The token is read from the address, sent once to
// /api/auth/setup-password, and then removed from the address bar so it is not
// left in browser history or shown on screen.
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import BrandLogo from "../brand-logo";

const MIN_LENGTH = 12; // must match MIN_PASSWORD_LENGTH in lib/portal-auth.ts

export default function SetupPasswordForm() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneEmail, setDoneEmail] = useState("");

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("token") ?? "";
    window.history.replaceState(null, "", "/setup");
    // Reading the address happens once, after mount, so the token is never rendered on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(value);
  }, []);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = Boolean(token) && password.length >= MIN_LENGTH && password === confirm && !busy;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !token) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/setup-password", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }), signal: AbortSignal.timeout(20000),
      });
      const body = await response.json() as { email?: string; error?: string };
      if (!response.ok || !body.email) throw new Error(body.error || "The password could not be saved.");
      setDoneEmail(body.email); setPassword(""); setConfirm(""); setToken(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The password could not be saved.");
    } finally { setBusy(false); }
  }

  return (
    <main className="access-login access-login-school-blue mk-setup min-h-svh antialiased">
      <section className="access-login-panel mk-setup-panel" aria-labelledby="setup-title">
        <div className="login-school-badge"><BrandLogo /><span>BALWYN HIGH SCHOOL</span></div>
        <div className="access-login-card has-form">
          <p className="access-login-kicker">CAMPUS ACCESS PORTAL</p>
          {doneEmail ? <>
            <div className="access-login-heading"><h1 id="setup-title">Password saved.</h1><p>You can now sign in as <strong>{doneEmail}</strong>. This setup link no longer works.</p></div>
            <Link className="access-login-submit" href="/login">Go to sign in<ArrowRight aria-hidden="true" /></Link>
          </> : token === "" ? <>
            <div className="access-login-heading"><h1 id="setup-title">Setup link missing.</h1><p>Open the full link your administrator gave you. If it has expired, ask them for a new one from Access &amp; users.</p></div>
            <Link className="access-login-text-button" href="/login">Back to sign in</Link>
          </> : <>
            <div className="access-login-heading"><h1 id="setup-title">Choose your password.</h1><p>At least {MIN_LENGTH} characters. Operators and administrators will also set up a six-digit authenticator code at first sign-in.</p></div>
            <form className="access-login-form" onSubmit={submit} aria-busy={busy}>
              <label htmlFor="setup-password">New password</label>
              <div className="access-login-input"><LockKeyhole aria-hidden="true" /><input id="setup-password" type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={MIN_LENGTH} maxLength={1024} required aria-invalid={tooShort} aria-describedby="setup-rules" /><button type="button" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} onClick={() => setShow(!show)}>{show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button></div>
              <p id="setup-rules" className={`access-login-provider-note ${tooShort ? "is-warning" : ""}`}>{tooShort ? `${MIN_LENGTH - password.length} more characters needed.` : "A short sentence is easier to remember than random symbols."}</p>
              <label htmlFor="setup-confirm">Confirm password</label>
              <div className="access-login-input"><LockKeyhole aria-hidden="true" /><input id="setup-confirm" type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={1024} required aria-invalid={mismatch} /></div>
              {mismatch && <p className="access-login-provider-note is-warning" role="status">The two passwords do not match.</p>}
              <button className="access-login-submit" type="submit" disabled={!ready}>{busy ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Saving…</> : <>Save password<CheckCircle2 aria-hidden="true" /></>}</button>
            </form>
            {error && <p className="access-login-error" role="alert">{error}</p>}
          </>}
        </div>
      </section>
    </main>
  );
}
