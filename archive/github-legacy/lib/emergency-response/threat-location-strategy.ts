import type { PerimeterThreatDetection } from "@/lib/early-detection/perimeter-threat-detector";

export interface ThreatDetection {
  id: string;
  threat_type: "INTRUDER" | "ARMED_INTRUDER" | "UNKNOWN";
  current_location: string;
}

export interface EmergencyStrategy {
  strategy:
    | "FULL_PERIMETER_LOCKDOWN_AND_EVACUATE"
    | "INTELLIGENT_HERDING_AND_TARGETED_EVACUATION";
  actions: string[];
  gates_to_lock: string[];
  gates_to_unlock: string[];
  projector_message: string;
  occupancy_safe: boolean;
}

export const ALL_17_GATES = Array.from(
  { length: 17 },
  (_, index) => `EXTERNAL_GATE_${index + 1}`,
);
export const INTERNAL_ESCAPE_ROUTES = [
  "EXIT_NORTH",
  "EXIT_SOUTH",
  "EXIT_EAST",
  "EXIT_WEST",
];

export function determine_emergency_strategy(
  threat: ThreatDetection,
  perimeter_check: Pick<PerimeterThreatDetection, "threat_location_status">,
): EmergencyStrategy {
  if (perimeter_check.threat_location_status !== "INSIDE_BUILDING") {
    return {
      strategy: "FULL_PERIMETER_LOCKDOWN_AND_EVACUATE",
      actions: [
        "Lock ALL 17 gates immediately",
        "Threat cannot enter building",
        "Unlock internal evacuation routes",
        "Broadcast: EVACUATE NOW via nearest exit",
        "Students evacuate AWAY from threat",
        "Police intercept threat at gate",
      ],
      gates_to_lock: ALL_17_GATES,
      gates_to_unlock: INTERNAL_ESCAPE_ROUTES,
      projector_message: "THREAT OUTSIDE - EVACUATE IMMEDIATELY",
      occupancy_safe: true,
    };
  }

  const containmentGates = [
    "CONTAINMENT_NORTH",
    "CONTAINMENT_EAST",
    "CONTAINMENT_SOUTH",
  ];
  const evacuationRoutes =
    threat.current_location.includes("NORTH") || threat.current_location.includes("GYM")
      ? ["EXIT_SOUTH", "EXIT_WEST"]
      : ["EXIT_NORTH", "EXIT_EAST"];

  return {
    strategy: "INTELLIGENT_HERDING_AND_TARGETED_EVACUATION",
    actions: [
      "Calculate threat destination",
      "Lock ONLY gates to herd threat to one zone",
      "Keep evacuation routes open",
      "Broadcast: Evacuate via assigned routes (away from threat)",
      "Students evacuate to safe zones",
      "Threat herded into containment zone",
      "Police respond to contained location",
    ],
    gates_to_lock: containmentGates,
    gates_to_unlock: evacuationRoutes,
    projector_message: `Targeted evacuation routes active away from ${threat.current_location}`,
    occupancy_safe: true,
  };
}
