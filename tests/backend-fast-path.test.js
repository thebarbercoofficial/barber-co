const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { Readable } = require('node:stream');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { memoryDb } = require('./helpers/memory-db');

async function main() {
  const admin = { _id: new ObjectId(), role: 'admin' };
  const customer = { _id: new ObjectId(), role: 'customer' };
  const database = memoryDb({ users: [admin, customer], services: [{ slug: 'cut', duration: '30 min' }], appointments: Array.from({ length: 125 }, (_, i) => ({ _id: new ObjectId(), customer: `Customer ${i}`, status: 'pending', date: '2099-01-05', time: '13:00', createdAt: new Date(i * 1000), updatedAt: new Date(i * 1000), paymentProof: 'must-not-leak', customerEmail: 'private@example.test', notificationOutbox: { private: true } })) });
  const localRequire = require('node:module').createRequire(path.resolve('api/index.js'));
  let sweeps = 0;
  const context = { require: name => name === '../lib/front-desk' ? deps => ({ ...localRequire(name)(deps), sweep: async () => {
    sweeps++;
    assert.ok(!database.records.counters?.some(row => row._id === 'appointment-mutation:booking-capacity'), 'Maintenance must not hold global capacity');
  } }) : localRequire(name), module: { exports: {} }, URL, console, process: { env: { JWT_SECRET: 'fast-test' } }, database };
  vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\ndb = async () => database;`, context);
  async function request(url, actor = admin, method = 'GET', body, stream) {
    const req = stream || Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { method, url: `/api${url}`, headers: actor ? { authorization: `Bearer ${jwt.sign({ sub: String(actor._id) }, 'fast-test')}` } : {} });
    let data;
    const headers = {};
    const res = { setHeader(key, value) { headers[key] = value; }, end(raw) { data = JSON.parse(raw); } };
    await context.module.exports(req, res);
    return { status: res.statusCode, data, headers };
  }
  assert.equal((await request('/admin/appointment-events', null)).status, 401);
  assert.equal((await request('/admin/appointment-events', customer)).status, 403);
  const events = await request('/admin/appointment-events');
  assert.equal(events.status, 200);
  assert.equal(events.headers['Cache-Control'], 'no-store');
  assert.equal(events.data.appointments.length, 100);
  assert.equal(events.data.appointments[0].customer, 'Customer 124');
  assert.ok(events.data.appointments.every(row => !('paymentProof' in row) && !('customerEmail' in row) && !('notificationOutbox' in row) && row.mongoId));
  admin.role = 'moderator';
  assert.equal((await request('/admin/appointment-events')).status, 200);
  const available = await request('/availability?date=2099-01-05&time=13:00&serviceId=cut', null);
  assert.equal(available.status, 200);
  assert.equal(sweeps, 0, 'Availability never performs maintenance');
  const slowBody = new Readable({ read() {} });
  const pending = request('/appointment-holds', customer, 'POST', null, slowBody);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!database.records.counters?.some(row => row._id === 'appointment-mutation:booking-capacity'), 'Slow request body cannot monopolize capacity');
  slowBody.push('{}');
  slowBody.push(null);
  await pending;
  await request('/admin/queue/next', admin, 'POST', {});
  await request('/admin/queue/next', admin, 'POST', {});
  assert.equal(sweeps, 1, 'Repeated serving requests reuse throttled maintenance outside lease');
  assert.equal(database.records.counters.filter(row => row._id === 'appointment-mutation:booking-capacity').length, 0, 'Capacity lease released');
  console.log('Fast path: read-only availability, pre-lock body parsing, pre-lock throttled queue sweep, projected latest-100 events and admin/moderator authorization passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
