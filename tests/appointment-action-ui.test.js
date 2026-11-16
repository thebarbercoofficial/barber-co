// Isolated browser and intercepted API: no production records or SMS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const user = { id: 'admin', role: 'admin', name: 'Owner', email: 'owner@example.test' };
      let booking = { id: 'booking', mongoId: 'booking', customer: 'Action Customer', status: 'pending', date: '2099-01-05', time: '14:00', serviceId: 'cut', barberId: 'barber', total: 250, hasPaymentProof: true };
      let reads = 0;
      let releaseStale;
      await context.addInitScript(user => {
        window.setInterval = () => 0;
        localStorage.setItem('barberCoState', JSON.stringify({ user }));
        localStorage.setItem('barberCoToken', 'isolated-token');
        localStorage.setItem('barberCoApiBase', location.origin);
      }, user);
      await context.route('https://**', route => route.abort());
      await context.route('**/api/**', async route => {
        const endpoint = new URL(route.request().url()).pathname;
        if (route.request().method() === 'PATCH') {
          const status = route.request().postDataJSON().status;
          booking = { ...booking, status };
          return route.fulfill({ json: { appointment: booking } });
        }
        if (endpoint === '/api/admin/appointments') {
          reads++;
          const snapshot = structuredClone(booking);
          if (reads === 2) await new Promise(resolve => { releaseStale = resolve; });
          return route.fulfill({ json: { appointments: [snapshot] } });
        }
        const data = endpoint.endsWith('/me') ? { user }
          : endpoint.endsWith('/catalog') ? { services: [{ id: 'cut', name: 'Haircut' }], barbers: [{ id: 'barber', name: 'Barber', status: 'active' }] }
          : { appointments: [], notifications: [] };
        await route.fulfill({ json: data });
      });
      const page = await context.newPage();
      page.on('pageerror', error => console.error(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/admin-schedule.html`);
      await page.getByRole('button', { name: 'Verify', exact: true }).waitFor({ timeout: 5000 }).catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
      const verifySize = await page.locator('.appointment-action').evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight }));
      await page.evaluate(() => { void refreshAppointments(); });
      await page.waitForFunction(() => document.querySelector('[data-appointment-panel]'));
      while (!releaseStale) await new Promise(resolve => setTimeout(resolve, 10));
      await page.getByRole('button', { name: 'Verify', exact: true }).click();
      await page.getByRole('button', { name: 'Finish', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Finish', exact: true }).isEnabled(), false);
      assert.equal(reads, 2, 'Saved mutation must not require another list request');
      releaseStale();
      await page.waitForTimeout(50);
      assert.equal(await page.getByRole('button', { name: 'Verify', exact: true }).count(), 0, 'An older poll cannot undo the saved status');
      assert.deepEqual(await page.locator('.appointment-action').evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight })), verifySize, 'Verify and Finish have equal dimensions');
      booking = { ...booking, attendanceStatus: 'serving', servicePaid: true };
      await page.evaluate(() => refreshAppointments());
      await page.getByRole('button', { name: 'Finish', exact: true }).click();
      await page.locator('.appointment-record .status-pill').filter({ hasText: 'Completed' }).waitFor();
      assert.equal(reads, 3, 'Completion is displayed from the server response');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(root, `outputs/appointment-actions-${width}.png`), fullPage: true });
      await context.close();
    }
    console.log('Verify/Finish server-confirmed updates, stale-poll protection, equal button dimensions and responsive layout passed at 1440/390px; no SMS.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
