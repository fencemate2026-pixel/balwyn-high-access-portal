"use client";

import { useEffect } from "react";

// Reports time on the portal and which buttons were pressed (15 Oct 2026).
//
// - A beat is sent every 30 s, but only while the tab is visible AND the person
//   has touched the page in the last 2 minutes. The server measures the time;
//   this component only supplies "I am here" and the pressed-button labels.
// - Only the visible label of the pressed button, link or tab is sent. Typed
//   text, field values and passwords are never read. Elements marked
//   data-presence-ignore are skipped.
// - Every failure is swallowed: this must never get in the way of gate controls.
const BEAT_MS = 30_000;
const IDLE_AFTER_MS = 120_000;
const MAX_QUEUE = 100;
const CONTROLS = "button, a[href], [role='button'], [role='tab'], [role='menuitem'], summary";

/** Visible label of a pressed control: aria-label, else its own text. Never a field value. */
export function labelFor(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "";
  const control = target.closest(CONTROLS);
  if (!control || control.closest("[data-presence-ignore]")) return "";
  const raw = control.getAttribute("aria-label") || control.getAttribute("title") || control.textContent || "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 120);
}

export default function PresenceTracker() {
  useEffect(() => {
    let sessionId = "";
    try { sessionId = crypto.randomUUID(); } catch { return; }
    let lastInput = Date.now();
    let queue: { label: string }[] = [];
    const touch = () => { lastInput = Date.now(); };
    const onClick = (event: MouseEvent) => {
      touch();
      const label = labelFor(event.target);
      if (label && queue.length < MAX_QUEUE) queue.push({ label });
    };
    const send = (final: boolean) => {
      const events = queue; queue = [];
      const body = JSON.stringify({ sessionId, events });
      try {
        if (final && typeof navigator.sendBeacon === "function") {
          navigator.sendBeacon("/api/presence", new Blob([body], { type: "text/plain" }));
        } else {
          void fetch("/api/presence", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(15000) }).catch(() => undefined);
        }
      } catch { /* never disturb the page */ }
    };
    const beat = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastInput > IDLE_AFTER_MS) return;
      send(false);
    };
    const onHide = () => { if (queue.length || document.visibilityState === "visible") send(true); };
    const passive = { passive: true, capture: true } as const;
    document.addEventListener("click", onClick, true);
    for (const name of ["keydown", "pointerdown", "touchstart", "scroll"]) window.addEventListener(name, touch, passive);
    window.addEventListener("pagehide", onHide);
    const timer = window.setInterval(beat, BEAT_MS);
    beat();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("click", onClick, true);
      for (const name of ["keydown", "pointerdown", "touchstart", "scroll"]) window.removeEventListener(name, touch, passive);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);
  return null;
}
