"use client";

import { AlertTriangle, Camera, CheckCircle2, Flame, ShieldAlert, ShieldQuestion } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AlertDecision, DetectionEvent, SystemMode } from "@/lib/portal-types";

function detectionIcon(type: DetectionEvent["type"]) {
  return type === "smoke" || type === "flame" ? Flame : ShieldAlert;
}

export function DetectionAlertPanel({
  detections,
  operatorName,
  activeMode,
  onDecision,
  onSimulateDetection,
}: {
  detections: DetectionEvent[];
  operatorName: string;
  activeMode: SystemMode;
  onDecision: (event: DetectionEvent, decision: AlertDecision) => void;
  onSimulateDetection: (type: "firearm" | "smoke") => void;
}) {
  return (
    <section className="detection-alert-panel">
      <div className="panel-heading">
        <div>
          <h2>Detection verification</h2>
          <small>Human confirmation required</small>
        </div>
        <Badge variant="outline">
          <ShieldQuestion /> {detections.filter((event) => event.status === "pending").length} pending
        </Badge>
      </div>

      <div className="detection-toolbar">
        <span>
          <AlertTriangle />
          Automated evidence never actuates gates without {operatorName}.
        </span>
        <div>
          <Button variant="outline" onClick={() => onSimulateDetection("firearm")}>
            Queue weapon alert
          </Button>
          <Button onClick={() => onSimulateDetection("smoke")}>Queue fire alert</Button>
        </div>
      </div>

      <div className="detection-list">
        {detections.length === 0 ? (
          <div className="detection-empty">
            <CheckCircle2 />
            <strong>No detection alerts awaiting review</strong>
            <p>Manual emergency controls remain available even when the alert queue is empty.</p>
          </div>
        ) : (
          detections.map((event) => {
            const Icon = detectionIcon(event.type);
            const pending = event.status === "pending";

            return (
              <article className={`detection-card ${pending ? "is-pending" : "is-reviewed"}`} key={event.id}>
                <header>
                  <span className="detection-card-icon">
                    <Icon />
                  </span>
                  <div>
                    <strong>{event.type.toUpperCase()} detection</strong>
                    <small>
                      {event.source} · {event.confidence.toFixed(2)} confidence · {event.timestamp}
                    </small>
                  </div>
                  <Badge variant={pending ? "destructive" : "outline"}>
                    {pending ? "Awaiting operator review" : `Reviewed · ${event.operatorDecision}`}
                  </Badge>
                </header>
                <div className="detection-evidence">
                  <span>
                    <Camera />
                    <strong>{event.camera}</strong>
                    <small>{event.snapshotLabel}</small>
                  </span>
                  <span>
                    <AlertTriangle />
                    <strong>{event.incidentLocation}</strong>
                    <small>{activeMode === "normal" ? "No emergency mode active" : `Current mode · ${activeMode}`}</small>
                  </span>
                </div>

                {pending ? (
                  <footer>
                    <Button variant="outline" onClick={() => onDecision(event, "rejected")}>
                      Reject
                    </Button>
                    <Button variant="outline" onClick={() => onDecision(event, "uncertain")}>
                      Mark uncertain
                    </Button>
                    <Button onClick={() => onDecision(event, "confirmed")}>Confirm and action</Button>
                  </footer>
                ) : (
                  <p className="detection-reviewed-note">
                    {event.notes || "Review recorded in the compliance audit trail."}
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
