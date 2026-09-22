import type { ScheduleRule } from "../../shared/types";

interface SchedulerProps {
  schedules: ScheduleRule[];
}

export function Scheduler({ schedules }: SchedulerProps){
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Automation scheduler</span>
          <h2>Planned gate actions</h2>
        </div>
      </div>
      <div className="schedule-list">
        {schedules.map((schedule) => (
          <article key={schedule.id} className="schedule-card">
            <strong>{schedule.name}</strong>
            <span>{schedule.gateId}</span>
            <p>{schedule.days.join(", ")} · {schedule.opensAt} → {schedule.closesAt}</p>
            <div className="schedule-tags">
              <span>{schedule.action}</span>
              <span>{schedule.source}</span>
              <span>{schedule.enabled ? "Enabled" : "Disabled"}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
