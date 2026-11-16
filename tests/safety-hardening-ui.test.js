const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
async function main() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const user = { id: 'user', role: 'customer', name: 'Test Customer', email: 'customer@example.test', emailVerified: true, phoneVerified: true, smsConsent: true };
      const writes = [];
      let valid = true;
      await context.addInitScript(({ base, user }) => {
        localStorage.setItem('barberCoToken', 'isolated-test'); localStorage.setItem('barberCoApiBase', base);
        localStorage.setItem('barberCoState', JSON.stringify({ user, services: [{ id: 'cut', name: 'Haircut', price: 150, duration: '30 min' }], barbers: [{ id: 'alex', name: 'Alex' }], booking: { date: '2099-12-01', time: '14:00', serviceId: 'cut', barberId: 'alex', holdId: 'hold', holdExpiresAt: new Date(Date.now() + 60000).toISOString(), total: 250, bookingFee: 100 } }));
      }, { base, user });
      await context.route('https://**', route => route.abort());
      await context.route('**/api/**', async route => {
        const req = route.request(); const endpoint = new URL(req.url()).pathname;
        let data = {};
        if (endpoint.endsWith('/checkout/validate')) { if (!valid) return route.fulfill({ status: 409, json: { error: 'Checkout expired. Do not pay.' } }); data = { valid: true }; }
        else if (endpoint.endsWith('/settings')) data = { settings: { paymentMode: 'live', paymentRevision: 'revision', gcash: { enabled: true, accountName: 'Shop', accountNumber: '09123456789' }, maya: { enabled: false } } };
        else if (endpoint.endsWith('/catalog')) data = { services: [{ id: 'cut', name: 'Haircut', price: 150 }], barbers: [{ id: 'alex', name: 'Alex' }] };
        else if (endpoint.endsWith('/me')) { if (req.method() === 'PATCH') { writes.push(req.postDataJSON()); Object.assign(user, req.postDataJSON()); } data = { user }; }
        else if (endpoint.endsWith('/appointments/mine')) data = { appointments: [] };
        else if (endpoint.endsWith('/notifications/mine')) data = { notifications: [] };
        else if (endpoint.endsWith('/payments/recovery')) { writes.push(req.postDataJSON()); data = { message: 'Proof saved. Do not pay again.', reference: 'case-123' }; }
        await route.fulfill({ json: data });
      });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/payment.html`);
      await page.getByText('09123456789', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => BarberCo.byId([{ id: 'wrong', name: 'Wrong service' }], 'deleted').name), 'Unavailable item');
      await page.evaluate(() => { BarberCo.state.booking.holdExpiresAt = new Date(0).toISOString(); });
      await page.getByRole('button', { name: 'Checkout unavailable', exact: true }).waitFor();
      assert.equal(await page.getByText('09123456789', { exact: true }).count(), 0);
      await page.getByText('Already paid but could not submit?', { exact: true }).click();
      await page.locator('[name="reference"]').fill('wallet-123');
      await page.locator('[name="proof"]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: Buffer.from('isolated-file') });
      await page.getByRole('button', { name: 'Send proof to staff' }).click();
      await page.locator('[data-recovery-status]').getByText('Proof saved. Do not pay again. Case: case-123').waitFor();
      assert.ok(writes.some(body => body.reference === 'wallet-123' && body.paymentProof.startsWith('data:image/png;base64,')));
      valid = false; await page.reload();
      await page.getByRole('heading', { name: 'Checkout unavailable' }).waitFor();
      assert.equal(await page.getByText('09123456789', { exact: true }).count(), 0);
      await page.goto(`${base}/user-profile.html`);
      await page.locator('[data-sms-consent]').waitFor({ state: 'attached' });
      await page.locator('[data-sms-consent]').evaluate(input => { input.checked = false; });
      await page.locator('[data-profile]').evaluate(form => form.requestSubmit(form.querySelector('[type="submit"]')));
      await page.waitForFunction(() => BarberCo.state.user.smsConsent === false);
      assert.ok(writes.some(body => body.smsConsent === false), 'Normal profile saving must persist opt-out without OTP');
      assert.deepEqual(errors, []);
      console.log(`Checkout expiry/initial validation, receipt recovery, missing catalog identity and profile SMS opt-out passed at ${width}px`);
      await context.close();
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
