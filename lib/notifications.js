const crypto = require('node:crypto');
const { sendEmail } = require('./account-security');

function smsProvider(env = process.env) {
  const requested = String(env.SMS_PROVIDER || '').trim().toLowerCase();
  if (requested === 'philsms' || requested === 'twilio' || requested === 'unisms') return requested;
  if (requested) return '';
  if (env.UNISMS_API_KEY && env.UNISMS_SENDER_ID) return 'unisms';
  if (env.PHILSMS_API_TOKEN) return 'philsms';
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) return 'twilio';
  return '';
}

function smsReady(env = process.env) {
  const provider = smsProvider(env);
  if (provider === 'philsms') return Boolean(env.PHILSMS_API_TOKEN && env.PHILSMS_SENDER_ID);
  if (provider === 'unisms') return Boolean(env.UNISMS_API_KEY && env.UNISMS_SENDER_ID);
  return provider === 'twilio' && Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
}

function smsProviderName(env = process.env) {
  const provider = smsProvider(env);
  return provider === 'philsms' ? 'PhilSMS' : provider === 'unisms' ? 'UniSMS' : provider === 'twilio' ? 'Twilio' : 'Not configured';
}

function twilioVerifyReady(env = process.env) {
  return Boolean(env.TWILIO_VERIFY_SERVICE_SID && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
}

function smsVerificationReady(env = process.env) {
  return twilioVerifyReady(env) || smsReady(env);
}

function normalizePhilSmsRecipient(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^639\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `63${digits}`;
  throw new Error('SMS recipient must be a valid Philippine mobile number.');
}

function providerMessageId(value) {
  if (Array.isArray(value)) return providerMessageId(value[0]);
  if (!value || typeof value !== 'object') return '';
  for (const key of ['uid', 'message_id', 'id']) if (value[key] != null) return String(value[key]);
  return providerMessageId(value.data);
}

function createSmsSender({ env = process.env, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  return async function sendSms(phone, text) {
    if (!smsReady(env)) throw new Error('SMS provider is not configured.');
    const provider = smsProvider(env);
    if (provider === 'philsms') {
      const response = await fetchImpl('https://app.philsms.com/api/v3/sms/send', {
        method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Bearer ${env.PHILSMS_API_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ recipient: normalizePhilSmsRecipient(phone), sender_id: env.PHILSMS_SENDER_ID, type: 'plain', message: text })
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('PhilSMS returned an unreadable response.'); }
      if (!response.ok || result?.status !== 'success') throw new Error('PhilSMS rejected the message.');
      return providerMessageId(result.data) || undefined;
    }
    if (provider === 'unisms') {
      const response = await fetchImpl('https://unismsapi.com/api/sms', {
        method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Basic ${Buffer.from(`${env.UNISMS_API_KEY}:`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ recipient: `+${normalizePhilSmsRecipient(phone)}`, content: text, sender_id: env.UNISMS_SENDER_ID })
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('UniSMS returned an unreadable response.'); }
      const message = result?.message;
      if (!response.ok || !message || !['pending', 'retrying', 'sent'].includes(String(message.status || '').toLowerCase())) throw new Error('UniSMS rejected the message.');
      return message.reference_id || undefined;
    }
    const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: `+63${phone.slice(1)}`, From: env.TWILIO_FROM, Body: text })
    });
    if (!response.ok) throw new Error('SMS provider rejected the message.');
    return (await response.json()).sid;
  };
}

const sendSms = createSmsSender();

async function deliver(database, record) {
  const user = record.userId ? await database.collection('users').findOne({ _id: record.userId }) : null;
  const ticket = record.queueTicketId ? await database.collection('queue').findOne({ _id: record.queueTicketId }) : null;
  const guestEmail = ticket?.emailConsent === true ? ticket.contactEmail : '';
  const recipient = user?.emailVerifiedAt ? user.email : guestEmail;
  const channels = {};
  if (record.channels?.email?.status === 'accepted') channels.email = record.channels.email;
  else if (recipient) {
    try { channels.email = { status: 'accepted', providerId: await sendEmail(recipient, ticket ? 'The Barber Co queue update' : 'The Barber Co appointment update', record.message, record._id) }; }
    catch (error) { channels.email = { status: 'failed', error: error.message }; }
  } else channels.email = user ? { status: 'unverified' } : { status: 'not-enabled' };
  if (record.channels?.sms?.status === 'accepted') channels.sms = record.channels.sms;
  else if (process.env.SMS_ROUTINE_UPDATES === 'true' && user?.phoneVerifiedAt && user.smsConsent && user.phone) {
    try { channels.sms = { status: 'accepted', providerId: await sendSms(user.phone, record.message) }; }
    catch (error) { channels.sms = { status: 'failed', error: error.message }; }
  } else channels.sms = { status: 'not-enabled' };
  await database.collection('notifications').updateOne({ _id: record._id }, { $set: { channels, attemptedAt: new Date() } });
}

