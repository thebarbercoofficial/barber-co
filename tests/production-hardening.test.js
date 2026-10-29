// Production configuration and real API/page code; database and delivery providers are isolated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { chromium } = require('playwright');
const { memoryDb } = require('./helpers/memory-db');
const { digest } = require('../lib/account-security');
const root = path.resolve(__dirname, '..');
const secret = 'isolated-production-test-secret-not-a-live-credential';
const database = memoryDb({ users: [], services: [{ _id: new ObjectId(), slug: 'basic', name: 'Basic Haircut', price: 150, duration: '30 min', active: true }], barbers: [{ _id: new ObjectId(), slug: 'alex', name: 'Alex', status: 'active' }], settings: [{ _id: 'shop', paymentMode: 'demo', bookingFee: 100, gcash: { enabled: true, accountName: 'Isolated Shop', accountNumber: '09123456789' }, maya: { enabled: false } }], counters: [{ _id: 'queue', value: 0 }] });
const rows = database.records;
const context = { require: require('node:module').createRequire(path.join(root, 'api/index.js')), module: { exports: {} }, process: { env: { JWT_SECRET: secret } }, URL, console, fixtureDatabase: database };
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'api/index.js'), 'utf8')}\ndb = async () => fixtureDatabase;`, context);
const handler = context.module.exports;
const nativeFetch = global.fetch;
const mails = [];
const sms = [];
let rejectDelivery = false;
const envNames = ['RESEND_API_KEY', 'EMAIL_FROM', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_VERIFY_SERVICE_SID'];
const savedEnv = Object.fromEntries(envNames.map((key) => [key, process.env[key]]));
envNames.forEach((key) => delete process.env[key]);
global.fetch = async (url, options) => {
  if (String(url).startsWith('https://api.resend.com/')) { mails.push(JSON.parse(options.body)); return { ok: !rejectDelivery, async json() { return { id: `isolated-email-${mails.length}` }; } }; }
  if (String(url).startsWith('https://verify.twilio.com/')) { const values = new URLSearchParams(options.body); return { ok: true, async json() { return { status: values.has('Code') ? values.get('Code') === '123456' ? 'approved' : 'pending' : 'pending' }; } }; }
  if (String(url).startsWith('https://api.twilio.com/')) { sms.push(String(options.body)); return { ok: !rejectDelivery, async json() { return { sid: `isolated-sms-${sms.length}` }; } }; }
  throw new Error(`Unexpected external request during isolated tests: ${url}`);
};
const proof = `data:image/png;base64,${fs.readFileSync(path.join(root, 'images/logo.png')).toString('base64')}`;
const registration = { name: 'Verified Customer', email: 'customer@isolated.test', phone: '09181234567', password: 'Correct-password-2026', confirmPassword: 'Correct-password-2026', birthDate: '2000-01-01' };
const booking = { serviceId: 'basic', barberId: 'alex', date: '2100-03-03', time: '14:00', paymentMethod: 'GCash', paymentMode: 'live', paymentProof: proof };
let checks = 0;
function passed(message) { checks++; console.log(`PASS ${checks}: ${message}`); }
function codeFor(email) { return mails.filter((item) => item.to.includes(email)).at(-1).text.match(/\b\d{6}\b/)[0]; }
function auth(user) { return jwt.sign({ sub: String(user._id), role: user.role, version: user.sessionVersion || 0 }, secret); }

async function main() {
  let browser;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return handler(req, res);
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(endpoint, body, token, method = body ? 'POST' : 'GET') {
    const response = await nativeFetch(`${base}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  try {
    const admin = { _id: new ObjectId(), name: 'Owner', email: 'owner@isolated.test', role: 'admin', passwordHash: await bcrypt.hash(registration.password, 4) };
    rows.users.push(admin);
    const adminToken = auth(admin);
    assert.equal((await request('/auth/register', registration)).status, 503);
    assert.equal(rows.users.length, 1);
    assert.equal((await request('/auth/forgot-password', { email: admin.email })).status, 503);
    assert.equal((await request('/auth/capabilities')).data.email, false);
    passed('Missing email configuration fails honestly without creating an account or pretending to reset a password');
    assert.equal((await request('/settings')).data.settings.paymentMode, 'live');
    assert.equal((await request('/admin/settings', { paymentMode: 'demo' }, adminToken, 'PATCH')).status, 400);
    passed('Production overrides legacy demo settings and rejects enabling demo payments');

    process.env.RESEND_API_KEY = 'isolated-fake-provider-key';
    process.env.EMAIL_FROM = 'Shop <shop@isolated.test>';
    assert.equal((await request('/auth/register', { ...registration, confirmPassword: 'different' })).status, 400);
    assert.equal((await request('/auth/register', { ...registration, birthDate: '2026-02-30' })).status, 400);
    assert.equal((await request('/auth/register', registration)).status, 201);
    assert.equal((await request('/auth/login', { email: registration.email, password: registration.password })).status, 403);
    assert.equal((await request('/auth/verify-email', { email: registration.email, code: '000000' })).status, 400);
    const verified = await request('/auth/verify-email', { email: registration.email, code: codeFor(registration.email) });
    assert.equal(verified.status, 200);
    assert.equal(verified.data.user.emailVerified, true);
    let userToken = verified.data.token;
    const user = rows.users.find((item) => item.email === registration.email);
    assert.equal((await request('/auth/verify-email', { email: registration.email, code: codeFor(registration.email) })).status, 400);
    passed('Real registration handler enforces confirmation/birth date and single-use email verification before issuing a session');

    assert.equal((await request('/auth/login', { identifier: registration.email, method: 'phone', password: registration.password })).status, 400);
    assert.equal((await request('/auth/login', { identifier: registration.phone, method: 'email', password: registration.password })).status, 400);
    for (let i = 0; i < 4; i++) assert.equal((await request('/auth/login', { email: registration.email, password: 'incorrect' })).status, 401);
    let locked = await request('/auth/login', { email: registration.email, password: 'incorrect' });
    assert.equal(locked.status, 429);
    assert.equal(locked.headers.get('retry-after'), '300');
    assert.equal((await request('/auth/login', { phone: registration.phone, password: registration.password })).status, 429, 'Changing login method cannot bypass account lockout');
    rows.loginAttempts[0].blockedUntil = new Date(0);
    for (let i = 0; i < 4; i++) await request('/auth/login', { email: registration.email, password: 'incorrect' });
    locked = await request('/auth/login', { email: registration.email, password: 'incorrect' });
    assert.equal(locked.headers.get('retry-after'), '600');
    rows.loginAttempts[0].blockedUntil = new Date(0);
    assert.equal((await request('/auth/login', { phone: registration.phone, password: registration.password })).status, 200);
    passed('Five incorrect attempts trigger persistent 5-minute then 10-minute lockouts shared by phone and email');

    await request('/auth/forgot-password', { email: registration.email });
    const resetCode = codeFor(registration.email);
    const nextPassword = 'New-secure-password-2026';
    assert.equal((await request('/auth/reset-password', { email: registration.email, code: '000000', password: nextPassword, confirmPassword: nextPassword })).status, 400);
    assert.equal((await request('/auth/reset-password', { email: registration.email, code: resetCode, password: nextPassword, confirmPassword: nextPassword })).status, 200);
    assert.equal((await request('/me', null, userToken)).status, 401, 'Reset invalidates the old session');
    assert.equal((await request('/auth/login', { email: registration.email, password: registration.password })).status, 401);
    const login = await request('/auth/login', { email: registration.email, password: nextPassword });
    assert.equal(login.status, 200);
    userToken = login.data.token;
    assert.equal((await request('/auth/reset-password', { email: registration.email, code: resetCode, password: nextPassword, confirmPassword: nextPassword })).status, 400);
    passed('Password reset changes the bcrypt hash, rejects old passwords, invalidates sessions and prevents code replay');
    let resetRecord = rows.accountCodes.find((item) => item._id === digest(`reset:${registration.email}`));
    resetRecord.sentAt = new Date(0);
    await request('/auth/forgot-password', { email: registration.email });
    resetRecord = rows.accountCodes.find((item) => item._id === digest(`reset:${registration.email}`));
    resetRecord.expiresAt = new Date(0);
    assert.equal((await request('/auth/reset-password', { email: registration.email, code: codeFor(registration.email), password: nextPassword, confirmPassword: nextPassword })).status, 400);
    resetRecord.sentAt = new Date(0);
    await request('/auth/forgot-password', { email: registration.email });
    for (let i = 0; i < 5; i++) assert.equal((await request('/auth/reset-password', { email: registration.email, code: '000000', password: nextPassword, confirmPassword: nextPassword })).status, 400);
    assert.equal((await request('/auth/reset-password', { email: registration.email, code: codeFor(registration.email), password: nextPassword, confirmPassword: nextPassword })).status, 400);
    passed('Expired email codes and codes with five failed guesses cannot reset a password');

    for (const endpoint of ['/admin/analytics', '/admin/appointments', '/admin/queue', '/admin/users', '/admin/notifications']) {
      assert.equal((await request(endpoint)).status, 401, endpoint);
      assert.equal((await request(endpoint, null, userToken)).status, 403, endpoint);
    }
    assert.equal((await request('/me', null, 'bad-token')).status, 401);
    passed('Unauthenticated and customer requests cannot read privileged API data, including with invalid tokens');

    const minor = { _id: new ObjectId(), name: 'Younger Customer', role: 'customer', email: 'minor@isolated.test', emailVerifiedAt: new Date(), birthDate: '2012-01-01' };
    rows.users.push(minor);
    assert.equal((await request('/appointment-holds', booking, auth(minor))).status, 403);
    assert.equal((await request('/appointments', booking, auth(minor))).status, 403);
    const minorWalkin = await request('/queue/walkin', { customer: minor.name, serviceId: 'basic' }, auth(minor));
    assert.equal(minorWalkin.status, 201);
    await request(`/admin/queue/${minorWalkin.data.ticket.id}`, { status: 'cancelled' }, adminToken, 'PATCH');
    passed('Under-18 shop policy is enforced by the server while walk-in access remains available');

    assert.equal((await request('/appointments', { ...booking, paymentProof: 'data:image/png;base64,aGVsbG8=' }, userToken)).status, 400);
    assert.equal((await request('/appointments', { ...booking, date: '2000-01-01' }, userToken)).status, 400);
    assert.equal((await request('/appointments', { ...booking, date: '2100-12-25' }, userToken)).status, 400);
    assert.equal((await request('/appointments', { ...booking, time: '23:00' }, userToken)).status, 400);
    const created = await request('/appointments', booking, userToken);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const appointmentId = created.data.appointment.id;
    assert.equal((await request('/appointments', booking, userToken)).status, 409);
    const listing = await request('/admin/appointments', null, adminToken);
    assert.equal(listing.data.appointments[0].paymentProof, undefined);
    assert.equal(listing.data.appointments[0].hasPaymentProof, true);
    assert.ok(JSON.stringify(listing.data).length < proof.length / 2, 'Polling payload must not contain receipt images');
    assert.equal((await request(`/admin/appointments/${appointmentId}/proof`)).status, 401);
    assert.equal((await request(`/admin/appointments/${appointmentId}/proof`, null, userToken)).status, 403);
    assert.equal((await request(`/admin/appointments/${appointmentId}/proof`, null, adminToken)).data.paymentProof, proof);
    passed('Booking rejects past/holiday/closed/conflicting slots and corrupt receipts; proof is private and fetched on demand');

    assert.equal((await request(`/admin/appointments/${appointmentId}/reschedule`, { date: '2100-03-03', time: '15:00' }, adminToken, 'PATCH')).status, 200);
    await request(`/admin/appointments/${appointmentId}`, { status: 'confirmed' }, adminToken, 'PATCH');
    const paidAt = rows.appointments[0].paidAt;
    await request(`/admin/appointments/${appointmentId}`, { status: 'completed' }, adminToken, 'PATCH');
    await request(`/admin/appointments/${appointmentId}`, { status: 'completed' }, adminToken, 'PATCH');
    assert.equal(rows.appointments[0].paidAt, paidAt);
    assert.equal((await request(`/admin/appointments/${appointmentId}`, { status: 'confirmed' }, adminToken, 'PATCH')).status, 409);
    assert.ok(rows.notifications.some((item) => item.message.includes('rescheduled')));
    assert.ok(rows.notifications.some((item) => item.message.includes('accepted') && item.channels.email.status === 'accepted'));
    passed('Rescheduling, acceptance and completion record notifications; repeats do not double-count or reopen completed work');

    process.env.TWILIO_ACCOUNT_SID = 'isolated-account'; process.env.TWILIO_AUTH_TOKEN = 'isolated-token'; process.env.TWILIO_FROM = '+15005550006'; process.env.TWILIO_VERIFY_SERVICE_SID = 'isolated-verify-service';
    assert.equal((await request('/me/phone/send-code', {}, userToken)).status, 200);
    assert.equal((await request('/me/phone/verify', { code: '', smsConsent: true }, userToken)).status, 400);
    assert.equal((await request('/me/phone/verify', { code: '000000', smsConsent: true }, userToken)).status, 400);
    assert.equal((await request('/me/phone/verify', { code: '123456', smsConsent: true }, userToken)).status, 200);
    const ticket = await request('/queue/walkin', { customer: 'Call Me Nickname', serviceId: 'basic' }, userToken);
    await request('/admin/queue/next', {}, adminToken);
    assert.ok(sms.length > 0);
    assert.ok(rows.notifications.some((item) => item.message.includes('your turn') && item.channels.sms.status === 'accepted'));
    assert.equal((await request('/admin/queue/next', {}, adminToken)).status, 409);
    await request(`/admin/queue/${ticket.data.ticket.id}`, { status: 'done' }, adminToken, 'PATCH');
    const queuePaidAt = rows.queue.find((item) => String(item._id) === ticket.data.ticket.id).paidAt;
    await request(`/admin/queue/${ticket.data.ticket.id}`, { status: 'done' }, adminToken, 'PATCH');
    assert.equal(rows.queue.find((item) => String(item._id) === ticket.data.ticket.id).paidAt, queuePaidAt);
    passed('Verified, opted-in customers receive turn notifications through the SMS adapter; repeated completion preserves payment timestamps');
    const failedTicket = await request('/queue/walkin', { customer: 'Delivery failure test', serviceId: 'basic' }, userToken);
    rejectDelivery = true;
    await request(`/admin/queue/${failedTicket.data.ticket.id}`, { status: 'cancelled' }, adminToken, 'PATCH');
    const failedNotice = rows.notifications.find((item) => item.message.includes(`#${failedTicket.data.ticket.queueNumber} was cancelled`));
    assert.equal(failedNotice.channels.email.status, 'failed');
    assert.equal(failedNotice.channels.sms.status, 'failed');
    rejectDelivery = false;
    await request('/admin/notifications/retry', { id: failedNotice._id }, adminToken);
    const counts = [mails.length, sms.length];
    await request('/admin/notifications/retry', { id: failedNotice._id }, adminToken);
    assert.deepEqual([mails.length, sms.length], counts, 'Retries must not resend already accepted channels');
    assert.equal((await request('/notifications/mine', null, auth(minor))).data.notifications.some((item) => String(item.userId) === String(user._id)), false);
    passed('Failed email/SMS delivery is recorded and retryable; accepted channels are not resent and account notifications remain private');
    const concurrentTickets = [];
    for (let i = 0; i < 2; i++) concurrentTickets.push((await request('/admin/queue', { customer: `Concurrent ${i}`, price: 0 }, adminToken)).data.ticket.id);
    const concurrentCalls = await Promise.all([request('/admin/queue/next', {}, adminToken), request('/admin/queue/next', {}, adminToken)]);
    assert.deepEqual(concurrentCalls.map((item) => item.status).sort(), [200, 409]);
    assert.equal(rows.queue.filter((item) => item.status === 'serving').length, 1);
    for (const id of concurrentTickets) await request(`/admin/queue/${id}`, { status: 'cancelled' }, adminToken, 'PATCH');
    passed('Simultaneous staff calls cannot start service for two customers at once');

    const analytics = (await request('/admin/analytics', null, adminToken)).data;
    assert.equal(analytics.totals.revenue, 400);
    assert.equal(analytics.daily.reduce((sum, day) => sum + day.revenue, 0), 400);
    assert.equal(analytics.barberPerformance.reduce((sum, row) => sum + row.revenue, 0), 400);
    passed('Dashboard total, daily collections and barber collections reconcile to the same paid ledger');

    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const width of [1440, 390]) {
      const staff = await browser.newContext({ viewport: { width, height: 900 } });
      await staff.addInitScript(({ base, token, user }) => { localStorage.setItem('barberCoApiBase', base); localStorage.setItem('barberCoToken', token); localStorage.setItem('barberCoState', JSON.stringify({ user })); }, { base, token: adminToken, user: { id: String(admin._id), name: admin.name, role: 'admin', email: admin.email } });
      await staff.route('https://fonts.googleapis.com/**', (route) => route.abort());
      await staff.route('https://fonts.gstatic.com/**', (route) => route.abort());
      const page = await staff.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${base}/admin-dashboard.html`);
      await page.locator('[data-dashboard-sync]').waitFor();
      await page.locator('[data-quick-service] [name="name"]').fill('Unsaved service draft');
      const beforeBookings = Number(await page.locator('[data-metric="bookings"] strong').textContent());
      const beforeRevenue = (await request('/admin/analytics', null, adminToken)).data.totals.revenue;
      const liveBooking = await request('/appointments', { ...booking, time: width === 1440 ? '16:00' : '17:00' }, userToken);
      assert.equal(liveBooking.status, 201);
      await page.waitForFunction((count) => Number(document.querySelector('[data-metric="bookings"] strong').textContent) === count, beforeBookings + 1, { timeout: 12000 });
      await request(`/admin/appointments/${liveBooking.data.appointment.id}`, { status: 'confirmed' }, adminToken, 'PATCH');
      await page.waitForFunction((amount) => Number(document.querySelector('[data-metric="revenue"] strong').textContent.replace(/[^0-9.]/g, '')) === amount, beforeRevenue + 250, { timeout: 12000 });
      assert.equal(await page.locator('[data-quick-service] [name="name"]').inputValue(), 'Unsaved service draft');
      const initialWaiting = Number(await page.locator('[data-metric="waiting"] strong').textContent());
      const fresh = await request('/admin/queue', { customer: `Live UI ${width}`, price: 150, serviceId: 'basic', cutName: 'Basic Haircut' }, adminToken);
      await page.waitForFunction((count) => Number(document.querySelector('[data-metric="waiting"] strong').textContent) === count, initialWaiting + 1, { timeout: 12000 });
      assert.equal(await page.locator('[data-quick-service] [name="name"]').inputValue(), 'Unsaved service draft');
      assert.ok((await page.locator('[data-period-totals]').innerText()).includes('all-time collected'));
      assert.ok((await page.locator('[data-period-totals]').innerText()).includes('selected period'));
      await page.goto(`${base}/admin-logbook.html`);
      await page.locator('[data-queue-rows]').waitFor();
      await page.locator('[name="customer"]').fill('Unsaved walk-in draft');
      await request(`/admin/queue/${fresh.data.ticket.id}`, { status: 'serving' }, adminToken, 'PATCH');
      await page.waitForFunction(() => document.querySelector('[data-count="serving"]').textContent === '1', { timeout: 12000 });
      assert.equal(await page.locator('[name="customer"]').inputValue(), 'Unsaved walk-in draft');
      await request(`/admin/queue/${fresh.data.ticket.id}`, { status: 'done' }, adminToken, 'PATCH');
      await page.waitForFunction(() => document.querySelector('[data-count="serving"]').textContent === '0', { timeout: 12000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(root, `production-logbook-${width}-check.png`), fullPage: true });
      await page.goto(`${base}/admin-schedule.html`);
      await page.getByRole('link', { name: 'Payment proof' }).first().click();
      await page.waitForFunction(() => document.querySelector('.receipt-dialog img')?.naturalWidth > 0);
      const downloadEvent = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Download receipt' }).click();
      assert.equal(fs.readFileSync(await (await downloadEvent).path()).length, fs.readFileSync(path.join(root, 'images/logo.png')).length);
      await page.screenshot({ path: path.join(root, `production-receipt-${width}-check.png`), fullPage: true });
      await page.getByRole('button', { name: 'Close receipt' }).click();
      assert.equal(errors.length, 0, errors.join('\n'));
      await staff.close();
      passed(`Dashboard/logbook live synchronization preserves drafts; receipt renders/downloads without overflow at ${width}px`);
    }

    const customerContext = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await customerContext.addInitScript(({ base, token, user }) => { localStorage.setItem('barberCoApiBase', base); localStorage.setItem('barberCoToken', token); localStorage.setItem('barberCoState', JSON.stringify({ user: { ...user, role: 'admin' } })); }, { base, token: userToken, user: { id: String(user._id), email: user.email, name: user.name } });
    const customerPage = await customerContext.newPage();
    await customerPage.goto(`${base}/admin-dashboard.html`);
    await customerPage.waitForURL('**/index.html');
    assert.equal(await customerPage.locator('.app-shell').count(), 0);
    await customerPage.goto(`${base}/login.html?next=admin-dashboard.html`);
    await customerPage.locator('[name="password"]').fill('previous secret');
    await customerPage.locator('[data-login-method="email"]').click();
    assert.equal(await customerPage.locator('[name="password"]').inputValue(), '');
    await customerPage.locator('[name="identifier"]').fill(user.email);
    await customerPage.locator('[name="password"]').fill(nextPassword);
    await customerPage.getByRole('button', { name: 'Sign In', exact: true }).click();
    await customerPage.waitForURL('**/index.html');
    await customerPage.goto(`${base}/register.html`);
    assert.equal(await customerPage.locator('[name="confirmPassword"]').count(), 1);
    const box = await customerPage.locator('[type="checkbox"]').boundingBox();
    assert.ok(box.width >= 17 && box.width <= 20);
    assert.ok(await customerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await customerPage.screenshot({ path: path.join(root, 'production-registration-390-check.png'), fullPage: true });
    await customerContext.close();
    passed('Forged local admin role and admin next= redirect cannot grant customer access; mobile confirmation/terms and password clearing work');
    const signup = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await signup.addInitScript((base) => localStorage.setItem('barberCoApiBase', base), base);
    await signup.route('https://fonts.googleapis.com/**', (route) => route.abort());
    await signup.route('https://fonts.gstatic.com/**', (route) => route.abort());
    const signupPage = await signup.newPage();
    await signupPage.goto(`${base}/register.html`);
    await signupPage.locator('[name="name"]').fill('Browser Verified Customer');
    await signupPage.locator('[name="phone"]').fill('09191234567');
    await signupPage.locator('[name="email"]').fill('browser@isolated.test');
    await signupPage.locator('[name="birthDate"]').fill('2000-01-01');
    await signupPage.locator('[name="password"]').fill(nextPassword);
    await signupPage.locator('[name="confirmPassword"]').fill('Not-the-same-password');
    await signupPage.locator('[type="checkbox"]').check();
    await signupPage.getByRole('button', { name: 'Create account and continue' }).click();
    await signupPage.locator('[data-toast]').filter({ hasText: 'Passwords do not match' }).waitFor();
    await signupPage.locator('[name="confirmPassword"]').fill(nextPassword);
    await signupPage.getByRole('button', { name: 'Create account and continue' }).click();
    await signupPage.locator('[name="code"]').waitFor();
    assert.equal(await signupPage.evaluate(() => localStorage.getItem('barberCoToken')), null);
    await signupPage.locator('[name="code"]').fill(codeFor('browser@isolated.test'));
    await signupPage.getByRole('button', { name: 'Verify and continue' }).click();
    await signupPage.waitForURL('**/index.html');
    assert.equal(await signupPage.evaluate(() => JSON.parse(localStorage.getItem('barberCoState')).user.emailVerified), true);
    await signupPage.goto(`${base}/login.html`);
    await signupPage.getByRole('button', { name: 'Forgot password?' }).click();
    await signupPage.locator('[data-forgot-email]').fill('browser@isolated.test');
    await signupPage.getByRole('button', { name: 'Send code', exact: true }).click();
    await signupPage.locator('[data-reset-modal].show').waitFor();
    await signupPage.locator('[data-reset-code]').fill(codeFor('browser@isolated.test'));
    await signupPage.locator('[data-reset-password]').fill('Browser-reset-password-2026');
    await signupPage.locator('[data-reset-confirm]').fill('Browser-reset-password-2026');
    await signupPage.getByRole('button', { name: 'Confirm', exact: true }).click();
    await signupPage.locator('[data-login-alert].success').waitFor();
    await signupPage.locator('[data-login-method="email"]').click();
    await signupPage.locator('[name="identifier"]').fill('browser@isolated.test');
    await signupPage.locator('[name="password"]').fill('Browser-reset-password-2026');
    await signupPage.getByRole('button', { name: 'Sign In', exact: true }).click();
    await signupPage.waitForURL('**/index.html');
    await signup.close();
    passed('Mobile registration verifies an emailed code before auto-login; the actual forgot-password UI resets and signs in with the new password');
    console.log(`Production hardening: ${checks} scenario groups passed. No live customer records or messages were created.`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    global.fetch = nativeFetch;
    for (const key of envNames) if (savedEnv[key] == null) delete process.env[key]; else process.env[key] = savedEnv[key];
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
