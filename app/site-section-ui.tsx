"use client";
// Shared building blocks for the owner site views (Thomastown and Mildura), 4 Nov 2026 (Jarrod):
// one numbered-section layout, one set of pills, tables and CSV download, so both sites look and
// behave the same. Moved out of mildura-site-view.tsx without changing how they look.
import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { GLASS_PANEL } from "./glass-ui";

export const MUTED = "text-[#B9CFE2]";
export type Tone = "ok" | "bad" | "warn" | "mute";
export const TONE: Record<Tone, string> = { ok: "text-[#34d399]", bad: "text-[#ff6b6b]", warn: "text-[#fbbf24]", mute: "text-[#B9CFE2]" };

export const Pill = ({ tone, children, caps = false }: { tone: Tone; children: ReactNode; caps?: boolean }) =>
  <em className={`telemetry-badge not-italic ${TONE[tone]} ${caps ? "text-[10px] font-bold tracking-[.08em] uppercase" : ""}`}><i className="signal-dot" />{children}</em>;

export const TH = `px-3 py-2 text-left text-[11px] font-semibold tracking-[.08em] uppercase ${MUTED} border-b border-white/[0.14]`;
export const TD = "px-3 py-2 border-b border-white/[0.08] text-sm";
// Cell text sits in a <span> so the dashboard's navy-panel text rule (.campus-context .mk-navy span) colours it.
export const Td = ({ children, className = "", colSpan }: { children: ReactNode; className?: string; colSpan?: number }) =>
  <td className={`${TD} ${className}`} colSpan={colSpan}><span>{children}</span></td>;

/** The dashboard styles its navy panels inside .campus-context; wrapping each panel the same way reuses those rules. */
const NAVY_SCOPE: CSSProperties = { display: "block", padding: 0, background: "transparent", maxWidth: "none" };
export const Navy = ({ children, className = "" }: { children: ReactNode; className?: string }) =>
  <div className="campus-context" style={NAVY_SCOPE}><div className={`${GLASS_PANEL} p-4 ${className}`}>{children}</div></div>;

/** Section = white header strip with orange title + icon, then a navy glass card. */
export function Section({ n, icon: Icon, title, right, children, label }: { n: number; icon: LucideIcon; title: string; right?: ReactNode; children: ReactNode; label?: string }) {
  return <section className="gate-condition mb-4" aria-label={label ?? title}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span className="gate-ordinal grid size-7 place-items-center rounded-none border border-[#FF7A00] bg-[#FF7A00] text-[11px] font-bold text-white" aria-hidden="true">{String(n).padStart(2, "0")}</span>
        <h2 className="m-0 flex items-center gap-2 text-lg"><Icon className="size-4 text-[#FF7A00]" aria-hidden="true" /> {title}</h2></div>
      {right}
    </div>
    <Navy>{children}</Navy>
  </section>;
}

export const Empty = ({ text }: { text: string }) => <p className={`m-0 text-sm ${MUTED}`}>{text}</p>;

/** Save a CSV in the browser. A byte-order mark makes Excel read UTF-8 names correctly. */
export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** yyyy-mm-dd in Melbourne, for export file names. */
export const stampDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
