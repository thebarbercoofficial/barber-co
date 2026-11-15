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
const service = { _id: new ObjectId(), slug: 'cut', name: 'QA Cut', price: 225, duration: '30 min', active: true };
const database = memoryDb({ users: [staff], services: [service], barbers: [{ _id: new ObjectId(), slug: 'alex', name: 'Alex', status: 'active' }], settings: [{ _id: 'shop' }] });
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
      const logbook = await staffContext.newPage();
      const tv = await staffContext.newPage();
      await customer.goto(`${base}/queue.html`);
      await logbook.goto(`${base}/admin-logbook.html`);
      await tv.goto(`${base}/queue-display.html`);
      await customer.getByRole('textbox', { name: 'Name', exact: true }).fill('QA Customer');
      await customer.getByRole('button', { name: 'Get queue number', exact: true }).click();
      await customer.waitForURL(/ticket=/);
      const id = new URL(customer.url()).searchParams.get('ticket');
      await customer.getByRole('button', { name: 'Your ticket is already in the queue', exact: true }).waitFor();
      assert.equal(await customer.getByRole('button', { name: 'Your ticket is already in the queue', exact: true }).isDisabled(), true);
      await customer.reload();
      await customer.getByRole('button', { name: 'Your ticket is already in the queue', exact: true }).waitFor();
      assert.equal(database.records.queue.length, 1);
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
      assert.equal(database.records.queue[0].paid, true);
      assert.equal(await customer.getByRole('button', { name: 'Get queue number', exact: true }).isEnabled(), true);
      // The initial price must reflect the selected catalog service, not a hardcoded PHP 150.
      assert.equal(await logbook.locator('[name="price"]').inputValue(), '225');
      await logbook.getByRole('textbox', { name: 'Customer call name', exact: true }).fill('QA Staff Entry');
      await logbook.getByRole('button', { name: 'Add to queue', exact: true }).click();
      await logbook.waitForFunction(() => document.querySelector('[data-queue-rows]')?.innerText.includes('QA Staff Entry'));
      assert.equal(database.records.queue.length, 2);
      assert.equal(database.records.queue[1].price, 225);
      await customer.waitForFunction(() => document.querySelector('[data-live-rows]')?.innerText.includes('QA Staff Entry'));
      const staffId = String(database.records.queue[1]._id);
      await logbook.getByRole('button', { name: 'Call next customer', exact: true }).click();
      await tv.locator(`.tv-serving [data-ticket-id="${staffId}"]`).waitFor();
      assert.equal(database.records.queue[1].status, 'serving');
      await logbook.locator(`[data-ticket-row="${staffId}"] [data-status$=":cancelled"]`).click();
      await customer.waitForFunction(() => !document.querySelector('[data-live-rows]')?.innerText.includes('QA Staff Entry'));
      assert.equal(database.records.queue[1].paid, false);
      assert.deepEqual(errors, []);
      await customerContext.close();
      await staffContext.close();
      console.log(`Walk-in actual browser/API flow passed at ${width}px: expired session, join, duplicate UI guard, reload, staff list, Serve, Call next, TV, customer status, paid completion guard, staff add and cancellation.`);
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
