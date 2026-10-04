// Isolated UI fixtures: all backend requests are intercepted; no production records are changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const services = [{ id: 'basic', name: 'Basic Haircut', price: 150, duration: '30 min', detail: 'Haircut and finishing', bookings: 8 }, { id: 'shave', name: 'Haircut + Shave', price: 200, duration: '45 min', detail: 'Haircut and beard shave', bookings: 3 }];
const barbers = [{ id: 'barber-1', name: 'Alex Santos', role: 'Fade specialist', status: 'active' }, { id: 'barber-2', name: 'Luis Reyes', role: 'Classic cuts', status: 'on-leave' }];
const initialQueue = Array.from({ length: 9 }, (_, i) => ({ id: `queue-${i}`, customer: i === 0 ? 'Miguel Alexander Dela Cruz' : `Customer ${i + 1}`, queueNumber: i + 1, status: i === 0 ? 'serving' : 'waiting', barberId: i === 0 ? 'barber-1' : '', cutName: 'Basic Haircut', serviceId: 'basic', price: 150, waitMinutes: 30, source: i % 2 ? 'shop-qr' : 'staff' }));
const initialAppointments = ['pending', 'confirmed', 'completed'].map((status, i) => ({ mongoId: `booking-${i}`, customer: ['Maria Dela Cruz', 'John Santos', 'Anna Reyes'][i], serviceId: 'basic', barberId: 'barber-1', date: '2026-10-08', time: '14:00', total: 250, status, queueNumber: i + 1, paymentProof: '/images/logo.png' }));
const accounts = [{ id: 'owner', name: 'Shop Owner', email: 'thebarberco.official@gmail.com', role: 'admin' }, { id: 'staff', name: 'Front Desk', email: 'staff@example.test', role: 'moderator' }, { id: 'customer', name: 'Customer Account', email: 'customer@example.test', role: 'customer' }];
const settings = { bookingFee: 100, gcash: { enabled: true, accountName: 'The Barber Co', accountNumber: '09123456789' }, maya: { enabled: false }, closedDates: [] };
const requests = [];
const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const daily = Array.from({ length: 365 }, (_, i) => {
  const bookings = i >= 351 ? i % 3 : 0;
  const walkins = i >= 351 ? i % 7 + 2 : 0;
  return { date: new Date(Date.parse(`${today}T00:00:00Z`) - (364 - i) * 86400000).toISOString().slice(0, 10), bookings, walkins, revenue: bookings * 250 + walkins * 150 };
});
const dailyTotals = daily.reduce((sum, day) => ({ bookings: sum.bookings + day.bookings, walkins: sum.walkins + day.walkins, revenue: sum.revenue + day.revenue }), { bookings: 0, walkins: 0, revenue: 0 });

