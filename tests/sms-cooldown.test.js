const assert = require('node:assert/strict');
const { reserve } = require('../lib/sms-budget');
const { memoryDb } = require('./helpers/memory-db');
const messaging = require('../lib/notifications');

(async () => {
  const database = memoryDb();
  const now = new Date('2026-11-17T10:00:00Z');
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => reserve(database, 'same-phone', { limit: 3, now })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'Concurrent resends reserve only one paid message');
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.status === 429 && result.reason.retryAfter > 0));
  await reserve(database, 'same-phone', { limit: 3, now: new Date(now.getTime() + 61000) });
  await reserve(database, 'same-phone', { limit: 3, now: new Date(now.getTime() + 122000) });
  await assert.rejects(reserve(database, 'same-phone', { limit: 3, now: new Date(now.getTime() + 183000) }), /Daily SMS limit/);
  await reserve(database, 'same-phone', { limit: 3, now: new Date('2026-11-17T16:00:01Z') });
  const globalResults = await Promise.allSettled(Array.from({ length: 40 }, () => reserve(database, 'global', { limit: 30, cooldownMs: 0, now })));
  assert.equal(globalResults.filter(result => result.status === 'fulfilled').length, 30);

  const saved = { provider: process.env.SMS_PROVIDER, token: process.env.IPROG_API_TOKEN, routine: process.env.SMS_ROUTINE_UPDATES, activated: process.env.SMS_ACTIVATED_AT, fetch: global.fetch };
  let sends = 0;
  try {
    process.env.SMS_PROVIDER = 'iprog'; process.env.IPROG_API_TOKEN = 'fixture';
    delete process.env.SMS_ROUTINE_UPDATES; delete process.env.SMS_ACTIVATED_AT;
    global.fetch = async () => { sends++; return { ok: true, json: async () => ({ status: 200, message_id: `fixture-${sends}` }) }; };
    const db = memoryDb({ users: [{ _id: 'customer', phone: '09171234567', phoneVerifiedAt: now, smsConsent: true }], notifications: [] });
    await messaging.notify(db, 'customer', 'Booking received.', 'booking:1');
    await messaging.notify(db, 'customer', 'Booking received.', 'booking:1');
    assert.equal(sends, 1, 'Duplicate event does not send again');
    await messaging.notify(db, 'customer', 'Booking cancelled.', 'booking:2');
    assert.equal(sends, 1, 'Different events cannot bypass per-number cooldown');
    const limited = db.records.notifications.find(item => item.channels.sms.status === 'rate-limited');
    assert.ok(limited.retryAt, 'Without email, a rate-limited notification is deferred');
    db.records.users[0].smsConsent = false;
    await messaging.notify(db, 'customer', 'No consent.', 'booking:3');
    assert.equal(sends, 1);
  } finally {
    global.fetch = saved.fetch;
    for (const [key, value] of [['SMS_PROVIDER', saved.provider], ['IPROG_API_TOKEN', saved.token], ['SMS_ROUTINE_UPDATES', saved.routine], ['SMS_ACTIVATED_AT', saved.activated]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  console.log('SMS concurrent cooldown, daily limits, Manila rollover, duplicate events, consent and deferred delivery passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
