import type { EmergencyState, GateStatus, WeatherSnapshot } from "../../shared/types";
import { EmergencyPanel } from "../components/EmergencyPanel";
import { GateStatus as GateStatusBoard } from "../components/GateStatus";
import { Scene3D } from "../components/Scene3D";
import { WeatherOverlay } from "../components/WeatherOverlay";

interface PortalProps {
  gates: GateStatus[];
  weather: WeatherSnapshot;
  emergency: EmergencyState;
  onEmergencyAction: (action: "lockdown" | "fire" | "normal") => void;
}

export function Portal({ gates, weather, emergency, onEmergencyAction }: PortalProps){
  return (
    <div className="page-grid">
      <section className="hero-panel panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Magic Keys visual command</span>
            <h2>3D campus control surface</h2>
          </div>
        </div>
        <WeatherOverlay weather={weather} />
        <Scene3D gates={gates} weather={weather} emergency={emergency} />
      </section>
      <GateStatusBoard gates={gates} />
      <EmergencyPanel emergency={emergency} onAction={onEmergencyAction} />
    </div>
  );
}
