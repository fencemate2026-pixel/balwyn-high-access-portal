"use client";

/**
 * AiFaceFx — animated light over the AI face on the sign-in brand panel.
 *
 * Three layers sit exactly over the face artwork (see login-ai-face.css):
 *   1. a soft "breathing" glow,
 *   2. a light beam sweeping slowly down the face,
 *   3. a canvas of blue 0s, 1s and sparks drifting upwards.
 * Every layer uses screen blending, so it only shows over the dark face and
 * disappears over white — it cannot tint the Magic Keys logo or the crest.
 *
 * Safety and performance:
 *   - Nothing animates for visitors whose device asks for reduced motion.
 *   - The canvas is capped at about 30 frames per second, sized to the panel,
 *     and stops while the tab is hidden (requestAnimationFrame pauses).
 *   - Purely decorative: aria-hidden, no focus, no pointer events.
 */

import { useEffect, useRef } from "react";

type Particle = { x: number; y: number; speed: number; size: number; alpha: number; digit: boolean; char: string; phase: number };

const FRAME_MS = 33; // ~30 fps is plenty for slow drifting particles
const MAX_PARTICLES = 70;

export default function AiFaceFx() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let frame = 0;
    let last = 0;

    const spawn = (anywhere: boolean): Particle => {
      const digit = Math.random() < 0.55;
      return {
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : height + 20,
        speed: 12 + Math.random() * 26,
        size: digit ? 9 + Math.random() * 11 : 1 + Math.random() * 2,
        alpha: 0.25 + Math.random() * 0.5,
        digit,
        char: Math.random() < 0.5 ? "0" : "1",
        phase: Math.random() * Math.PI * 2,
      };
    };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.min(MAX_PARTICLES, Math.round((width * height) / 7000));
      particles = Array.from({ length: count }, () => spawn(true));
    };

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - last < FRAME_MS) return;
      const seconds = Math.min((time - last) / 1000, 0.1);
      last = time;
      ctx.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.y -= particle.speed * seconds;
        if (particle.y < -30) Object.assign(particle, spawn(false));
        ctx.globalAlpha = particle.alpha * (0.6 + 0.4 * Math.sin(time / 500 + particle.phase));
        if (particle.digit) {
          ctx.fillStyle = "rgb(120, 210, 255)";
          ctx.font = `600 ${particle.size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.fillText(particle.char, particle.x, particle.y);
        } else {
          ctx.fillStyle = "rgb(190, 235, 255)";
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const start = () => {
      if (frame || reduceMotion.matches) return;
      last = performance.now();
      frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      ctx.clearRect(0, 0, width, height);
    };
    const onMotionPreference = () => (reduceMotion.matches ? stop() : start());

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    start();
    reduceMotion.addEventListener("change", onMotionPreference);

    return () => {
      stop();
      observer.disconnect();
      reduceMotion.removeEventListener("change", onMotionPreference);
    };
  }, []);

  return (
    <div className="magic-ai-fx" aria-hidden="true">
      <div className="magic-ai-fx-glow" />
      <div className="magic-ai-fx-scan" />
      <canvas ref={canvasRef} className="magic-ai-fx-particles" />
    </div>
  );
}
