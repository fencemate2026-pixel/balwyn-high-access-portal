"use client";

import { useEffect, useState } from "react";
import GuidanceProjection, { type GuidanceRoute } from "../guidance-projection";
import { emergencyVoiceScript } from "@/lib/emergency-voice";

type LivePayload = { showing: true; route: GuidanceRoute; updatedAt: string | null };
type Payload = LivePayload | { showing: false };

function australianVoice(voices: SpeechSynthesisVoice[]) {
  return voices.find((voice) => /^en[-_]AU(?:[-_]|$)/i.test(voice.lang));
}

export default function ClassroomScreen() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let stopped = false;
    const pull = async () => {
      try {
        const response = await fetch("/api/classroom", { cache: "no-store" });
        if (!response.ok) throw new Error("unavailable");
        const body = await response.json() as Payload;
        if (stopped) return;
        if (body?.showing === true && !body.route) throw new Error("incomplete");
        setPayload(body.showing ? body : { showing: false });
        setUnreachable(false);
      } catch {
        // Keep the last live route. A failed poll must not flash all-clear.
        if (!stopped) setUnreachable(true);
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  const showing = payload?.showing === true;

  useEffect(() => {
    if (!showing || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    let stopped = false;
    let timer: number | undefined;
    const say = () => {
      if (stopped) return;
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(emergencyVoiceScript("fire"));
      utterance.lang = "en-AU";
      utterance.rate = 0.92;
      const voice = australianVoice(synth.getVoices());
      if (voice) utterance.voice = voice;
      const again = (pauseMs: number) => {
        if (!stopped) timer = window.setTimeout(say, pauseMs);
      };
      utterance.addEventListener("end", () => again(2000));
      utterance.addEventListener("error", () => again(4000));
      synth.speak(utterance);
    };
    window.speechSynthesis.cancel();
    say();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.speechSynthesis.cancel();
    };
  }, [showing]);

  if (showing && payload.route) {
    return (
      <main style={{ height: "100dvh", overflow: "hidden", background: "#0b131e" }}>
        <GuidanceProjection route={payload.route} live />
      </main>
    );
  }

  return (
    <main style={{
      minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0b131e", color: "#f4f8fc",
      fontFamily: '"Zing Sans Rust", "Zing Sans Rust Base", system-ui, sans-serif', textAlign: "center", padding: 48,
    }}>
      <div>
        <p style={{ letterSpacing: "0.22em", fontSize: 28, color: "#9cb4cd" }}>CLASSROOM SCREEN</p>
        <h1 style={{ fontSize: "clamp(40px, 6vw, 72px)", lineHeight: 1, margin: "18px 0" }}>No fire evacuation is active.</h1>
        <p style={{ fontSize: "clamp(22px, 3vw, 32px)", color: "#9cb4cd" }}>
          {unreachable && !payload ? "Waiting for the school portal." : "This screen shows the route when an administrator starts the fire evacuation."}
        </p>
      </div>
    </main>
  );
}
