"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, Eye, EyeOff, HelpCircle, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

import SessionExitGuard from "./session-exit-guard";
import PresenceTracker from "./presence-tracker";
import BrandLogo from "./brand-logo";
import BrandArtwork from "./brand-artwork";
import type { PortalSnapshot } from "@/lib/portal-model";
import { GOOGLE_SIGN_IN_ORIGIN, GOOGLE_SIGN_IN_URL } from "@/lib/google-signin-origin";

// Gate rendering and operator tools are only needed after authentication.
const DashboardClient = dynamic(() => import("./dashboard-client"), {
  loading: () => <main className="login-workspace-loading" role="status"><LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /><h1>Opening your workspace…</h1><p>You’re signed in. Loading your workspace.</p></main>,
});
const OperatorHelpDock = dynamic(() => import("./operator-help-dock"));

function prepareWorkspace() {
  void import("./dashboard-client").catch(() => { /* Loading is retried when the workspace renders. */ });
}

/**
 * Message shown when a sign-in request fails. A browser timeout or abort raises a
 * DOMException whose text is engine wording ("signal timed out" in Chrome, "The
 * operation timed out." in Firefox), which staff saw verbatim on 12 Oct 2026.
 * Those are replaced with plain English; server messages pass through unchanged.
 */
function signInFailureMessage(reason: unknown, fallback: string): string {
  if (reason instanceof DOMException && (reason.name === "TimeoutError" || reason.name === "AbortError")) {
    return "The portal took too long to respond. Please try again in a moment.";
  }
  return reason instanceof Error ? reason.message : fallback;
}

let googleIdentityRequest: Promise<void> | null = null;
function loadGoogleIdentity(): Promise<void> {
  if (window.google) return Promise.resolve();
  if (googleIdentityRequest) return googleIdentityRequest;
  googleIdentityRequest = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.dataset.googleIdentity = "true";
    const timer = window.setTimeout(fail, 12000);
    function fail() {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error("Google could not be loaded. Please try again."));
    }
    script.onload = () => { window.clearTimeout(timer); if (window.google) resolve(); else fail(); };
    script.onerror = fail;
    document.head.appendChild(script);
  }).catch((reason) => { googleIdentityRequest = null; throw reason; });
  return googleIdentityRequest;
}

async function prepareGoogleSignIn() {
  // Download the provider SDK while the browser-bound challenge is prepared.
  const [config] = await Promise.all([fetchGoogleSignInConfig(), loadGoogleIdentity()]);
  return config;
}

type Providers = { google: boolean; microsoft: boolean; email: boolean; azure?: boolean; azureStaff?: string };
const AZURE_RETURN = encodeURIComponent("/api/auth/azure/complete");
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

