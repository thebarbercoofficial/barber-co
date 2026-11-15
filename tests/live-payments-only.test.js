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
const legacy = mergedSettings({ paymentMode: 'demo', gcash: { enabled: true, accountName: 'Test-era recipient', accountNumber: '09123456789' } });
assert.equal(paymentConfigured(legacy), false, 'unconfirmed test-era recipient must not become live automatically');
const settings = mergedSettings({ paymentMode: 'live', paymentDetailsConfirmed: true, gcash: { enabled: true, accountName: 'Shop', accountNumber: '09123456789' } });
assert.equal(settings.paymentMode, 'live');
assert.equal(paymentConfigured(settings), true);
console.log('Live payments only: no demo fallback, legacy demo setting ignored, unconfigured checkout blocked, real method accepted');

async function browserCheck() {
  const browser = await require('playwright').chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1440]) for (const script of ['booking', 'payment']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<div id="app"></div>');
      await page.evaluate(() => {
        window.BarberCo = {
          state: { services: [], user: { name: 'Test' }, booking: { date: '2100-03-03', time: '14:00' } }, barbers: [],
          nav: () => '', initHeader() {}, byId: () => ({}), peso: () => '', save() {}, toast() {},
          isAuthenticated: () => true, canAccess: () => false,
          loadCatalog: async () => {}, loadSettings: async () => ({ paymentMode: 'live' })
        };
      });
      await page.addScriptTag({ path: require('node:path').resolve(`js/pages/${script}.js`) });
      await page.getByRole('heading', { name: 'Payment method is currently unavailable.' }).waitFor();
      assert.equal(await page.locator('[data-confirm-payment], [data-payment]').count(), 0);
      assert.doesNotMatch(await page.locator('#app').innerText(), /demo|sample receipt/i);
      await page.close();
    }
    console.log('Booking and checkout unavailable states verified on mobile and desktop without demo controls');
  } finally { await browser.close(); }
}
browserCheck().catch(error => { console.error(error); process.exitCode = 1; });
