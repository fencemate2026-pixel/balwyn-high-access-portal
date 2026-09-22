import type { DashboardSnapshot } from "../../shared/types";

interface DashboardProps {
  dashboard: DashboardSnapshot;
}

export function Dashboard({ dashboard }: DashboardProps){
  const cards = [
    { label: "Active gates", value: dashboard.activeGates },
    { label: "Open gates", value: dashboard.openGates },
    { label: "Alerts", value: dashboard.alerts },
    { label: "Uptime", value: `${dashboard.uptimePercent.toFixed(2)}%` },
  ];

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Admin dashboard</span>
          <h2>Operations snapshot</h2>
        </div>
      </div>
      <div className="stats-grid">
        {cards.map((card) => (
          <article key={card.label} className="stat-card">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </div>
      <div className="event-list">
        {dashboard.recentEvents.map((event) => (
          <article key={event.id} className={`event-card event-${event.severity}`}>
            <strong>{event.title}</strong>
            <p>{event.detail}</p>
            <span>{new Date(event.occurredAt).toLocaleTimeString()}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
