const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { ObjectId } = require('mongodb');
const { memoryDb } = require('./helpers/memory-db');
async function main() {
  const localRequire = require('node:module').createRequire(path.resolve('api/index.js'));
  let connections = 0, indexes = 0, closed = 0;
  const memory = memoryDb({ services: [{ _id: 'existing' }], barbers: [{ _id: 'existing' }] });
  const database = { collection(name) { return { ...memory.collection(name), updateOne: async () => ({ modifiedCount: 1 }), createIndex() { if (++indexes === 1) return Promise.reject(new Error('index temporarily unavailable')); return Promise.resolve(); } }; } };
  class MongoClient {
    async connect() { if (++connections === 1) throw new Error('connection temporarily unavailable'); return this; }
    async close() { closed++; }
    db() { return database; }
  }
  const context = { require: name => name === 'mongodb' ? { MongoClient, ObjectId } : localRequire(name), module: { exports: {} }, process: { env: { MONGODB_URI: 'isolated-test' } }, console, URL };
  vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\nmodule.exports.getDb = db;`, context);
  await assert.rejects(context.module.exports.getDb(), /connection temporarily/);
  await assert.rejects(context.module.exports.getDb(), /index temporarily/);
  assert.equal(await context.module.exports.getDb(), database);
  assert.equal(connections, 2);
  assert.equal(closed, 1);
  let sends = 0, fail = true;
  const messagingRequire = require('node:module').createRequire(path.resolve('lib/notifications.js'));
  const notifications = { require: name => name === './account-security' ? { sendEmail: async () => { sends++; if (fail) throw new Error('provider unavailable'); return 'accepted-id'; } } : messagingRequire(name), module: { exports: {} }, process: { env: { SMS_ROUTINE_UPDATES: 'false' } }, AbortSignal, Buffer, URLSearchParams };
  vm.runInNewContext(fs.readFileSync('lib/notifications.js', 'utf8'), notifications);
  const user = { _id: new ObjectId(), email: 'isolated@example.test', emailVerifiedAt: new Date() };
  const db = memoryDb({ users: [user] });
  const service = notifications.module.exports;
  await service.notify(db, user._id, 'Booking accepted', 'booking:test:confirmed');
  assert.equal(sends, 1);
  assert.equal(db.records.notifications[0].attempts, 1);
  assert.ok(db.records.notifications[0].retryAt);
  await service.retryPending(db);
  assert.equal(sends, 1, 'Backoff prevents immediate retry');
  db.records.notifications[0].retryAt = new Date(0);
  await Promise.all([service.retryPending(db), service.retryPending(db)]);
  assert.equal(sends, 2, 'Concurrent retry workers use a delivery lease');
  db.records.notifications[0].retryAt = new Date(0);
  await service.retryPending(db);
  assert.equal(sends, 3);
  assert.equal(db.records.notifications[0].retryAt, null, 'Automatic retries stop after three attempts');
  fail = false;
  await service.deliver(db, db.records.notifications[0]);
  assert.equal(sends, 4, 'Staff can explicitly retry after fixing provider');
  await service.deliver(db, db.records.notifications[0]);
  await service.notify(db, user._id, 'Booking accepted', 'booking:test:confirmed');
  assert.equal(sends, 4, 'Accepted notifications are not resent');
  console.log('Connection and index failure recovery, delivery backoff, concurrent leases, retry cap and accepted-message deduplication passed without real messages');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
