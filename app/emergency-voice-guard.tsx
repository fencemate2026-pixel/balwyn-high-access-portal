"use client";

import { useEffect } from "react";
import { emergencyVoiceScript } from "@/lib/emergency-voice";

function isEmergencyWarning(text: string) {
  return /warning\.|fire evacuation/i.test(text);
}

function isAllClear(text: string) {
  return /emergency priority cleared|returning to normal operation/i.test(text);
}

function findAustralianVoice(voices: SpeechSynthesisVoice[]) {
  const australian = voices.filter((voice) => /^en[-_]AU(?:[-_]|$)/i.test(voice.lang));
  return australian.find((voice) => voice.default) ?? australian[0] ?? voices.find((voice) => /^en/i.test(voice.lang));
}

export default function EmergencyVoiceGuard() {
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const synth = window.speechSynthesis;
    const originalSpeak = synth.speak.bind(synth);
    const originalCancel = synth.cancel.bind(synth);
    let protect = false;

    function speakNow() {
      const utterance = new SpeechSynthesisUtterance(emergencyVoiceScript("fire"));
      utterance.lang = "en-AU";
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.volume = 1;
      const voice = findAustralianVoice(synth.getVoices());
      if (voice) utterance.voice = voice;
      protect = true;
      utterance.addEventListener("end", () => { protect = false; });
      utterance.addEventListener("error", () => { protect = false; });
      originalCancel();
      originalSpeak(utterance);
    }

    synth.speak = ((utterance: SpeechSynthesisUtterance) => {
      const incoming = utterance.text || "";
      if (isAllClear(incoming)) {
        protect = false;
        originalCancel();
        originalSpeak(utterance);
        return;
      }
      if (isEmergencyWarning(incoming)) {
        if (protect && (synth.speaking || synth.pending)) return;
        speakNow();
        return;
      }
      originalSpeak(utterance);
    }) as typeof synth.speak;

    synth.cancel = (() => {
      if (protect && (synth.speaking || synth.pending)) return;
      originalCancel();
    }) as typeof synth.cancel;

    function onClick(event: Event) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const fire = target.closest(".confirm-fire");
      if (fire) speakNow();
    }

    document.addEventListener("click", onClick, true);
    synth.getVoices();

    return () => {
      document.removeEventListener("click", onClick, true);
      synth.speak = originalSpeak;
      synth.cancel = originalCancel;
    };
  }, []);

  return null;
}
