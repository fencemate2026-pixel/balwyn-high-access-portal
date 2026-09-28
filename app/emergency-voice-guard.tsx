"use client";

import { useEffect } from "react";

/**
 * Loads the browser's voice list as early as possible, so the first
 * fire / evacuation warning can use an Australian English voice.
 *
 * 28 Sep 2026: this component no longer rewrites or re-speaks warnings. It used
 * to replace the dashboard's warning with its own script and cancel/restart
 * speech, which, together with the dashboard's 6.5 s repeat, cut the warning
 * off mid-sentence. The dashboard now owns the warning loop: it speaks the
 * whole sentence, waits for it to finish, pauses, then repeats.
 */
export default function EmergencyVoiceGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
  }, []);
  return null;
}
