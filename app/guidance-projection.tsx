"use client";

/**
 * The projected classroom screen.
 *
 * Replaces the fixed "Follow your teacher" card with the route the wayfinding
 * engine actually computed. A teacher already knows to follow the evacuation
 * plan; what they do not know, at the moment the alarm goes, is which way is
 * still open today.
 *
 * WHY THE TYPE IS THIS BIG
 *
 * The overlay is drawn at 1440x900 and then perspective-mapped onto the
 * projector screen in the photograph, where it ends up a few hundred pixels
 * wide — which is also roughly how a real projector reads from the back row of
 * a classroom. So it is sized for one glance: a headline, three steps, and
 * where to assemble. Anything more does not survive the reduction.
 *
 * COLOUR CARRIES THE STATE
 *
 * Green, amber and red are the ISO 7010 safe / assisted / stop conventions, and
 * the same green as the running-man signs already in the corridors, so the
 * screen agrees with the building's signage rather than competing with it. The
 * rail across the top changes with the state, which is legible before any word
 * has been read.
 *
 * DATA
 *
 * `route` is the engine's output. Nothing here is written by hand, and the
 * three statuses are the three real answers: a way out, a refuge, or stay put.
 * The last one is the case a fixed card cannot express at all.
 */

import { ShieldCheck, TriangleAlert, Ban } from "lucide-react";
import BrandLogo from "./brand-logo";

export type GuidanceStatus = "ok" | "refuge" | "hold";

export type GuidanceRoute = {
  status: GuidanceStatus;
  /** Room or door the screen is installed in. */
  origin: string;
  headline: string;
  steps: { text: string; metres?: number }[];
  destinationLabel: string;
  destination: string;
  avoid?: string;
  totalMetres?: number;
};

const TONE: Record<GuidanceStatus, { rail: string; lift: string; label: string }> = {
  ok:     { rail: "#009639", lift: "#35cc72", label: "Safe route" },
  refuge: { rail: "#e8a317", lift: "#ffc44d", label: "Assisted evacuation" },
  hold:   { rail: "#d7263d", lift: "#ff5f73", label: "Do not leave the room" },
};

/**
 * The example shown in the concept photograph. These are Balwyn's own measured
 * figures from their marked diagram, not invented ones — the point of the
 * demonstration is that the number is real.
 */
export const EXAMPLE_ROUTE: GuidanceRoute = {
  status: "ok",
  origin: "Room G12",
  headline: "Go to the school oval",
  steps: [
    { text: "Leave by the north-west doors" },
    { text: "Follow the path past D block", metres: 60 },
    { text: "Continue to the oval", metres: 65 },
  ],
  destinationLabel: "Assemble at",
  destination: "School oval",
  avoid: "Do not use the central path",
  totalMetres: 125,
};

export default function GuidanceProjection({ route, live = false }: { route: GuidanceRoute; live?: boolean }) {
  const tone = TONE[route.status];
  const Icon = route.status === "ok" ? ShieldCheck : route.status === "refuge" ? TriangleAlert : Ban;

  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      background: "#0f2136", color: "#f4f8fc",
      borderTop: `14px solid ${tone.rail}`,
      fontFamily: '"Zing Sans Rust", "Zing Sans Rust Base", system-ui, sans-serif',
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 34px", background: "#0c1c2f", borderBottom: "1px solid #1c385a",
      }}>
        <BrandLogo />
        <span style={{ letterSpacing: "0.22em", fontSize: 26, color: "#9cb4cd" }}>
          {route.origin.toUpperCase()}
        </span>
        <span style={{ letterSpacing: "0.22em", fontSize: 26, color: "#9cb4cd" }}>
          EMERGENCY GUIDANCE
        </span>
      </div>

      <div style={{ flex: 1, padding: "30px 40px", display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, color: tone.lift }}>
          <Icon style={{ width: 34, height: 34 }} aria-hidden />
          <span style={{ letterSpacing: "0.24em", fontSize: 26, fontWeight: 600 }}>
            {tone.label.toUpperCase()}
          </span>
        </div>

        <strong style={{ fontSize: 96, lineHeight: 0.95, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {route.headline}
        </strong>

        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {route.steps.map((step, i) => (
            <li key={step.text} style={{
              display: "grid", gridTemplateColumns: "58px 1fr auto", alignItems: "center",
              gap: 18, padding: "14px 20px", background: "#0d1f34",
              borderLeft: `6px solid ${tone.rail}`,
            }}>
              <span style={{ fontSize: 44, fontWeight: 700, color: tone.lift, textAlign: "center" }}>
                {i + 1}
              </span>
              <span style={{ fontSize: 44, fontWeight: 600, lineHeight: 1.1 }}>{step.text}</span>
              <span style={{
                fontFamily: '"Zing Sans Rust", "Zing Sans Rust Base", system-ui, sans-serif', fontSize: 28, color: "#61809f",
                fontVariantNumeric: "tabular-nums",
              }}>
                {step.metres ? `${step.metres} m` : ""}
              </span>
            </li>
          ))}
        </ol>

        <div style={{ display: "flex", alignItems: "baseline", gap: 22, flexWrap: "wrap" }}>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 18, padding: "18px 26px",
            background: `${tone.rail}2e`, border: `2px solid ${tone.rail}`, flex: "1 1 auto",
          }}>
            <span style={{ letterSpacing: "0.2em", fontSize: 24, color: tone.lift }}>
              {route.destinationLabel.toUpperCase()}
            </span>
            <span style={{ fontSize: 56, fontWeight: 700, lineHeight: 1 }}>{route.destination}</span>
            {route.totalMetres ? (
              <span style={{
                marginLeft: "auto", fontFamily: '"Zing Sans Rust", "Zing Sans Rust Base", system-ui, sans-serif', fontSize: 30,
                color: "#9cb4cd", fontVariantNumeric: "tabular-nums",
              }}>
                {route.totalMetres} m
              </span>
            ) : null}
          </div>
        </div>

        {route.avoid ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, color: "#ff5f73" }}>
            <Ban style={{ width: 32, height: 32 }} aria-hidden />
            <span style={{ fontSize: 36, fontWeight: 600 }}>{route.avoid}</span>
          </div>
        ) : null}
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between", padding: "14px 34px",
        background: "#0c1c2f", borderTop: "1px solid #1c385a",
        letterSpacing: "0.18em", fontSize: 22, color: "#61809f",
      }}>
        <span>{live ? "FOLLOW THIS ROUTE" : "ADVISORY — FOLLOW YOUR TEACHER AND THE POSTED DIAGRAM"}</span>
        <span style={{ color: live ? "#35cc72" : "#e8a317" }}>{live ? "LIVE · WHOLE SCHOOL" : "DEMONSTRATION · NO LIVE INCIDENT"}</span>
      </div>
    </div>
  );
}
