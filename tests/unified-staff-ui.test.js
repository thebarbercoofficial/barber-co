const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const role of ['admin', 'moderator']) for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const fixtureServices = [];
      const user = { id: 'fixture-staff', name: 'Fixture Staff', role, email: 'fixture@example.test' };
      await context.addInitScript(({ base, user }) => {
        localStorage.setItem('barberCoApiBase', base);
        localStorage.setItem('barberCoToken', 'isolated-token');
        localStorage.setItem('barberCoState', JSON.stringify({ user, services: [], barbers: [] }));
      }, { base, user });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (route.request().method() === 'POST' && url.pathname === '/api/admin/services') {
          fixtureServices.push(route.request().postDataJSON());
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ service: fixtureServices.at(-1) }) });
        }
        assert.equal(route.request().method(), 'GET', 'Only isolated service creation is allowed; never send SMS');
        const data = { user, users: [user], services: fixtureServices, barbers: [{ id: 'fixture-barber', name: 'Fixture Barber', role: 'Barber', status: 'active' }], queue: [], appointments: [], reservations: [], contacts: [], notifications: [], settings: { operatingHours: {}, paymentMode: 'live' }, totals: { customers: 0, bookings: 0, walkins: 0, revenue: 0, waiting: 0 }, daily: [{ date: '2026-11-16', bookings: 0, walkins: 0, revenue: 0 }], barberPerformance: [] };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/admin-workspace.html`);
      await page.locator('[data-alert-bell]').waitFor();
      assert.equal(await page.locator('.sidebar').count(), 1);
      const keys = role === 'admin' ? ['dashboard', 'logbook', 'contacts', 'schedule', 'users', 'profile', 'services', 'barbers', 'reports'] : ['logbook', 'contacts', 'schedule'];
      assert.equal(await page.locator('iframe').count(), keys.length);
      for (const key of keys) {
        if (width === 390) await page.locator('[data-staff-toggle]').click();
        await page.locator(`.sidebar a[href="admin-workspace.html#${key}"]`).click();
        const frame = page.frameLocator(`[data-staff-section="${key}"]`);
        await frame.locator('.workspace h1').waitFor();
        await page.waitForFunction(key => document.getElementById(key).hasAttribute('data-loaded'), key);
        await page.waitForTimeout(450);
        await page.evaluate(key => document.getElementById(key).scrollIntoView({ block: 'start', behavior: 'instant' }), key);
        await page.waitForTimeout(100);
        assert.equal(await page.locator(`.sidebar a[href$="#${key}"]`).getAttribute('aria-current'), 'location', `Scrollspy ${key}`);
        assert.equal(await frame.locator('.staff-header').isVisible(), false, 'No duplicate headers');
        assert.equal(await frame.locator('[data-alert-bell]').count(), 0, 'One notification bell only');
        const layout = await frame.locator('.workspace').evaluate(el => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, bottom: el.getBoundingClientRect().bottom, height: innerHeight }));
        assert.ok(layout.width <= layout.viewport + 1, `${key} horizontal overflow at ${width}: ${JSON.stringify(layout)}`);
        assert.ok(layout.bottom <= layout.height + 3, `${key} must fit its auto-height module: ${JSON.stringify(layout)}`);
        if (key === 'barbers') {
          await frame.locator('[data-status$=":on-leave"]').click();
          await frame.locator('dialog[open]').waitFor();
          const dialog = await frame.locator('dialog[open]').boundingBox();
          assert.ok(dialog.y >= 64 && dialog.y + dialog.height <= 901, `Dialog must stay in the outer viewport: ${JSON.stringify(dialog)}`);
          await frame.locator('dialog [data-close]').click();
        }
        if (key === 'services') {
          await frame.locator('[name="name"]').fill('Isolated service');
          await frame.locator('[name="price"]').fill('150');
          await frame.locator('[name="duration"]').fill('30 min');
          await frame.locator('[name="detail"]').fill('Fixture only');
          await frame.locator('[data-service-form] [type="submit"]').click();
          await frame.locator('[data-service-rows]').filter({ hasText: 'Isolated service' }).waitFor();
          assert.equal(fixtureServices.length, 1);
        }
        if (key === 'reports') {
          await frame.locator('body').evaluate(() => { window.print = () => { window.fixturePrintCalled = true; }; });
          await frame.locator('[data-print-report]').click();
          assert.equal(await frame.locator('body').evaluate(() => window.fixturePrintCalled), true);
          await frame.locator('[data-report-close]').click();
        }
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForTimeout(100);
      assert.equal(await page.locator(`.sidebar a[href$="#${keys[0]}"]`).getAttribute('aria-current'), 'location');
      assert.deepEqual(errors, []);
      fs.mkdirSync(path.join(root, 'outputs/unified-staff'), { recursive: true });
      await page.screenshot({ path: path.join(root, `outputs/unified-staff/${role}-${width}.png`) });
      const last = keys.at(-1);
      await page.goto(`${base}/admin-workspace.html#${last}`);
      await page.frameLocator(`[data-staff-section="${last}"]`).locator('.workspace h1').waitFor();
      await page.waitForTimeout(600);
      const deepLinkTop = await page.locator(`#${last}`).evaluate(el => el.getBoundingClientRect().top);
      assert.ok(Math.abs(deepLinkTop - 80) < 5, `Deep links must land below the header: ${deepLinkTop}`);
      await page.reload();
      await page.frameLocator(`[data-staff-section="${last}"]`).locator('.workspace h1').waitFor();
      await page.waitForTimeout(600);
      assert.equal(await page.locator(`.sidebar a[href$="#${last}"]`).getAttribute('aria-current'), 'location', 'Reload restores the current section');
      await context.close();
      console.log(`${role} ${width}px: continuous sections, navigation, scrollspy, auto-height, single bell and no script errors passed`);
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
