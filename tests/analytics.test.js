const assert = require('node:assert/strict');
const { buildAnalytics } = require('../lib/analytics');
const now = new Date('2026-10-04T12:00:00Z');
const services = [{ slug: 'basic', price: 999 }];
const appointments = [
  { createdAt: '2026-10-02T17:00:00Z', paidAt: '2026-10-03T17:00:00Z', paid: true, total: 250, serviceId: 'basic' },
  { createdAt: '2026-10-03T01:00:00Z', paid: false, total: 500 },
  { createdAt: '2025-01-01', updatedAt: '2026-10-02T01:00:00Z', paid: true, total: 200 },
  { createdAt: 'invalid', paid: false },
  { createdAt: '2026-10-04', paid: true, total: 0 }
];
const queue = [
  { createdAt: '2026-10-03T18:00:00Z', paidAt: '2026-10-04T02:00:00Z', paid: true, price: 150, status: 'done' },
  { createdAt: '2026-10-04T02:00:00Z', paid: false, price: 150, status: 'waiting' }
];
const data = buildAnalytics(appointments, queue, 7, services, now);
assert.equal(data.daily.length, 365);
assert.equal(data.daily.at(-1).date, '2026-10-04');
assert.deepEqual(data.totals, { customers: 7, bookings: 5, walkins: 2, revenue: 600, waiting: 1 });
assert.deepEqual(data.daily.at(-1), { date: '2026-10-04', bookings: 1, walkins: 2, revenue: 400 });
assert.equal(data.daily.at(-2).bookings, 2);
assert.equal(data.daily.at(-3).revenue, 200);
assert.equal(data.legacyPayments, 2);
assert.equal(data.daily.at(-4).revenue, 0);
assert.equal(buildAnalytics([], [], 0, [], now).daily.every((day) => day.revenue === 0), true);
assert.equal(buildAnalytics([{ serviceId: 'basic', bookingFee: 100, paid: true, createdAt: now }], [], 0, services, now).totals.revenue, 1099);
console.log('Analytics totals, payment snapshots, Philippine dates, and empty series passed');
