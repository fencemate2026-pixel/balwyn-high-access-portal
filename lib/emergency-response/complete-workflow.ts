import type { PerimeterThreatDetection } from "@/lib/early-detection/perimeter-threat-detector";
import { execute_intelligent_herding } from "@/lib/emergency-response/internal-threat-herding";
import { PerimeterLockdownSystem } from "@/lib/emergency-response/perimeter-lockdown";
import type { ThreatDetection } from "@/lib/emergency-response/threat-location-strategy";

export async function handle_emergency_threat(
  threat: ThreatDetection,
  perimeter_check: PerimeterThreatDetection,
  operator_approval: boolean,
  perimeter_lockdown_system = new PerimeterLockdownSystem(),
) {
  if (perimeter_check.threat_location_status === "INSIDE_BUILDING") {
    return execute_intelligent_herding(threat);
  }

  return perimeter_lockdown_system.execute_perimeter_lockdown(
    operator_approval,
    perimeter_check,
  );
}
