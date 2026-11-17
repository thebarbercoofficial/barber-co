const assert = require('node:assert/strict');
const { memoryDb } = require('./helpers/memory-db');
const { updateWithNotice, flush } = require('../lib/notification-outbox');
const messaging = require('../lib/notifications');

(async () => {
  const savedFetch = global.fetch;
  const keys = ['SMS_PROVIDER', 'PHILSMS_API_TOKEN', 'PHILSMS_SENDER_ID', 'SMS_ACTIVATED_AT', 'SMS_ROUTINE_UPDATES'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let sent = 0;
  try {
    process.env.SMS_PROVIDER = 'philsms'; process.env.PHILSMS_API_TOKEN = 'fixture'; process.env.PHILSMS_SENDER_ID = 'Fixture';
    delete process.env.SMS_ACTIVATED_AT; delete process.env.SMS_ROUTINE_UPDATES;
    global.fetch = async () => { sent++; return { ok: true, json: async () => ({ status: 'success', data: [{ uid: `fixture-${sent}` }] }) }; };
    const cases = [
      ['verified booking', { status: 'confirmed' }],
      ['completed booking', { status: 'completed' }],
      ['cancelled booking', { status: 'cancelled' }],
      ['disapproved booking', { status: 'disapproved' }],
      ['rescheduled booking', { date: '2100-01-03', time: '15:00' }],
      ['staff reschedule proposal', { rescheduleRequest: { status: 'pending', initiatedBy: 'staff', requestedAt: new Date(), date: '2100-01-03', time: '15:00' } }],
      ['rejected reschedule', { rescheduleRequest: { status: 'rejected', requestedAt: new Date() } }],
      ['no-show', { absentMembers: [{ name: 'Fixture' }] }],
      ['booking arrival', { 'arrivals.0': new Date() }],
      ['expired reschedule', { status: 'cancelled', cancelledBy: 'reschedule-expiration' }]
    ];
    for (const [name, update] of cases) {
      const db = memoryDb({ users: [{ _id: 'u', phone: '09171234567', phoneVerifiedAt: new Date(), smsConsent: true }], appointments: [{ _id: 'a', userId: 'u', date: '2100-01-02', time: '14:00', status: 'pending', customer: 'Fixture' }] });
      const before = sent;
      await updateWithNotice(db, 'appointments', { _id: 'a' }, { $set: update });
      await flush(db, messaging.notify);
      await messaging.retryPending(db);
      assert.equal(sent, before + 1, name);
      await messaging.retryPending(db);
      assert.equal(sent, before + 1, `${name} deduplication`);
    }
    for (const source of ['appointment', 'walk-in']) {
      const db = memoryDb({ users: [{ _id: 'u', phone: '09171234567', phoneVerifiedAt: new Date(), smsConsent: true }], queue: [{ _id: 'q', source, userId: 'u', status: 'waiting', queueNumber: 1 }] });
      const before = sent;
      await updateWithNotice(db, 'queue', { _id: 'q' }, { $set: { status: 'serving' } });
      await flush(db, messaging.notify);
      await messaging.retryPending(db);
      assert.equal(sent, before + (source === 'appointment' ? 1 : 0), `${source} queue SMS policy`);
    }
    console.log('SMS booking lifecycle, reschedule, no-show, arrival, appointment queue, walk-in suppression and deduplication passed with mocked provider');
  } finally {
    global.fetch = savedFetch;
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
