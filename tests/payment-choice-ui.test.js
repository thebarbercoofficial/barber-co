// Isolated checkout fixture: no production requests, payments, or messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const user = { id: 'payment-user', name: 'Payment Customer', email: 'payment@example.test', role: 'customer', emailVerified: true };
const services = [{ id: 'basic', name: 'Classic Haircut', price: 150, duration: '30 min' }];
const barbers = [{ id: 'alex', name: 'Alex', status: 'active' }];
const settings = { paymentMode: 'live', paymentRevision: 'fixture', bookingFee: 100, gcash: { enabled: true, accountName: 'Shop', accountNumber: '09123456789' }, maya: { enabled: true, accountName: 'Shop', accountNumber: '09123456789' } };
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(({ base, user, services, barbers }) => {
        localStorage.setItem('barberCoApiBase', base);
        localStorage.setItem('barberCoToken', 'fixture');
        localStorage.setItem('barberCoState', JSON.stringify({ user, services, barbers, booking: { serviceId: 'basic', barberId: 'alex', date: '2100-03-03', time: '14:00', holdId: 'fixture', holdExpiresAt: new Date(Date.now() + 600000).toISOString() } }));
      }, { base, user, services, barbers });
      let requests = 0;
      let unavailable = false;
      const submissions = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (['/api/settings', '/api/checkout/validate'].includes(url.pathname)) requests++;
        let data = {};
        if (url.pathname === '/api/settings') data = { settings: unavailable ? { ...settings, gcash: { enabled: false }, maya: { enabled: false } } : settings };
        else if (url.pathname === '/api/me') data = { user };
        else if (url.pathname === '/api/catalog') data = { services, barbers };
        else if (url.pathname === '/api/checkout/validate') data = { valid: true, splitPaymentVersion: 1, bookingPaymentChoices: ['online', 'onsite'] };
        else if (url.pathname === '/api/appointments' && route.request().method() === 'POST') {
          submissions.push(route.request().postDataJSON());
          data = { appointment: { queueNumber: 1 } };
        }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/payment.html`);
      await page.locator('.payment-layout').waitFor().catch(async error => { console.error(errors, await page.locator('body').innerText()); throw error; });
      assert.equal(await page.locator('[name="service-payment"]').count(), 0);
      assert.equal(await page.locator('[data-payment]').count(), 2);
      const before = requests;
      await page.locator('[name="booking-payment"][value="onsite"]').check();
      assert.equal(await page.locator('[data-online-payment], [data-online-instructions], [data-payment-proof], [data-payment]').count(), 0);
      assert.equal(requests, before, 'Changing payment choice does not wait for a server request');
      assert.match(await page.locator('.form-card').innerText(), /Due at shop\s+PHP 250.00/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('[name="booking-payment"][value="online"]').check();
      assert.match(await page.locator('[data-online-instructions]').innerText(), /Transfer amount\s+PHP 250.00/);
      assert.equal(await page.locator('[data-onsite-payment]').count(), 0);
      await page.evaluate(() => { BookingPolicy.confirm = async () => true; });
      await page.locator('[data-confirm-payment]').click();
      assert.equal(submissions.length, 0, 'Online payment requires a receipt');
      await page.locator('[data-payment-proof]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
      await page.locator('[data-confirm-payment]').click();
      await page.waitForFunction(() => document.querySelector('[data-toast]')?.innerText.includes('Booking submitted'));
      assert.equal(submissions[0].bookingPaymentMethod, 'online');
      assert.equal(submissions[0].servicePaymentMethod, 'online');
      assert.match(submissions[0].paymentProof, /^data:image\/png;base64,/);
      // A fresh page restores the fixture booking after successful submission.
      await page.goto(`${base}/payment.html`);
      await page.locator('.payment-layout').waitFor();
      await page.evaluate(() => { BookingPolicy.confirm = async () => true; });
      await page.locator('[name="booking-payment"][value="onsite"]').check();
      await page.locator('[data-confirm-payment]').click();
      await page.waitForFunction(() => document.querySelector('[data-toast]')?.innerText.includes('Booking submitted'));
      assert.equal(submissions[1].bookingPaymentMethod, 'onsite');
      assert.equal(submissions[1].servicePaymentMethod, 'cash');
      assert.equal(submissions[1].paymentMethod, 'On-site');
      assert.equal(submissions[1].paymentProof, '');
      unavailable = true;
      await page.goto(`${base}/payment.html`);
      await page.locator('.payment-layout').waitFor();
      assert.equal(await page.locator('[name="booking-payment"][value="online"]').isDisabled(), true);
      assert.equal(await page.locator('[name="booking-payment"][value="onsite"]').isChecked(), true);
      assert.equal(await page.locator('[data-payment-proof], [data-payment]').count(), 0);
      assert.match(await page.locator('.form-card').innerText(), /Online payment is currently unavailable/);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Single payment choice, immediate wallet removal and both submission payloads passed at ${width}px`);
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
