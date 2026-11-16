// Isolated browser notifications; no production writes, texts or desktop capture.
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
    for (const role of ['customer', 'admin', 'moderator']) for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      let bookings = [{ id: 'one', customer: 'Ada <img src=x onerror=alert(1)>', status: 'pending', date: '2100-03-03', time: '14:00', createdAt: new Date().toISOString() }];
      let contacts = [];
      const notifications = [];
      let failure = false;
      await context.addInitScript(({ role }) => {
        localStorage.setItem('barberCoToken', 'isolated-token');
        localStorage.setItem('barberCoState', JSON.stringify({ user: { id: role, name: 'QA', email: 'qa@example.test', role } }));
        window.tones = 0;
        window.AudioContext = class {
          state = 'running'; currentTime = 0; destination = {};
          async resume() { this.state = 'running'; }
          createOscillator() { return { frequency: {}, connect() { return { connect() {} }; }, start() { window.tones++; }, stop() {} }; }
          createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
        };
      }, { role });
      await context.route('https://fonts.**/**', route => route.abort());
      await context.route('**/api/**', route => {
        const endpoint = new URL(route.request().url()).pathname;
        if (failure && endpoint.endsWith('/notifications/mine')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Offline"}' });
        if (role === 'customer' && endpoint.endsWith('/notifications/mine') && bookings[0].status !== 'pending' && !notifications.some(item => item._id === bookings[0].status)) notifications.push({ _id: bookings[0].status, message: `Your appointment is ${bookings[0].status}. ${bookings[0].staffNote || ''}`, createdAt: new Date().toISOString() });
        const data = endpoint.endsWith('/me') ? { user: { id: role, name: 'QA', role, email: 'qa@example.test' } } : endpoint.endsWith('/catalog') ? { services: [], barbers: [] } : endpoint.endsWith('/appointment-events') || endpoint.endsWith('/appointments') || endpoint.endsWith('/appointments/mine') ? { appointments: bookings } : endpoint.endsWith('/contacts') ? { contacts } : endpoint.includes('notifications') ? { notifications } : endpoint.endsWith('/analytics') ? { totals: {}, daily: [], barberPerformance: [] } : endpoint.endsWith('/queue') ? { queue: [] } : { settings: {} };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const base = `http://127.0.0.1:${server.address().port}`;
      await page.goto(`${base}/${role === 'customer' ? 'index.html' : 'admin-schedule.html'}`);
      await page.locator('[data-alert-bell] svg').waitFor();
      if (role === 'customer') {
        assert.equal(await page.locator('.customer-header-actions [data-alert-bell]').count(), 1);
        if (width === 1440) {
          const bell = await page.locator('[data-alert-bell]').boundingBox();
          const nav = await page.locator('.site-nav').boundingBox();
          assert.ok(bell.x >= nav.x + nav.width, 'Bell belongs to the right side of navigation');
        }
      }
      await page.waitForFunction(expected => Object.values(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('barberCoAlerts:'))) || '{}').baselines || {}).length === expected, role === 'customer' ? 1 : 2);
      assert.equal(await page.locator('[data-alert-popup]').isVisible(), false, 'First load is quiet');
      await page.locator('[data-alert-bell]').click();
      await page.locator('[data-alert-panel]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-alert-panel] .alert-entry img').count(), 0, 'Names must not inject markup');
      await page.locator('[data-alert-close]').click();
      bookings = [{ ...bookings[0], status: 'confirmed' }];
      await page.evaluate(() => BarberCoAlerts.refresh());
      await page.locator('[data-alert-popup]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.alert-badge').textContent(), '1');
      assert.equal(await page.locator('[data-alert-bell]').evaluate(node => node.classList.contains('has-unread')), true);
      if (role === 'customer') {
        await page.locator('[data-alert-bell]').click();
        assert.match(await page.locator('[data-alert-panel]').innerText(), /appointment is confirmed/);
        assert.equal(await page.locator('.alert-entry').first().getAttribute('href'), 'user-profile.html#bookings');
        await page.locator('[data-alert-close]').click();
      }
      assert.ok(await page.evaluate(() => window.tones >= 2), 'Two-tone sound after user interaction');
      await page.locator('[data-alert-dismiss]').click();
      const tones = await page.evaluate(() => window.tones);
      await page.evaluate(() => BarberCoAlerts.refresh());
      assert.equal(await page.locator('[data-alert-popup]').isVisible(), false, 'Polling does not repeat alerts');
      assert.equal(await page.evaluate(() => window.tones), tones);
      await page.locator('[data-alert-bell]').click();
      await page.locator('[data-alert-sound]').click();
      assert.equal(await page.locator('[data-alert-sound]').getAttribute('aria-pressed'), 'false');
      await page.locator('[data-alert-read]').click();
      assert.equal(await page.locator('.alert-badge').isVisible(), false);
      assert.equal(await page.locator('[data-alert-bell]').evaluate(node => node.classList.contains('has-unread')), false);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-alert-panel]').isVisible(), false);
      bookings = [{ ...bookings[0], status: 'cancelled', staffNote: '<b>Invalid receipt</b>' }];
      if (role !== 'customer') contacts = [{ _id: 'contact', name: 'Visitor', createdAt: new Date().toISOString() }];
      await page.evaluate(() => BarberCoAlerts.refresh());
      assert.equal(await page.evaluate(() => window.tones), tones, 'Muted updates stay silent');
      await page.locator('[data-alert-bell]').click();
      assert.equal(await page.locator('.alert-entry b').count(), 0);
      if (role !== 'customer') assert.ok((await page.locator('[data-alert-panel]').innerText()).includes('New contact message'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page overflow');
      const box = await page.locator('[data-alert-panel]').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'Panel fits the viewport');
      await page.locator('[data-alert-sound]').focus();
      await page.evaluate(() => BarberCoAlerts.refresh());
      assert.equal(await page.locator('[data-alert-sound]').evaluate(node => document.activeElement === node), true, 'Polling preserves keyboard focus');
      const preview = path.join(root, 'outputs/site-alerts');
      fs.mkdirSync(preview, { recursive: true });
      await page.screenshot({ path: path.join(preview, `${role}-${width}.png`), fullPage: false });
      await page.reload();
      await page.locator('[data-alert-bell]').waitFor();
      await page.evaluate(() => BarberCoAlerts.refresh());
      assert.equal(await page.locator('[data-alert-popup]').isVisible(), false, 'Reload does not replay changes');
      await page.locator('[data-alert-bell]').click();
      assert.equal(await page.locator('[data-alert-sound]').getAttribute('aria-pressed'), 'false', 'Mute persists');
      if (role === 'customer') {
        failure = true;
        await page.evaluate(() => BarberCoAlerts.refresh());
        assert.ok((await page.locator('[data-alert-panel]').innerText()).includes('unavailable'));
        failure = false;
        await page.evaluate(() => BarberCoAlerts.refresh());
      }
      if (role === 'customer' && width === 1440) {
        bookings = [{ ...bookings[0], status: 'completed' }];
        const second = await context.newPage();
        await second.goto(`${base}/index.html`);
        await second.locator('[data-alert-popup]').waitFor({ state: 'visible' });
        await page.bringToFront();
        await page.evaluate(() => BarberCoAlerts.refresh());
        assert.equal(await page.locator('[data-alert-popup]').isVisible(), false, 'Other tabs do not repeat an already observed update');
        await second.close();
      }
      if (role === 'customer') {
        notifications.push({ _id: 'offline-reschedule', message: 'The shop proposes a new appointment schedule. Please approve or reject it.', createdAt: new Date().toISOString() });
        await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('barberCoAlerts:')) localStorage.removeItem(key); });
        await page.reload();
        await page.waitForFunction(() => document.querySelector('.alert-badge')?.textContent === String(3 + (innerWidth === 1440 ? 1 : 0)));
        assert.equal(await page.locator('[data-alert-popup]').isVisible(), false, 'Saved messages populate the bell quietly on first visit');
        await page.locator('[data-alert-bell]').click();
        const history = await page.locator('[data-alert-panel]').innerText();
        assert.match(history, /appointment is confirmed/);
        assert.match(history, /appointment is cancelled/);
        assert.match(history, /approve or reject/);
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`In-site notifications, sound/mute, unread/read, deduplication, reload, escaped content and layout passed: ${role} ${width}px`);
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
