const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const secret = 'role-sync-fixture';
const owner = { _id: new ObjectId(), name: 'Owner', email: 'owner@example.test', role: 'admin' };
const customer = { _id: new ObjectId(), name: 'Front desk', email: 'staff@example.test', role: 'customer', emailVerifiedAt: new Date(), birthDate: '1990-01-01' };
const database = require('./helpers/memory-db').memoryDb({ users: [owner, customer], services: [{ _id: new ObjectId(), slug: 'basic', name: 'Basic', price: 150, active: true }], barbers: [{ _id: new ObjectId(), slug: 'alex', name: 'Alex', status: 'active' }], settings: [{ _id: 'shop' }] });
const context = { require: require('node:module').createRequire(path.join(root, 'api/index.js')), module: { exports: {} }, process: { env: { JWT_SECRET: secret } }, URL, console, database };
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'api/index.js'), 'utf8')}\ndb = async () => database;`, context);
const token = user => jwt.sign({ sub: String(user._id), role: user.role }, secret);
const originalCustomerToken = token(customer);
async function request(userToken, method, url, body) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { method, url: `/api${url}`, headers: { authorization: `Bearer ${userToken}` } });
  let data;
  const res = { setHeader() {}, end(raw) { data = JSON.parse(raw); } };
  await context.module.exports(req, res);
  return { status: res.statusCode, ...data };
}
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) return context.module.exports(req, res);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const admin = await browser.newPage();
    const staff = await browser.newPage();
    for (const [page, user, userToken] of [[admin, owner, token(owner)], [staff, customer, originalCustomerToken]]) {
      await page.addInitScript(({ user, userToken, base }) => {
        if (!localStorage.getItem('barberCoToken')) {
          localStorage.setItem('barberCoToken', userToken);
          localStorage.setItem('barberCoState', JSON.stringify({ user: { id: String(user._id), name: user.name, email: user.email, role: user.role } }));
        }
        localStorage.setItem('barberCoApiBase', base);
      }, { user, userToken, base });
      await page.route('https://**/*', route => route.abort());
    }
    await staff.goto(`${base}/index.html`);
    await admin.goto(`${base}/admin-users.html`);
    const picker = admin.locator(`[data-role-select="${customer._id}"]`);
    await picker.selectOption('moderator');
    await admin.waitForFunction(() => document.querySelector('[data-role-select]')?.disabled === false);
    assert.equal(customer.role, 'moderator');
    const stale = await browser.newPage();
    await stale.addInitScript(({ base, originalCustomerToken }) => {
      localStorage.setItem('barberCoApiBase', base);
      localStorage.setItem('barberCoToken', originalCustomerToken);
      localStorage.setItem('barberCoState', JSON.stringify({ user: { name: 'Front desk', email: 'staff@example.test', role: 'customer' } }));
    }, { base, originalCustomerToken });
    await stale.goto(`${base}/admin-logbook.html`);
    await stale.getByRole('heading', { name: 'Customer queue', exact: true }).waitFor();
    assert.equal(await stale.locator('#staff-sidebar a[href="admin-reports.html"]').count(), 0);
    assert.equal(await stale.locator('#staff-sidebar a[href="admin-users.html"]').count(), 0);
    await stale.close();
    await staff.evaluate(() => window.dispatchEvent(new Event('focus')));
    await staff.waitForURL('**/admin-logbook.html');
    await staff.getByRole('heading', { name: 'Customer queue', exact: true }).waitFor();
    for (const pageName of ['admin-schedule.html', 'admin-contacts.html']) {
      await staff.goto(`${base}/${pageName}`);
      await staff.locator('#app:visible h1').waitFor();
      assert.ok(staff.url().endsWith(pageName));
    }
    for (const route of ['/admin/analytics', '/admin/users']) assert.equal((await request(originalCustomerToken, 'GET', route)).status, 403);
    assert.equal((await request(originalCustomerToken, 'PATCH', '/admin/settings', {})).status, 403);
    assert.equal((await request(originalCustomerToken, 'GET', '/admin/appointments')).status, 200);
    assert.equal((await request(originalCustomerToken, 'GET', '/admin/queue')).status, 200);
    assert.equal((await request(originalCustomerToken, 'PATCH', `/admin/users/${owner._id}`, { role: 'customer' })).status, 403);
    await picker.selectOption('customer');
    await admin.waitForTimeout(100);
    assert.equal(customer.role, 'customer');
    await staff.evaluate(() => window.dispatchEvent(new Event('focus')));
    await staff.waitForURL('**/index.html');
    assert.equal((await request(originalCustomerToken, 'GET', '/admin/queue')).status, 403);
    console.log('Role picker promotion/demotion, existing customer token, open-tab synchronization, staff operations and business/security denials passed');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
