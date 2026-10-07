const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const users = [];
function matches(user, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some((item) => matches(user, item));
    if (value?.$regex) return value.$regex.test(String(user[key] || ''));
    if (value?.$ne) return String(user[key]) !== String(value.$ne);
    return String(user[key]) === String(value);
  });
}
function unique(user, exclude) {
  const key = users.some((item) => item !== exclude && item.email === user.email) ? 'email' : user.phoneLogin && users.some((item) => item !== exclude && item.phoneLogin === user.phoneLogin) ? 'phoneLogin' : '';
  if (key) { const error = new Error('Duplicate login identifier'); error.code = 11000; error.keyPattern = { [key]: 1 }; throw error; }
}
const database = { collection(name) {
  assert.equal(name, 'users');
  return {
    find(query) { let list = users.filter((user) => matches(user, query)); return { limit(count) { list = list.slice(0, count); return this; }, async toArray() { return list; } }; },
    async findOne(query) { return users.find((user) => matches(user, query)); },
    async insertOne(user) { unique(user); users.push(user); },
    async updateOne(query, update) {
      const user = users.find((item) => matches(item, query));
      const next = { ...user, ...update.$set };
      for (const key of Object.keys(update.$unset || {})) delete next[key];
      unique(next, user);
      for (const key of Object.keys(update.$unset || {})) delete user[key];
      Object.assign(user, next);
    }
  };
} };
const context = { require: require('node:module').createRequire(path.join(root, 'api/index.js')), module: { exports: {} }, process: { env: { JWT_SECRET: 'isolated-phone-test-secret' } }, URL, console, fixtureDatabase: database };
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'api/index.js'), 'utf8')}\ndb = async () => fixtureDatabase;`, context);
async function main() {
  const hash = await bcrypt.hash('Isolated-test-password', 4);
  users.push({ _id: new ObjectId(), name: 'Legacy Admin', email: 'admin@phone.test', role: 'admin', phone: '', passwordHash: hash });
  users.push({ _id: new ObjectId(), name: 'Legacy Staff', email: 'staff@phone.test', role: 'moderator', phone: '+63 917 123 4567', passwordHash: hash });
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return context.module.exports(req, res);
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(endpoint, body, token, method = 'POST') {
    const response = await fetch(`${base}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  let browser;
  try {
    const registration = { name: 'Phone Customer', phone: '+639181234567', email: 'customer@phone.test', password: 'Isolated-test-password' };
    const registered = await request('/auth/register', registration);
    assert.equal(registered.status, 201);
    assert.equal(registered.data.user.phone, '09181234567');
    assert.ok(registered.data.token);
    for (const identifier of ['09181234567', '+639181234567', '639181234567', '0918 123 4567', 'CUSTOMER@PHONE.TEST']) {
      const login = await request('/auth/login', { identifier, password: registration.password });
      assert.equal(login.status, 200, JSON.stringify(login.data));
      assert.equal(login.data.user.id, registered.data.user.id);
    }
    assert.equal((await request('/auth/login', { identifier: registration.phone, password: 'wrong' })).status, 401);
    assert.equal((await request('/auth/login', { identifier: '123', password: registration.password })).status, 400);
    assert.equal((await request('/auth/register', { ...registration, email: 'other@phone.test' })).status, 409);
    assert.equal((await request('/auth/register', { ...registration, phone: 'invalid', email: 'invalid@phone.test' })).status, 400);
    const races = await Promise.all(['race1', 'race2'].map((id) => request('/auth/register', { ...registration, email: `${id}@phone.test`, phone: '09191234567' })));
    assert.deepEqual(races.map((item) => item.status).sort(), [201, 409]);
    const admin = await request('/auth/login', { email: 'admin@phone.test', password: registration.password });
    assert.equal(admin.status, 200, 'Legacy email clients remain compatible');
    assert.equal(admin.data.user.role, 'admin');
    assert.equal((await request('/auth/login', { phone: '09171234567', password: registration.password })).data.user.role, 'moderator');
    assert.equal((await request('/me', { phone: '09181234567' }, admin.data.token, 'PATCH')).status, 409);
    assert.equal((await request('/me', { phone: '+639161234567' }, admin.data.token, 'PATCH')).status, 200);
    assert.equal((await request('/auth/login', { identifier: '09161234567', password: registration.password })).data.user.role, 'admin');
    await request('/me', { bio: 'Changed bio only' }, admin.data.token, 'PATCH');
    assert.equal(users[0].phone, '09161234567', 'Unrelated profile updates must preserve the login number');
    await request('/me', { phone: '' }, admin.data.token, 'PATCH');
    assert.equal(users[0].phoneLogin, undefined);
    assert.equal((await request('/auth/login', { identifier: '09161234567', password: registration.password })).status, 401);
    users.push({ _id: new ObjectId(), name: 'Ambiguous legacy number', email: 'duplicate@phone.test', phone: '0917-123-4567', passwordHash: hash });
    assert.equal((await request('/auth/login', { identifier: '09171234567', password: registration.password })).status, 401, 'Never choose an arbitrary account with a duplicate legacy number');
    assert.equal((await request('/auth/login', { identifier: 'staff@phone.test', password: registration.password })).status, 200);
    console.log('Phone API: format normalization, registration, roles, email fallback, duplicates/concurrency, profile linking, and ambiguous legacy protection passed');

    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const width of [1440, 390]) {
      const browserContext = await browser.newContext({ viewport: { width, height: 900 } });
      await browserContext.addInitScript((base) => { localStorage.setItem('barberCoApiBase', base); }, base);
      await browserContext.route('https://fonts.googleapis.com/**', (route) => route.abort());
      await browserContext.route('https://fonts.gstatic.com/**', (route) => route.abort());
      await browserContext.route(/\/(index|admin-dashboard|booking)\.html(?:\?.*)?$/, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated login destination</title>' }));
      const page = await browserContext.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${base}/login.html`);
      assert.equal(await page.locator('[name="identifier"]').getAttribute('type'), 'tel');
      assert.equal(await page.locator('[data-login-method="phone"]').getAttribute('aria-pressed'), 'true');
      await page.locator('[name="identifier"]').fill('09181234567');
      await page.locator('[name="password"]').fill(registration.password);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(root, `phone-login-${width}-check.png`), fullPage: true });
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await page.waitForURL('**/index.html');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('barberCoState')).user.phone), '09181234567');
      await page.goto(`${base}/login.html`);
      await page.locator('[data-login-method="email"]').click();
      assert.equal(await page.locator('[name="identifier"]').getAttribute('type'), 'email');
      await page.locator('[name="identifier"]').fill('admin@phone.test');
      await page.locator('[name="password"]').fill(registration.password);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await page.waitForURL('**/admin-dashboard.html');
      await page.goto(`${base}/register.html?next=booking.html`);
      await page.locator('[name="name"]').fill('Phone UI Customer');
      await page.locator('[name="phone"]').fill(width === 1440 ? '09201234567' : '09211234567');
      await page.locator('[name="email"]').fill(`ui-${width}@phone.test`);
      await page.locator('[name="password"]').fill(registration.password);
      await page.locator('[type="checkbox"]').check();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(root, `phone-register-${width}-check.png`), fullPage: true });
      await page.getByRole('button', { name: 'Create account and continue' }).click();
      await page.waitForURL('**/booking.html');
      assert.ok(await page.evaluate(() => localStorage.getItem('barberCoToken')));
      assert.equal(errors.length, 0, errors.join(', '));
      await browserContext.close();
      console.log(`Phone-first login, email fallback, and auto-login after mobile registration passed at ${width}px`);
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
