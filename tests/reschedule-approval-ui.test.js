// Isolated browser fixtures; no production API calls or records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const request = { date: '2099-12-21', time: '13:00', originalDate: '2099-12-20', originalTime: '14:00', status: 'pending', expiresAt: '2099-12-20T06:00:00.000Z', requestedAt: '2099-12-01T00:00:00.000Z' };
const initial = { id: 'fixture-booking', mongoId: 'fixture-booking', customer: 'Fixture Customer', serviceId: 'basic', date: '2099-12-20', time: '14:00', queueNumber: 1, total: 550, status: 'confirmed', partySize: 3, partyMembers: ['Fixture Customer', 'Member <Guest>', 'Searchable Companion'], durationMinutes: 90 };

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
      for (const role of ['admin', 'customer']) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const user = { id: 'fixture-user', role, name: 'Fixture Customer', email: 'fixture@example.test', emailVerified: true };
        let booking = { ...initial, ...(role === 'admin' ? { rescheduleRequest: { ...request } } : {}) };
        const writes = [];
        let failReview = false;
        await context.addInitScript(({ base, user }) => {
          localStorage.setItem('barberCoToken', 'isolated-test');
          localStorage.setItem('barberCoApiBase', base);
          localStorage.setItem('barberCoState', JSON.stringify({ user }));
        }, { base, user });
        await context.route('https://**', route => route.abort());
        await context.route('**/api/**', async route => {
          const req = route.request();
          const endpoint = new URL(req.url()).pathname;
          let data = {};
          if (req.method() === 'PATCH') {
            const body = req.postDataJSON();
            writes.push({ endpoint, body });
            if (endpoint.endsWith('/reschedule-review')) {
              if (failReview || body.requestedAt !== booking.rescheduleRequest.requestedAt) return route.fulfill({ status: 409, json: { error: 'Request changed. Refresh and review again.' } });
              booking.rescheduleRequest = { ...booking.rescheduleRequest, status: body.decision === 'approve' ? 'approved' : 'rejected', reason: body.reason };
              if (body.decision === 'approve') { booking.date = request.date; booking.time = request.time; }
            } else if (endpoint.endsWith('/reschedule')) {
              if (role === 'customer') booking.rescheduleRequest = { ...request, ...body };
              else Object.assign(booking, body);
            } else if (endpoint.endsWith('/cancel')) booking.status = 'cancelled';
            data = { appointment: booking };
          } else if (endpoint.endsWith('/me')) data = { user };
          else if (endpoint.endsWith('/catalog')) data = { services: [{ id: 'basic', name: 'Basic Haircut', price: 150 }], barbers: [] };
          else if (endpoint.endsWith('/appointments') || endpoint.endsWith('/appointments/mine')) data = { appointments: [booking] };
          else if (endpoint.includes('/notifications')) data = { notifications: [] };
          await route.fulfill({ json: data });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/${role === 'admin' ? 'admin-schedule' : 'user-profile'}.html`);
        const bookingPanel = page.locator(role === 'admin' ? '[data-appointment-panel]' : '[data-my-bookings]');
        await bookingPanel.getByText('Group of 3:', { exact: true }).waitFor();
        assert.match(await bookingPanel.innerText(), /Fixture Customer, Member <Guest>, Searchable Companion/);
        assert.match(await bookingPanel.innerText(), /90 minutes total/);
        assert.match(await bookingPanel.innerText(), /whole group/);
        assert.equal(await bookingPanel.locator('guest').count(), 0, 'Member names must be rendered as text rather than HTML');
        if (role === 'admin') {
          const search = page.locator('[data-appointment-search]');
          await search.fill('searchable companion');
          assert.equal(await bookingPanel.locator('.appointment-record').count(), 1, 'Staff can find a group by a member other than the account holder');
          await search.fill('absent group member');
          assert.equal(await bookingPanel.locator('.appointment-record').count(), 0, 'Member search must exclude nonmatching reservations');
          await search.fill('');
          assert.equal(await bookingPanel.locator('.appointment-record').count(), 1);
          await page.locator('[data-filter="reschedule-review"]').click();
          assert.equal(await page.locator('[data-status$=":completed"]').count(), 0);
          assert.equal(await page.locator('[data-reschedule]').count(), 0);
          assert.match(await page.locator('[data-appointment-panel]').innerText(), /Original:[\s\S]*Requested:[\s\S]*Review deadline:[\s\S]*Asia\/Manila/);
          await page.locator('[data-decision="approve"]').click();
          await page.getByRole('button', { name: 'Go back', exact: true }).click();
          assert.equal(writes.length, 0);
          failReview = true;
          await page.locator('[data-decision="reject"]').click();
          await page.getByRole('button', { name: 'Confirm rejection' }).click();
          await page.getByText('Request changed. Refresh and review again.', { exact: true }).waitFor();
          assert.equal(await page.getByRole('button', { name: 'Confirm rejection' }).isEnabled(), true);
          failReview = false;
          await page.locator('dialog textarea').fill('Please keep the original time.');
          await page.getByRole('button', { name: 'Confirm rejection' }).click();
          await page.waitForFunction(() => !document.querySelector('dialog'));
          await page.locator('[data-filter="all"]').click();
          await page.locator('[data-reschedule]').waitFor();
          assert.equal(writes.at(-1).body.requestedAt, request.requestedAt);
          const details = await page.evaluate(() => {
            const approved = { date: '2099-12-21', time: '13:00', rescheduleRequest: { status: 'approved', originalDate: '2099-12-20', originalTime: '14:00' } };
            return { snapshot: rescheduleDetails(approved), legacy: rescheduleDetails({ ...approved, rescheduleRequest: { status: 'approved' } }) };
          });
          assert.match(details.snapshot, /Original:<\/strong> 2099-12-20 at 14:00/);
          assert.match(details.legacy, /Current schedule:/);
          assert.equal(booking.date, initial.date);
          await page.locator('[data-reschedule]').click();
          await page.locator('dialog [name="date"]').fill('2099-12-22');
          await page.locator('dialog [name="reason"]').fill('Staff schedule changed.');
          page.once('dialog', dialog => dialog.dismiss());
          await page.getByRole('button', { name: 'Save schedule' }).click();
          assert.equal(writes.length, 2);
          page.once('dialog', dialog => dialog.accept());
          await page.getByRole('button', { name: 'Save schedule' }).click();
          await page.waitForFunction(() => !document.querySelector('dialog'));
          assert.equal(writes.at(-1).body.reason, 'Staff schedule changed.');
          booking = { ...initial, rescheduleRequest: { ...request } };
          await page.reload();
          await page.locator('[data-decision="approve"]').click();
          await page.getByRole('button', { name: 'Confirm approval' }).click();
          await page.locator('[data-reschedule]').waitFor();
          assert.equal(booking.rescheduleRequest.status, 'approved');
          assert.equal(writes.at(-1).body.requestedAt, request.requestedAt);
        } else {
          await page.locator('[data-reschedule]').click();
          await page.locator('dialog [name="date"]').fill(request.date);
          await page.locator('dialog [name="time"]').fill(request.time);
          page.once('dialog', async dialog => {
            assert.match(dialog.message(), /Review deadline:[\s\S]*No refund/);
            await dialog.dismiss();
          });
          await page.getByRole('button', { name: 'Send reschedule request' }).click();
          assert.equal(writes.length, 0);
          page.once('dialog', dialog => dialog.accept());
          await page.getByRole('button', { name: 'Send reschedule request' }).click();
          await page.waitForFunction(() => document.querySelector('[data-reschedule]')?.disabled);
          assert.equal(booking.date, initial.date);
          assert.equal(await page.locator('[data-cancel-booking]').isEnabled(), true);
          assert.match(await page.locator('[data-my-bookings]').innerText(), /not accepted yet[\s\S]*Review deadline/);
          assert.equal(await page.locator('[data-my-bookings] .status-pill').innerText(), 'Reschedule awaiting staff approval');
          page.once('dialog', dialog => dialog.accept());
          await page.locator('[data-cancel-booking]').click();
          await page.waitForFunction(() => !document.querySelector('[data-cancel-booking]'));
          assert.equal(booking.status, 'cancelled');
          assert.equal(writes.at(-1).body.acceptNoRefund, true);
        }
        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${role} overflow at ${width}`);
        await context.close();
      }
    }
    console.log('Reschedule approval UI: desktop/mobile group display, escaped member names, staff member search, customer requests, confirmations, pending cancellation, staff approve/reject, stale errors and version payloads passed.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
