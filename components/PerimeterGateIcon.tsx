import type { GatePosition, PerimeterGateState } from "@/lib/portal-types";

export function PerimeterGateIcon({
  position,
  state,
}: {
  position: GatePosition;
  state: PerimeterGateState;
}) {
  return (
    <span
      className={`access-icon perimeter-force-gate is-${position} state-${state}`}
      aria-hidden="true"
    >
      <span className="perimeter-force-ring" />
      <span className="perimeter-force-door">
        <i className="door-left" />
        <i className="door-right" />
      </span>
      <span className="perimeter-force-shield" />
      <span className="perimeter-force-wave wave-a" />
      <span className="perimeter-force-wave wave-b" />
    </span>
  );
}
