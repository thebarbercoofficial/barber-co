const crypto = require('node:crypto');

// Reserve before calling a paid provider. Conditional updates also stop concurrent resends.
async function reserve(database, scope, { limit, cooldownMs = 60000, now = new Date() }) {
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const _id = crypto.createHash('sha256').update(`sms-budget:${scope}:${day}`).digest('hex');
  const records = database.collection('loginAttempts');
  try {
    await records.updateOne({ _id }, { $setOnInsert: { count: 0, expiresAt: new Date(now.getTime() + 172800000) } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  const claimed = await records.findOneAndUpdate({ _id, count: { $lt: limit }, ...(cooldownMs ? { $or: [{ sentAt: { $exists: false } }, { sentAt: { $lt: new Date(now.getTime() - cooldownMs) } }] } : {}) }, { $inc: { count: 1 }, $set: { sentAt: now } }, { returnDocument: 'after' });
  if (claimed) return;
  const previous = await records.findOne({ _id });
  const daily = previous?.count >= limit;
  const retryAfter = daily ? Math.ceil((Date.parse(`${day}T16:00:00Z`) - now.getTime()) / 1000) : Math.max(1, Math.ceil((new Date(previous?.sentAt).getTime() + cooldownMs - now.getTime()) / 1000));
  throw Object.assign(new Error(daily ? 'Daily SMS limit reached. Use email or try tomorrow.' : 'Wait one minute before requesting another SMS.'), { status: 429, retryAfter: Math.max(1, retryAfter) });
}

module.exports = { reserve };
