"use client";

import { useEffect, useState } from "react";
import { Camera, CheckCircle2, Flame, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

type VisionEvent = {
  id: number;
  kind: string;
  zone: string;
  score: number;
  note: string;
  label: string | null;
  reviewer: string | null;
};

type Props = {
  endpoint?: string;
  reviewer?: string;
};

const DEMO: VisionEvent[] = [
  {
    id: 1,
    kind: "fire_suspect",
    zone: "TF-FORECOURT",
    score: 0.0165,
    note: "Hot orange cluster. Confirm on site. Not a fire-panel input.",
    label: null,
    reviewer: null,
  },
  {
    id: 2,
    kind: "smoke_suspect",
    zone: "TF-FORECOURT",
    score: 0.0851,
    note: "Grey plume-like region. Confirm on site.",
    label: null,
    reviewer: null,
  },
];

function title(kind: string) {
  if (kind === "fire_suspect") return "Fire suspect";
  if (kind === "smoke_suspect") return "Smoke suspect";
  if (kind === "after_hours_motion") return "After-hours motion";
  return kind;
}

export default function VisionReviewPanel({
  endpoint = "/.netlify/functions/vision-events",
  reviewer = "desk",
}: Props) {
  const [events, setEvents] = useState<VisionEvent[]>(DEMO);
  const [source, setSource] = useState<"demo" | "live">("demo");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch(endpoint, { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active || !payload?.events) return;
        setEvents(payload.events);
        setSource(payload.source === "live" ? "live" : "demo");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [endpoint]);

  async function label(id: number, value: "true_positive" | "false_positive") {
    setEvents((current) =>
      current.map((event) =>
        event.id === id ? { ...event, label: value, reviewer } : event,
      ),
    );
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, label: value, reviewer }),
      });
    } catch {
      setMessage("Label saved on this screen only. The vision service was not reachable.");
    }
  }

  const waiting = events.filter((event) => !event.label).length;

  return (
    <section className="remote-open-panel" aria-label="Camera event review">
      <h3>
        <Camera /> Camera review · awaiting approval
      </h3>
      <p>
        Advisory queue only. Confirming an event does not pulse a gate, set lockdown,
        or replace the fire panel. {source === "demo" ? "Showing demonstration events until a vision service is configured." : "Showing events from the on-site vision service."}
      </p>
      <small>{waiting} event{waiting === 1 ? "" : "s"} waiting · {source}</small>
      <div className="identity-rows">
        {events.map((event) => (
          <div key={event.id}>
            <span>
              {event.kind === "fire_suspect" ? <Flame /> : <ShieldAlert />} {title(event.kind)} · {event.zone}
            </span>
            <strong>{event.label ? event.label.replace("_", " ") : "Awaiting approval"}</strong>
            <small>{event.note}</small>
            {!event.label && (
              <span className="sheet-actions">
                <Button size="sm" onClick={() => void label(event.id, "true_positive")}>
                  <CheckCircle2 /> Confirm
                </Button>
                <Button size="sm" variant="outline" onClick={() => void label(event.id, "false_positive")}>
                  False alarm
                </Button>
              </span>
            )}
          </div>
        ))}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
