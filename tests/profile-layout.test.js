const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const user = { id: 'profile-layout-fixture', name: 'Profile Test', email: 'profile@example.test', role: 'customer', emailVerified: true, birthDate: '2000-01-01' };
const payloads = {
  '/api/me': { user },
  '/api/catalog': { services: [{ id: 'basic', name: 'Basic Haircut' }], barbers: [] },
  '/api/appointments/mine': { appointments: [{ customer: user.name, serviceId: 'basic', queueNumber: 15, date: '2026-11-03', time: '13:00', total: 250, demoPayment: true, status: 'confirmed' }] },
  '/api/notifications/mine': { notifications: [1, 2].map((id) => ({ message: `Your appointment update ${id}: booking accepted.`, createdAt: '2026-11-02T11:00:00Z' })) }
};
async function main() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (payloads[url.pathname]) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payloads[url.pathname]));
    const file = path.join(root, url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.addInitScript(({ base, user }) => {
      localStorage.setItem('barberCoToken', 'isolated-layout-test');
      localStorage.setItem('barberCoApiBase', base);
      localStorage.setItem('barberCoState', JSON.stringify({ user }));
    }, { base, user });
    await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
    await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
    for (const width of [1860, 1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/user-profile.html`);
      await page.locator('.account-details[open]').waitFor();
      await page.getByText('Demo booking accepted', { exact: true }).waitFor();
      assert.equal(await page.locator('.profile-booking-stack > .profile-head').count(), 1);
      assert.equal(await page.locator('.booking-column .profile-head').count(), 0);
      assert.equal(await page.locator('.upload-box').count(), 0);
      assert.equal(await page.locator('.profile-photo-pencil svg').count(), 1);
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Change profile photo', exact: true }).click();
      assert.equal((await chooser).isMultiple(), false);
      const bounds = await page.evaluate(() => {
        const left = document.querySelector('.booking-column').getBoundingClientRect();
        const right = document.querySelector('.account-column').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, correctOrder: innerWidth > 900 ? left.right <= right.left : left.bottom <= right.top, fits: innerWidth < 1440 || document.documentElement.scrollHeight <= innerHeight, headerClear: Math.min(left.top, right.top) >= document.querySelector('[data-header]').getBoundingClientRect().bottom };
      });
      assert.deepEqual(bounds, { overflow: false, correctOrder: true, fits: true, headerClear: true }, `Profile layout at ${width}px`);
      await page.locator('.account-details > summary').click();
      await page.locator('.account-details > summary').click();
      if (width === 1860) await page.screenshot({ path: path.join(root, '..', 'profile-swapped-layout-test.png') });
    }
    console.log('PASS: bookings left, account right, desktop fit, fixed-header clearance, and mobile stacking at five widths');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
