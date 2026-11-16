const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { memoryDb } = require('./helpers/memory-db');
const { updateWithNotice } = require('../lib/notification-outbox');
const { buildAnalytics } = require('../lib/analytics');
const admin = { _id: new ObjectId(), role: 'admin', name: 'Staff' };
const localRequire = require('node:module').createRequire(path.resolve('api/index.js'));
const database = memoryDb({ users: [admin], appointments: [], queue: [], settings: [{ _id: 'shop' }], appointmentSlots: [] });
const notices = [];
const context = { require: name => name === '../lib/notifications' ? { notify: async (db, user, message) => notices.push(message) } : localRequire(name), module: { exports: {} }, process: { env: { JWT_SECRET: 'split-test' } }, URL, console, database };
vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\ndb = async () => database;`, context);
vm.runInContext('frontDesk.sweep = async () => {};', context);
async function request(url, body, method = 'PATCH') {
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, { method, url: `/api${url}`, headers: { authorization: `Bearer ${jwt.sign({ sub: String(admin._id) }, 'split-test')}` } });
  let data;
  const res = { setHeader() {}, end(raw) { data = JSON.parse(raw); } };
  await context.module.exports(req, res);
  return { status: res.statusCode, ...data };
}
function fixture() {
  const item = { _id: new ObjectId(), userId: admin._id, status: 'confirmed', date: '2100-03-03', time: '14:00', customer: 'Customer', servicePaymentMethod: 'cash', bookingFee: 100, total: 350, bookingFeePaid: true, bookingFeePaidAt: new Date(), servicePaid: false, paid: false, arrivals: { 0: new Date() }, partyMembers: ['Customer'] };
  const ticket = { _id: new ObjectId(), appointmentId: String(item._id), source: 'appointment', status: 'serving', customer: 'Customer', createdAt: new Date() };
  database.records.appointments = [item]; database.records.queue = [ticket];
  return { item, ticket };
}
async function main() {
  for (const route of ['appointment', 'queue', 'paid']) {
    const { item, ticket } = fixture();
    const url = route === 'appointment' ? `/admin/appointments/${item._id}` : `/admin/queue/${ticket._id}${route === 'paid' ? '/paid' : ''}`;
    const status = route === 'appointment' ? 'completed' : 'done';
    const method = route === 'paid' ? 'POST' : 'PATCH';
    if (route === 'paid') {
      ticket.status = 'waiting';
      const before = JSON.stringify({ item, ticket });
      const denied = await request(url, { cashCollected: true, cashAmount: 250 }, method);
      assert.equal(denied.status, 409, JSON.stringify(denied));
      assert.equal(JSON.stringify({ item, ticket }), before, 'Waiting paid rejection must not mutate booking or ticket');
      assert.equal(buildAnalytics([item], [], 0, []).totals.revenue, 100);
      ticket.status = 'serving';
    }
    for (const confirmation of [{}, { cashCollected: true, cashAmount: 249 }, { cashCollected: true, cashAmount: '250' }]) {
      const response = await request(url, { status, ...confirmation }, method);
      assert.equal(response.status, 400, JSON.stringify(response));
      assert.equal(item.status, 'confirmed'); assert.equal(ticket.status, 'serving'); assert.equal(item.servicePaid, false);
    }
    const response = await request(url, { status, cashCollected: true, cashAmount: 250 }, method);
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(item.servicePaid, true); assert.equal(item.status, 'completed');
    const paidAt = item.servicePaidAt;
    assert.equal((await request(url, { status }, method)).status, 200);
    assert.equal(item.servicePaidAt, paidAt);
    const audit = buildAnalytics([item], [], 0, []).collections;
    assert.equal(audit.bookings, 350); assert.equal(audit.records.length, 2);
    const events = Object.values(item.notificationOutbox || {});
    assert.ok(events.some(event => event.message.includes('Cash collection confirmed.')));
    assert.ok(notices.some(message => message.includes('Cash collection confirmed.')));
  }
  const { item } = fixture();
  await updateWithNotice(database, 'appointments', { _id: item._id }, { $set: { status: 'cancelled', cancelledBy: 'no-show', absentMembers: [{ name: 'Customer' }] } });
  assert.equal(buildAnalytics([item], [], 0, []).totals.revenue, 100);
  assert.ok(Object.values(item.notificationOutbox).some(event => event.message.includes('Cash balance: PHP 250.00')));
  // Exercise both request launch orders. A lease conflict is an expected loser;
  // the surviving terminal state and collection history must remain consistent.
  for (const cancelFirst of [true, false]) {
    const { item: racedItem, ticket } = fixture();
    const cancel = () => request(`/admin/queue/${ticket._id}`, { status: 'cancelled' });
    const collect = () => request(`/admin/queue/${ticket._id}/paid`, { cashCollected: true, cashAmount: 250 }, 'POST');
    const results = await Promise.all(cancelFirst ? [cancel(), collect()] : [collect(), cancel()]);
    assert.equal(results.filter(result => result.status === 200).length, 1, JSON.stringify(results));
    assert.equal(results.filter(result => result.status === 409).length, 1, JSON.stringify(results));
    const collected = ticket.status === 'done';
    assert.equal(racedItem.status, collected ? 'completed' : 'cancelled');
    assert.equal(racedItem.servicePaid, collected);
    const audit = buildAnalytics([racedItem], [], 0, []);
    assert.equal(audit.totals.revenue, collected ? 350 : 100);
    assert.equal(audit.collections.records.filter(row => row.tender === 'cash').length, collected ? 1 : 0);
    const beforeRetry = JSON.stringify({ item: racedItem, ticket });
    const retry = await collect();
    assert.equal(retry.status, collected ? 200 : 409, JSON.stringify(retry));
    assert.equal(JSON.stringify({ item: racedItem, ticket }), beforeRetry, 'Retry cannot revive a cancelled ticket or recollect cash');
  }
  {
    const { item, ticket } = fixture();
    Object.assign(item, { bookingPaymentMethod: 'onsite', bookingFeePaid: false, servicePaymentMethod: 'cash', cashDue: 350 });
    const before = JSON.stringify(item);
    const rejected = await request(`/admin/appointments/${item._id}`, { status: 'completed' });
    assert.equal(rejected.status, 400);
    assert.equal(JSON.stringify(item), before, 'Onsite completion without cash confirmation must not mutate booking');
    const completed = await request(`/admin/appointments/${item._id}`, { status: 'completed', cashCollected: true, cashAmount: 350 });
    assert.equal(completed.status, 200, JSON.stringify(completed));
    assert.equal(item.bookingFeePaid, true); assert.equal(item.servicePaid, true);
    const audit = buildAnalytics([item], [], 0, []).collections;
    assert.equal(audit.bookings, 350); assert.equal(audit.records.length, 1);
    assert.deepEqual(audit.records.map(row => [row.component, row.tender, row.amount]), [['booking-total', 'cash', 350]]);
  }
  console.log('Waiting paid rejected unchanged; serving paid succeeds; cancellation/payment races reconcile in both launch orders');
  console.log('Real API rejects missing/wrong cash amounts before writes on all three completion paths; retries, outbox and no-show accounting passed (no network/SMS)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
