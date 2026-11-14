const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let tick;
let unref = false;
let cleared = false;
const timer = { unref() { unref = true; } };
const context = {
  require: name => name === './api' ? {} : require(name), module: { exports: {} },
  setInterval(callback, interval) { tick = callback; assert.equal(interval, 15000); return timer; },
  clearInterval(value) { assert.equal(value, timer); cleared = true; }, console
};
vm.runInNewContext(fs.readFileSync('server.js', 'utf8'), context);
async function main() {
  let calls = 0;
  let finish;
  const stop = context.module.exports.startRescheduleCleanup(() => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  });
  assert.equal(calls, 1, 'Catch up on startup without a website read');
  assert.equal(unref, true);
  await tick();
  assert.equal(calls, 1, 'Do not overlap an unfinished sweep');
  finish();
  await new Promise(resolve => setImmediate(resolve));
  const next = tick();
  assert.equal(calls, 2);
  finish();
  await next;
  stop();
  assert.equal(cleared, true);
  console.log('Server startup/periodic expiration, unref, non-overlap and shutdown cleanup passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
