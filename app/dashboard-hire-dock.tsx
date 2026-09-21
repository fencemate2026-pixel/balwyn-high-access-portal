"use client";

import { useEffect, useState } from "react";
import FacilityHirePanel from "./facility-hire-panel";
import "./hire-dock.css";

function portalMode() {
  const portal = document.querySelector(".control-portal");
  const className = portal?.className || "";
  if (className.includes("mode-fire")) return "fire";
  if (className.includes("mode-lockdown")) return "lockdown";
  return "normal";
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
      const list = item?.parentElement;
      if (schedule && item && list && !document.getElementById("hire-nav-item")) {
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
        cluster.innerHTML = `
          <small>SYSTEM STATUS</small>
          <div class="status-lamps" aria-hidden="true">
            <i class="status-lamp green is-on" title="Portal online"></i>
            <i class="status-lamp amber is-flash" title="Attention required"></i>
            <i class="status-lamp red" title="Emergency priority"></i>
          </div>
        `;
        header.prepend(cluster);
      }

      const systemCard = document.querySelector(".sidebar-system-card");
      if (systemCard && !document.getElementById("sidebar-rjl-mark")) {
        const mark = document.createElement("div");
        mark.id = "sidebar-rjl-mark";
        mark.className = "sidebar-rjl-mark";
        mark.innerHTML = `<img src="/rjl-commercial-logo.png" alt="RJL Commercial" />`;
        systemCard.parentElement?.insertBefore(mark, systemCard);
      }

      return Boolean(document.querySelector(".workspace-header-right") && document.querySelector(".sidebar-system-card"));
    }

    if (placeChrome()) return;
    const timer = window.setInterval(() => {
      if (placeChrome()) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function sync() {
      setMode(portalMode());
      const badge = document.querySelector(".concept-badge")?.textContent || "";
      setAttention(/commissioning|attention/i.test(badge));
    }
    sync();
    const timer = window.setInterval(sync, 1500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const cluster = document.getElementById("system-status-cluster");
    if (!cluster) return;
    const amber = cluster.querySelector(".status-lamp.amber");
    const red = cluster.querySelector(".status-lamp.red");
    amber?.classList.toggle("is-flash", attention && mode === "normal");
    amber?.classList.toggle("is-on", attention && mode === "normal");
    red?.classList.toggle("is-flash", mode !== "normal");
    red?.classList.toggle("is-on", mode !== "normal");
  }, [mode, attention]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("#hire-nav-item")) return;
      if (target.closest(".portal-nav-button")) setOpen(false);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    document.getElementById("hire-nav-item")?.classList.toggle("is-hire-open", open);
  }, [open]);

  if (!open) return null;
  return (
    <div className="hire-overlay" role="region" aria-label="Facility hire">
      <FacilityHirePanel />
    </div>
  );
}
