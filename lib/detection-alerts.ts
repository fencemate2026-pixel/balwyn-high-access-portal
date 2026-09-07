import { buildActivityRecord } from "@/lib/portal-activity";
import type {
  AlertDecision,
  AlertVerification,
  DetectionEvent,
  DetectionKind,
  GatePosition,
  PerimeterGateState,
  SystemMode,
} from "@/lib/portal-types";

export function createSyntheticDetectionEvent(
  type: DetectionKind,
  incidentLocation: string,
): DetectionEvent {
  const timestamp = new Date().toISOString();
  const upper = type.toUpperCase();
  return {
    id: `${type}-${Date.now()}`,
    type,
    source: "Sentinel AI edge detector",
    confidence: type === "firearm" || type === "knife" ? 0.94 : 0.91,
    incidentLocation,
    camera: type === "firearm" || type === "knife" ? "CAM-COURTYARD-03" : "CAM-SCIENCE-02",
    snapshotLabel: `${upper} evidence frame · ${incidentLocation}`,
    timestamp,
    status: "pending",
  };
}

function modeForDetection(type: DetectionKind): Extract<SystemMode, "lockdown" | "fire"> {
  return type === "firearm" || type === "knife" ? "lockdown" : "fire";
}

export function processDetectionAlert({
  detectionEvent,
  decision,
  operator,
  notes,
}: {
  detectionEvent: DetectionEvent;
  decision: AlertDecision;
  operator: string;
  notes?: string;
}) {
  const timestamp = new Date().toISOString();
  const mode = modeForDetection(detectionEvent.type);
  const reviewedEvent: DetectionEvent = {
    ...detectionEvent,
    status: "reviewed",
    operatorDecision: decision,
    notes,
  };

  const actionTaken =
    decision !== "confirmed"
      ? "none"
      : mode === "fire"
        ? ("fire" as const)
        : ("perimeter-deploy" as const);

  const verification: AlertVerification = {
    id: `verify-${detectionEvent.id}`,
    detectionEventId: detectionEvent.id,
    operator,
    decision,
    notes:
      notes?.trim() ||
      (decision === "confirmed"
        ? "Reviewed and confirmed by operator."
        : decision === "uncertain"
          ? "Operator marked as uncertain pending more evidence."
          : "Operator rejected alert after review."),
    timestamp,
    actionTaken,
  };

  const activity = [
    buildActivityRecord(
      "Detection alert reviewed",
      `${operator} marked the ${detectionEvent.type} alert from ${detectionEvent.source} as ${decision}.`,
      { timestamp, source: detectionEvent.source },
    ),
  ];

  if (decision === "confirmed") {
    activity.push(
      buildActivityRecord(
        mode === "fire" ? "Fire mode triggered from detection" : "Lockdown triggered from detection",
        `${operator} confirmed ${detectionEvent.type} evidence near ${detectionEvent.incidentLocation}.`,
        { timestamp, source: detectionEvent.source },
      ),
    );
  } else {
    activity.push(
      buildActivityRecord(
        "Detection closed without automated action",
        `${operator} kept manual emergency controls independent after a ${decision} ${detectionEvent.type} review.`,
        { timestamp, source: detectionEvent.source },
      ),
    );
  }

  return {
    reviewedEvent,
    verification,
    activity,
    nextMode: decision === "confirmed" ? mode : ("normal" as SystemMode),
    perimeterState:
      decision === "confirmed" && mode === "lockdown"
        ? ("deployed" as PerimeterGateState)
        : ("normal" as PerimeterGateState),
    perimeterPosition:
      decision === "confirmed" && mode === "lockdown"
        ? ("closed" as GatePosition)
        : undefined,
  };
}
