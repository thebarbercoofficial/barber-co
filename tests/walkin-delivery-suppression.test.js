const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ObjectId } = require('mongodb');
const { memoryDb } = require('./helpers/memory-db');
const userId = new ObjectId();
const tickets = ['shop-qr', 'staff'].map(source => ({ _id: new ObjectId(), source, userId, contactEmail: 'guest@example.test', emailConsent: true }));
const notifications = tickets.map((ticket, i) => ({ _id: `legacy-${i}`, queueTicketId: ticket._id, userId, message: 'Queue alert', createdAt: new Date(), channels: { email: { status: 'failed' } }, retryAt: new Date(0) }));
const database = memoryDb({ users: [{ _id: userId, email: 'account@example.test', emailVerifiedAt: new Date(), phone: '09123456789', phoneVerifiedAt: new Date(), smsConsent: true }], queue: tickets, notifications });
const localRequire = require('node:module').createRequire(path.resolve('lib/notifications.js'));
let deliveries = 0;
const context = { require: name => name === './account-security' ? { sendEmail: async () => { deliveries++; throw new Error('No real email'); } } : localRequire(name), module: { exports: {} }, process: { env: { SMS_PROVIDER: 'iprog', IPROG_API_TOKEN: 'fake' } }, fetch: async () => { deliveries++; throw new Error('No real SMS'); }, console, Buffer, URLSearchParams, AbortSignal };
vm.runInNewContext(fs.readFileSync('lib/notifications.js', 'utf8'), context);
(async () => {
  await context.module.exports.retryPending(database);
  for (const record of database.records.notifications) {
    assert.equal(record.retryAt, null);
    assert.equal(record.channels.email.status, 'not-enabled');
    assert.equal(record.channels.sms.status, 'not-enabled');
  }
  for (const ticket of tickets) await context.module.exports.notify(database, userId, 'Queue alert', `new-${ticket.source}`, { queueTicketId: ticket._id });
  assert.equal(database.records.notifications.length, 2);
  assert.equal(deliveries, 0);
  console.log('Legacy and new walk-in SMS/email jobs suppressed');
})().catch(error => { console.error(error); process.exitCode = 1; });
