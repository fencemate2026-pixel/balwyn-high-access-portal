"use client";

/**
 * AiFaceFx — animated light over the AI face on the sign-in brand panel.
 *
 * The first version (soft glow, faint drifting digits) was too subtle to notice,
 * so the face now visibly "thinks":
 *   1. a bright scanning line sweeps down the face every few seconds,
 *   2. a network of glowing nodes drifts inside the head, linked by lines,
 *      with signals running along the links,
 *   3. the eye pulses and sends out a ring now and then,
 *   4. blue 0s and 1s rise through the face,
 *   5. a soft "breathing" glow (CSS, see login-ai-face.css).
 * Everything sits exactly over the face artwork and uses screen blending, so it
 * only shows over the dark face and disappears over white: it cannot tint the
 * Magic Keys logo or the crest.
 *
 * Safety and performance:
 *   - Nothing animates for visitors whose device asks for reduced motion.
 *   - Capped at about 30 frames per second, sized to the face, and the browser
 *     pauses it automatically while the tab is hidden.
 *   - Purely decorative: aria-hidden, no focus, no pointer events.
 */

import { useEffect, useRef } from "react";

const FRAME_MS = 33;           // ~30 fps
const NODE_COUNT = 26;         // network nodes inside the head
const DIGIT_COUNT = 34;        // rising 0s and 1s
const SCAN_PERIOD_MS = 4200;   // one sweep of the scanning line
const EYE = { x: 0.175, y: 0.435 }; // eye position as a share of the face box (measured from the artwork)
const CYAN = "120, 214, 255";

type Node = { x: number; y: number; vx: number; vy: number; r: number };
type Digit = { x: number; y: number; speed: number; size: number; alpha: number; char: string; phase: number };
type Signal = { from: number; to: number; t: number; speed: number };

