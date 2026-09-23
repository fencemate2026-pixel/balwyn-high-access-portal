"use client";

import { useEffect, useState } from "react";
import FacilityHirePanel from "./facility-hire-panel";
import DashboardOpsStrip from "./dashboard-ops-strip";
import "./hire-dock.css";

function portalMode() {
  const portal = document.querySelector(".control-portal");
  const className = portal?.className || "";
  if (className.includes("mode-fire")) return "fire";
  if (className.includes("mode-lockdown")) return "lockdown";
  return "normal";
}

function statusCopy(mode: "normal" | "fire" | "lockdown", attention: boolean) {
  if (mode === "fire") return "FIRE — open packets queued, no confirmed movement";
  if (mode === "lockdown") return "LOCKDOWN — close packets queued, no confirmed movement";
  if (attention) return "Amber: commissioning — 0 controllers online, no verified heartbeat";
  return "Normal — portal online";
}

function applyLiveGateArt() {
  document.querySelectorAll<HTMLImageElement>("img.single-gate-image").forEach((image) => {
    const icon = image.closest(".access-icon");
    const open = icon?.classList.contains("is-open");
    const closed = icon?.classList.contains("is-closed");
    if (open) {
      if (!image.src.includes("single-gate-open-transparent.png")) image.src = "/single-gate-open-transparent.png";
      return;
    }
    if (closed) {
      if (!image.src.includes("single-gate-closed-transparent.png")) image.src = "/single-gate-closed-transparent.png";
      return;
    }
    if (!image.src.includes("single-gate-live.svg")) image.src = "/single-gate-live.svg";
  });
}

export default function DashboardHireDock() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"normal" | "fire" | "lockdown">("normal");
  const [attention, setAttention] = useState(true);

  useEffect(() => {
    function placeChrome() {
      const schedule = Array.from(document.querySelectorAll<HTMLElement>(".portal-nav-button"))
        .find((button) => (button.textContent || "").includes("Gate schedules"));
      const item = schedule?.closest("li");
      if (schedule && item && !document.getElementById("hire-nav-item")) {
        const clone = item.cloneNode(true) as HTMLElement;
        clone.id = "hire-nav-item";
        clone.querySelectorAll("span").forEach((span) => {
          if ((span.textContent || "").includes("Gate schedules")) span.textContent = "Facility hire";
        });
        const control = clone.querySelector("button, [role='button']") as HTMLElement | null;
        control?.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        });
        item.after(clone);
      }
      const header = document.querySelector(".workspace-header-right");
      if (header && !document.getElementById("system-status-cluster")) {
        const cluster = document.createElement("div");
        cluster.id = "system-status-cluster";
        cluster.className = "system-status-cluster";
        cluster.innerHTML = `<small>SYSTEM STATUS</small><div class="status-lamps"><i class="status-lamp green is-on"></i><i class="status-lamp amber is-flash"></i><i class="status-lamp red"></i></div><span class="header-strobe"><i></i></span><b class="status-why"></b>`;
        header.prepend(cluster);
      }
      applyLiveGateArt();
    }
    placeChrome();
    const timer = window.setInterval(placeChrome, 800);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function sync() {
      setMode(portalMode());
      setAttention(/commissioning|attention/i.test(document.querySelector(".concept-badge")?.textContent || ""));
      applyLiveGateArt();
    }
    sync();
    const timer = window.setInterval(sync, 1500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const cluster = document.getElementById("system-status-cluster");
    if (!cluster) return;
    cluster.querySelector(".status-lamp.amber")?.classList.toggle("is-flash", attention && mode === "normal");
    cluster.querySelector(".status-lamp.red")?.classList.toggle("is-flash", mode !== "normal");
    cluster.querySelector(".header-strobe")?.classList.toggle("is-amber", attention && mode === "normal");
    cluster.querySelector(".header-strobe")?.classList.toggle("is-red", mode !== "normal");
    const why = cluster.querySelector(".status-why");
    if (why) why.textContent = statusCopy(mode, attention);
  }, [mode, attention]);

  // Tab state: while Facility hire is open, its tab shows as the active one.
  useEffect(() => {
    document.body.classList.toggle("hire-open", open);
    return () => document.body.classList.remove("hire-open");
  }, [open]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest("#hire-nav-item")) return;
      if (target.closest(".portal-nav-button")) setOpen(false);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <>
      <DashboardOpsStrip />
      {open ? (
        <div className="hire-overlay" role="region" aria-label="Facility hire">
          <FacilityHirePanel />
        </div>
      ) : null}
    </>
  );
}
