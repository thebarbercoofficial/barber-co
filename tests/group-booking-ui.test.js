// Isolated page fixtures: no shared state, production server, or real payments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const previews = path.join(root, 'outputs/group-booking-preview');
async function captureLayout(page, name, width) {
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => {
    const outside = [...document.querySelectorAll('#app input, #app select, #app textarea, #app button, #app strong, #app label, #app fieldset')].filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width && (rect.left < -1 || rect.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1);
    }).map(node => `${node.tagName} ${node.getAttribute('name') || node.textContent.slice(0, 60)}`);
    return { document: document.documentElement.scrollWidth > innerWidth + 1, outside };
  });
  await page.screenshot({ path: path.join(previews, `${name}-${width}.png`), fullPage: true, animations: 'disabled' });
  assert.deepEqual(overflow, { document: false, outside: [] }, `${name} ${width}px overflow`);
}
async function main() {
  fs.mkdirSync(previews, { recursive: true });
  const server = http.createServer((req, res) => {
    if (req.url === '/css/styles.css') {
      res.setHeader('Content-Type', 'text/css');
      return res.end(fs.readFileSync(path.join(root, 'css/styles.css')));
    }
    res.setHeader('Content-Type', 'text/javascript');
    res.end(fs.readFileSync(path.join(root, 'js/pages', req.url.includes('payment') ? 'payment.js' : 'booking.js')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await page.route('**/*', route => {
        if (new URL(route.request().url()).origin !== `http://127.0.0.1:${server.address().port}`) return route.abort();
        return route.fallback();
      });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/payment.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/styles.css"></head><body class="transaction-page"><div id="app"></div></body></html>' }));
      await page.goto(`http://127.0.0.1:${server.address().port}/payment.html`);
      await page.addInitScript(() => {
        window.calls = [];
        window.confirmed = 0;
        window.BookingPolicy = { terms() {}, async confirm() { window.confirmed++; return false; } };
        const service = { id: 'cut', name: 'Cut', price: 200, duration: '1 hr 30 min' };
        const settings = { paymentMode: 'demo', bookingFee: 100, demoMethods: { gcash: { enabled: true, accountNumber: 'demo' } }, operatingHours: Object.fromEntries(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(day => [day, { open: '13:00', close: '18:00' }])) };
        window.BarberCo = {
          state: JSON.parse(sessionStorage.getItem('fixture') || 'null') || { services: [service], selectedServiceId: 'cut', user: { name: 'Account Name' } },
          barbers: [{ id: 'barber', name: 'Barber' }], isAuthenticated: () => true, canAccess: () => false,
          nav: () => '', initHeader() {}, byId: (items, id) => items.find(item => item.id === id), peso: value => `PHP ${value}`,
          serviceOptions: () => '<option value="cut">Cut</option>', barberOptions: () => '<option value="barber">Barber</option>', save() { sessionStorage.setItem('fixture', JSON.stringify(window.BarberCo.state)); }, toast(message) { window.lastToast = message; },
          async loadCatalog() {}, async loadSettings() { return settings; },
          async api(url, options) {
            window.calls.push({ url, body: options && JSON.parse(options.body) });
            if (url === '/appointments') return { appointment: { queueNumber: 1 } };
            if (options) return { hold: { id: 'quote', partySize: 2, partyMembers: ['Account Name', '<Guest>'], total: 475, bookingFee: 75, durationMinutes: 180, unitDurationMinutes: 90 } };
            return { unavailableBarberIds: [] };
          }
        };
      });
      await page.reload();
      await page.addScriptTag({ url: `http://127.0.0.1:${server.address().port}/booking.js` });
      await page.locator('[name="partySize"]').fill('2');
      assert.deepEqual(await page.evaluate(() => ['15 min', '1 hr', '1 hr 30 min'].map(durationMinutes)), [30, 60, 90]);
      assert.equal(await page.locator('[data-member]').first().inputValue(), 'Account Name');
      await page.locator('[data-member]').nth(1).fill('<Guest>');
      await page.locator('[name="partySize"]').fill('1');
      await page.locator('[name="partySize"]').fill('2');
      assert.equal(await page.locator('[data-member]').nth(1).inputValue(), '<Guest>');
      await page.locator('[name="date"]').fill('2099-12-21');
      await page.locator('[name="date"]').dispatchEvent('change');
      await page.waitForFunction(() => calls.some(call => call.url.includes('partySize=2')));
      assert.equal(await page.locator('[name="time"] option[value="15:00"]').count(), 1);
      assert.equal(await page.locator('[name="time"] option[value="15:30"]').count(), 0);
      assert.match(await page.locator('.summary-list').innerText(), /PHP 500/);
      assert.match(await page.locator('.summary-list').innerText(), /180 minutes/);
      await page.locator('[name="time"]').selectOption('13:00');
      await captureLayout(page, 'group-form', width);
      await page.getByRole('button', { name: 'Proceed to payment' }).click();
      await page.waitForURL('**/payment.html');
      await page.addScriptTag({ url: `http://127.0.0.1:${server.address().port}/payment.js` });
      await page.locator('[data-confirm-payment]').waitFor();
      assert.deepEqual(await page.evaluate(() => ['15 min', '1 hr', '1 hr 30 min'].map(unitDuration)), [30, 60, 90]);
      const summary = await page.locator('.form-card .summary-list').innerText();
      assert.match(summary, /<Guest>/);
      assert.match(summary, /PHP 475/);
      assert.match(summary, /PHP 75/);
      assert.match(summary, /180 minutes/);
      assert.equal(await page.locator('.summary-list Guest').count(), 0);
      assert.match(await page.locator('.form-card').innerText(), /Competing requests may be rejected/);
      await captureLayout(page, 'group-checkout', width);
      await page.locator('[data-payment-proof]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
      await page.locator('[data-confirm-payment]').click();
      assert.equal(await page.evaluate(() => confirmed), 1);
      assert.equal(await page.locator('[data-confirm-payment]').isEnabled(), true);
      assert.equal(await page.evaluate(() => calls.length), 0);
      await page.evaluate(() => { BookingPolicy.confirm = async () => true; });
      await page.locator('[data-confirm-payment]').click();
      await page.waitForFunction(() => calls.some(call => call.url === '/appointments'));
      const submitted = await page.evaluate(() => calls.find(call => call.url === '/appointments').body);
      assert.equal(submitted.partySize, 2);
      assert.deepEqual(submitted.partyMembers, ['Account Name', '<Guest>']);
      assert.equal(submitted.total, 475);
      assert.equal(submitted.nonRefundableAccepted, true);
      assert.deepEqual(errors, []);
      await page.addScriptTag({ path: path.join(root, 'js/booking-policy.js') });
      await page.evaluate(() => { window.policyResult = null; BookingPolicy.confirm().then(value => { window.policyResult = value; }); });
      const dialog = page.getByRole('dialog', { name: 'Confirm your booking' });
      assert.match(await dialog.innerText(), /Submission does not guarantee your time/);
      assert.match(await dialog.innerText(), /Staff approval is first-wins/);
      assert.match(await dialog.innerText(), /whole group/);
      await dialog.getByRole('button', { name: 'Confirm and submit' }).click();
      assert.equal(await page.evaluate(() => policyResult), null);
      await dialog.getByRole('link').click();
      const terms = page.getByRole('dialog', { name: 'Booking terms and policy', exact: true });
      assert.match(await terms.innerText(), /Pending requests and payment drafts do not reserve capacity/);
      assert.match(await terms.innerText(), /one booking fee for the whole group/);
      await page.keyboard.press('Escape');
      await dialog.locator('input').check();
      await dialog.getByRole('button', { name: 'Confirm and submit' }).click();
      await page.waitForFunction(() => policyResult === true);
      const source = fs.readFileSync(path.join(root, 'js/pages/admin-dashboard.js'), 'utf8');
      const rows = source.slice(source.indexOf('function compactGroupDetails'), source.indexOf('async function render'));
      const markup = await page.evaluate(code => {
        const safeText = value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        const peso = value => `PHP ${value}`;
        const icon = () => '';
        return eval(`${code}; onlineBookingRows([{ customer: 'Group', status: 'pending', partySize: 2, partyMembers: ['Account', '<Guest>'], durationMinutes: 180, unitDurationMinutes: 90, total: 475 }]);`);
      }, rows);
      await page.locator('#app').evaluate((node, html) => { node.innerHTML = html; }, markup);
      assert.match(await page.locator('#app').innerText(), /180 minutes/);
      assert.match(await page.locator('#app').innerText(), /<Guest>/);
      assert.match(await page.locator('#app').innerText(), /whole group/);
      assert.match(await page.locator('#app').innerText(), /no capacity reserved/);
      assert.equal(await page.locator('#app Guest').count(), 0);
      await page.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().then(() => console.log('Group booking browser checks passed.')).catch(error => { console.error(error); process.exitCode = 1; });
