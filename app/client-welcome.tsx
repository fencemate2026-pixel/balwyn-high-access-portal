"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import "./client-welcome.css";

const LEAVE_MS = 420;

export default function ClientWelcome({ siteName, children }: { siteName: string; children: ReactNode }) {
  const [phase, setPhase] = useState<"in" | "out" | "done">("in");
  const appRef = useRef<HTMLDivElement>(null);
  const goRef = useRef<HTMLButtonElement>(null);
  const closed = useRef(false);
  const dismissRef = useRef<() => void>(() => {});

  function finish() {
    setPhase("done");
  }

  function dismiss() {
    if (closed.current) return;
    closed.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      finish();
      return;
    }
    setPhase("out");
    window.setTimeout(finish, LEAVE_MS);
  }

  useEffect(() => {
    if (phase === "done") appRef.current?.focus();
  }, [phase]);

  dismissRef.current = dismiss;

  useEffect(() => {
    goRef.current?.focus();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const timer = window.setTimeout(() => dismissRef.current(), 3200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      {phase !== "done" && (
        <div className={`mk-welcome${phase === "out" ? " is-leaving" : ""}`} role="dialog" aria-modal="true" aria-labelledby="mk-welcome-title">
          <div className="mk-welcome-stage">
            <div className="mk-welcome-glow" aria-hidden="true" />
            <div className="mk-welcome-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="magic-brand-logo"
                src="/magic-keys-welcome-logo.png"
                width={1592}
                height={633}
                alt="Magic Keys — Secure access. Safer environments. Protecting futures."
                decoding="sync"
                loading="eager"
              />
              <span className="mk-welcome-beam" aria-hidden="true" />
            </div>
            <div className="mk-welcome-rail" aria-hidden="true" />
            <p id="mk-welcome-title" className="mk-welcome-kicker">Magic Keys</p>
            <p className="mk-welcome-site">{siteName}</p>
            <button ref={goRef} type="button" className="mk-welcome-go" onClick={dismiss}>Continue</button>
          </div>
        </div>
      )}
      <div id="client-app" ref={appRef} className="mk-welcome-app" tabIndex={-1} inert={phase !== "done" ? true : undefined}>
        {children}
      </div>
    </>
  );
}
