// Isolated API and browser checks; no production records are changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { Readable } = require('node:stream');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');
const { memoryDb } = require('./helpers/memory-db');
const root = path.resolve(__dirname, '..');
const users = ['admin', 'moderator', 'customer'].map(role => ({ _id: new ObjectId(), name: role, role }));
function fixture() {
  const memory = memoryDb({ users, queue: Array.from({ length: 23 }, (_, i) => ({ _id: new ObjectId(), customer: `Customer ${i + 1}`, status: 'done', paid: true, price: 150, paidAt: new Date(), createdAt: new Date(), source: 'staff' })) });
  const database = { collection(name) {
    const collection = memory.collection(name);
    collection.bulkWrite = async operations => {
      for (const { updateOne } of operations) await collection.updateOne(updateOne.filter, updateOne.update, { upsert: updateOne.upsert });
    };
    return collection;
  } };
  const localRequire = require('node:module').createRequire(path.join(root, 'api/index.js'));
  const sandbox = { require: localRequire, module: { exports: {} }, URL, console, process: { env: { JWT_SECRET: 'collections-fixture' } }, database };
  vm.runInNewContext(`${fs.readFileSync(path.join(root, 'api/index.js'), 'utf8')}\ndb = async () => database;`, sandbox);
  async function request(url, body, role = 'admin') {
    const user = users.find(item => item.role === role);
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { method: body ? 'POST' : 'GET', url: `/api${url}`, headers: { authorization: `Bearer ${jwt.sign({ sub: String(user._id) }, 'collections-fixture')}` } });
    let result;
    const res = { setHeader() {}, end(raw) { result = JSON.parse(raw); } };
    await sandbox.module.exports(req, res);
    return { status: res.statusCode, body: result };
  }
  return { request, records: memory.records };
}
async function main() {
  const api = fixture();
  const before = (await api.request('/admin/analytics')).body;
  const ids = before.collections.records.slice(0, 2).map(item => item.id);
  for (const role of ['moderator', 'customer']) assert.equal((await api.request('/admin/collection-records/clear', { ids }, role)).status, 403);
  assert.equal((await api.request('/admin/collection-records/clear', { ids: ['invalid'] })).status, 400);
  assert.equal((await api.request('/admin/collection-records/clear', { ids: [] })).status, 400);
  assert.equal((await api.request('/admin/collection-records/clear', { ids })).status, 200);
  assert.equal((await api.request('/admin/collection-records/clear', { ids })).status, 200, 'Repeated deletion is idempotent');
  const after = (await api.request('/admin/analytics')).body;
  assert.equal(after.collections.records.length, 21);
  assert.deepEqual(after.totals, before.totals, 'Revenue and customer metrics stay unchanged');
  assert.deepEqual(after.daily, before.daily, 'Daily payment history stays unchanged');
  assert.equal(after.collections.walkins, before.collections.walkins);
  assert.equal(api.records.queue.length, 23);
  assert.ok(api.records.queue.every(item => item.paid && item.status === 'done'));
  assert.equal(api.records.clearedCollectionRecords.length, 2);
  assert.equal(String(api.records.clearedCollectionRecords[0].clearedBy), String(users[0]._id));
  console.log('Admin-only report deletion preserves payments, totals and history.');
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
    for (const width of [1440, 390]) {
      const isolated = fixture();
      let fail = false;
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(user => {
        localStorage.setItem('barberCoToken', 'fixture');
        localStorage.setItem('barberCoState', JSON.stringify({ user }));
      }, { id: String(users[0]._id), name: 'Admin', email: 'admin@example.test', role: 'admin' });
      await context.route('https://fonts.**/**', route => route.abort());
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url()).pathname.replace(/^\/api/, '');
        if (url === '/admin/analytics' || url === '/admin/collection-records/clear') {
          if (fail && url.endsWith('/clear')) return route.fulfill({ status: 503, json: { error: 'Try again.' } });
          const result = await isolated.request(url, route.request().method() === 'POST' ? route.request().postDataJSON() : undefined);
          return route.fulfill({ status: result.status, json: result.body });
        }
        return route.fulfill({ json: url === '/me' ? { user: { id: String(users[0]._id), name: 'Admin', email: 'admin@example.test', role: 'admin' } } : { settings: {}, appointments: [], contacts: [], notifications: [], services: [], barbers: [] } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', () => { throw new Error('No confirmation popups allowed'); });
      await page.goto(`http://127.0.0.1:${server.address().port}/admin-reports.html`);
      const ledger = page.locator('.collections-ledger');
      const remove = ledger.locator('[data-ledger-delete]');
      await remove.waitFor({ timeout: 10000 }).catch(async error => { console.error(errors, await page.locator('body').innerText()); throw error; });
      assert.equal(await remove.isDisabled(), true);
      assert.equal(await ledger.locator('tbody tr').count(), 10);
      assert.equal(await ledger.locator('[data-ledger-range]').textContent(), '1–10 of 23');
      await ledger.getByRole('button', { name: 'Next page', exact: true }).click();
      assert.equal(await ledger.locator('[data-ledger-range]').textContent(), '11–20 of 23');
      await ledger.locator('[data-ledger-select]').first().check();
      assert.equal(await remove.isEnabled(), true);
      await ledger.getByRole('button', { name: 'Last page', exact: true }).click();
      assert.equal(await ledger.locator('tbody tr').count(), 3);
      await ledger.locator('[data-ledger-select-page]').check();
      assert.match(await remove.textContent(), /4/);
      fail = true;
      await remove.click();
      await ledger.getByRole('status').filter({ hasText: 'Try again.' }).waitFor();
      assert.equal(await ledger.locator('[data-ledger-select]:checked').count(), 3, 'Failure preserves selection');
      fail = false;
      await remove.click();
      await ledger.getByRole('status').filter({ hasText: 'Records removed.' }).waitFor();
      assert.equal(await ledger.locator('[data-ledger-range]').textContent(), '11–19 of 19', 'Deletion clamps the last page');
      assert.equal(await remove.isDisabled(), true);
      await page.reload();
      await ledger.locator('[data-ledger-range]').filter({ hasText: '1–10 of 19' }).waitFor();
      assert.equal(await page.locator('[data-metric="revenue"] strong').textContent(), 'PHP 3,450.00');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const out = path.join(root, 'outputs/collection-records');
      fs.mkdirSync(out, { recursive: true });
      await ledger.evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 80));
      await page.screenshot({ path: path.join(out, `${width}.png`) });
      await ledger.locator('.ledger-pagination').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, `${width}-pagination.png`) });
      await ledger.locator('[data-ledger-clear]').click();
      await ledger.getByRole('status').filter({ hasText: 'Records removed.' }).waitFor();
      assert.equal(await ledger.locator('[data-ledger-range]').textContent(), '0–0 of 0');
      assert.equal(await ledger.locator('[data-ledger-clear]').isDisabled(), true);
      assert.equal(await page.locator('[data-metric="revenue"] strong').textContent(), 'PHP 3,450.00');
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Selection, pagination, deletion, failure recovery, persistence and layout passed: ${width}px`);
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
