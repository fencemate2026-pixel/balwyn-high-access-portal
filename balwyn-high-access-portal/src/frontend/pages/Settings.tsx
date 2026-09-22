import type { EmergencyState, HireBooking } from "../../shared/types";

interface SettingsProps {
  emergency: EmergencyState;
  hireBookings: HireBooking[];
}

export function Settings({ emergency, hireBookings }: SettingsProps){
  return (
    <div className="stacked-layout">
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Portal settings</span>
            <h2>Hardware bridge and deployment profile</h2>
          </div>
        </div>
        <div className="settings-grid">
          <article className="setting-card">
            <strong>Controller bridge</strong>
            <p>Raspberry Pi relay adapter with ACB-004 dry-contact mapping and watchdog heartbeat.</p>
          </article>
          <article className="setting-card">
            <strong>Emergency state</strong>
            <p>{emergency.mode.toUpperCase()} · Updated {new Date(emergency.updatedAt).toLocaleString()}</p>
          </article>
          <article className="setting-card">
            <strong>Database schema</strong>
            <p>balwyn_portal on PostgreSQL with seed data for gates, rules, schedules, and hire requests.</p>
          </article>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Facility hire</span>
            <h2>Upcoming approved access windows</h2>
          </div>
        </div>
        <div className="schedule-list">
          {hireBookings.map((booking) => (
            <article key={booking.id} className="schedule-card">
              <strong>{booking.organisation}</strong>
              <span>{booking.location}</span>
              <p>{new Date(booking.startIso).toLocaleString()} → {new Date(booking.endIso).toLocaleString()}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
