import { AlertTriangle, ArrowRight, CheckCircle2, Flame, LockKeyhole, MonitorUp, ShieldAlert, Siren, UnlockKeyhole } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { FinalConfidenceScore } from '@/lib/confidence/confidence-calculator';
import type { EscalationDecision } from '@/lib/confidence/escalation-logic';
import type { ThreatDetection } from '@/lib/confidence/types';

interface AIRecommendationPanelProps {
  threat: ThreatDetection;
  score: FinalConfidenceScore;
  escalation: EscalationDecision;
  operatorName: string;
  onApprove: () => void;
  onEscalate: () => void;
  onCancel: () => void;
  onInvestigate?: () => void;
}

export function AIRecommendationPanel({
  threat,
  score,
  escalation,
  operatorName,
  onApprove,
  onEscalate,
  onCancel,
  onInvestigate,
}: AIRecommendationPanelProps) {
  const lowConfidence = escalation.status === 'AUTO_ESCALATED_TO_FULL_LOCKDOWN';
  const fire = escalation.recommendation_plan.responseType === 'fire_evacuation';
  const Icon = fire ? Flame : lowConfidence ? ShieldAlert : Siren;

  return (
    <section className={`ai-recommendation-panel ${lowConfidence ? 'is-escalated' : 'is-ready'}`}>
      <header className="ai-panel-header">
        <div>
          <span className="ai-panel-overline">
            <Icon />
            {fire ? 'Human-gated evacuation guidance' : lowConfidence ? 'Low-confidence threat response' : 'AI threat containment recommendation'}
          </span>
          <h2>{escalation.headline}</h2>
          <p>{escalation.operator_message}</p>
        </div>
        <div className="ai-confidence-pill" aria-label={`Recommendation confidence ${score.recommendation_confidence}%`}>
          <strong>{score.recommendation_confidence}%</strong>
          <small>{lowConfidence ? 'Below 98%' : '98%+ cleared'}</small>
        </div>
      </header>

      <div className="ai-panel-body">
        <article className="ai-summary-card">
          <div className="ai-section-title">
            <strong>{fire ? 'Evacuation analysis' : 'Threat analysis'}</strong>
            <Badge variant="outline">Operator approval required</Badge>
          </div>
          <ul className="ai-threat-list">
            <li><span>Type</span><strong>{threat.type}</strong></li>
            <li><span>Location</span><strong>{threat.location}</strong></li>
            <li><span>Speed</span><strong>{threat.speed.toFixed(1)} m/s</strong></li>
            <li><span>Direction</span><strong>{threat.direction}</strong></li>
            <li><span>Predicted destination</span><strong>{threat.predictedDestination}</strong></li>
          </ul>

          <div className="ai-action-block">
            <strong>{lowConfidence ? 'Escalated action' : 'Recommended action'}</strong>
            <p>{lowConfidence ? 'Do not execute a targeted containment path. Present a full-campus lockdown for operator confirmation.' : escalation.recommendation_plan.recommendedAction}</p>
            {!lowConfidence && (
              <ul className="ai-gate-list">
                {escalation.gate_actions.map((gate) => (
                  <li key={`${gate.gateId}-${gate.instruction}`}>
                    {gate.instruction === 'OPEN' ? <UnlockKeyhole /> : gate.instruction === 'LOCK' ? <LockKeyhole /> : <ArrowRight />}
                    <span>
                      <strong>{gate.gateId}</strong>
                      <small>{gate.reason}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>

        <article className="ai-breakdown-card">
          <div className="ai-section-title">
            <strong>5-layer confidence breakdown</strong>
            <Badge variant={score.all_layers_pass ? 'default' : 'secondary'}>
              {score.all_layers_pass ? 'All layers pass' : 'Escalation triggered'}
            </Badge>
          </div>
          <div className="ai-breakdown-list">
            {score.detailed_breakdown.map((layer) => (
              <div className="ai-breakdown-row" key={layer.layer}>
                <div>
                  <strong>{layer.layer}</strong>
                  <p>{layer.reasoning}</p>
                </div>
                <span className={layer.meets_threshold ? 'is-pass' : 'is-fail'}>
                  {layer.score}% / {layer.threshold}%
                </span>
              </div>
            ))}
          </div>
          <div className="ai-safety-checks" aria-label="Safety verification summary">
            <span><CheckCircle2 /> Human approval required before every action</span>
            <span><CheckCircle2 /> Audit trail is captured for every layer score</span>
            <span><CheckCircle2 /> Safety constraints must remain at 100%</span>
          </div>
        </article>
      </div>

      {fire && escalation.classroom_routes.length > 0 && (
        <article className="ai-routes-card">
          <div className="ai-section-title">
            <strong>Projector evacuation routes</strong>
            <Badge variant="outline"><MonitorUp /> Classroom-specific</Badge>
          </div>
          <div className="ai-route-grid">
            {escalation.classroom_routes.map((route) => (
              <div className="ai-route-card" key={route.room}>
                <strong>{route.room}</strong>
                <p>{route.route}</p>
                <small>{route.destination}</small>
              </div>
            ))}
          </div>
        </article>
      )}

      <footer className="ai-panel-footer">
        <div className="ai-panel-meta">
          <span>Operator: {operatorName}</span>
          <span>Timestamp: {new Intl.DateTimeFormat('en-AU', {
            dateStyle: 'medium',
            timeStyle: 'medium',
            timeZone: 'Australia/Melbourne',
          }).format(new Date())}</span>
        </div>
        <div className="ai-panel-actions">
          {lowConfidence ? (
            <>
              <Button onClick={onApprove}><ShieldAlert /> Confirm lockdown</Button>
              {onInvestigate ? <Button variant="outline" onClick={onInvestigate}><AlertTriangle /> Investigate further</Button> : null}
              <Button variant="outline" onClick={onCancel}>Cancel</Button>
            </>
          ) : (
            <>
              <Button onClick={onApprove}>{fire ? <UnlockKeyhole /> : <CheckCircle2 />} {fire ? 'Approve evacuation' : 'Approve recommendation'}</Button>
              <Button variant="outline" onClick={onEscalate}><ShieldAlert /> Escalate</Button>
              <Button variant="outline" onClick={onCancel}>Cancel</Button>
            </>
          )}
        </div>
      </footer>
    </section>
  );
}
