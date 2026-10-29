const crypto = require('node:crypto');
const { sendEmail } = require('./account-security');

function smsReady() { return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM); }
async function sendSms(phone, text) {
  if (!smsReady()) throw new Error('SMS provider is not configured.');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: `+63${phone.slice(1)}`, From: process.env.TWILIO_FROM, Body: text })
  });
  if (!response.ok) throw new Error('SMS provider rejected the message.');
  return (await response.json()).sid;
}

async function deliver(database, record) {
  const user = await database.collection('users').findOne({ _id: record.userId });
  const channels = {};
  if (record.channels?.email?.status === 'accepted') channels.email = record.channels.email;
  else if (user?.emailVerifiedAt) {
    try { channels.email = { status: 'accepted', providerId: await sendEmail(user.email, 'The Barber Co appointment update', record.message, record._id) }; }
    catch (error) { channels.email = { status: 'failed', error: error.message }; }
  } else channels.email = { status: 'unverified' };
  if (record.channels?.sms?.status === 'accepted') channels.sms = record.channels.sms;
  else if (user?.phoneVerifiedAt && user.smsConsent && user.phone) {
    try { channels.sms = { status: 'accepted', providerId: await sendSms(user.phone, record.message) }; }
    catch (error) { channels.sms = { status: 'failed', error: error.message }; }
  } else channels.sms = { status: 'not-enabled' };
  await database.collection('notifications').updateOne({ _id: record._id }, { $set: { channels, attemptedAt: new Date() } });
}

async function notify(database, userId, message, eventKey) {
  if (!userId) return;
  const _id = crypto.createHash('sha256').update(eventKey).digest('hex');
  // Stable event ids prevent repeated clicks from sending the same notification twice.
  const inserted = await database.collection('notifications').updateOne({ _id }, { $setOnInsert: { userId, message, createdAt: new Date(), channels: {} } }, { upsert: true });
  if (inserted.upsertedCount || inserted.upsertedId) await deliver(database, { _id, userId, message });
}

async function verifyPhone(phone, code) {
  if (!process.env.TWILIO_VERIFY_SERVICE_SID || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) throw Object.assign(new Error('SMS verification is not configured.'), { status: 503 });
  const response = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/${code ? 'VerificationCheck' : 'Verifications'}`, {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: `+63${phone.slice(1)}`, ...(code ? { Code: String(code) } : { Channel: 'sms' }) })
  });
  if (!response.ok) throw Object.assign(new Error('SMS verification could not be completed. Try again later.'), { status: 400 });
  const result = await response.json();
  if (code && result.status !== 'approved') throw Object.assign(new Error('The SMS code is invalid or expired.'), { status: 400 });
}

module.exports = { notify, deliver, smsReady, verifyPhone };
