// Real API handlers and browser pages share an isolated in-memory database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const secret = 'isolated-booking-review-secret';
const users = ['admin', 'moderator', 'customer'].map((role) => ({ _id: new ObjectId(), name: `Review ${role}`, email: `${role}@review.test`, role }));
const service = { _id: new ObjectId(), slug: 'basic', name: 'Basic Haircut', price: 150, duration: '30 min', active: true };
const barber = { _id: new ObjectId(), slug: 'review-barber', name: 'Review Barber', status: 'active' };
const settings = { _id: 'shop', bookingFee: 100, gcash: { enabled: true, accountName: 'Test Shop', accountNumber: '09123456789' }, maya: { enabled: false } };
const records = { users, services: [service], barbers: [barber], settings: [settings], appointments: [], appointmentHolds: [], appointmentSlots: [], counters: [{ _id: 'queue', value: 0 }] };
const equal = (a, b) => String(a) === String(b);
function matches(item, query = {}) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some((condition) => matches(item, condition));
    const actual = item[key];
    if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)) {
      return Object.entries(value).every(([operator, expected]) => {
        if (operator === '$in') return expected.some((candidate) => equal(actual, candidate));
        if (operator === '$nin') return !expected.some((candidate) => equal(actual, candidate));
        if (operator === '$ne') return !equal(actual, expected);
        if (operator === '$gt') return actual > expected;
        throw new Error(`Unsupported test query ${operator}`);
      });
    }
    return equal(actual, value);
  });
}
function update(item, changes) {
  Object.assign(item, changes.$set || {});
  for (const key of Object.keys(changes.$unset || {})) delete item[key];
  for (const [key, value] of Object.entries(changes.$inc || {})) item[key] = (item[key] || 0) + value;
}
const database = { collection(name) {
  records[name] ||= [];
  return {
    find(query, options = {}) {
      let items = records[name].filter((item) => matches(item, query));
      const cursor = {
        sort(sort) { const [key, direction] = Object.entries(sort)[0]; items.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * direction); return cursor; },
        limit(count) { items = items.slice(0, count); return cursor; },
        async toArray() { return items.map((item) => options.projection ? Object.fromEntries(Object.entries(item).filter(([key]) => key === '_id' || options.projection[key])) : { ...item }); }
      };
      return cursor;
    },
    async findOne(query) { return records[name].find((item) => matches(item, query)); },
    async insertOne(item) { records[name].push(item); return { insertedId: item._id }; },
    async insertMany(items) {
      for (const item of items) {
        if (records[name].some((existing) => equal(existing._id, item._id))) { const error = new Error('Duplicate slot'); error.code = 11000; throw error; }
        records[name].push(item);
      }
    },
    async updateOne(query, changes) { const item = records[name].find((record) => matches(record, query)); if (item) update(item, changes); return { modifiedCount: Number(Boolean(item)) }; },
    async updateMany(query, changes) { const items = records[name].filter((record) => matches(record, query)); items.forEach((item) => update(item, changes)); return { modifiedCount: items.length }; },
    async findOneAndUpdate(query, changes) { const item = records[name].find((record) => matches(record, query)); update(item, changes); return item; },
    async deleteOne(query) { const index = records[name].findIndex((record) => matches(record, query)); if (index >= 0) records[name].splice(index, 1); },
    async deleteMany(query) { records[name] = records[name].filter((record) => !matches(record, query)); }
  };
} };
const context = { require: require('node:module').createRequire(path.join(root, 'api/index.js')), module: { exports: {} }, process: { env: { JWT_SECRET: secret } }, URL, console, fixtureDatabase: database };
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'api/index.js'), 'utf8')}\ndb = async () => fixtureDatabase;`, context);
const handler = context.module.exports;
const token = (role) => jwt.sign({ sub: String(users.find((user) => user.role === role)._id), role }, secret);
const booking = { serviceId: 'basic', barberId: 'review-barber', date: '2100-03-03', time: '14:00', customer: 'Review admin' };
const proof = 'data:image/png;base64,aXNvbGF0ZWQtdGVzdA==';

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return handler(req, res);
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(endpoint, role = 'admin', body, method = body ? 'POST' : 'GET') {
    const response = await fetch(`${base}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${token(role)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  let browser;
  try {
    assert.equal((await request('/admin/appointments', null)).status, 401);
    assert.equal((await request('/admin/appointments', 'customer')).status, 403);
    const held = await request('/appointment-holds', 'admin', booking);
    assert.equal(held.status, 201, JSON.stringify(held.data));
    let list = await request('/admin/appointments');
    assert.equal(list.data.reservations.length, 1);
    assert.equal(list.data.reservations[0].customer, users[0].name);
    assert.equal(list.data.appointments.length, 0);
    assert.equal(list.headers.get('cache-control'), 'no-store');
    delete records.appointmentHolds[0].customer;
    assert.equal((await request('/admin/appointments')).data.reservations[0].customer, users[0].name, 'Existing holds should show the account name too');
    assert.equal((await request(`/admin/appointments/${held.data.hold.id}`, 'admin', { status: 'confirmed' }, 'PATCH')).status, 404, 'Unpaid holds must not be accepted');
    assert.equal((await request('/appointment-holds', 'customer', booking)).status, 409, 'Held barber/time must remain reserved');
    const submitted = await request('/appointments', 'admin', { ...booking, holdId: held.data.hold.id, paymentMethod: 'GCash', paymentProof: proof });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
    list = await request('/admin/appointments', 'moderator');
    assert.equal(list.data.reservations.length, 0);
    assert.equal(list.data.appointments[0].mongoId, submitted.data.appointment.id);
    assert.equal(list.data.appointments[0].status, 'pending');
    assert.equal((await request('/appointments/mine')).data.appointments[0].id, submitted.data.appointment.id);
    assert.equal((await request(`/admin/appointments/${submitted.data.appointment.id}`, 'moderator', { status: 'confirmed' }, 'PATCH')).status, 200);
    assert.equal((await request('/appointments/mine')).data.appointments[0].status, 'confirmed');
    records.appointmentHolds.push({ _id: new ObjectId(), userId: users[0]._id, expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await request('/admin/appointments')).data.reservations.length, 0, 'Expired holds must not appear');
    settings.gcash.accountNumber = '';
    assert.equal((await request('/appointment-holds', 'admin', { ...booking, time: '16:00' })).status, 409);
    assert.equal((await request('/admin/appointments')).data.paymentConfigured, false);
    settings.gcash.accountNumber = '09123456789';
    console.log('API: admin booking, payment hold visibility, submission, moderator approval, own status, access, expiry, and missing payment setup passed');

    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const [role, width, time] of [['admin', 1440, '16:00'], ['customer', 390, '17:00']]) {
      const browserContext = await browser.newContext({ viewport: { width, height: 900 } });
      const user = users.find((item) => item.role === role);
      await browserContext.addInitScript(({ base, user, auth }) => {
        localStorage.setItem('barberCoApiBase', base);
        localStorage.setItem('barberCoToken', auth);
        if (!localStorage.getItem('barberCoState')) localStorage.setItem('barberCoState', JSON.stringify({ user }));
      }, { base, user: { id: String(user._id), name: user.name, email: user.email, role }, auth: token(role) });
      await browserContext.route('https://fonts.googleapis.com/**', (route) => route.abort());
      await browserContext.route('https://fonts.gstatic.com/**', (route) => route.abort());
      const page = await browserContext.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${base}/booking.html`);
      await page.locator('[name="date"]').fill(booking.date);
      await page.locator('[name="date"]').dispatchEvent('change');
      await page.locator('[name="time"]').selectOption(time);
      await page.locator('[name="barber"]').selectOption('review-barber');
      await page.getByRole('button', { name: 'Proceed to payment' }).click();
      await page.waitForURL('**/payment.html');
      assert.equal(records.appointments.filter((item) => item.time === time).length, 0);
      const staff = await browser.newContext({ viewport: { width, height: 900 } });
      await staff.addInitScript(({ base, auth, user }) => {
        localStorage.setItem('barberCoApiBase', base);
        localStorage.setItem('barberCoToken', auth);
        if (!localStorage.getItem('barberCoState')) localStorage.setItem('barberCoState', JSON.stringify({ user }));
        // Loading payment proofs must not depend on browser storage writes.
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === 'barberCoState' && value.includes('paymentProof')) throw new DOMException('Storage full', 'QuotaExceededError');
          return original.call(this, key, value);
        };
      }, { base, auth: token('admin'), user: { id: String(users[0]._id), name: users[0].name, email: users[0].email, role: 'admin' } });
      await staff.route('https://fonts.googleapis.com/**', (route) => route.abort());
      await staff.route('https://fonts.gstatic.com/**', (route) => route.abort());
      const review = await staff.newPage();
      await review.goto(`${base}/admin-schedule.html`);
      await review.locator('[data-filter="awaiting-payment"]').click();
      assert.equal(await review.locator('[data-payment-warning]').isVisible(), false);
      assert.ok((await review.locator('[data-appointment-panel]').innerText()).includes(user.name));
      assert.equal(await review.locator('[data-status]').count(), 0);
      await page.locator('[data-payment-proof]').setInputFiles(path.join(root, 'images/logo.png'));
      await page.getByRole('button', { name: 'Submit for verification' }).click();
      await page.waitForURL(role === 'admin' ? '**/admin-schedule.html' : '**/user-profile.html#bookings');
      const saved = records.appointments.find((item) => item.time === time);
      assert.ok(saved, 'The browser submission must reach the API database');
      if (role === 'admin') await page.locator(`[data-status="${saved._id}:confirmed"]`).waitFor();
      await review.reload();
      await review.locator('[data-filter="pending"]').click();
      await review.locator(`[data-status="${saved._id}:confirmed"]`).click();
      await review.locator('[data-filter="confirmed"]').click();
      await review.locator(`[data-status="${saved._id}:completed"]`).waitFor();
      assert.equal((await request('/appointments/mine', role)).data.appointments.find((item) => item.id === String(saved._id)).status, 'confirmed');
      if (role === 'customer') await page.getByText('Accepted and payment verified', { exact: true }).waitFor({ timeout: 15000 });
      assert.ok(await review.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.equal(errors.length, 0, errors.join(', '));
      await review.waitForTimeout(500);
      await review.screenshot({ path: path.join(root, `booking-review-${width}-check.png`), fullPage: true });
      settings.gcash.accountNumber = '';
      await page.goto(`${base}/booking.html`);
      await page.getByRole('heading', { name: 'Payment setup is incomplete.' }).waitFor();
      assert.equal(await page.locator('[data-booking]').count(), 0);
      if (role === 'admin') assert.equal(await page.getByRole('link', { name: 'Set up payments', exact: true }).count(), 1);
      await review.reload();
      await review.locator('[data-payment-warning]').waitFor({ state: 'visible' });
      settings.gcash.accountNumber = '09123456789';
      await staff.close();
      await browserContext.close();
      console.log(`Browser: ${role} booking reaches staff review, can be accepted, and missing payment setup is explicit at ${width}px`);
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
