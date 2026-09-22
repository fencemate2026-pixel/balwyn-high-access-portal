import type { EmergencyState } from "../../shared/types";

interface EmergencyPanelProps {
  emergency: EmergencyState;
  onAction: (action: "lockdown" | "fire" | "normal") => void;
}

export function EmergencyPanel({ emergency, onAction }: EmergencyPanelProps){
  return (
    <section className="panel emergency-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Emergency command</span>
          <h2>Rapid response controls</h2>
        </div>
        <span className={`pill pill-${emergency.mode}`}>{emergency.mode.toUpperCase()}</span>
      </div>
      <p>Muster point: <strong>{emergency.musterPoint}</strong> · Last action by {emergency.triggeredBy}</p>
      <div className="emergency-actions">
        <button className="action action-lock" onClick={() => onAction("lockdown")} type="button">Lockdown campus</button>
        <button className="action action-fire" onClick={() => onAction("fire")} type="button">Fire evacuation mode</button>
        <button className="action action-normal" onClick={() => onAction("normal")} type="button">Return to normal</button>
      </div>
    </section>
  );
}
