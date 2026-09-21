"use client";

import { useEffect, useState } from "react";
import FacilityHirePanel from "./facility-hire-panel";
import "./hire-dock.css";

export default function DashboardHireDock() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function placeButton() {
      const existing = document.getElementById("hire-nav-item");
      const buttons = Array.from(document.querySelectorAll<HTMLElement>(".portal-nav-button"));
      const schedule = buttons.find((button) => (button.textContent || "").includes("Gate schedules"));
      const item = schedule?.closest("li");
      const list = item?.parentElement;
      if (!schedule || !item || !list) return false;
      if (existing) return true;

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
      return true;
    }

    if (placeButton()) return;
    const timer = window.setInterval(() => {
      if (placeButton()) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

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
