// Actual pages and API, isolated from production records and messaging.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');
const { memoryDb } = require('./helpers/memory-db');
const root = path.resolve(__dirname, '..');
const staff = { _id: new ObjectId(), name: 'QA Staff', email: 'staff@qa.test', role: 'admin' };
const accountA = { _id: new ObjectId(), name: 'Queue Account A', email: 'queue-a@qa.test', role: 'customer' };
const accountB = { _id: new ObjectId(), name: 'Queue Account B', email: 'queue-b@qa.test', role: 'customer' };
const service = { _id: new ObjectId(), slug: 'cut', name: 'QA Cut', price: 225, duration: '30 min', active: true };
const database = memoryDb({ users: [staff, accountA, accountB], services: [service], barbers: [{ _id: new ObjectId(), slug: 'alex', name: 'Alex', status: 'active' }], settings: [{ _id: 'shop' }] });
const localRequire = require('node:module').createRequire(path.join(root, 'api/index.js'));
const sandbox = { require: name => name === '../lib/notifications' ? { notify: async () => {} } : localRequire(name), module: { exports: {} }, URL, console, process: { env: { JWT_SECRET: 'walkin-test' } }, database };
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'api/index.js'), 'utf8')}\ndb = async () => database;`, sandbox);
const handler = sandbox.module.exports;

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return handler(req, res);
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ sub: String(staff._id) }, 'walkin-test');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const width of [1440, 390]) {
      database.records.queue = [];
      const errors = [];
      const customerContext = await browser.newContext({ viewport: { width, height: 900 } });
      const staffContext = await browser.newContext({ viewport: { width, height: 900 } });
      for (const [context, admin] of [[customerContext, false], [staffContext, true]]) {
        await context.addInitScript(({ base, admin, token, user }) => {
          if (location.origin !== base) return;
          localStorage.setItem('barberCoApiBase', base);
          localStorage.setItem('barberCoToken', admin ? token : 'expired-test-token');
          if (admin) localStorage.setItem('barberCoState', JSON.stringify({ user }));
        }, { base, admin, token, user: { id: String(staff._id), name: staff.name, email: staff.email, role: 'admin' } });
        await context.route('https://**', route => route.abort());
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      }
      const customer = await customerContext.newPage();
      customer.on('dialog', async dialog => { errors.push(`Unexpected customer browser popup: ${dialog.type()}`); await dialog.dismiss(); });
      const logbook = await staffContext.newPage();
      const tv = await staffContext.newPage();
      await customer.goto(`${base}/queue.html`);
      await customer.locator('[data-ticket-panel]').waitFor();
      assert.equal(await customer.locator('[data-walkin]').isVisible(), false, 'Public queue cannot join without an in-shop QR');
      const qrResponse = await fetch(`${base}/api/admin/queue/qr`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(qrResponse.status, 200);
      const qr = await qrResponse.json();
      await customer.goto(`${base}/queue.html?walkinToken=${encodeURIComponent(qr.token)}`);
      assert.equal(await customer.locator('[name="contactEmail"], [name="emailConsent"], input[type="file"]').count(), 0, 'Walk-in scan has no email or gallery-upload controls');
      await logbook.goto(`${base}/admin-logbook.html`);
      await tv.goto(`${base}/queue-display.html`);
      await customer.getByRole('textbox', { name: 'Name', exact: true }).fill('QA Customer');
      const now = new Date();
      const local = new Date(now.getTime() + 8 * 3600000).toISOString();
      const reserved = { _id: new ObjectId(), userId: accountB._id, customer: 'Reserved customer', barberId: 'alex', serviceId: 'cut', date: local.slice(0, 10), time: local.slice(11, 16), durationMinutes: 30, status: 'confirmed', graceDeadline: new Date(now.getTime() + 600000), partyMembers: ['Reserved customer'] };
      database.records.appointments = [reserved];
      await customer.evaluate(() => refreshWalkinBarbers());
      assert.equal(await customer.locator('[name="barberId"] option[value="alex"]').evaluate(option => option.disabled), true, 'Overlapping approved appointment greys out the walk-in barber');
      const blocked = await customer.evaluate(async token => {
        const response = await fetch('/api/queue/walkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer: 'Blocked customer', serviceId: 'cut', barberId: 'alex', walkinToken: token }) });
        return response.status;
      }, qr.token);
      assert.equal(blocked, 409, 'Server rejects a reserved barber even if the dropdown is bypassed');
      database.records.appointments = [];
      await customer.evaluate(() => refreshWalkinBarbers());
      await customer.locator('[name="barberId"]').selectOption('alex');
      await customer.getByRole('button', { name: 'Get queue number', exact: true }).click();
      await customer.waitForURL(/ticket=/);
      const firstId = new URL(customer.url()).searchParams.get('ticket');
      await customer.getByRole('button', { name: 'Your ticket is already in the queue', exact: true }).waitFor();
      assert.equal(await customer.getByRole('button', { name: 'Your ticket is already in the queue', exact: true }).isDisabled(), true);
      assert.equal(await customer.locator('[data-walkin-fields]').isVisible(), false, 'An active ticket must not show a blank join form');
      assert.equal(await customer.getByRole('link', { name: 'View your queue status' }).isVisible(), true);
      await customer.reload();
      await customer.getByRole('button', { name: 'Your ticket is already in the queue', exact: true }).waitFor();
      assert.equal(database.records.queue.length, 1);
      await customer.getByRole('button', { name: 'Cancel my place', exact: true }).waitFor();
      assert.equal(database.records.queue[0].barberId, 'alex', 'Chosen available barber is saved');
      const ticketOnlyCancel = await customer.evaluate(async id => (await fetch(`/api/queue/ticket/${id}/cancel`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, firstId);
      assert.equal(ticketOnlyCancel, 403, 'A public ticket URL alone cannot cancel the ticket');
      let cancelAttempts = 0;
      await customer.route('**/api/queue/ticket/*/cancel', route => {
        cancelAttempts++;
        if (cancelAttempts === 1) return route.fulfill({ status: 503, json: { error: 'Cancellation temporarily unavailable. Try again.' } });
        return route.continue();
      });
      await customer.getByRole('button', { name: 'Cancel my place', exact: true }).click();
      await customer.getByText('Cancellation temporarily unavailable. Try again.', { exact: true }).first().waitFor();
      assert.equal(database.records.queue[0].status, 'waiting', 'Failed cancellation must not claim success');
      assert.equal(await customer.getByRole('button', { name: 'Cancel my place', exact: true }).isEnabled(), true);
      await customer.getByRole('button', { name: 'Cancel my place', exact: true }).click();
      await customer.waitForFunction(() => document.querySelector('[data-ticket-panel]')?.innerText.includes('Cancelled'));
      assert.equal(database.records.queue[0].status, 'cancelled');
      assert.equal(cancelAttempts, 2, 'Each click submits once, with no browser confirmation');
      assert.equal(await customer.getByRole('button', { name: 'Cancel my place', exact: true }).count(), 0);
      const secondQrResponse = await fetch(`${base}/api/admin/queue/qr`, { headers: { Authorization: `Bearer ${token}` } });
      const secondQr = await secondQrResponse.json();
      await customer.goto(`${base}/queue.html?walkinToken=${encodeURIComponent(secondQr.token)}`);
      await customer.getByRole('textbox', { name: 'Name', exact: true }).fill('QA Customer 2');
      await customer.getByRole('button', { name: 'Get queue number', exact: true }).click();
      await customer.waitForURL(/ticket=/);
      const id = new URL(customer.url()).searchParams.get('ticket');
      assert.notEqual(id, firstId);
      const row = logbook.locator(`[data-ticket-row="${id}"]`);
      await logbook.bringToFront();
      await row.waitFor();
      assert.equal(await row.locator('[data-status$=":done"]').isDisabled(), true);
      const rejected = await fetch(`${base}/api/admin/queue/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
      assert.equal(rejected.status, 409);
      assert.equal(database.records.queue[0].paid, false);
      await tv.locator(`[data-ticket-id="${id}"]`).waitFor();
      await row.getByRole('button', { name: 'Serve', exact: true }).click();
      await customer.waitForFunction(() => document.querySelector('[data-ticket-panel]')?.innerText.includes('Now serving'));
      await tv.locator(`.tv-serving [data-ticket-id="${id}"]`).waitFor();
      logbook.once('dialog', dialog => dialog.accept());
      await row.locator('[data-status$=":done"]').click();
      await customer.waitForFunction(() => document.querySelector('[data-ticket-panel]')?.innerText.includes('Completed'));
      const customerTicket = database.records.queue.find(ticket => String(ticket._id) === id);
      assert.equal(customerTicket.paid, true);
      assert.equal(await customer.getByRole('button', { name: 'Get queue number', exact: true }).isEnabled(), false, 'A completed ticket needs a fresh in-shop QR to join again');
      assert.equal(await customer.locator('[data-walkin-fields]').isVisible(), false);
      assert.equal(await customer.locator('[name="customer"]').getAttribute('autocomplete'), 'off');
      // The initial price must reflect the selected catalog service, not a hardcoded PHP 150.
      assert.equal(await logbook.locator('[name="price"]').inputValue(), '225');
      await logbook.getByRole('textbox', { name: 'Customer call name', exact: true }).fill('QA Staff Entry');
      await logbook.getByRole('button', { name: 'Add to queue', exact: true }).click();
      await logbook.waitForFunction(() => document.querySelector('[data-queue-rows]')?.innerText.includes('QA Staff Entry'));
      assert.equal(database.records.queue.length, 3);
      const staffTicket = database.records.queue.find(ticket => ticket.customer === 'QA Staff Entry');
      assert.equal(staffTicket.price, 225);
      await customer.waitForFunction(() => document.querySelector('[data-live-rows]')?.innerText.includes('QA Staff Entry'));
      const staffId = String(staffTicket._id);
      await logbook.getByRole('button', { name: 'Call next customer', exact: true }).click();
      await tv.locator(`.tv-serving [data-ticket-id="${staffId}"]`).waitFor();
      assert.equal(staffTicket.status, 'serving');
      assert.equal(await customer.getByRole('button', { name: 'Cancel my place', exact: true }).count(), 0, 'A customer cannot cancel after the barber calls their ticket');
      await logbook.locator(`[data-ticket-row="${staffId}"] [data-status$=":cancelled"]`).click();
      await customer.waitForFunction(() => !document.querySelector('[data-live-rows]')?.innerText.includes('QA Staff Entry'));
      assert.equal(staffTicket.paid, false);
      assert.deepEqual(errors, []);

      const accountQrResponse = await fetch(`${base}/api/admin/queue/qr`, { headers: { Authorization: `Bearer ${token}` } });
      const accountQr = await accountQrResponse.json();
      const accountTokenA = jwt.sign({ sub: String(accountA._id) }, 'walkin-test');
      const accountTokenB = jwt.sign({ sub: String(accountB._id) }, 'walkin-test');
      const accountContext = await browser.newContext({ viewport: { width, height: 900 } });
      await accountContext.addInitScript(({ base }) => localStorage.setItem('barberCoApiBase', base), { base });
      const accountPage = await accountContext.newPage();
      const accountErrors = [];
      accountPage.on('pageerror', error => accountErrors.push(error.message));
      await accountPage.goto(`${base}/queue.html`);
      await accountPage.evaluate(({ token, user }) => {
        localStorage.setItem('barberCoToken', token);
        localStorage.setItem('barberCoState', JSON.stringify({ user }));
      }, { token: accountTokenA, user: { id: String(accountA._id), name: accountA.name, email: accountA.email, role: 'customer' } });
      await accountPage.goto(`${base}/queue.html?walkinToken=${encodeURIComponent(accountQr.token)}`);
      await accountPage.getByRole('textbox', { name: 'Name', exact: true }).fill(accountA.name);
      await accountPage.getByRole('button', { name: 'Get queue number', exact: true }).click();
      await accountPage.waitForURL(/ticket=/);
      const accountTicketA = new URL(accountPage.url()).searchParams.get('ticket');

      await accountPage.evaluate(({ token, user }) => {
        localStorage.setItem('barberCoToken', token);
        localStorage.setItem('barberCoState', JSON.stringify({ user }));
      }, { token: accountTokenB, user: { id: String(accountB._id), name: accountB.name, email: accountB.email, role: 'customer' } });
      await accountPage.goto(`${base}/queue.html?walkinToken=${encodeURIComponent(accountQr.token)}`);
      const joinButton = accountPage.getByRole('button', { name: 'Get queue number', exact: true });
      await joinButton.waitFor();
      assert.equal(await joinButton.isEnabled(), true, 'A second account on the same device can join behind the first ticket');
      await accountPage.getByRole('textbox', { name: 'Name', exact: true }).fill(accountB.name);
      await joinButton.click();
      await accountPage.waitForURL(/ticket=/);
      const accountTicketB = new URL(accountPage.url()).searchParams.get('ticket');
      const queuedAccounts = database.records.queue.filter(ticket => [accountTicketA, accountTicketB].includes(String(ticket._id))).sort((left, right) => left.queueNumber - right.queueNumber);
      assert.equal(queuedAccounts.length, 2);
      assert.deepEqual(queuedAccounts.map(ticket => ticket.userId.toString()), [String(accountA._id), String(accountB._id)]);
      assert.equal(queuedAccounts[1].queueNumber, queuedAccounts[0].queueNumber + 1, 'Separate account tickets receive consecutive FIFO positions');

      await accountPage.evaluate(({ token, user }) => {
        localStorage.setItem('barberCoToken', token);
        localStorage.setItem('barberCoState', JSON.stringify({ user }));
      }, { token: accountTokenA, user: { id: String(accountA._id), name: accountA.name, email: accountA.email, role: 'customer' } });
      await accountPage.goto(`${base}/queue.html?walkinToken=${encodeURIComponent(accountQr.token)}`);
      await accountPage.getByRole('button', { name: 'Your ticket is already in the queue', exact: true }).waitFor();
      assert.equal(await accountPage.locator('[data-walkin-fields]').isVisible(), false, 'The account with an active ticket still cannot create a duplicate');
      assert.deepEqual(accountErrors, []);
      await accountContext.close();
      await customerContext.close();
      await staffContext.close();
      console.log(`Walk-in browser/API flow passed at ${width}px: in-shop QR, account-scoped tickets, FIFO stacking, duplicate guard, reload, staff queue, TV, customer status and cancellation.`);
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
