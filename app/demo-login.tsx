"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

import DashboardClient from "./dashboard-client";
import DashboardHireDock from "./dashboard-hire-dock";
import BrandLogo from "./brand-logo";
import BrandArtwork from "./brand-artwork";
import type { PortalSnapshot } from "@/lib/portal-model";
import { GOOGLE_SIGN_IN_ORIGIN, GOOGLE_SIGN_IN_URL } from "@/lib/google-signin-origin";

type Providers = { google: boolean; microsoft: boolean; email: boolean };
type Enrollment = { secret: string; account: string };

type GoogleCredentialResponse = { credential?: string; state?: string };
type GoogleSignInConfig = { clientId: string; nonce: string; state: string; expiresAt: number };

async function fetchGoogleSignInConfig(): Promise<GoogleSignInConfig> {
  const response = await fetch("/api/auth/google/challenge", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(12000),
  });
  const body = await response.json() as GoogleSignInConfig & { error?: string };
  if (!response.ok || !body.clientId || !body.nonce || !body.state) throw new Error(body.error || "Google sign-in is temporarily unavailable. Please try again.");
  return body;
}

declare global {
  interface Window {
    google?: {
      accounts: { id: {
        initialize(options: { client_id: string; nonce: string; callback: (response: GoogleCredentialResponse) => void; auto_select?: boolean; ux_mode?: "popup" | "redirect" }): void;
        renderButton(element: HTMLElement, options: Record<string, string | number | boolean>): void;
        disableAutoSelect(): void;
      } };
    };
  }
}

