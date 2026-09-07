import type { FinalConfidenceScore } from './confidence-calculator';
import type {
  GateDirective,
  OperatorDecision,
  RecommendationPlan,
} from './types';

export interface EscalationDecision {
  status: 'SHOW_RECOMMENDATION' | 'AUTO_ESCALATED_TO_FULL_LOCKDOWN';
  headline: string;
  operator_message: string;
  allowed_operator_actions: OperatorDecision[];
  gate_actions: GateDirective[];
  classroom_routes: RecommendationPlan['classroomRoutes'];
  recommendation_plan: RecommendationPlan;
  human_approval_required: true;
}

export interface OperatorActionResult {
  executed: boolean;
  resulting_mode: 'normal' | 'targeted-containment' | 'lockdown' | 'fire';
  gates_to_lock: string[];
  gates_to_keep_open: string[];
  gates_to_open: string[];
  audit_entry: string;
}

export function determine_escalation_decision(
  final_confidence: FinalConfidenceScore,
  recommendation_plan: RecommendationPlan,
): EscalationDecision {
  if (final_confidence.can_show_to_operator) {
    return {
      status: 'SHOW_RECOMMENDATION',
      headline:
        recommendation_plan.responseType === 'fire_evacuation'
          ? 'Fire evacuation recommendation ready for operator approval'
          : 'AI threat containment recommendation ready for operator approval',
      operator_message: `${final_confidence.recommendation_confidence}% confidence cleared the 98% threshold. Human approval is still required before any gate action executes.`,
      allowed_operator_actions: ['APPROVED', 'ESCALATED', 'CANCELLED'],
      gate_actions: recommendation_plan.gates,
      classroom_routes: recommendation_plan.classroomRoutes,
      recommendation_plan,
      human_approval_required: true,
    };
  }

  return {
    status: 'AUTO_ESCALATED_TO_FULL_LOCKDOWN',
    headline: 'Low-confidence threat response escalated for human review',
    operator_message: `Confidence is ${final_confidence.recommendation_confidence}%, below the 98% requirement. The system is recommending a full-campus lockdown for operator confirmation instead of a targeted action.`,
    allowed_operator_actions: ['CONFIRM_LOCKDOWN', 'CANCELLED', 'INVESTIGATE_FURTHER'],
    gate_actions: [],
    classroom_routes: recommendation_plan.classroomRoutes,
    recommendation_plan,
    human_approval_required: true,
  };
}

export function apply_operator_decision(
  decision: Exclude<OperatorDecision, 'PENDING'>,
  escalation: EscalationDecision,
): OperatorActionResult {
  if (decision === 'CANCELLED') {
    return {
      executed: false,
      resulting_mode: 'normal',
      gates_to_lock: [],
      gates_to_keep_open: [],
      gates_to_open: [],
      audit_entry: 'Operator cancelled the recommendation before any automated gate action was executed.',
    };
  }

  if (decision === 'INVESTIGATE_FURTHER') {
    return {
      executed: false,
      resulting_mode: 'normal',
      gates_to_lock: [],
      gates_to_keep_open: [],
      gates_to_open: [],
      audit_entry: 'Operator paused execution and requested further investigation.',
    };
  }

  if (escalation.status === 'AUTO_ESCALATED_TO_FULL_LOCKDOWN' || decision === 'ESCALATED' || decision === 'CONFIRM_LOCKDOWN') {
    return {
      executed: true,
      resulting_mode: 'lockdown',
      gates_to_lock: ['ALL_GATES'],
      gates_to_keep_open: [],
      gates_to_open: [],
      audit_entry: 'Operator confirmed a full-campus lockdown after the AI recommendation failed the 98% confidence threshold.',
    };
  }

  if (escalation.recommendation_plan.responseType === 'fire_evacuation') {
    return {
      executed: true,
      resulting_mode: 'fire',
      gates_to_lock: [],
      gates_to_keep_open: [],
      gates_to_open: escalation.gate_actions.map((gate) => gate.gateId),
      audit_entry: 'Operator approved the fire evacuation plan, opening gates and publishing classroom-specific routes to projectors.',
    };
  }

  return {
    executed: true,
    resulting_mode: 'targeted-containment',
    gates_to_lock: escalation.gate_actions
      .filter((gate) => gate.instruction === 'LOCK')
      .map((gate) => gate.gateId),
    gates_to_keep_open: escalation.gate_actions
      .filter((gate) => gate.instruction === 'KEEP_OPEN')
      .map((gate) => gate.gateId),
    gates_to_open: [],
    audit_entry: 'Operator approved the targeted containment recommendation and released the guided gate plan.',
  };
}
