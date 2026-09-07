import { type GateDirective, type Zone } from './types';

export interface SafetyConstraints {
  fire_exits_accessible: boolean;
  no_occupants_trapped: boolean;
  escape_routes_available: boolean;
  fire_law_compliant: boolean;
  emergency_lights_functional: boolean;
  all_safety_checks_pass: boolean;
  safety_confidence: number;
  failed_checks: string[];
  remediation: string[];
  reasoning: string;
}

export function verify_safety_constraints(
  zone: Zone,
  gates_to_lock: GateDirective[],
): SafetyConstraints {
  const fire_exits_accessible = zone.fireExitsAccessible && !gates_to_lock.some((gate) => gate.reason.toLowerCase().includes('fire exit'));
  const no_occupants_trapped = zone.thermalOccupancyCount === 0 && zone.badgeOccupancyCount === 0 && !zone.radarMotionDetected;
  const escape_routes_available = zone.escapeRoutesAvailable;
  const fire_law_compliant = zone.fireLawCompliant;
  const emergency_lights_functional = zone.emergencyLightsFunctional;
  const failed_checks = [
    !fire_exits_accessible && 'Fire exits are obstructed by the current plan.',
    !no_occupants_trapped && 'Occupants remain inside the target zone.',
    !escape_routes_available && 'Adjacent escape routes are not available.',
    !fire_law_compliant && 'The action would violate fire egress requirements.',
    !emergency_lights_functional && 'Emergency lighting is unavailable.',
  ].filter(Boolean) as string[];

  return {
    fire_exits_accessible,
    no_occupants_trapped,
    escape_routes_available,
    fire_law_compliant,
    emergency_lights_functional,
    all_safety_checks_pass: failed_checks.length === 0,
    safety_confidence: failed_checks.length === 0 ? 100 : 0,
    failed_checks,
    remediation: failed_checks.map((check) => {
      if (check.includes('Fire exits')) return 'Leave all designated fire exits open and re-route the containment plan.';
      if (check.includes('Occupants')) return 'Clear the target zone or switch to full lockdown until occupancy is verified empty.';
      if (check.includes('Adjacent')) return 'Re-open an alternate escape route before presenting the recommendation.';
      if (check.includes('fire egress')) return 'Escalate to the campus emergency plan and review the gate set with the operator.';
      return 'Dispatch maintenance or switch to manual evacuation support before executing any gate changes.';
    }),
    reasoning: failed_checks.length === 0
      ? `${zone.name} passed every binary safety gate, so the safety layer contributes 100%.`
      : `Safety checks failed for ${zone.name}; binary safety confidence drops to 0% until every issue is remediated.`,
  };
}
