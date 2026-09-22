import type { GateStatus as GateStatusType } from "../../shared/types";

interface GateStatusProps {
  gates: GateStatusType[];
}

export function GateStatus({ gates }: GateStatusProps){
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Perimeter control</span>
          <h2>Gate and bollard status</h2>
        </div>
        <span className="helper-text">Live LED indicators</span>
      </div>
      <div className="status-grid">
        {gates.map((gate) => (
          <article key={gate.id} className="status-card">
            <div className="status-topline">
              <span className={`led led-${gate.status}`} aria-hidden="true" />
              <strong>{gate.name}</strong>
            </div>
            <span className="status-zone">{gate.zone}</span>
            <div className="status-values">
              <span>{gate.status.toUpperCase()}</span>
              <span>{gate.openPercent}% open</span>
            </div>
            <div className="meter-track" aria-hidden="true">
              <span className="meter-fill" style={{ width: `${gate.openPercent}%` }} />
            </div>
            <p>{gate.issue ?? `${gate.automationMode} automation · Relay CH ${gate.relayChannel}`}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
