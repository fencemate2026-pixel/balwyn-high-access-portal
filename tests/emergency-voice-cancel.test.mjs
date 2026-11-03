import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fs = require('fs');
const vm = require('vm');
// TypeScript 7 no longer ships the JS compiler API (transpileModule), so compile with esbuild.
const esbuild = require('esbuild');
const assert = require('node:assert/strict');

// The guard only warms the voice list. It must never wrap speak() or cancel():
// wrapping them used to replace and restart the dashboard's fire warning, which
// cut the sentence off part-way (fixed 28 Sep 2026).
let voiceRequests = 0;
const speak = () => {}, cancel = () => {};
const synth = { speak, cancel, getVoices: () => { voiceRequests += 1; return []; } };
const code = esbuild.transformSync(fs.readFileSync('app/emergency-voice-guard.tsx', 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code;
const mod = {exports: {}};
const sandbox = {module: mod, exports: mod.exports, window: {speechSynthesis: synth}, require: n => n === 'react' ? {useEffect: fn => { fn(); }} : {}};
vm.runInNewContext(code, sandbox);
mod.exports.default();
assert.equal(synth.speak, speak, 'speak() must not be wrapped');
assert.equal(synth.cancel, cancel, 'cancel() must not be wrapped');
assert.equal(voiceRequests, 1, 'the voice list is requested once, early');

// The dashboard's warning loop waits for each sentence to END before repeating,
// and never cancels a sentence part-way.
const dashboard = fs.readFileSync('app/dashboard-client.tsx', 'utf8');
const loop = dashboard.slice(dashboard.indexOf('const speakWarning'), dashboard.indexOf('const voiceStatusText'));
assert.ok(loop.includes('addEventListener("end"'), 'the next warning is scheduled from the end of the previous one');
assert.ok(!/setInterval\(speakWarning/.test(loop), 'no fixed-interval restart that cuts the sentence off');
assert.ok(loop.includes('emergencyVoiceScript('), 'one warning script, the full sentence');
console.log("PASS: guard never intercepts speech; dashboard warning finishes each sentence");
