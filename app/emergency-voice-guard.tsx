"use client";

import { useEffect } from "react";
import { emergencyVoiceScript } from "@/lib/emergency-voice";

function isEmergencyWarning(text: string) {
  return /warning\.|fire evacuation|lockdown gate commands|evacuate by the nearest safe exit/i.test(text);
}

function isAllClear(text: string) {
  return /emergency priority cleared|returning to normal operation/i.test(text);
}

export default function EmergencyVoiceGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const synth = window.speechSynthesis;
    const originalSpeak = synth.speak.bind(synth);
    const originalCancel = synth.cancel.bind(synth);
    let protect = false;

    synth.speak = ((utterance: SpeechSynthesisUtterance) => {
      const incoming = utterance.text || "";
      if (isAllClear(incoming)) {
        protect = false;
        originalCancel();
        originalSpeak(utterance);
        return;
      }
      if (isEmergencyWarning(incoming)) {
        const mode = /lockdown/i.test(incoming) ? "lockdown" : "fire";
        utterance.text = emergencyVoiceScript(mode);
        utterance.rate = Math.min(utterance.rate || 0.88, 0.88);
        if (protect && (synth.speaking || synth.pending)) return;
        protect = true;
        utterance.addEventListener("end", () => {
          protect = false;
        });
        utterance.addEventListener("error", () => {
          protect = false;
        });
      }
      originalSpeak(utterance);
    }) as typeof synth.speak;

    synth.cancel = (() => {
      if (protect && (synth.speaking || synth.pending)) return;
      originalCancel();
    }) as typeof synth.cancel;

    return () => {
      synth.speak = originalSpeak;
      synth.cancel = originalCancel;
    };
  }, []);

  return null;
}
