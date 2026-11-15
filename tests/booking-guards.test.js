const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { memoryDb } = require('./helpers/memory-db');
const guards = require('../lib/booking-guards');

async function main() {
  const userId = new ObjectId();
  const booking = { _id: new ObjectId(), userId, date: '2100-03-03', time: '14:00', durationMinutes: 60, barberId: 'alex', status: 'pending' };
  const db = memoryDb({ appointments: [booking], queue: [] });
  await assert.rejects(guards.requireCustomerCapacity(db, userId, booking.date, '14:30', 30), /overlapping/);
  await guards.requireCustomerCapacity(db, userId, booking.date, '15:00', 30);
  await guards.requireCustomerCapacity(db, userId, booking.date, '14:30', 30, String(booking._id));
  await guards.requireCustomerCapacity(db, new ObjectId(), booking.date, '14:30', 30);
  booking.rescheduleRequest = { status: 'pending', date: booking.date, time: '16:00' };
  await assert.rejects(guards.requireCustomerCapacity(db, userId, booking.date, '16:30', 30), /overlapping/);
  const now = new Date('2100-03-03T06:00:00Z');
  assert.throws(() => guards.requireFuture(booking.date, '14:00', now.getTime()), /15 minutes/);
  guards.requireFuture(booking.date, '14:30', now.getTime());
  const key = guards.guestKey({ socket: { remoteAddress: '127.0.0.1' } });
  db.records.queue.push({ source: 'shop-qr', guestKey: key, customer: 'Ada', status: 'waiting', createdAt: now });
  await assert.rejects(guards.requireGuestAllowance(db, key, null, 'ada', now), /active queue ticket/);
  await guards.requireGuestAllowance(db, key, null, 'Another person', now);
  for (let i = 0; i < 4; i++) db.records.queue.push({ source: 'shop-qr', guestKey: key, customer: `Other ${i}`, status: 'done', createdAt: now });
  await assert.rejects(guards.requireGuestAllowance(db, key, null, 'Spam', now), error => error.status === 429);
  const fs = require('node:fs');
  const vm = require('node:vm');
  const localRequire = require('node:module').createRequire(require('node:path').resolve('api/index.js'));
  const context = { require: localRequire, module: { exports: {} }, process, console };
  vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\nmodule.exports.unavailable = unavailableBarbers;`, context);
  const current = new Date();
  const slot = new Date(current.getTime() + 8 * 3600000).toISOString();
  const barber = { _id: new ObjectId(), slug: 'alex', status: 'active' };
  const capacity = memoryDb({ appointments: [], services: [], barbers: [barber], queue: [{ status: 'serving', barberId: String(barber._id), calledAt: current, durationMinutes: 60 }] });
  const blocked = await context.module.exports.unavailable(capacity, slot.slice(0, 10), slot.slice(11, 16), 30);
  assert.ok(blocked.includes('alex'), 'serving walk-in blocks booking using either barber alias');
  console.log('Booking guards: account overlaps, alternate barbers, pending reschedules, lead time, duplicate/rate limits and serving capacity passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
