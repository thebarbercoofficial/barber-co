// Group creation is disabled; historical records stay readable and single bookings remain supported.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { Readable } = require('node:stream');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { memoryDb } = require('./helpers/memory-db');
const localRequire = require('node:module').createRequire(path.resolve('api/index.js'));
const users = ['customer', 'moderator'].map((role, i) => ({ _id: new ObjectId(), role, name: `Person ${i}`, email: `${i}@test.invalid` }));
const barber = { _id: new ObjectId(), slug: 'test-barber', status: 'active' };
const service = { _id: new ObjectId(), slug: 'basic', duration: '30 min', price: 150, active: true };
const legacy = { _id: new ObjectId(), userId: users[0]._id, customer: users[0].name, serviceId: 'basic', barberId: barber.slug, date: '2100-03-03', time: '14:00', partySize: 3, partyMembers: ['Person 0', 'Guest 1', 'Guest 2'], durationMinutes: 90, total: 550, status: 'confirmed', paid: true, createdAt: new Date() };
const database = memoryDb({ users, appointments: [legacy], appointmentHolds: [], appointmentSlots: [], queue: [], barbers: [barber], services: [service], settings: [{ _id: 'shop', bookingFee: 100, paymentMode: 'live', paymentRevision: 'fixture-revision', gcash: { enabled: true, accountNumber: '09123456789' } }] });
const context = { require: name => name === '../lib/notifications' ? { notify: async () => {} } : name === '../lib/receipt' ? { validateReceipt: async () => {} } : localRequire(name), module: { exports: {} }, process: { env: { JWT_SECRET: 'test', ALLOW_UNVERIFIED_ACCOUNTS: 'true' } }, URL, console, database };
vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\ndb = async () => database;`, context);
const api = context.module.exports;
async function request(url, body, method = 'POST') {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { method, url: `/api${url}`, headers: { authorization: `Bearer ${jwt.sign({ sub: String(users[0]._id) }, 'test')}` } });
  let result;
  const res = { setHeader() {}, end(data) { result = JSON.parse(data); } };
  await api(req, res);
  return { status: res.statusCode, ...result };
}
async function main() {
  const paymentRevision = (await request('/settings', null, 'GET')).settings.paymentRevision;
  const group = { serviceId: 'basic', barberId: barber.slug, date: '2100-03-04', time: '14:00', partySize: 3, partyMembers: ['Person 0', 'Guest 1', 'Guest 2'] };
  assert.equal((await request('/appointment-holds', group)).status, 400, 'Group checkout holds are rejected');
  assert.equal((await request('/appointment-holds', { ...group, partySize: 1 })).status, 400, 'A single booking cannot contain multiple guest names');
  assert.equal((await request('/appointments', { ...group, nonRefundableAccepted: true })).status, 400, 'Direct group appointment submissions are rejected');
  const legacyHold = { _id: new ObjectId(), userId: users[0]._id, serviceId: 'basic', partySize: 3, partyMembers: group.partyMembers, expiresAt: new Date(Date.now() + 600000) };
  database.records.appointmentHolds.push(legacyHold);
  assert.equal((await request('/checkout/validate', { holdId: String(legacyHold._id), paymentRevision })).status, 400, 'An old group checkout hold cannot be paid through');
  database.records.appointmentHolds.splice(database.records.appointmentHolds.indexOf(legacyHold), 1);
  assert.equal((await request('/availability?date=2100-03-04&time=14:00&serviceId=basic&partySize=3', null, 'GET')).status, 400, 'Group availability requests are rejected');

  const single = await request('/appointment-holds', { serviceId: 'basic', barberId: barber.slug, date: '2100-03-05', time: '14:00', partySize: 1, partyMembers: ['Guest'] });
  assert.equal(single.status, 201, JSON.stringify(single));
  assert.equal(single.hold.partySize, 1);
  assert.deepEqual(single.hold.partyMembers, [users[0].name]);
  assert.equal(single.hold.durationMinutes, 30);
  assert.equal(single.hold.total, 250);
  const checkout = await request('/checkout/validate', { holdId: single.hold.id, paymentRevision });
  assert.equal(checkout.status, 200, JSON.stringify(checkout));
  const submitted = await request('/appointments', { customer: users[0].name, serviceId: 'basic', barberId: barber.slug, date: '2100-03-05', time: '14:00', holdId: single.hold.id, nonRefundableAccepted: true, paymentMethod: 'GCash', paymentProof: 'data:image/png;base64,dGVzdA==', paymentMode: 'live', paymentRevision });
  assert.equal(submitted.status, 201, JSON.stringify(submitted));
  assert.equal(submitted.appointment.partySize, 1);
  assert.deepEqual(submitted.appointment.partyMembers, [users[0].name]);
  assert.equal(submitted.appointment.durationMinutes, 30);
  assert.equal(submitted.appointment.total, 250);

  const old = database.records.appointments.find(item => String(item._id) === String(legacy._id));
  assert.equal(old.partySize, 3, 'Existing group appointment data remains viewable');
  assert.deepEqual(old.partyMembers, legacy.partyMembers);
  assert.equal(legacy.status, 'confirmed', 'Existing group appointment data is unchanged');
  console.log('New group booking blocked, single booking and checkout pass, historical group booking remains readable');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
