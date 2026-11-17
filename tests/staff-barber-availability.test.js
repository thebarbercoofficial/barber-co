const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const secret = 'staff-availability-fixture';
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const owner = { _id: new ObjectId(), role: 'moderator' };
const records = {
  users: [owner], services: [{ _id: new ObjectId(), slug: 'basic', duration: '30 min', active: true }],
  barbers: [
    { _id: new ObjectId(), slug: 'leave', name: 'Leave', status: 'active', leaveFrom: today, leaveTo: today },
    { _id: new ObjectId(), slug: 'status-leave', name: 'Status leave', status: 'on-leave' },
    { _id: new ObjectId(), slug: 'free', name: 'Free', status: 'active' },
    { _id: new ObjectId(), slug: 'busy', name: 'Busy', status: 'active' }
  ],
  queue: [{ _id: new ObjectId(), barberId: 'busy', serviceId: 'basic', status: 'serving', calledAt: new Date() }]
};
const database = require('./helpers/memory-db').memoryDb(records);
const context = { require: require('node:module').createRequire(path.resolve('api/index.js')), module: { exports: {} }, process: { env: { JWT_SECRET: secret } }, URL, console, database };
vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\ndb = async () => database;`, context);
async function request(method, url, body) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { method, url: `/api${url}`, headers: { authorization: `Bearer ${jwt.sign({ sub: String(owner._id) }, secret)}` } });
  let value;
  const res = { setHeader() {}, end(text) { value = JSON.parse(text); } };
  await context.module.exports(req, res);
  return { status: res.statusCode, body: value };
}
(async () => {
  const availability = await request('GET', '/queue/barber-availability?serviceId=basic');
  assert.equal(availability.status, 200);
  assert.ok(availability.body.onLeaveBarberIds.includes('leave'));
  assert.ok(availability.body.onLeaveBarberIds.includes('status-leave'));
  for (const barberId of ['leave', 'status-leave', 'busy', 'missing']) {
    const result = await request('POST', '/admin/queue', { customer: 'Customer', serviceId: 'basic', barberId });
    assert.equal(result.status, 409, JSON.stringify(result));
  }
  for (const barberId of ['free', '']) {
    const result = await request('POST', '/admin/queue', { customer: 'Customer', serviceId: 'basic', barberId });
    assert.equal(result.status, 201, JSON.stringify(result));
    assert.equal(result.body.ticket.barberId, barberId);
  }
  console.log('Staff walk-in leave/busy rejection and available/unassigned creation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
