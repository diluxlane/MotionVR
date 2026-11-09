const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the production quaternion routines without needing a browser DOM.
const code = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const from = code.indexOf('function qMultiply(');
const to = code.indexOf('function handleOrientation(');
assert.ok(from >= 0 && to > from);
const ctx = vm.createContext({ Math, screen: { orientation: { angle: 90 } }, window: {} });
vm.runInContext(code.slice(from, to) + '\nthis.math={qMultiply,qInverse,qNormalize,qFromEuler,qSlerp,sensorQuaternion};', ctx);
const { qMultiply, qInverse, qFromEuler, sensorQuaternion, qSlerp } = ctx.math;
function sameOrientation(a, b, tolerance = 1e-8) {
  const dot = Math.abs(a.reduce((sum, v, i) => sum + v * b[i], 0));
  assert.ok(1 - dot < tolerance, `quaternion orientations differ: dot=${dot}`);
}
test('recentered relative orientation matches local yaw on a tilted headset', () => {
  const q0 = sensorQuaternion(35, 25, 15);
  const localYaw = qFromEuler(0, Math.PI / 3, 0);
  const q1 = qMultiply(q0, localYaw);
  sameOrientation(qMultiply(qInverse(q0), q1), localYaw);
});
test('same initial and current orientation yields identity', () => {
  const q = sensorQuaternion(315, -15, 60);
  sameOrientation(qMultiply(qInverse(q), q), [0, 0, 0, 1]);
});
test('quaternion smoothing stays finite for identical poses', () => {
  const q = sensorQuaternion(15, 18, -3);
  const smoothed = qSlerp(q, q, 0.3);
  assert.ok(smoothed.every(Number.isFinite));
  sameOrientation(smoothed, q);
});
test('heading wraparound 355 to 5 degrees is 10 degrees, not 350', () => {
  const samples = [355, 359, 1, 5];
  const headings = samples.map(a => a * Math.PI / 180);
  const ss = headings.reduce((t,a) => t + Math.sin(a),0);
  const cc = headings.reduce((t,a) => t + Math.cos(a),0);
  const center = Math.atan2(ss,cc) * 180 / Math.PI;
  const offsets = samples.map(angle => ((angle - center + 540)%360)-180);
  const range = Math.max(...offsets)-Math.min(...offsets);
  assert.ok(range>=9 && range<=11);
});
