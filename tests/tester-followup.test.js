const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { Readable } = require('node:stream');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { memoryDb } = require('./helpers/memory-db');
const { createSmsSender, smsReady, smsProviderName } = require('../lib/notifications');
const { onLeave, leaveDates } = require('../lib/barber-leave');

async function main() {
  const env = { SMS_PROVIDER: 'iprog', IPROG_API_TOKEN: 'isolated-test-token' };
  let sent;
  const send = createSmsSender({ env, fetchImpl: async (url, options) => {
    sent = { url, ...JSON.parse(options.body) };
    return { ok: true, json: async () => ({ status: 200, message_id: 'test-id' }) };
  } });
  assert.equal(smsReady(env), true);
  assert.equal(smsProviderName(env), 'IPROG SMS');
  assert.equal(await send('09968527664', 'Your booking was approved.'), 'test-id');
  assert.equal(sent.phone_number, '639968527664');
  assert.equal(sent.api_token, env.IPROG_API_TOKEN);
  assert.equal(sent.url, 'https://www.iprogsms.com/api/v1/sms_messages');
  assert.equal(smsReady({ SMS_PROVIDER: 'iprog' }), false);
  const rejected = createSmsSender({ env, fetchImpl: async () => ({ ok: true, json: async () => ({ status: 400, message: 'private detail' }) }) });
  await assert.rejects(rejected('09968527664', 'test'), /IPROG rejected/);
  assert.throws(() => leaveDates({ leaveFrom: '2100-02-30', leaveTo: '2100-03-01' }));
  assert.throws(() => leaveDates({ leaveFrom: '2100-03-03', leaveTo: '2100-03-01' }));
  assert.equal(onLeave({ status: 'active', leaveFrom: '2100-03-01', leaveTo: '2100-03-03' }, '2100-03-02'), true);
  assert.equal(onLeave({ status: 'active', leaveFrom: '2100-03-01', leaveTo: '2100-03-03' }, '2100-03-04'), false);

  const admin = { _id: new ObjectId(), role: 'admin' };
  const barber = { _id: new ObjectId(), slug: 'alex', status: 'active' };
  const booking = { _id: new ObjectId(), userId: new ObjectId(), customer: 'QA', status: 'pending', date: '2100-03-02', time: '14:00', barberId: 'alex' };
  const db = memoryDb({ users: [admin], barbers: [barber], appointments: [booking], services: [{ _id: new ObjectId(), slug: 'cut', duration: '30 min', active: true }] });
  const localRequire = require('node:module').createRequire(path.resolve('api/index.js'));
  const context = { require: name => name === '../lib/notifications' ? { notify: async () => {} } : localRequire(name), module: { exports: {} }, URL, console, process: { env: { JWT_SECRET: 'tester-followup' } }, database: db };
  vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\ndb = async () => database;`, context);
  const request = async (url, body, method = 'PATCH') => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { method, url: `/api${url}`, headers: { authorization: `Bearer ${jwt.sign({ sub: String(admin._id) }, 'tester-followup')}` } });
    let data;
    const res = { setHeader() {}, end(raw) { data = JSON.parse(raw); } };
    await context.module.exports(req, res);
    return { status: res.statusCode, ...data };
  };
  assert.equal((await request(`/admin/barbers/${barber._id}`, { status: 'active', leaveFrom: '2100-03-01', leaveTo: '2100-03-03' })).status, 409);
  assert.equal((await request(`/admin/appointments/${booking._id}`, { status: 'disapproved' })).status, 400);
  assert.equal((await request(`/admin/appointments/${booking._id}`, { status: 'disapproved', reason: 'Receipt could not be verified.' })).status, 200);
  assert.equal(booking.status, 'disapproved');
  assert.equal(booking.refundStatus, 'review-required');
  assert.equal((await request(`/admin/appointments/${booking._id}`, { status: 'confirmed' })).status, 409);
  assert.equal((await request(`/admin/barbers/${barber._id}`, { status: 'active', leaveFrom: '2100-03-01', leaveTo: '2100-03-03' })).status, 200);
  const availability = await request('/availability?date=2100-03-02&time=14:00&serviceId=cut', null, 'GET');
  assert.equal(availability.status, 200);
  assert.ok(availability.unavailableBarberIds.includes('alex'));

  const old = { _id: new ObjectId(), userId: new ObjectId(), customer: 'Expired', date: '2099-12-31', time: '14:00', status: 'pending', paid: false };
  const walkin = { _id: new ObjectId(), status: 'waiting', source: 'staff', createdAt: new Date('2099-12-31T06:00:00Z'), price: 150, paid: false };
  const rolloverDb = memoryDb({ appointments: [old], queue: [walkin] });
  const desk = require('../lib/front-desk')({ withAppointmentMutation: async (_db, _id, action) => action(), notify: async () => {}, serviceDuration: () => 30 });
  await desk.sweep(rolloverDb, new Date('2100-01-01T01:00:00Z'));
  assert.equal(old.cancelledBy, 'review-expiration');
  assert.equal(old.refundStatus, 'review-required');
  assert.equal(walkin.cancelledBy, 'day-rollover');
  assert.equal(walkin.paid, false);
  await desk.sweep(rolloverDb, new Date('2100-01-01T01:00:01Z'));
  assert.equal(rolloverDb.records.queue.length, 1, 'Rollover preserves history');
  console.log('IPROG request/failure handling, leave dates and availability, disapproval lifecycle, expiry and daily rollover passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
