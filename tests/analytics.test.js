const assert = require('node:assert/strict');
const { buildAnalytics, buildBarberPerformance } = require('../lib/analytics');
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
const performance = buildBarberPerformance([
  { barberId: 'alex', status: 'completed', paid: true, total: 250 },
  { barberId: 'id-alex', status: 'confirmed', paid: true, total: 300 },
  { barberId: 'alex', status: 'cancelled', paid: false, total: 500 },
  { barberId: 'alex', demoPayment: true, paid: true, total: 999, status: 'completed' },
  { status: 'pending', paid: false },
  { barberId: 'deleted-id', status: 'completed', paid: true, total: 200 }
], [
  { barberId: 'id-alex', status: 'done', paid: true, price: 150 },
  { barberId: 'alex', status: 'waiting', paid: false, price: 150 },
  { barberId: 'alex', status: 'cancelled', paid: false, price: 150 }
], [{ _id: 'id-alex', slug: 'alex', name: 'Alex', status: 'active' }, { _id: 'id-luis', name: 'Luis', status: 'on-leave' }], services);
assert.deepEqual(performance[0], { id: 'id-alex', name: 'Alex', status: 'active', bookings: 3, walkins: 3, completed: 2, cancelled: 2, revenue: 700, demoBookings: 1 });
assert.equal(performance[1].completed, 0, 'Barbers with no work still appear');
assert.equal(performance.find((row) => row.id === 'unassigned').bookings, 1);
assert.equal(performance.find((row) => row.id === 'deleted-id').revenue, 200, 'Historical work is not dropped if a barber is removed');
assert.equal(performance.reduce((sum, row) => sum + row.revenue, 0), 900);
assert.deepEqual(buildBarberPerformance([], [], [], []), []);
console.log('Per-barber online/walk-in performance, aliases, completion, cancellations, demo separation, and historical records passed');