export default function DemoLogin({ generalClient = false, preferredProvider }: { generalClient?: boolean; preferredProvider?: "google" } = {}) {
  const googleOnly = generalClient && preferredProvider === "google";
  const [snapshot, setSnapshot] = useState<PortalSnapshot | null>(null);
  const [googleConfig, setGoogleConfig] = useState<GoogleSignInConfig | null>(null);
  const [googlePortalLink, setGooglePortalLink] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [providers, setProviders] = useState<Providers | null>(null);
  // Keep the requested form visible; server readiness still controls submission.
  const emailAvailable = providers?.email === true;
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
  const helpRef = useRef<HTMLDivElement>(null);
  // Bring the help text into view once, when it opens; typing afterwards is never interrupted.
  useEffect(() => { if (help) helpRef.current?.focus(); }, [help]);
  const signInBusyRef = useRef(false);
  const restoreSessionRef = useRef(true);

  const refreshGoogleSignIn = useCallback(async () => {
    if (window.location.origin !== GOOGLE_SIGN_IN_ORIGIN) {
      setGooglePortalLink(true);
      return;
    }
    setGoogleConfig(null);
    setPreparing(true);
    setGoogleError("");
    try {
      setGoogleConfig(await prepareGoogleSignIn());
    } catch (reason) {
      setGoogleError(reason instanceof Error ? reason.message : "Google sign-in is temporarily unavailable.");
    } finally {
      setPreparing(false);
    }
  }, []);

  const handleGoogleCredential = useCallback(async (response: GoogleCredentialResponse, config: GoogleSignInConfig) => {
    if (signInBusyRef.current) return;
    signInBusyRef.current = true;
    restoreSessionRef.current = false;
    prepareWorkspace();
    setSubmitting(true);
    setError("");
    try {
      if (!response.credential || response.state !== config.state) throw new Error("Your sign-in request has expired. Please try again.");
      const result = await fetch("/api/auth/google", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: response.credential, state: response.state }), signal: AbortSignal.timeout(20000) });
      const body = await result.json() as { snapshot?: PortalSnapshot; error?: string };
      if (!result.ok || !body.snapshot) throw new Error(body.error || "Google sign-in was not accepted.");
      setSnapshot(body.snapshot);
    } catch (reason) {
      setError(signInFailureMessage(reason, "Google sign-in was not accepted."));
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
    if (new URLSearchParams(window.location.search).get("signin") === "azure_failed") {
      window.queueMicrotask(() => {
        if (active) setError("Azure sign-in was cancelled or this account is not approved. Please try again or ask your administrator.");
      });
      window.history.replaceState(null, "", "/login");
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
    // A slow or expired session must never hold up available sign-in methods.
    void fetch("/api/portal", { cache: "no-store", signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { snapshot?: PortalSnapshot; code?: string } | null;
        if (response.status === 403 && body?.code === "settlement_site") {
          window.location.assign("/settlement");
          return null;
        }
        return response.ok ? body : null;
      })
      .then((portal) => {
        if (active && restoreSessionRef.current && portal?.snapshot) setSnapshot(portal.snapshot);
      }).catch(() => { /* Sign-in remains available when session restoration fails. */ });

    async function loadProviders() {
      try {
        const response = await fetch("/api/auth/providers", { cache: "no-store", signal });
        if (!response.ok) throw new Error("Provider request failed.");
        const options = await response.json() as Providers;
        if (!active) return;
        setProviders(options);
        if (!options.google) return;
        if (window.location.origin !== GOOGLE_SIGN_IN_ORIGIN) {
          setGooglePortalLink(true);
          return;
        }
        setPreparing(true);
        try { const config = await prepareGoogleSignIn(); if (active) setGoogleConfig(config); }
        catch { if (active) setGoogleError("Google could not be loaded. Please try again."); }
        finally { if (active) setPreparing(false); }
      } catch { if (active) setError("Sign-in options could not be loaded. Please refresh the page."); }
    }
    void loadProviders();
    // Download the dashboard code while the operator is typing, so it is ready
    // the moment sign-in succeeds (sign-in speed, 28 Sep 2026).
    const preload = window.setTimeout(prepareWorkspace, 800);
    return () => { active = false; controller.abort(); window.clearTimeout(preload); };
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
      window.google.accounts.id.renderButton(googleButtonRef.current, { state: googleConfig.state, type: "standard", theme: "filled_black", size: "large", text: "signin_with", shape: "rectangular", logo_alignment: "left", width });
    };
    const observer = new ResizeObserver(() => {
      const width = Math.min(400, Math.floor(googleButtonRef.current?.clientWidth ?? 0));
      if (width !== lastWidth) renderGoogleButton();
    });
    if (googleButtonRef.current) observer.observe(googleButtonRef.current);
    renderGoogleButton();
    return () => { cancelled = true; observer.disconnect(); };
  }, [googleConfig, snapshot, authenticator, handleGoogleCredential]);

  async function handleEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signInBusyRef.current || (!authenticator && !emailAvailable)) return;
    signInBusyRef.current = true;
    restoreSessionRef.current = false;
    prepareWorkspace();
    setSubmitting(true);
    setError("");
    try {
      const result = await fetch(authenticator ? "/api/auth/email/verify" : "/api/auth/email", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authenticator ? { code } : { email, password }), signal: AbortSignal.timeout(20000),
      });
      const body = await result.json() as { snapshot?: PortalSnapshot; settlementSite?: boolean; requiresAuthenticator?: boolean; enrollment?: Enrollment | null; error?: string; restart?: boolean };
      if (body.restart) { setAuthenticator(false); setEnrollment(null); setCode(""); }
      if (!result.ok) throw new Error(body.error || "Sign-in could not be completed.");
      if (body.settlementSite) { window.location.assign("/settlement"); return; }
      if (body.snapshot) { setSnapshot(body.snapshot); setEnrollment(null); setCode(""); }
      else if (body.requiresAuthenticator) { setAuthenticator(true); setEnrollment(body.enrollment ?? null); setPassword(""); }
      else throw new Error("Sign-in could not be completed. Please try again.");
    } catch (reason) { setError(signInFailureMessage(reason, "Sign-in could not be completed.")); }
    finally { signInBusyRef.current = false; setSubmitting(false); }
  }

  async function handleMicrosoftSignIn() {
    if (signInBusyRef.current || !providers?.microsoft) return;
    signInBusyRef.current = true;
    restoreSessionRef.current = false;
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
    restoreSessionRef.current = false;
    setError(""); setPassword(""); setCode(""); setAuthenticator(false); setEnrollment(null); setSnapshot(null);
    if (providers?.google) await refreshGoogleSignIn();
  }

  if (snapshot) return (
    <>
      <SessionExitGuard />
      <PresenceTracker />
      <OperatorHelpDock />
      <DashboardClient initialData={snapshot} user={snapshot.user} onSignOut={handleSignOut} />
    </>
  );

  return (
    <main className="access-login access-login-split access-login-school-blue min-h-svh antialiased">
      <div className="access-login-shell">
        <header className="access-login-header flex items-center justify-between gap-6">
          <Link href="/" className="access-login-brand" aria-label="Magic Keys home"><BrandLogo /></Link>
          {generalClient ? <div className="access-login-school"><span><small>SECURE CLIENT ACCESS</small><strong>MagicKeys</strong></span></div> : <div className="access-login-school"><span><small>SECURE ACCESS</small><strong>Magic Keys</strong></span></div>}
        </header>

        <div className="access-login-layout grid items-center">
          <section className="access-login-brand-stage" aria-label={generalClient ? "MagicKeys — secure client access" : "Magic Keys — secure access"}><BrandArtwork fillHeight /></section>

          <section className="access-login-panel" aria-labelledby="magic-login-title">
            <div className="login-school-badge">
              <BrandLogo tone="dark" />
              {generalClient ? <span>SECURE CLIENT ACCESS</span> : null}
            </div>
            <div className="access-login-card has-form">
              <div className="access-login-lock flex items-center justify-center" aria-hidden="true"><LockKeyhole /></div>
              <p className="access-login-kicker">{generalClient ? "MAGICKEYS CLIENT LOGIN" : "SECURE ACCESS"}</p>
              <div className="access-login-heading">
                <h1 id="magic-login-title">{authenticator ? "Verify your sign-in" : googleOnly ? "Continue with Google" : "Welcome back."}</h1>
                <p>{authenticator ? "Enter the six-digit code from your authenticator app." : generalClient ? "Sign in to your secure MagicKeys workspace." : "Sign in to your Magic Keys workspace."}</p>
              </div>

              {(!googleOnly || authenticator) && <form className="access-login-form" onSubmit={handleEmailSignIn} aria-busy={submitting}>
                {authenticator ? <>
                  {enrollment && <div className="access-login-enrollment"><strong>Set up your authenticator</strong><p>Add a new account in your authenticator app. Choose a time-based key and enter:</p><code>{enrollment.secret}</code><span>Account: {enrollment.account}</span></div>}
                  <label htmlFor="login-code">Authenticator code</label>
                  <div className="access-login-input"><ShieldCheck aria-hidden="true" /><input id="login-code" name="code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus placeholder="000000" /></div>
                  <button className="access-login-submit" type="submit" disabled={submitting || code.length !== 6}>{submitting ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Verifying…</> : <>Verify and sign in<ArrowRight aria-hidden="true" /></>}</button>
                  <button className="access-login-text-button" type="button" disabled={submitting} onClick={() => { setAuthenticator(false); setEnrollment(null); setCode(""); setError(""); }}>Back to sign in</button>
                </> : <>
                  <label htmlFor="login-email">Email or username</label>
                  <div className="access-login-input"><Mail aria-hidden="true" /><input id="login-email" name="username" type="text" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your approved email or username" maxLength={254} required /></div>
                  <div className="access-login-label-row flex items-center justify-between gap-3"><label htmlFor="login-password">Password</label><button className="access-login-text-button" type="button" aria-expanded={help} aria-controls={help ? "login-help" : undefined} onClick={() => setHelp(!help)}>Forgot password?</button></div>
                  <div className="access-login-input"><LockKeyhole aria-hidden="true" /><input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={1024} required placeholder="Enter your password" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button></div>
                  <button className="access-login-submit" type="submit" disabled={submitting || !emailAvailable} aria-describedby={providers && !emailAvailable ? "login-email-availability" : undefined}>{submitting ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Signing in…</> : <>Sign in<ArrowRight aria-hidden="true" /></>}</button>
                  {providers && !emailAvailable && <p id="login-email-availability" className="access-login-provider-note">Email sign-in opens once your administrator has created your account and you have set your password from the setup link.</p>}
                </>}
              </form>}

              {help && <div id="login-help" className="access-login-help" role="region" aria-label="Sign-in help" tabIndex={-1} ref={helpRef}><strong>Forgotten your password?</strong><p>Ask your portal administrator for a new setup link. It lets you choose a new password and stops the old one working. Google and Microsoft passwords are managed by those providers.</p></div>}
              {error && <p className="access-login-error" role="alert">{error}</p>}
              {!authenticator && <>
                {!providers && !error && <p className="access-login-loading flex items-center justify-center gap-3" role="status"><LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading sign-in options…</p>}
                {!providers && error && <button type="button" className="access-login-provider" onClick={() => window.location.reload()}>Reload sign-in options<ArrowRight aria-hidden="true" /></button>}
                {!googleOnly && (providers?.google || providers?.microsoft) && <div className="access-login-divider"><span>{providers?.google && providers?.microsoft ? "or use an approved Google or Microsoft account" : providers?.google ? "or use an approved Google account" : "or use an approved Microsoft account"}</span></div>}
                <div className="access-login-providers" aria-busy={preparing || submitting}>
                  {providers?.google && (googlePortalLink ? <a className="access-login-provider access-login-google-link" href={generalClient ? `${GOOGLE_SIGN_IN_ORIGIN}/client-login?method=google` : GOOGLE_SIGN_IN_URL} target="_top"><GoogleMark />Continue with Google<ArrowRight aria-hidden="true" /></a> : googleConfig ? <div ref={googleButtonRef} className="access-login-google" aria-label="Sign in with Google" /> : <button className="access-login-provider" type="button" disabled={preparing || submitting} onClick={() => void refreshGoogleSignIn()}><GoogleMark />{preparing ? "Loading Google…" : "Sign in with Google"}{preparing ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</button>)}
                  {googlePortalLink && <p className="access-login-provider-note">{generalClient ? "You’ll continue on the secure MagicKeys portal." : "You’ll continue on the Magic Keys portal."}</p>}
                  {googleError && <p className="access-login-error" role="alert">{googleError}</p>}
                  {!googleOnly && providers?.microsoft && <button className="access-login-provider access-login-microsoft" type="button" onClick={() => void handleMicrosoftSignIn()} disabled={submitting}><span className="access-login-microsoft-icon" aria-hidden="true"><i /><i /><i /><i /></span>Sign in with Microsoft<ArrowRight aria-hidden="true" /></button>}
                  {!googleOnly && providers?.azure && <a className="access-login-provider" href={`/.auth/login/google?post_login_redirect_uri=${AZURE_RETURN}`}><GoogleMark />Sign in with Google (Azure)<ArrowRight aria-hidden="true" /></a>}
                  {!googleOnly && providers?.azure && providers.azureStaff && <a className="access-login-provider" href={`/.auth/login/${encodeURIComponent(providers.azureStaff)}?post_login_redirect_uri=${AZURE_RETURN}`}>Staff sign-in with email and password (Azure)<ArrowRight aria-hidden="true" /></a>}
                  {submitting && <p className="access-login-loading flex items-center justify-center gap-3" role="status"><LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Completing sign-in…</p>}
                </div>
              </>}

              {googleOnly && <Link className="access-login-text-button" href="/client-login">Use email or username instead</Link>}
              <div className="access-login-assurance"><ShieldCheck aria-hidden="true" /><span>Access for approved accounts only.<small>Your workspace. Protected.</small></span><Check aria-hidden="true" /></div>
              <button className="access-login-help-toggle flex items-center justify-center gap-2" type="button" aria-expanded={help} aria-controls={help ? "login-help" : undefined} onClick={() => setHelp(!help)}><HelpCircle aria-hidden="true" />Need help signing in?</button>
              
            </div>
            <div className="login-panel-footer">
              <nav className="access-login-legal flex items-center justify-center gap-5" aria-label="Legal information"><Link href="/privacy">Privacy policy</Link><span aria-hidden="true">·</span><Link href="/terms">Terms of use</Link></nav>
              <a className="access-login-partner" href="https://rjlcommercialgroup.com" target="_blank" rel="noopener noreferrer" aria-label="RJL Commercial — installer and support">
                {/* eslint-disable-next-line @next/next/no-img-element -- existing transparent installer logo */}
                <img src="/rjl-commercial-logo-2026.png" alt="RJL Commercial" width={1200} height={280} />
              </a>
            </div>
          </section>
        </div>

        <footer className="access-login-footer flex items-center justify-between gap-6">
          <p>Magic Keys<span aria-hidden="true"> / </span><span>Protecting futures.</span></p>
          <a className="access-login-partner flex items-center gap-3" href="https://rjlcommercialgroup.com" target="_blank" rel="noopener noreferrer" aria-label="RJL Commercial Fencing and Gates — installer and support">
            {/* eslint-disable-next-line @next/next/no-img-element -- local transparent installer logo */}
            <img src="/rjl-commercial-logo-2026.png" alt="RJL Commercial" width={1200} height={280} />
          </a>
        </footer>
      </div>
    </main>
  );
}

function GoogleMark() {
  return <svg className="access-login-google-mark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.61 20.46H42V20H24v8h11.3A12 12 0 1 1 32.9 14.9l5.66-5.66A19.97 19.97 0 0 0 24 4C12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20c0-1.34-.14-2.65-.39-3.54Z"/><path fill="#34A853" d="m6.31 33.24 6.57-5.06A12 12 0 0 0 35.3 28H24v-8h18v.46h1.61C45.6 31.6 37.23 44 24 44a19.97 19.97 0 0 1-17.69-10.76Z"/><path fill="#FBBC05" d="m6.31 14.76 6.57 5.06a12 12 0 0 0 0 8.36l-6.57 5.06a20 20 0 0 1 0-18.48Z"/><path fill="#EA4335" d="M24 4a19.97 19.97 0 0 1 14.56 5.24l-5.66 5.66a12 12 0 0 0-20.02 4.92l-6.57-5.06A19.97 19.97 0 0 1 24 4Z"/><path fill="#4285F4" d="M43.61 20.46H42V20H24v8h11.3a11.99 11.99 0 0 1-4.12 5.73l6.18 4.79A19.93 19.93 0 0 0 44 24c0-1.34-.14-2.65-.39-3.54Z"/></svg>;
}