async function fixtures(context, role) {
  let queue = structuredClone(initialQueue);
  let appointments = structuredClone(initialAppointments);
  await context.addInitScript(({ role }) => {
    localStorage.setItem('barberCoState', JSON.stringify({ user: { id: 'test-user', name: role === 'admin' ? 'Shop Owner' : 'Front Desk', email: 'qa@example.test', role } }));
    localStorage.setItem('barberCoToken', 'qa-isolated-token');
    localStorage.setItem('barberCoApiBase', 'https://barber-co-seven.vercel.app');
  }, { role });
  await context.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await context.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const endpoint = new URL(req.url()).pathname;
    requests.push({ endpoint, method: req.method(), body: req.postDataJSON() });
    let data;
    if (endpoint.endsWith('/catalog')) data = { services, barbers };
    else if (endpoint.endsWith('/analytics')) data = { totals: { customers: 24, ...dailyTotals, waiting: 8 }, daily, services, barbers };
    else if (endpoint.endsWith('/settings')) data = { settings };
    else if (endpoint.endsWith('/users')) data = { users: accounts };
    else if (endpoint.includes('/users/')) data = { user: { ...accounts.find((item) => item.id === endpoint.split('/').pop()), role: req.postDataJSON().role } };
    else if (endpoint.endsWith('/barbers')) data = { barbers };
    else if (endpoint.endsWith('/services')) data = { services };
    else if (endpoint.endsWith('/queue')) data = { queue };
    else if (endpoint.includes('/queue/')) {
      const id = endpoint.split('/').pop();
      const body = req.postDataJSON() || {};
      queue = queue.map((item) => item.id === id ? { ...item, ...body } : item);
      data = { ticket: queue.find((item) => item.id === id) };
    } else if (endpoint.endsWith('/appointments')) data = { appointments };
    else if (endpoint.includes('/appointments/')) {
      const id = endpoint.split('/').pop();
      appointments = appointments.map((item) => item.mongoId === id ? { ...item, ...req.postDataJSON() } : item);
      data = { appointment: appointments.find((item) => item.mongoId === id) };
    } else throw new Error(`Unexpected API request ${endpoint}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

async function main() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = process.env.STAFF_UI_BASE || `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const pages = ['dashboard', 'logbook', 'schedule', 'users', 'barbers', 'services', 'reports', 'profile'];
    for (const width of [1920, 1440, 768, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await fixtures(context, 'admin');
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const name of pages) {
        await page.goto(`${base}/admin-${name}.html`);
        await page.waitForSelector('.workspace h1');
        await page.waitForTimeout(350);
        assert.equal(errors.length, 0, `${name}: ${errors.join(', ')}`);
        assert.ok(await page.locator('.sidebar a svg').count() >= 7, `${name}: navigation icons missing`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 1, `${name} at ${width}: horizontal overflow ${overflow}`);
        assert.equal(await page.locator('.site-header').evaluate((el) => Math.round(el.getBoundingClientRect().height)), 64);
        if (name === 'profile') {
          const groups = await page.locator('.settings-group').evaluateAll((elements) => elements.map((group) => {
            const box = group.getBoundingClientRect();
            const heading = group.querySelector('.settings-group-title').getBoundingClientRect();
            const next = group.querySelector('.settings-group-title').nextElementSibling.getBoundingClientRect();
            return { name: group.querySelector('h3').textContent, topInset: heading.top - box.top, leftInset: heading.left - box.left, rightInset: box.right - heading.right, gap: next.top - heading.bottom };
          }));
          assert.equal(groups.length, 3);
          for (const group of groups) {
            assert.ok(group.topInset >= 16 && group.leftInset >= 16 && group.rightInset >= 16, `${group.name} must stay inside its box at ${width}px`);
            assert.ok(group.gap >= 15, `${group.name} needs space above its fields at ${width}px`);
          }
        }
        assert.equal(await page.locator('.site-header').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(43, 26, 18)', 'Staff header must match the oak theme');
        if (['dashboard', 'reports'].includes(name)) {
          await page.waitForFunction(() => Boolean(Chart.getChart(document.querySelector('[data-trend-chart]'))));
          const pixels = await page.locator('canvas').evaluate((canvas) => {
            const values = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let colored = 0;
            for (let i = 3; i < values.length; i += 4) if (values[i]) colored++;
            return colored;
          });
          assert.ok(pixels > 100, 'Chart canvas must render');
          await page.locator('[data-chart-range]').selectOption('7');
          assert.equal(await page.locator('[data-chart-rows] tr').count(), 7);
          await page.locator('[data-chart-metric="bookings"]').click();
          assert.equal(await page.locator('canvas').evaluate((canvas) => Chart.getChart(canvas).data.datasets[0].label), 'Online bookings');
          const before = await page.locator('[data-chart-readout]').textContent();
          await page.locator('[data-chart-day]').focus();
          await page.keyboard.press('Home');
          assert.notEqual(await page.locator('[data-chart-readout]').textContent(), before, 'Keyboard chart inspection must work');
          await page.locator('[data-chart-metric="revenue"]').click();
          await page.locator('[data-chart-range]').selectOption('30');
          await page.waitForTimeout(350);
          const line = await page.locator('canvas').evaluate((canvas) => Chart.getChart(canvas).getDatasetMeta(0).data.map((point) => point.y));
          assert.ok(Math.max(...line) - Math.min(...line) > 20, 'The line must reflect varying data');
        }
        await page.screenshot({ path: path.join(root, `staff-ui-${name}-${width}-check.png`), fullPage: true });
        if (width > 960) {
          await page.evaluate(() => window.scrollTo(0, 600));
          assert.equal(await page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().top)), 64, 'Sidebar shifts on scroll');
        } else {
          await page.locator('[data-staff-toggle]').click();
          assert.equal(await page.locator('[data-staff-toggle]').getAttribute('aria-expanded'), 'true');
          await page.waitForFunction(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().left) === 0);
          assert.ok(Math.abs(await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().left)) < 1);
          await page.locator('[data-sidebar-dismiss]').click({ position: { x: 300, y: 200 } });
        }
      }
      await page.goto(`${base}/admin-reports.html`);
      await page.waitForSelector('[data-chart-rows] tr');
      const downloadEvent = page.waitForEvent('download');
      await page.locator('[data-chart-export]').click();
      const download = await downloadEvent;
      const csv = fs.readFileSync(await download.path(), 'utf8');
      assert.equal(csv.split('\r\n').length, 31);
      assert.ok(csv.includes('Collected revenue (PHP)'));
      const periodRevenue = daily.slice(-30).reduce((sum, day) => sum + day.revenue, 0);
      assert.ok((await page.locator('[data-chart-footer]').textContent()).includes(periodRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })));
      await page.goto(`${base}/admin-logbook.html`);
      await page.waitForSelector('[data-ticket-row]');
      assert.equal(await page.locator('[data-ticket-row="queue-0"] .button:disabled').textContent(), 'Serving');
      assert.equal(await page.locator('[data-next]').isDisabled(), true);
      await page.locator('[data-queue-search]').fill('Miguel');
      assert.equal(await page.locator('[data-ticket-row]').count(), 1);
      await page.locator('[name="customer"]').fill('Draft customer');
      await page.waitForTimeout(5300);
      assert.equal(await page.locator('[name="customer"]').inputValue(), 'Draft customer');
      assert.equal(await page.locator('[data-queue-search]').inputValue(), 'Miguel');
      await page.goto(`${base}/admin-schedule.html`);
      await page.waitForSelector('.appointment-record');
      await page.locator('[data-filter="pending"]').click();
      assert.equal(await page.locator('.appointment-record').count(), 1);
      await page.locator('[data-status="booking-0:confirmed"]').click();
      await page.waitForSelector('.staff-empty');
      await page.locator('[data-filter="confirmed"]').click();
      assert.equal(await page.locator('.appointment-record').count(), 2);
      await page.goto(`${base}/admin-users.html`);
      await page.waitForSelector('[data-role-select]');
      assert.equal(await page.locator('[data-role-select="owner"]').isDisabled(), true);
      await page.locator('[data-role-select="customer"]').selectOption('moderator');
      await page.waitForTimeout(100);
      assert.ok(requests.some((item) => item.endpoint === '/api/admin/users/customer' && item.body.role === 'moderator'));
      await page.goto(`${base}/admin-profile.html`);
      await page.waitForSelector('[name="gcashName"]');
      await page.locator('[name="gcashName"]').fill('Unsaved account name');
      await page.locator('[data-qr="gcash"]').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(root, 'images/logo.png')) });
      await page.waitForSelector('[data-qr-preview="gcash"] img');
      assert.equal(await page.locator('[name="gcashName"]').inputValue(), 'Unsaved account name');
      await context.close();
      console.log(`Admin screens and interactions passed at ${width}px`);
    }
    const mod = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await fixtures(mod, 'moderator');
    const page = await mod.newPage();
    await page.goto(`${base}/admin-logbook.html`);
    await page.waitForSelector('.workspace');
    assert.equal(await page.locator('.sidebar a[href="admin-users.html"]').count(), 0);
    assert.equal(await page.locator('.sidebar a[href="admin-profile.html"]').count(), 0);
    assert.equal(await page.locator('.sidebar a[href="admin-reports.html"]').count(), 0);
    assert.equal(await page.locator('[data-analytics]').count(), 0);
    await page.screenshot({ path: path.join(root, 'staff-ui-moderator-check.png'), fullPage: true });
    await page.goto(`${base}/admin-profile.html`);
    await page.waitForURL('**/login.html');
    console.log('Moderator navigation and admin-only page restriction passed');
    await mod.close();
    const empty = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await fixtures(empty, 'admin');
    await empty.route('**/api/admin/analytics', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ totals: { bookings: 0, customers: 0, waiting: 0, revenue: 0 }, services: [], barbers: [], daily: daily.map((day) => ({ ...day, bookings: 0, walkins: 0, revenue: 0 })) }) }));
    const emptyPage = await empty.newPage();
    await emptyPage.goto(`${base}/admin-reports.html`);
    await emptyPage.waitForSelector('[data-chart-message]:visible');
    assert.equal(await emptyPage.locator('[data-chart-message]').textContent(), 'No activity in this period');
    assert.equal(await emptyPage.locator('[data-chart-rows] tr').count(), 30);
    await empty.route('**/api/admin/analytics', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Analytics temporarily unavailable.' }) }));
    await emptyPage.reload();
    await emptyPage.waitForSelector('[data-chart-message]:visible');
    assert.equal(await emptyPage.locator('[data-chart-message]').textContent(), 'Daily analytics could not be loaded.');
    assert.equal(await emptyPage.locator('[data-chart-export]').isDisabled(), true);
    assert.equal(await emptyPage.locator('[data-chart-rows] tr').count(), 0);
    console.log('Empty charts and backend-error states passed without fabricated data');
    await empty.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
