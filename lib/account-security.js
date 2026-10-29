const crypto = require('node:crypto');

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const failure = (message, status, retryAfter) => Object.assign(new Error(message), { status, retryAfter });
const emailReady = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

async function sendEmail(to, subject, text, key) {
  if (!emailReady()) throw failure('Email delivery is not configured. Please contact the shop.', 503);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text })
  });
  if (!response.ok) throw failure('The email service could not accept the message. Please retry later.', 503);
  const result = await response.json();
  return result.id;
}

async function checkLogin(database, key) {
  const record = await database.collection('loginAttempts').findOne({ _id: digest(key) });
  const seconds = Math.ceil((new Date(record?.blockedUntil || 0).getTime() - Date.now()) / 1000);
  if (seconds > 0) throw failure(`Too many incorrect attempts. Try again in ${Math.ceil(seconds / 60)} minutes.`, 429, seconds);
}

async function failedLogin(database, key) {
  const records = database.collection('loginAttempts');
  const _id = digest(key);
  const record = await records.findOneAndUpdate({ _id }, { $inc: { failures: 1 }, $set: { expiresAt: new Date(Date.now() + 86400000) } }, { upsert: true, returnDocument: 'after' });
  if (record.failures >= 5) {
    const level = Math.min(Number(record.level || 0) + 1, 5);
    const seconds = Math.min(300 * 2 ** (level - 1), 3600);
    await records.updateOne({ _id }, { $set: { failures: 0, level, blockedUntil: new Date(Date.now() + seconds * 1000) } });
    throw failure(`Too many incorrect attempts. Try again in ${seconds / 60} minutes.`, 429, seconds);
  }
}

async function issueCode(database, email, purpose) {
  const collection = database.collection('accountCodes');
  const _id = digest(`${purpose}:${email}`);
  const previous = await collection.findOne({ _id });
  if (previous?.sentAt && Date.now() - new Date(previous.sentAt).getTime() < 60000) throw failure('Wait one minute before requesting another code.', 429, 60);
  const code = String(crypto.randomInt(100000, 1000000));
  const nonce = crypto.randomUUID();
  const record = { hash: digest(`${nonce}:${code}`), nonce, attempts: 0, consumed: false, expiresAt: new Date(Date.now() + 600000), sentAt: new Date() };
  await collection.updateOne({ _id }, { $set: record }, { upsert: true });
  try {
    await sendEmail(email, purpose === 'verify' ? 'Verify your Barber Co email' : 'Reset your Barber Co password', `Your code is ${code}. It expires in 10 minutes. Do not share it. If you did not request this, ignore this email.`, nonce);
  } catch (error) { await collection.deleteOne({ _id, nonce }); throw error; }
}

async function consumeCode(database, email, purpose, code) {
  const collection = database.collection('accountCodes');
  const _id = digest(`${purpose}:${email}`);
  const record = await collection.findOne({ _id });
  if (!record || record.consumed || record.attempts >= 5 || new Date(record.expiresAt).getTime() <= Date.now()) throw failure('The code is invalid or expired. Request a new code.', 400);
  const hash = digest(`${record.nonce}:${String(code || '')}`);
  const claimed = await collection.findOneAndUpdate({ _id, hash, consumed: false, attempts: { $lt: 5 }, expiresAt: { $gt: new Date() } }, { $set: { consumed: true } }, { returnDocument: 'after' });
  if (!claimed) {
    await collection.updateOne({ _id, nonce: record.nonce }, { $inc: { attempts: 1 } });
    throw failure('The code is invalid or expired. Request a new code.', 400);
  }
}

function ageOn(birthDate, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate))) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== birthDate) return null;
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (today.slice(5) < birthDate.slice(5) ? 1 : 0);
  return years >= 0 && years <= 120 ? years : null;
}

module.exports = { digest, emailReady, sendEmail, checkLogin, failedLogin, issueCode, consumeCode, ageOn };
