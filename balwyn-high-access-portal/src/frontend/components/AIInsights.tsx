import type { AIInsight } from "../../shared/types";

interface AIInsightsProps {
  insights: AIInsight[];
}

export function AIInsights({ insights }: AIInsightsProps){
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">AI recommendations</span>
          <h2>Operational insights</h2>
        </div>
      </div>
      <div className="insight-grid">
        {insights.map((insight) => (
          <article key={insight.id} className={`insight-card priority-${insight.priority}`}>
            <div className="status-topline">
              <span className={`pill pill-${insight.priority}`}>{insight.priority}</span>
              <span>{Math.round(insight.confidence * 100)}% confidence</span>
            </div>
            <strong>{insight.title}</strong>
            <p>{insight.summary}</p>
            <footer>{insight.recommendation}</footer>
          </article>
        ))}
      </div>
    </section>
  );
}
