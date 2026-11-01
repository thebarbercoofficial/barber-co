const assert = require('node:assert/strict');
const { configured, createSender } = require('../lib/gmail-delivery');

async function main() {
  const env = { GMAIL_CLIENT_ID: 'test-id', GMAIL_CLIENT_SECRET: 'test-secret', GMAIL_REFRESH_TOKEN: 'test-refresh', GMAIL_SENDER: 'sender@gmail.com' };
  assert.equal(configured({}), false);
  assert.equal(configured(env), true);
  const requests = [];
  let clients = 0;
  let reject = false;
  let empty = false;
  const send = createSender({ env, clientFactory(id, secret) {
    clients++;
    assert.equal(id, 'test-id');
    assert.equal(secret, 'test-secret');
    return {
      setCredentials(value) { assert.equal(value.refresh_token, env.GMAIL_REFRESH_TOKEN); },
      async request(options) {
        requests.push(options);
        if (reject) throw new Error('provider error containing private-token');
        return { data: empty ? {} : { id: 'delivered-test-id' } };
      }
    };
  } });
  assert.equal(await send('customer@example.com', 'Verification code', 'Your code is 123456.', 'one'), 'delivered-test-id');
  assert.equal(requests[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(requests[0].retry, false);
  const mime = Buffer.from(requests[0].data.raw, 'base64url').toString();
  assert.match(mime, /From: The Barber Co <sender@gmail.com>/);
  assert.match(mime, /To: customer@example.com/);
  assert.match(mime, /Your code is 123456\./);
  await send('customer@example.com', 'Booking accepted', 'Accepted', 'two');
  assert.equal(clients, 1, 'Reuse OAuth client and cached access token');
  env.GMAIL_REFRESH_TOKEN = 'rotated-token';
  await send('customer@example.com', 'Notice', 'Updated', 'three');
  assert.equal(clients, 2, 'Credential rotation recreates the OAuth client');
  const before = requests.length;
  await assert.rejects(send('customer@example.com\r\nBcc: attacker@example.com', 'Test', 'Body', 'four'), { status: 503 });
  assert.equal(requests.length, before, 'Reject injected recipients before transmission');
  reject = true;
  await assert.rejects(send('customer@example.com', 'Test', 'Body', 'five'), (error) => error.status === 503 && !error.message.includes('private-token'));
  reject = false;
  empty = true;
  await assert.rejects(send('customer@example.com', 'Test', 'Body', 'six'), { status: 503 });
  delete env.GMAIL_REFRESH_TOKEN;
  await assert.rejects(send('customer@example.com', 'Test', 'Body', 'seven'), { status: 503 });
  console.log('PASS: Gmail MIME delivery, OAuth reuse/rotation, injection rejection, and honest redacted failures');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
