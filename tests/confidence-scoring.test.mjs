import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({
  appType: 'custom',
  configFile: false,
  root,
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

const { createConfidenceScenario } = await vite.ssrLoadModule('/lib/confidence/demo-scenarios.ts');
const { apply_operator_decision } = await vite.ssrLoadModule('/lib/confidence/escalation-logic.ts');

function scenario(kind) {
  return createConfidenceScenario(kind);
}

test('98%+ confidence - recommendation shown to operator', () => {
  const current = scenario('high-confidence');
  assert.equal(current.finalConfidence.can_show_to_operator, true);
  assert.equal(current.escalation.status, 'SHOW_RECOMMENDATION');
  assert.ok(current.finalConfidence.recommendation_confidence >= 98);
});

test('Below 98% confidence - auto-escalate to full lockdown', () => {
  const current = scenario('low-confidence');
  assert.equal(current.finalConfidence.can_show_to_operator, false);
  assert.equal(current.escalation.status, 'AUTO_ESCALATED_TO_FULL_LOCKDOWN');
  assert.equal(current.finalConfidence.action_if_below_threshold, 'AUTO_ESCALATE_TO_FULL_LOCKDOWN');
});

test('One sensor below threshold - confidence drops', () => {
  const current = scenario('sensor-failure');
  assert.equal(current.sensorFusion.all_thresholds_met, false);
  assert.ok(current.finalConfidence.recommendation_confidence < 98);
});

test('Occupancy verification fails - auto-escalate', () => {
  const current = scenario('occupancy-failure');
  assert.equal(current.occupancy.meets_threshold, false);
  assert.equal(current.escalation.status, 'AUTO_ESCALATED_TO_FULL_LOCKDOWN');
});

test('Safety check fails - confidence is 0%', async () => {
  const { verify_safety_constraints } = await vite.ssrLoadModule('/lib/confidence/safety-constraints.ts');
  const safety = verify_safety_constraints(
    {
      id: 'blocked-zone',
      name: 'Blocked Zone',
      thermalOccupancyCount: 1,
      radarMotionDetected: true,
      badgeOccupancyCount: 1,
      pathClear: false,
      adjacentZonesAccessible: false,
      fireExitsAccessible: false,
      escapeRoutesAvailable: false,
      fireLawCompliant: false,
      emergencyLightsFunctional: false,
    },
    [{ gateId: 'Gate-1', instruction: 'LOCK', reason: 'Block fire exit' }],
  );
  assert.equal(safety.all_safety_checks_pass, false);
  assert.equal(safety.safety_confidence, 0);
});

test('Operator approves recommendation and gates lock', () => {
  const current = scenario('high-confidence');
  const action = apply_operator_decision('APPROVED', current.escalation);
  assert.equal(action.executed, true);
  assert.equal(action.resulting_mode, 'targeted-containment');
  assert.deepEqual(action.gates_to_lock, ['FRONT-DG01', 'FRONT-DG02']);
});

test('Operator cancels recommendation - no gates lock', () => {
  const current = scenario('high-confidence');
  const action = apply_operator_decision('CANCELLED', current.escalation);
  assert.equal(action.executed, false);
  assert.deepEqual(action.gates_to_lock, []);
});

test('Threat moves - recalculate and update recommendation', () => {
  const first = scenario('high-confidence');
  const moved = scenario('moved-threat');
  assert.notEqual(first.threat.location, moved.threat.location);
  assert.notEqual(first.plan.recommendedAction, moved.plan.recommendedAction);
  assert.ok(moved.finalConfidence.recommendation_confidence >= 98);
});

test('False positive weapon detection - escalates to full lockdown', () => {
  const current = scenario('false-positive');
  assert.equal(current.finalConfidence.can_show_to_operator, false);
  assert.equal(current.escalation.status, 'AUTO_ESCALATED_TO_FULL_LOCKDOWN');
});

test('Fire detected - 100% confidence, all gates unlock', () => {
  const current = scenario('fire');
  const action = apply_operator_decision('APPROVED', current.escalation);
  assert.equal(current.finalConfidence.recommendation_confidence, 100);
  assert.equal(action.resulting_mode, 'fire');
  assert.ok(action.gates_to_open.length >= 5);
});
