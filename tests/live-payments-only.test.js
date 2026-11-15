const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const localRequire = require('node:module').createRequire(require('node:path').resolve('api/index.js'));
const context = { require: localRequire, module: { exports: {} }, process: { env: { ALLOW_DEMO_PAYMENTS: 'true' } }, console };
vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\nmodule.exports.check = { mergedSettings, paymentConfigured };`, context);
const { mergedSettings, paymentConfigured } = context.module.exports.check;
for (const input of [{}, { paymentMode: 'demo' }, { paymentMode: 'demo', gcash: { enabled: false }, maya: { enabled: false } }]) {
  const settings = mergedSettings(input);
  assert.equal(settings.paymentMode, 'live');
  assert.equal(settings.allowDemoPayments, false);
  assert.equal(settings.demoMethods, undefined);
  assert.equal(paymentConfigured(settings), false);
}
const settings = mergedSettings({ paymentMode: 'demo', gcash: { enabled: true, accountName: 'Shop', accountNumber: '09123456789' } });
assert.equal(settings.paymentMode, 'live');
assert.equal(paymentConfigured(settings), true);
console.log('Live payments only: no demo fallback, legacy demo setting ignored, unconfigured checkout blocked, real method accepted');
