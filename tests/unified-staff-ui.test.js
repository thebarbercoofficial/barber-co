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
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (route.request().method() === 'POST' && url.pathname === '/api/admin/services') {
          fixtureServices.push(route.request().postDataJSON());
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ service: fixtureServices.at(-1) }) });
        }
        assert.equal(route.request().method(), 'GET', 'Navigation smoke test must not make state-changing requests');
        const data = { user, users: [user], services: fixtureServices, barbers: [{ id: 'fixture-barber', name: 'Fixture Barber', role: 'Barber', status: 'active' }], queue: [], appointments: [], reservations: [], contacts: [], notifications: [], settings: { operatingHours: {}, paymentMode: 'live' }, totals: { customers: 0, bookings: 0, walkins: 0, revenue: 0, waiting: 0 }, daily: [{ date: '2026-11-16', bookings: 0, walkins: 0, revenue: 0 }], barberPerformance: [] };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });

      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const keys = role === 'admin' ? ['dashboard', 'logbook', 'contacts', 'schedule', 'users', 'profile', 'services', 'barbers', 'reports'] : ['logbook', 'contacts', 'schedule'];
      await page.goto(`${base}/admin-${keys[0]}.html`);
      await page.locator('.workspace h1').waitFor();

      for (const key of keys) {
        if (width === 390) await page.locator('[data-staff-toggle]').click();
        const link = page.locator(`.sidebar a[href="admin-${key}.html"]`);
        await link.click();
        await page.waitForURL(`**/admin-${key}.html`);
        await page.locator('.workspace h1').waitFor();
        assert.equal(await page.locator('iframe').count(), 0, 'Admin sections must be standalone, not embedded in one scrolling feed');
        assert.equal(await page.locator('[data-workspace-rail]').count(), 0, 'No extra workspace rail should stretch the page');
        assert.equal(await page.locator('.sidebar a[aria-current="page"]').getAttribute('href'), `admin-${key}.html`);
        assert.equal(await page.locator('.staff-header').count(), 1, 'Each admin section has one shared header');
        const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, workspace: document.querySelector('.workspace').getBoundingClientRect().width, sections: document.querySelectorAll('.workspace').length }));
        assert.ok(layout.width <= layout.viewport + 1, `${key} horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
        assert.equal(layout.sections, 1, `${key} should render one module per page`);
        if (['logbook', 'schedule', 'users', 'services', 'barbers'].includes(key)) {
          const list = page.locator('.queue-list, .record-list').first();
          await list.waitFor();
          const scroll = await list.evaluate(el => {
            el.innerHTML = Array.from({ length: 30 }, () => '<div class="appointment-row" style="height:64px;min-height:64px">Test row</div>').join('');
            return { overflowY: getComputedStyle(el).overflowY, maxHeight: getComputedStyle(el).maxHeight, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
          });
          assert.equal(scroll.overflowY, 'auto', `${key} long records should scroll inside their list`);
          assert.notEqual(scroll.maxHeight, 'none', `${key} list should be capped instead of stretching the entire page`);
          assert.ok(scroll.scrollHeight > scroll.clientHeight, `${key} long records should overflow within that list`);
        }
        assert.deepEqual(errors, [], `${key} script errors`);
      }

      if (role === 'admin') {
        await page.goto(`${base}/admin-workspace.html#reports`);
        await page.waitForURL('**/admin-reports.html');
      }
      await context.close();
      console.log(`${role} ${width}px: standalone admin pages, sidebar routing, contained list scrolling and legacy redirect passed`);
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