export default function DemoLogin() {
  const portalAssurance = [
    "Approved accounts only · school and RJL review",
    "Operator actions are session logged and time stamped",
    "Controller heartbeat context is separated from emergency authority",
  ] as const;

  const [hydrated, setHydrated] = useState(false);
  const [snapshot, setSnapshot] = useState<PortalSnapshot | null>(null);
  const [googleConfig, setGoogleConfig] = useState<GoogleSignInConfig | null>(null);
  const [googlePortalLink, setGooglePortalLink] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authenticator, setAuthenticator] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [help, setHelp] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const signInBusyRef = useRef(false);

  const refreshGoogleSignIn = useCallback(async () => {
    if (window.location.origin !== GOOGLE_SIGN_IN_ORIGIN) {
      setGooglePortalLink(true);
      return;
    }
    setGoogleConfig(null);
    setPreparing(true);
    setGoogleError("");
    try {
      setGoogleConfig(await fetchGoogleSignInConfig());
    } catch (reason) {
      setGoogleError(reason instanceof Error ? reason.message : "Google sign-in is temporarily unavailable.");
    } finally {
      setPreparing(false);
    }
  }, []);

  const handleGoogleCredential = useCallback(async (response: GoogleCredentialResponse, config: GoogleSignInConfig) => {
    if (signInBusyRef.current) return;
    signInBusyRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (!response.credential || response.state !== config.state) throw new Error("Your sign-in request has expired. Please try again.");
      const result = await fetch("/api/auth/google", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: response.credential, state: response.state }) });
      const body = await result.json() as { snapshot?: PortalSnapshot; error?: string };
      if (!result.ok || !body.snapshot) throw new Error(body.error || "Google sign-in was not accepted.");
      setSnapshot(body.snapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google sign-in was not accepted.");
      await refreshGoogleSignIn();
    } finally {
      signInBusyRef.current = false;
      setSubmitting(false);
    }
  }, [refreshGoogleSignIn]);

  useEffect(() => {
    let active = true;
    if (new URLSearchParams(window.location.search).get("signin") === "microsoft_failed") {
      window.queueMicrotask(() => {
        if (active) setError("Microsoft sign-in was cancelled or this account is not approved. Please try again or choose another sign-in method.");
      });
      window.history.replaceState(null, "", "/login");
    }
    async function loadSignIn() {
      const [portal, options] = await Promise.allSettled([
        fetch("/api/portal", { cache: "no-store", signal: AbortSignal.timeout(12000) }).then(async (response) => response.ok ? response.json() as Promise<{ snapshot: PortalSnapshot }> : null),
        fetch("/api/auth/providers", { cache: "no-store", signal: AbortSignal.timeout(12000) }).then(async (response) => {
          if (!response.ok) throw new Error("Sign-in options could not be loaded. Please refresh the page.");
          return response.json() as Promise<Providers>;
        }),
      ]);
      if (!active) return;
      setHydrated(true);
      if (options.status === "fulfilled") setProviders(options.value);
      else setError("Sign-in options could not be loaded. Please refresh the page.");
      if (portal.status === "fulfilled" && portal.value?.snapshot) { setSnapshot(portal.value.snapshot); return; }
      if (options.status === "fulfilled" && options.value.google) {
        if (window.location.origin !== GOOGLE_SIGN_IN_ORIGIN) {
          setGooglePortalLink(true);
          return;
        }
        setPreparing(true);
        try { const config = await fetchGoogleSignInConfig(); if (active) setGoogleConfig(config); }
        catch { if (active) setGoogleError("Google could not be loaded. Please try again."); }
        finally { if (active) setPreparing(false); }
      }
    }
    void loadSignIn();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!googleConfig || snapshot || authenticator) return;
    let cancelled = false;
    let lastWidth = 0;
    const renderGoogleButton = () => {
      if (cancelled || !window.google || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({ client_id: googleConfig.clientId, nonce: googleConfig.nonce, ux_mode: "popup", auto_select: false, callback: (response) => void handleGoogleCredential(response, googleConfig) });
      const width = Math.min(400, Math.floor(googleButtonRef.current.clientWidth));
      if (width < 180) return;
      lastWidth = width;
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(googleButtonRef.current, { state: googleConfig.state, type: "standard", theme: "filled_blue", size: "large", text: "signin_with", shape: "rectangular", logo_alignment: "left", width });
    };
    const observer = new ResizeObserver(() => {
      const width = Math.min(400, Math.floor(googleButtonRef.current?.clientWidth ?? 0));
      if (width !== lastWidth) renderGoogleButton();
    });
    if (googleButtonRef.current) observer.observe(googleButtonRef.current);
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
    if (existing) {
      if (window.google) renderGoogleButton();
      else existing.addEventListener("load", renderGoogleButton, { once: true });
      return () => { cancelled = true; observer.disconnect(); existing.removeEventListener("load", renderGoogleButton); };
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = renderGoogleButton;
    script.onerror = () => {
      if (cancelled) return;
      script.remove();
      setGoogleConfig(null);
      setGoogleError("Google could not be loaded. Please try again.");
    };
    document.head.appendChild(script);
    return () => { cancelled = true; observer.disconnect(); };
  }, [googleConfig, snapshot, authenticator, handleGoogleCredential]);

  async function handleEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signInBusyRef.current) return;
    signInBusyRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = await fetch(authenticator ? "/api/auth/email/verify" : "/api/auth/email", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authenticator ? { code } : { email, password }), signal: AbortSignal.timeout(20000),
      });
      const body = await result.json() as { snapshot?: PortalSnapshot; requiresAuthenticator?: boolean; enrollment?: Enrollment | null; error?: string; restart?: boolean };
      if (body.restart) { setAuthenticator(false); setEnrollment(null); setCode(""); }
      if (!result.ok) throw new Error(body.error || "Sign-in could not be completed.");
      if (body.snapshot) { setSnapshot(body.snapshot); setEnrollment(null); setCode(""); }
      else if (body.requiresAuthenticator) { setAuthenticator(true); setEnrollment(body.enrollment ?? null); setPassword(""); }
      else throw new Error("Sign-in could not be completed. Please try again.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-in could not be completed."); }
    finally { signInBusyRef.current = false; setSubmitting(false); }
  }

  async function handleMicrosoftSignIn() {
    if (signInBusyRef.current || !providers?.microsoft) return;
    signInBusyRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = await fetch("/api/auth/microsoft/start", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(12000),
      });
      const body = await result.json() as { url?: string; error?: string };
      if (!result.ok || !body.url) throw new Error(body.error || "Microsoft sign-in is unavailable.");
      const destination = new URL(body.url);
      if (destination.origin !== "https://login.microsoftonline.com") throw new Error("Microsoft sign-in could not be started.");
      window.location.assign(destination.href);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Microsoft sign-in is unavailable.");
      signInBusyRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    try {
      const result = await fetch("/api/auth/logout", { method: "POST" });
      if (!result.ok) throw new Error("Sign-out failed. Please try again.");
    } catch { window.alert("Sign-out could not be completed. Please check your connection and try again."); return; }
    window.google?.accounts.id.disableAutoSelect();
    setError(""); setPassword(""); setCode(""); setAuthenticator(false); setEnrollment(null); setSnapshot(null);
    if (providers?.google) await refreshGoogleSignIn();
  }

  if (snapshot) return (
    <>
      <DashboardHireDock />
      <DashboardClient initialData={snapshot} user={snapshot.user} onSignOut={handleSignOut} />
    </>
  );

  return (
    <main className="magic-login">
      <section className="magic-login-panel" aria-labelledby="magic-login-title">
        <header className="magic-login-brand"><Link href="/" aria-label="Magic Keys home"><BrandLogo /><span>Balwyn High School</span></Link></header>
        <div className="magic-login-content">
          <div className="magic-login-heading"><h1 id="magic-login-title">{authenticator ? "Verify your sign-in" : "Welcome back"}</h1><p>{authenticator ? "Enter the code from your authenticator app." : "Sign in to the Balwyn High School Magic Keys operations portal."}</p></div>
          {!authenticator && <ul className="magic-login-assurance" aria-label="Portal assurance">
            {portalAssurance.map((item) => <li key={item}><ShieldCheck aria-hidden="true" />{item}</li>)}
          </ul>}
          <form className="magic-login-form" onSubmit={handleEmailSignIn} aria-busy={submitting}>
            {authenticator ? <>
              {enrollment && <div className="magic-login-enrollment"><strong>Set up your authenticator</strong><p>Add a new account in Google Authenticator, Microsoft Authenticator or another authenticator app. Choose a time-based key and enter:</p><code>{enrollment.secret}</code><span>Account: {enrollment.account}</span></div>}
              <label htmlFor="login-code">Authenticator code</label>
              <div className="magic-login-input"><ShieldCheck aria-hidden="true" /><input id="login-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus placeholder="000000" /></div>
              <button className="magic-login-submit" type="submit" disabled={submitting || code.length !== 6}>{submitting ? "Verifying…" : "Verify and sign in"}<ArrowRight aria-hidden="true" /></button>
              <button className="magic-login-text-button" type="button" disabled={submitting} onClick={() => { setAuthenticator(false); setEnrollment(null); setCode(""); setError(""); }}>Back to sign in</button>
            </> : <>
              <label htmlFor="login-email">Email or username</label>
              <div className="magic-login-input"><Mail aria-hidden="true" /><input id="login-email" name="username" type="text" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@school.edu.au" maxLength={254} required /></div>
              <label htmlFor="login-password">Password</label>
              <div className="magic-login-input"><LockKeyhole aria-hidden="true" /><input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={1024} required placeholder="Enter your password" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff /> : <Eye />}</button></div>
              <button className="magic-login-forgot" type="button" aria-expanded={help} aria-controls="login-help" onClick={() => setHelp(!help)}>Forgot password?</button>
              {help && <p id="login-help" className="magic-login-help">Use your connected Google or Microsoft account, or ask your portal administrator to reset your operator password. Your email provider’s password is separate from your portal password.</p>}
              <button className="magic-login-submit" type="submit" disabled={submitting || !hydrated || !providers?.email}>{submitting ? "Signing in…" : !hydrated ? "Preparing sign-in…" : "Sign in"}<ArrowRight aria-hidden="true" /></button>
              {providers && !providers.email && <p className="magic-login-provider-note">Email sign-in is currently unavailable.</p>}
            </>}
          </form>
          {error && <p className="magic-login-error" role="alert">{error}</p>}
          {!authenticator && <>
            <div className="magic-login-divider"><span>or continue with</span></div>
            <div className="magic-login-providers" aria-busy={preparing || submitting}>
              {googlePortalLink ? <a className="magic-login-provider" href={GOOGLE_SIGN_IN_URL} target="_top"><span className="magic-google-letter" aria-hidden="true">G</span>Continue with Google <ArrowRight aria-hidden="true" /></a> : googleConfig ? <div ref={googleButtonRef} className="magic-login-google" aria-label="Sign in with Google" /> : <button className="magic-login-provider" type="button" disabled={preparing || submitting || !providers?.google} onClick={() => void refreshGoogleSignIn()}><span className="magic-google-letter" aria-hidden="true">G</span>{preparing ? "Loading Google…" : "Sign in with Google"}</button>}
              {googlePortalLink && <p className="magic-login-provider-note">Continue on the school’s Magic Keys portal to sign in.</p>}
              {googleError && <p className="magic-login-provider-note" role="status">{googleError}</p>}
              <button className="magic-login-provider" type="button" onClick={() => void handleMicrosoftSignIn()} disabled={submitting || !providers?.microsoft} aria-describedby={providers && !providers.microsoft ? "microsoft-status" : undefined}><span className="magic-microsoft-icon" aria-hidden="true"><i /><i /><i /><i /></span>Microsoft / Hotmail</button>
              {providers && !providers.microsoft && <p id="microsoft-status" className="magic-login-provider-note">Microsoft sign-in is being connected.</p>}
            </div>
          </>}
          <p className="magic-login-approval"><ShieldCheck aria-hidden="true" /> Access for approved accounts</p>
          <nav className="magic-login-legal" aria-label="Legal information"><a href="/privacy">Privacy</a><span aria-hidden="true">·</span><a href="/terms">Terms</a></nav>
        </div>
      </section>
      <div className="magic-login-visual"><BrandArtwork className="magic-login-artwork" /><div className="magic-login-school"><img src="/balwyn-watermark.png" alt="Balwyn High School" /><span>Balwyn High School</span></div></div>
    </main>
  );
}
