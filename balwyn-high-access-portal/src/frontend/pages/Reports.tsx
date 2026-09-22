import type { AIInsight, GateStatus, ScheduleRule } from "../../shared/types";

interface ReportsProps {
  gates: GateStatus[];
  insights: AIInsight[];
  schedules: ScheduleRule[];
}

export function Reports({ gates, insights, schedules }: ReportsProps){
  const issueCount = gates.filter((gate) => gate.status === "issue").length;
  const automationCoverage = Math.round((schedules.filter((schedule) => schedule.enabled).length / Math.max(schedules.length, 1)) * 100);

  return (
    <div className="stacked-layout">
      <section className="panel report-summary">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Reports</span>
            <h2>Readiness and anomaly review</h2>
          </div>
        </div>
        <div className="stats-grid">
          <article className="stat-card"><span>Current issues</span><strong>{issueCount}</strong></article>
          <article className="stat-card"><span>Automation coverage</span><strong>{automationCoverage}%</strong></article>
          <article className="stat-card"><span>Insight backlog</span><strong>{insights.length}</strong></article>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Trend detail</span>
            <h2>AI and equipment notes</h2>
          </div>
        </div>
        <div className="insight-grid">
          {insights.map((insight) => (
            <article key={insight.id} className={`insight-card priority-${insight.priority}`}>
              <strong>{insight.title}</strong>
              <p>{insight.summary}</p>
              <footer>{insight.recommendation}</footer>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
