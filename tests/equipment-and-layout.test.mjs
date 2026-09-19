import test from 'node:test';
import assert from 'node:assert/strict';
import layer from '../data/balwyn_site.json' with {type:'json'};
import { DEFAULT_EQUIPMENT,validateEquipment,exportPiConfiguration } from '../lib/equipment-config.ts';
import { GATES } from '../lib/portal-model.ts';
import { routeToMuster } from '../lib/site-layout.ts';
import { findHelp } from '../lib/software-help.ts';
test('equipment accepts six-second profiles but rejects duplicate channels and invalid GPIO',()=>{
 const valid={...structuredClone(DEFAULT_EQUIPMENT),gateMap:{'TF-ENTRY':1,'SIDE-ENTRY':4}};valid.pi.pulseMs=6000;
 assert.equal(validateEquipment(valid,GATES).pi.pulseMs,6000);
 for(const mutate of [c=>c.pi.pulseMs=10001,c=>c.pi.pins=[17,17,22,23],c=>c.gateMap={'TF-ENTRY':1,'SIDE-ENTRY':1},c=>c.gateMap={'UNKNOWN':1},c=>c.voiceVolume=2,c=>c.refreshSeconds=1]){const bad=structuredClone(valid);mutate(bad);assert.throws(()=>validateEquipment(bad,GATES))}
 assert.match(exportPiConfiguration(valid),/DOOR_PULSE_MS=6000/);
 assert.doesNotMatch(exportPiConfiguration(valid),/DOOR_API_TOKEN=/);
});
test('all source exits have a recorded path, blocked shared path has no invented alternative',()=>{
 assert.equal(layer.exits.length,22);assert.equal(layer.nodes.filter(n=>n.kind==='muster').length,2);
 for(const id of layer.exits)assert.ok(routeToMuster(layer,id));
 assert.ok(Math.abs(routeToMuster(layer,'EXIT_01').distance-221.9)<0.001);
 assert.equal(routeToMuster(layer,'EXIT_01',['PINCH']),null);
 assert.equal(routeToMuster(layer,'EXIT_15',['PINCH']).muster,'MUSTER_EAST');
 assert.equal(routeToMuster(layer,'EXIT_15',['MUSTER_EAST']),null);
 assert.equal(routeToMuster(layer,'NOT_A_NODE'),null);
});
test('software knowledge includes current pulse guidance and imported school layer',()=>{
 assert.ok(findHelp('six-second pulse timeout').some(p=>p.source==='SOFTWARE_HELP.md'&&p.text.includes('15 seconds')));
 assert.ok(findHelp('school site layer PINCH').some(p=>p.text.includes('22 marked')));
 assert.equal(findHelp('xxyyzznonsense').length,0);
});
