"use client";

import { AlertTriangle, CheckCircle2, Flame, Map, Route, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RoutePlan } from "@/lib/portal-types";

export function EvacuationRoutingPanel({
  floorPlanName,
  incidentLocation,
  routePlan,
  isFireMode,
  onIncidentLocationChange,
  onReviewRoutes,
}: {
  floorPlanName: string;
  incidentLocation: string;
  routePlan: RoutePlan;
  isFireMode: boolean;
  onIncidentLocationChange: (value: string) => void;
  onReviewRoutes: () => void;
}) {
  return (
    <section className="evacuation-routing-panel">
      <div className="view-panel-heading">
        <div>
          <h2>Evacuation routing</h2>
          <small>sg-pro-sentinel advisory integration</small>
        </div>
        <Badge variant="outline">
          <Map /> {floorPlanName}
        </Badge>
      </div>

      <div className={`routing-callout ${isFireMode ? "is-fire" : ""}`}>
        {isFireMode ? <Flame /> : <ShieldCheck />}
        <div>
          <strong>
            {isFireMode
              ? "Fire mode active · route suggestions prepared automatically"
              : "Prepared routing view"}
          </strong>
          <p>
            Advisory routes are calculated immediately, then held until a human reviews them
            before display.
          </p>
        </div>
      </div>

      <div className="routing-toolbar">
        <label>
          <span>Incident location</span>
          <Input
            value={incidentLocation}
            onChange={(event) => onIncidentLocationChange(event.target.value)}
            placeholder="e.g. Science Lab"
          />
        </label>
        <Button onClick={onReviewRoutes}>
          <Route /> {routePlan.humanReviewed ? "Reviewed for display" : "Review advisory routes"}
        </Button>
      </div>

      {!routePlan.humanReviewed ? (
        <div className="routing-pending">
          <AlertTriangle />
          <div>
            <strong>Routes pending human review</strong>
            <p>
              Safe and blocked exits have been calculated for {routePlan.incidentLocation}, but
              detailed route paths remain hidden until an operator reviews them.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="exit-status-grid">
            {routePlan.exits.map((exit) => (
              <article className={`exit-status-card is-${exit.status}`} key={exit.exitId}>
                <strong>{exit.label}</strong>
                <span>{exit.status === "safe" ? "Safe exit" : "Blocked exit"}</span>
                <p>{exit.reason}</p>
              </article>
            ))}
          </div>

          <div className="route-list">
            {routePlan.routes.map((route) => (
              <article className={`route-card is-${route.status}`} key={route.classroomId}>
                <header>
                  <strong>{route.classroom}</strong>
                  <Badge variant={route.status === "safe" ? "outline" : "destructive"}>
                    {route.status === "safe" ? route.exitLabel : "Hold position"}
                  </Badge>
                </header>
                <p>{route.advisory}</p>
                <span>
                  {route.status === "safe" ? <CheckCircle2 /> : <AlertTriangle />}
                  {route.path.join(" → ")}
                </span>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
