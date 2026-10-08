const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const secret = 'isolated-analytics-test-secret';
const owner = { _id: new ObjectId(), role: 'admin', name: 'Test owner' };
const appointment = { _id: new ObjectId(), customer: 'Test booking', barberId: 'alex', serviceId: 'basic', total: 250, status: 'pending', paid: false, createdAt: new Date() };
const queue = [{ _id: new ObjectId(), price: 150, paid: true, status: 'done', createdAt: new Date(), paidAt: new Date() }];
const records = { appointments: [appointment], queue, services: [{ _id: new ObjectId(), slug: 'basic', price: 150 }], barbers: [{ _id: new ObjectId(), slug: 'alex', name: 'Alex' }] };
const database = { collection(name) {
  return {
    find: () => ({ toArray: async () => records[name] || [] }),
    findOne: async (query) => name === 'users' ? owner : (records[name] || []).find((item) => String(item._id) === String(query._id)),
    countDocuments: async () => 3,
    updateOne: async (query, update) => Object.assign(records[name].find((item) => String(item._id) === String(query._id)), update.$set),
    deleteMany: async () => ({ deletedCount: 0 })
  };
} };
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
  response = await request('PATCH', `/api/admin/appointments/${appointment._id}`, { status: 'confirmed' });
  assert.equal(response.status, 200);
  assert.ok(appointment.paidAt);
  const paidAt = appointment.paidAt;
  await request('PATCH', `/api/admin/appointments/${appointment._id}`, { status: 'completed' });
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
