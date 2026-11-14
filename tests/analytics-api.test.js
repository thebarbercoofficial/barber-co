const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const secret = 'isolated-analytics-test-secret';
const owner = { _id: new ObjectId(), role: 'admin', name: 'Test owner' };
const appointment = { _id: new ObjectId(), customer: 'Test booking', barberId: 'alex', serviceId: 'basic', date: '2100-03-03', time: '14:00', total: 250, status: 'pending', paid: false, createdAt: new Date() };
const queue = [{ _id: new ObjectId(), price: 150, paid: true, status: 'done', createdAt: new Date(), paidAt: new Date() }];
const records = {
  users: [owner, ...Array.from({ length: 3 }, () => ({ _id: new ObjectId(), role: 'customer' }))],
  appointments: [appointment], queue,
  services: [{ _id: new ObjectId(), slug: 'basic', price: 150, duration: '30 min', active: true }],
  barbers: [{ _id: new ObjectId(), slug: 'alex', name: 'Alex', status: 'active' }],
  settings: [{ _id: 'shop' }], appointmentSlots: [], counters: []
};
const database = require('./helpers/memory-db').memoryDb(records);
const context = { require: require('node:module').createRequire(path.resolve('api/index.js')), module: { exports: {} }, process: { env: { JWT_SECRET: secret } }, URL, console, fixtureDatabase: database };
vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\ndb = async () => fixtureDatabase;`, context);
const handler = context.module.exports;
async function request(method, url, body, authenticated = true) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { method, url, headers: authenticated ? { authorization: `Bearer ${jwt.sign({ sub: String(owner._id), role: 'admin' }, secret)}` } : {} });
  let result;
  const res = { statusCode: 0, setHeader() {}, end(value) { result = JSON.parse(value); } };
  await handler(req, res);
  return { status: res.statusCode, body: result };
}

async function run() {
  assert.equal((await request('GET', '/api/admin/analytics', null, false)).status, 401);
  owner.role = 'moderator';
  assert.equal((await request('GET', '/api/admin/analytics')).status, 403);
  owner.role = 'customer';
  assert.equal((await request('GET', '/api/admin/analytics')).status, 403);
  owner.role = 'admin';
  let response = await request('GET', '/api/admin/analytics');
  assert.equal(response.status, 200);
  assert.equal(response.body.daily.length, 365);
  assert.equal(response.body.totals.revenue, 150);
  assert.equal(records.appointmentSlots.length, 0, 'Pending reservations do not hold capacity');
  response = await request('PATCH', `/api/admin/appointments/${appointment._id}`, { status: 'confirmed' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(appointment.status, 'confirmed');
  assert.deepEqual(records.appointmentSlots.map(slot => slot._id), [840, 855].map(minute => `${appointment.date}:${records.barbers[0]._id}:${minute}`));
  assert.ok(records.appointmentSlots.every(slot => slot.appointmentId === String(appointment._id) && !slot.expiresAt), 'Approval acquires permanent locks for this reservation');
  assert.ok(appointment.paidAt);
  const paidAt = appointment.paidAt;
  response = await request('PATCH', `/api/admin/appointments/${appointment._id}`, { status: 'completed' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(appointment.status, 'completed');
  assert.equal(records.appointmentSlots.length, 0, 'Completion releases capacity');
  assert.equal(appointment.paidAt, paidAt, 'Completion must not move a payment to a different day');
  response = await request('GET', '/api/admin/analytics');
  assert.equal(response.body.totals.revenue, 400);
  assert.equal(response.body.daily.at(-1).revenue, 400);
  assert.equal(response.body.barberPerformance[0].completed, 1);
  assert.equal(response.body.barberPerformance[0].bookings, 1);
  assert.equal(response.body.barberPerformance[0].revenue, 250);
  assert.equal(response.body.barberPerformance.reduce((sum, row) => sum + row.revenue, 0), response.body.totals.revenue);
  console.log('Analytics API admin-only access, collected totals, and stable payment timestamps passed');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
