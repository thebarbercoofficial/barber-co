const assert = require('node:assert/strict');
const { createSmsSender, smsReady, smsProviderName, smsVerificationReady, requestPhoneVerification, verifyPhoneCode } = require('../lib/notifications');
const { memoryDb } = require('./helpers/memory-db');

async function main() {
  const env = { SMS_PROVIDER: 'philsms', PHILSMS_API_TOKEN: 'private-test-token', PHILSMS_SENDER_ID: 'BarberCo' };
  const requests = [];
  const send = createSmsSender({ env, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, async json() { return { status: 'success', data: [{ uid: 'message-123', status: 'Queued' }] }; } };
  } });
  assert.equal(smsReady(env), true);
  assert.equal(smsProviderName(env), 'PhilSMS');
  assert.equal(await send('09181234567', 'Your booking was accepted.'), 'message-123');
  assert.equal(requests[0].url, 'https://app.philsms.com/api/v3/sms/send');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-test-token');
  assert.deepEqual(JSON.parse(requests[0].options.body), { recipient: '639181234567', sender_id: 'BarberCo', type: 'plain', message: 'Your booking was accepted.' });
  assert.equal(await send('+639181234567', 'Update'), 'message-123');
  await assert.rejects(send('1234', 'Update'), /valid Philippine mobile number/);
  const incomplete = { SMS_PROVIDER: 'philsms', PHILSMS_API_TOKEN: 'token' };
  assert.equal(smsReady(incomplete), false, 'Sender ID is required for this provider API');
  const rejected = createSmsSender({ env, fetchImpl: async () => ({ ok: true, async json() { return { status: 'error', message: 'private provider details' }; } }) });
  await assert.rejects(rejected('09181234567', 'Update'), (error) => error.message === 'PhilSMS rejected the message.');
  const uni = { SMS_PROVIDER: 'unisms', UNISMS_API_KEY: 'private-unisms-key', UNISMS_SENDER_ID: 'SCHOOLTEST' };
  const uniRequests = [];
  const uniSend = createSmsSender({ env: uni, fetchImpl: async (url, options) => {
    uniRequests.push({ url, options });
    return { ok: true, status: 201, async json() { return { message: { status: 'pending', reference_id: 'uni-message-456' } }; } };
  } });
  assert.equal(smsReady(uni), true);
  assert.equal(smsProviderName(uni), 'UniSMS');
  assert.equal(await uniSend('09181234567', 'Your booking was accepted.'), 'uni-message-456');
  assert.equal(uniRequests[0].url, 'https://unismsapi.com/api/sms');
  assert.equal(uniRequests[0].options.headers.Authorization, `Basic ${Buffer.from('private-unisms-key:').toString('base64')}`);
  assert.deepEqual(JSON.parse(uniRequests[0].options.body), { recipient: '+639181234567', content: 'Your booking was accepted.', sender_id: 'SCHOOLTEST' });
  const savedFetch = global.fetch;
  const savedProvider = process.env.SMS_PROVIDER;
  const savedKey = process.env.UNISMS_API_KEY;
  const savedSender = process.env.UNISMS_SENDER_ID;
  const otpMessages = [];
  try {
    process.env.SMS_PROVIDER = 'unisms'; process.env.UNISMS_API_KEY = 'private-unisms-key'; process.env.UNISMS_SENDER_ID = 'SCHOOLTEST';
    global.fetch = async (_url, options) => { otpMessages.push(JSON.parse(options.body)); return { ok: true, async json() { return { message: { status: 'pending', reference_id: 'otp-message' } }; } }; };
    const database = memoryDb({ accountCodes: [] });
    assert.equal(smsVerificationReady(), true);
    await requestPhoneVerification(database, 'user-1', '09181234567');
    const code = otpMessages[0].content.match(/\b\d{6}\b/)[0];
    assert.equal(await database.collection('accountCodes').countDocuments({ hash: code }), 0, 'OTP is not stored in plaintext');
    await assert.rejects(verifyPhoneCode(database, 'user-1', '09181234568', code), /invalid or expired/);
    await assert.rejects(verifyPhoneCode(database, 'user-1', '09181234567', '000000'), /invalid or expired/);
    await requestPhoneVerification(database, 'user-2', '09181234567');
    const secondCode = otpMessages[1].content.match(/\b\d{6}\b/)[0];
    await verifyPhoneCode(database, 'user-2', '09181234567', secondCode);
    await assert.rejects(verifyPhoneCode(database, 'user-1', '09181234567', code), /invalid or expired/);
  } finally {
    global.fetch = savedFetch;
    if (savedProvider === undefined) delete process.env.SMS_PROVIDER; else process.env.SMS_PROVIDER = savedProvider;
    if (savedKey === undefined) delete process.env.UNISMS_API_KEY; else process.env.UNISMS_API_KEY = savedKey;
    if (savedSender === undefined) delete process.env.UNISMS_SENDER_ID; else process.env.UNISMS_SENDER_ID = savedSender;
  }
  const twilio = { TWILIO_ACCOUNT_SID: 'test-account', TWILIO_AUTH_TOKEN: 'test-auth', TWILIO_FROM: '+15005550006' };
  const twilioSend = createSmsSender({ env: twilio, fetchImpl: async (_url, options) => ({ ok: true, async json() { return { sid: new URLSearchParams(options.body).get('From') }; } }) });
  assert.equal(smsReady(twilio), true);
  assert.equal(smsProviderName(twilio), 'Twilio');
  assert.equal(await twilioSend('09181234567', 'Update'), '+15005550006');
  console.log('PASS: PhilSMS and UniSMS request shapes, provider credentials, OTP verification, Philippine phone normalization, failure handling, and legacy Twilio sending');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
