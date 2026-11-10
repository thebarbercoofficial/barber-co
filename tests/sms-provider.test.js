const assert = require('node:assert/strict');
const { createSmsSender, smsReady, smsProviderName } = require('../lib/notifications');

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
  const twilio = { TWILIO_ACCOUNT_SID: 'test-account', TWILIO_AUTH_TOKEN: 'test-auth', TWILIO_FROM: '+15005550006' };
  const twilioSend = createSmsSender({ env: twilio, fetchImpl: async (_url, options) => ({ ok: true, async json() { return { sid: new URLSearchParams(options.body).get('From') }; } }) });
  assert.equal(smsReady(twilio), true);
  assert.equal(smsProviderName(twilio), 'Twilio');
  assert.equal(await twilioSend('09181234567', 'Update'), '+15005550006');
  console.log('PASS: PhilSMS request shape, Philippine phone normalization, sender configuration, failure handling, and legacy Twilio sending');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
