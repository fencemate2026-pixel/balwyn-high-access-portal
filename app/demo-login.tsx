"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  RadioTower,
  ShieldCheck,
} from "lucide-react";

import DashboardClient from "./dashboard-client";

const DEMO_SESSION_KEY = "balwyn-magic-keys-demo-session";
const DEMO_USER = "paul sutton";
const DEMO_PASSWORD_SHA256 =
  "d108e21c1dcc6755b02c6604a27c17f6dddb0692019e05e065f50b4cb2a86dc7";

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export default function DemoLogin() {
  const [hydrated, setHydrated] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [operatorName, setOperatorName] = useState("Paul Sutton");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSignedIn(sessionStorage.getItem(DEMO_SESSION_KEY) === "paul-sutton");
    setHydrated(true);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const validName = operatorName.trim().toLowerCase() === DEMO_USER;
    const validPassword = (await sha256(password)) === DEMO_PASSWORD_SHA256;

    if (!validName || !validPassword) {
      setError("The operator name or password is incorrect.");
      setSubmitting(false);
      return;
    }

    sessionStorage.setItem(DEMO_SESSION_KEY, "paul-sutton");
    setPassword("");
    setSignedIn(true);
    setSubmitting(false);
  }

  function handleSignOut() {
    sessionStorage.removeItem(DEMO_SESSION_KEY);
    setPassword("");
    setError("");
    setSignedIn(false);
  }

  if (!hydrated) {
    return (
      <main className="demo-login-loading" aria-label="Loading secure access">
        <img src="/balwyn-watermark.png" alt="Balwyn High School" />
      </main>
    );
  }

  if (signedIn) {
    return (
      <DashboardClient
        user={{ displayName: "Paul Sutton", email: "Demonstration operator" }}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <main className="demo-login-shell">
      <section className="demo-login-brand" aria-labelledby="demo-login-brand-title">
        <div className="demo-brand-topline">
          <span className="demo-brand-crest">
            <img src="/balwyn-watermark.png" alt="Balwyn High School crest" />
          </span>
          <span>
            <strong>BALWYN HIGH SCHOOL</strong>
            <small>Authorised operations portal</small>
          </span>
        </div>

        <div className="demo-brand-message">
          <p>MAGIC KEYS</p>
          <h1 id="demo-login-brand-title">Gate operations, under control.</h1>
          <span>
            A secure demonstration of coordinated access, scheduling and emergency
            response across the Balwyn High School campus.
          </span>
        </div>

        <div className="demo-brand-status" aria-label="System overview">
          <span><CheckCircle2 /><span><strong>17 access points</strong><small>Single control view</small></span></span>
          <span><RadioTower /><span><strong>Campus-wide response</strong><small>Coordinated automation</small></span></span>
        </div>

        <div className="demo-brand-watermark" aria-hidden="true">
          <img src="/balwyn-watermark.png" alt="" />
        </div>
      </section>

      <section className="demo-login-access" aria-labelledby="demo-login-title">
        <div className="demo-login-panel">
          <div className="demo-access-mark"><KeyRound /></div>
          <p className="demo-access-overline">Magic Keys · Demonstration access</p>
          <h2 id="demo-login-title">Operator sign in</h2>
          <p className="demo-access-copy">
            Enter the authorised operator credentials to open the Balwyn High School
            gate operations dashboard.
          </p>

          <form className="demo-login-form" onSubmit={handleSubmit} noValidate>
            <label htmlFor="operator-name">Operator name</label>
            <div className="demo-input-wrap">
              <input
                id="operator-name"
                name="operator-name"
                type="text"
                value={operatorName}
                onChange={(event) => setOperatorName(event.target.value)}
                autoComplete="username"
                spellCheck="false"
                required
              />
            </div>

            <label htmlFor="operator-password">Password</label>
            <div className="demo-input-wrap has-action">
              <LockKeyhole aria-hidden="true" />
              <input
                id="operator-password"
                name="operator-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>

            <p className={`demo-login-error ${error ? "is-visible" : ""}`} role="alert" aria-live="polite">
              {error || "\u00a0"}
            </p>

            <button className="demo-login-submit" type="submit" disabled={submitting}>
              <span>{submitting ? "Verifying operator…" : "Enter operations dashboard"}</span>
              <ArrowRight />
            </button>
          </form>

          <div className="demo-access-trust">
            <ShieldCheck />
            <span><strong>Secure demonstration environment</strong><small>All controls operate in simulation mode</small></span>
          </div>

          <footer className="demo-access-footer">
            <span>Managed by</span>
            <img src="/rjl-commercial-logo.jpg" alt="RJL Commercial" />
          </footer>
        </div>
      </section>
    </main>
  );
}