async function notify(database, userId, message, eventKey, options = {}) {
  const queueTicketId = options.queueTicketId;
  if (!userId && !queueTicketId) return;
  if (!userId && queueTicketId) {
    const ticket = await database.collection('queue').findOne({ _id: queueTicketId });
    if (ticket?.emailConsent !== true || !ticket.contactEmail) return;
  }
  const _id = crypto.createHash('sha256').update(eventKey).digest('hex');
  // Stable event ids prevent repeated clicks from sending the same notification twice.
  const inserted = await database.collection('notifications').updateOne({ _id }, { $setOnInsert: { ...(userId ? { userId } : {}), ...(queueTicketId ? { queueTicketId } : {}), message, createdAt: new Date(), channels: {} } }, { upsert: true });
  if (inserted.upsertedCount || inserted.upsertedId) await deliver(database, { _id, userId, queueTicketId, message });
}

async function twilioVerifyPhone(phone, code) {
  const response = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/${code ? 'VerificationCheck' : 'Verifications'}`, {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: `+63${phone.slice(1)}`, ...(code ? { Code: String(code) } : { Channel: 'sms' }) })
  });
  if (!response.ok) throw Object.assign(new Error('SMS verification could not be completed. Try again later.'), { status: 400 });
  const result = await response.json();
  if (code && result.status !== 'approved') throw Object.assign(new Error('The SMS code is invalid or expired.'), { status: 400 });
}

async function requestPhoneVerification(database, userId, phone) {
  const budget = database.collection('loginAttempts');
  const budgetId = crypto.createHash('sha256').update(`sms-budget:${normalizePhilSmsRecipient(phone)}:${new Date().toISOString().slice(0, 10)}`).digest('hex');
  const previousBudget = await budget.findOne({ _id: budgetId });
  if (previousBudget?.sentAt && Date.now() - new Date(previousBudget.sentAt).getTime() < 60000) throw Object.assign(new Error('Wait one minute before requesting another SMS code.'), { status: 429 });
  const allowance = await budget.findOneAndUpdate({ _id: budgetId }, { $inc: { count: 1 }, $set: { sentAt: new Date(), expiresAt: new Date(Date.now() + 172800000) } }, { upsert: true, returnDocument: 'after' });
  if (allowance.count > 3) throw Object.assign(new Error('Daily SMS limit reached. Use email recovery or try tomorrow.'), { status: 429 });
  if (twilioVerifyReady() && !String(userId).startsWith('recovery:')) return twilioVerifyPhone(phone);
  if (!smsReady()) throw Object.assign(new Error('SMS verification is not configured.'), { status: 503 });
  const collection = database.collection('accountCodes');
  const _id = crypto.createHash('sha256').update(`phone-verification:${userId}`).digest('hex');
  const previous = await collection.findOne({ _id });
  if (previous?.sentAt && Date.now() - new Date(previous.sentAt).getTime() < 60000) throw Object.assign(new Error('Wait one minute before requesting another code.'), { status: 429 });
  const code = String(crypto.randomInt(100000, 1000000));
  const nonce = crypto.randomUUID();
  await collection.updateOne({ _id }, { $set: { nonce, hash: crypto.createHash('sha256').update(`${nonce}:${code}`).digest('hex'), phoneHash: crypto.createHash('sha256').update(normalizePhilSmsRecipient(phone)).digest('hex'), attempts: 0, consumed: false, sentAt: new Date(), expiresAt: new Date(Date.now() + 600000) } }, { upsert: true });
  try {
    await sendSms(phone, `Your Barber Co verification code is ${code}. It expires in 10 minutes. Do not share it.`);
  } catch (error) {
    await collection.deleteOne({ _id, nonce });
    throw Object.assign(new Error('The SMS service could not send a verification code. Please try again later.'), { status: 503, cause: error });
  }
}

async function verifyPhoneCode(database, userId, phone, code) {
  if (twilioVerifyReady() && !String(userId).startsWith('recovery:')) return twilioVerifyPhone(phone, code);
  if (!smsReady()) throw Object.assign(new Error('SMS verification is not configured.'), { status: 503 });
  const collection = database.collection('accountCodes');
  const _id = crypto.createHash('sha256').update(`phone-verification:${userId}`).digest('hex');
  const now = new Date();
  const record = await collection.findOne({ _id, consumed: false, expiresAt: { $gt: now }, attempts: { $lt: 5 } });
  if (!record) throw Object.assign(new Error('The code is invalid or expired. Request a new code.'), { status: 400 });
  const phoneHash = crypto.createHash('sha256').update(normalizePhilSmsRecipient(phone)).digest('hex');
  if (phoneHash !== record.phoneHash) {
    await collection.updateOne({ _id, nonce: record.nonce, consumed: false }, { $set: { consumed: true } });
    throw Object.assign(new Error('The code is invalid or expired. Request a new code.'), { status: 400 });
  }
  const hash = crypto.createHash('sha256').update(`${record.nonce}:${String(code || '')}`).digest('hex');
  if (hash !== record.hash) {
    await collection.updateOne({ _id, nonce: record.nonce, consumed: false, attempts: { $lt: 5 } }, { $inc: { attempts: 1 } });
    throw Object.assign(new Error('The code is invalid or expired. Request a new code.'), { status: 400 });
  }
  const consumed = await collection.updateOne({ _id, nonce: record.nonce, hash, consumed: false, attempts: { $lt: 5 }, expiresAt: { $gt: now } }, { $set: { consumed: true } });
  if (!consumed.modifiedCount) throw Object.assign(new Error('The code is invalid or expired. Request a new code.'), { status: 400 });
}

module.exports = { notify, deliver, smsReady, smsProviderName, smsVerificationReady, createSmsSender, requestPhoneVerification, verifyPhoneCode };