export default function AiFaceFx() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let width = 0;
    let height = 0;
    let scale = 1; // 1 = face drawn 472 px wide
    let nodes: Node[] = [];
    let digits: Digit[] = [];
    let signals: Signal[] = [];
    let frame = 0;
    let last = 0;
    let nextSignal = 0;
    let nextRing = 0;
    let ringStart = -1;

    // Nodes stay inside the head (right of the face profile, above the neck).
    const nodeBounds = () => ({ x0: width * 0.24, x1: width * 0.97, y0: height * 0.06, y1: height * 0.82 });
    const spawnNode = (): Node => {
      const b = nodeBounds();
      return {
        x: b.x0 + Math.random() * (b.x1 - b.x0),
        y: b.y0 + Math.random() * (b.y1 - b.y0),
        vx: (Math.random() - 0.5) * 16 * scale,
        vy: (Math.random() - 0.5) * 16 * scale,
        r: (1.6 + Math.random() * 1.8) * scale,
      };
    };
    const spawnDigit = (anywhere: boolean): Digit => ({
      x: width * (0.2 + Math.random() * 0.78),
      y: anywhere ? Math.random() * height : height + 24 * scale,
      speed: (18 + Math.random() * 34) * scale,
      size: (11 + Math.random() * 13) * scale,
      alpha: 0.45 + Math.random() * 0.45,
      char: Math.random() < 0.5 ? "0" : "1",
      phase: Math.random() * Math.PI * 2,
    });

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      scale = Math.max(0.35, width / 472);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      nodes = Array.from({ length: NODE_COUNT }, spawnNode);
      digits = Array.from({ length: DIGIT_COUNT }, () => spawnDigit(true));
      signals = [];
    };

    const linkDistance = () => width * 0.26;

    const drawNetwork = (time: number, dt: number) => {
      const b = nodeBounds();
      for (const n of nodes) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.x < b.x0 || n.x > b.x1) n.vx *= -1;
        if (n.y < b.y0 || n.y > b.y1) n.vy *= -1;
      }
      const max = linkDistance();
      ctx.lineWidth = Math.max(0.6, 0.9 * scale);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.hypot(dx, dy);
          if (d > max) continue;
          ctx.strokeStyle = `rgba(${CYAN}, ${0.5 * (1 - d / max)})`;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
      for (const n of nodes) {
        const glow = 0.65 + 0.35 * Math.sin(time / 600 + n.x);
        ctx.fillStyle = `rgba(190, 240, 255, ${glow})`;
        ctx.shadowColor = `rgba(${CYAN}, 0.9)`;
        ctx.shadowBlur = 8 * scale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Signals: bright dots running along a link between two nearby nodes.
      if (time > nextSignal) {
        const from = Math.floor(Math.random() * nodes.length);
        let best = -1;
        let bestD = Infinity;
        nodes.forEach((n, k) => {
          if (k === from) return;
          const d = Math.hypot(n.x - nodes[from].x, n.y - nodes[from].y);
          if (d < bestD && d < max) { bestD = d; best = k; }
        });
        if (best >= 0) signals.push({ from, to: best, t: 0, speed: 0.9 + Math.random() * 0.8 });
        nextSignal = time + 220 + Math.random() * 380;
      }
      signals = signals.filter((s) => s.t <= 1);
      for (const s of signals) {
        s.t += s.speed * dt;
        const a = nodes[s.from];
        const z = nodes[s.to];
        const x = a.x + (z.x - a.x) * s.t;
        const y = a.y + (z.y - a.y) * s.t;
        ctx.fillStyle = "rgba(235, 252, 255, 0.95)";
        ctx.shadowColor = `rgba(${CYAN}, 1)`;
        ctx.shadowBlur = 12 * scale;
        ctx.beginPath();
        ctx.arc(x, y, 2.2 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    const drawDigits = (time: number, dt: number) => {
      for (const d of digits) {
        d.y -= d.speed * dt;
        if (d.y < -30 * scale) Object.assign(d, spawnDigit(false));
        ctx.globalAlpha = d.alpha * (0.55 + 0.45 * Math.sin(time / 420 + d.phase));
        ctx.fillStyle = `rgb(${CYAN})`;
        ctx.font = `700 ${Math.round(d.size)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.fillText(d.char, d.x, d.y);
      }
      ctx.globalAlpha = 1;
    };

    const drawScan = (time: number) => {
      const p = (time % SCAN_PERIOD_MS) / SCAN_PERIOD_MS;
      const y = -height * 0.1 + p * height * 1.2;
      const band = height * 0.14;
      const trail = ctx.createLinearGradient(0, y - band, 0, y);
      trail.addColorStop(0, `rgba(${CYAN}, 0)`);
      trail.addColorStop(1, `rgba(${CYAN}, 0.32)`);
      ctx.fillStyle = trail;
      ctx.fillRect(0, y - band, width, band);
      ctx.fillStyle = "rgba(225, 248, 255, 0.95)";
      ctx.shadowColor = `rgba(${CYAN}, 1)`;
      ctx.shadowBlur = 16 * scale;
      ctx.fillRect(0, y - 1.5 * scale, width, 3 * scale);
      ctx.shadowBlur = 0;
    };

    const drawEye = (time: number) => {
      const x = width * EYE.x;
      const y = height * EYE.y;
      const pulse = 0.55 + 0.45 * Math.sin(time / 380);
      const r = width * 0.06;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, `rgba(235, 252, 255, ${0.95 * pulse})`);
      glow.addColorStop(0.35, `rgba(${CYAN}, ${0.6 * pulse})`);
      glow.addColorStop(1, `rgba(${CYAN}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // An expanding ring every few seconds.
      if (time > nextRing) { ringStart = time; nextRing = time + 2600; }
      const age = (time - ringStart) / 1300;
      if (ringStart >= 0 && age <= 1) {
        ctx.strokeStyle = `rgba(${CYAN}, ${0.9 * (1 - age)})`;
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.arc(x, y, r * (0.4 + age * 2.6), 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - last < FRAME_MS) return;
      const dt = Math.min((time - last) / 1000, 0.1);
      last = time;
      ctx.clearRect(0, 0, width, height);
      drawDigits(time, dt);
      drawNetwork(time, dt);
      drawEye(time);
      drawScan(time);
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
      <canvas ref={canvasRef} className="magic-ai-fx-particles" />
    </div>
  );
}
