"use client";

/** Classroom projection preview. Recorded route examples remain advisory until site approval. */

import { ShieldCheck, TriangleAlert, Ban } from "lucide-react";
import BrandLogo from "./brand-logo";

export type GuidanceStatus = "ok" | "refuge" | "hold";

export type GuidanceRoute = {
  status: GuidanceStatus;
  /** Recorded outdoor exit identifier; this layer contains no interiors. */
  origin: string;
  headline: string;
  steps: { text: string; metres?: number }[];
  destinationLabel: string;
  destination: string;
  avoid?: string;
  totalMetres?: number;
};

const TONE: Record<GuidanceStatus, { rail: string; lift: string; label: string }> = {
  ok:     { rail: "#009639", lift: "#35cc72", label: "Recorded route · example" },
  refuge: { rail: "#e8a317", lift: "#ffc44d", label: "Assisted evacuation · example" },
  hold:   { rail: "#d7263d", lift: "#ff5f73", label: "No verified route" },
};

// EXIT_12 → PINCH → MUSTER_OVAL in the supplied balwyn_site.json.
// These are recorded outdoor connections, not a verified classroom route.
export const EXAMPLE_ROUTE: GuidanceRoute = {
  status: "ok",
  origin: "Exit 12",
  headline: "Go to the school oval",
  steps: [
    { text: "Leave by Exit 12" },
    { text: "Follow the path to the central crossing", metres: 70.9 },
    { text: "Continue to the oval", metres: 17.2 },
  ],
  destinationLabel: "Meeting point",
  destination: "School oval",
  totalMetres: 88.1,
  avoid: "Stay clear of the internal driveway",
};

export default function GuidanceProjection({ route }: { route: GuidanceRoute }) {
  const tone = TONE[route.status];
  const Icon = route.status === "ok" ? ShieldCheck : route.status === "refuge" ? TriangleAlert : Ban;

  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      background: "#0f2136", color: "#f4f8fc",
      borderTop: `14px solid ${tone.rail}`,
      fontFamily: '"Barlow Condensed", "Barlow", system-ui, sans-serif',
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 34px", background: "#0c1c2f", borderBottom: "1px solid #1c385a",
      }}>
        <div style={{ width: 270, height: 88, flexShrink: 0 }}><BrandLogo /></div>
        <span style={{ letterSpacing: "0.22em", fontSize: 26, color: "#9cb4cd" }}>
          {route.origin.toUpperCase()}
        </span>
        <span style={{ letterSpacing: "0.22em", fontSize: 26, color: "#9cb4cd" }}>
          EMERGENCY GUIDANCE
        </span>
      </div>

      <div style={{ flex: 1, padding: "24px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, color: tone.lift }}>
          <Icon style={{ width: 34, height: 34 }} aria-hidden />
          <span style={{ letterSpacing: "0.24em", fontSize: 26, fontWeight: 600 }}>
            {tone.label.toUpperCase()}
          </span>
        </div>

        <strong style={{ fontSize: 88, lineHeight: 0.95, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {route.headline}
        </strong>

        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {route.steps.map((step, i) => (
            <li key={step.text} style={{
              display: "grid", gridTemplateColumns: "58px 1fr auto", alignItems: "center",
              gap: 18, padding: "12px 20px", background: "#0d1f34",
              borderLeft: `6px solid ${tone.rail}`,
            }}>
              <span style={{ fontSize: 44, fontWeight: 700, color: tone.lift, textAlign: "center" }}>
                {i + 1}
              </span>
              <span style={{ fontSize: 44, fontWeight: 600, lineHeight: 1.1 }}>{step.text}</span>
              <span style={{
                fontFamily: '"Barlow", sans-serif', fontSize: 28, color: "#61809f",
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
                marginLeft: "auto", fontFamily: '"Barlow", sans-serif', fontSize: 30,
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
        letterSpacing: "0.12em", fontSize: 18, color: "#61809f",
      }}>
        <span>ADVISORY · APPROXIMATE DISTANCES · FOLLOW THE APPROVED SCHOOL PLAN</span>
        <span style={{ color: "#e8a317" }}>DEMONSTRATION · NO LIVE INCIDENT</span>
      </div>
    </div>
  );
}
