// Isolated browser fixtures; retries never contact a delivery provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
async function main() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const width of [2560, 1440, 1024, 768, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(() => {
        localStorage.setItem('barberCoToken', 'fixture');
        localStorage.setItem('barberCoState', JSON.stringify({ user: { id: 'admin', email: 'admin@example.test', name: 'Administrator', role: 'admin' } }));
      });
      const message = 'Your Barber Co appointment on 2026-11-19 at 2:00 PM is cancelled. Reason: Cancelled by staff. Reservation fee: PHP 100.00 verified online. Service payment: online. Cash balance: PHP 0.00.';
      let empty = false;
      let retryCount = 0;
      const notices = () => Array.from({ length: 50 }, (_, i) => ({ _id: `notice-${i}`, message: i === 1 ? `Reference: ${'x'.repeat(180)}` : message, channels: { email: { status: i ? 'accepted' : 'failed' }, sms: { status: 'not-enabled' } } }));
      await context.route('https://fonts.**/**', route => route.abort());
      await context.route('**/api/**', route => {
        const url = new URL(route.request().url()).pathname;
        let data = { services: [], barbers: [], appointments: [], contacts: [], notifications: [] };
        if (url.endsWith('/me')) data = { user: { id: 'admin', email: 'admin@example.test', name: 'Administrator', role: 'admin' } };
        else if (url.endsWith('/settings')) data = { settings: { paymentDetailsConfirmed: true, gcash: { enabled: true }, maya: { enabled: false } } };
        else if (url.endsWith('/admin/notifications')) data = { emailConfigured: true, smsConfigured: false, notifications: empty ? [] : notices() };
        else if (url.endsWith('/admin/notifications/retry')) { retryCount++; data = { message: 'Retry recorded.' }; }
        return route.fulfill({ json: data });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/admin-profile.html`);
      const table = page.locator('.notification-delivery-table');
      await table.locator('tbody tr').first().waitFor();
      assert.equal(await table.locator('tbody tr').count(), 50);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No document overflow');
      const geometry = await table.evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth, height: node.clientHeight, scrollHeight: node.scrollHeight, firstRowHeight: node.querySelector('tbody tr').getBoundingClientRect().height }));
      assert.ok(geometry.scrollWidth <= geometry.width + 1, 'Messages and status columns fit the available width');
      assert.ok(geometry.height <= 560 && geometry.scrollHeight > geometry.height, 'Long history scrolls inside a bounded region');
      assert.ok(geometry.firstRowHeight < (geometry.width > 640 ? 180 : 330), 'No excessively tall rows');
      assert.equal(await table.locator('tbody th').first().textContent(), message);
      for (const cell of await table.locator('tbody tr').first().locator('th, td').all()) {
        assert.ok(await cell.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Cell content is not clipped');
      }
      await table.locator('[data-notification-retry]').first().click();
      assert.equal(retryCount, 1, 'Existing retry handler still works');
      await table.locator('tbody tr').first().waitFor();
      await table.evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 235));
      const out = path.join(root, 'outputs/settings-notification-layout');
      fs.mkdirSync(out, { recursive: true });
      await page.screenshot({ path: path.join(out, `${width}.png`) });
      empty = true;
      await page.reload();
      await page.getByText('No notifications recorded.', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Notification wrapping, columns, bounded scrolling, retry and empty state passed: ${width}px`);
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
