const crypto = require('node:crypto');
const leadMinutes = 15;
const start = (date, time) => new Date(`${date}T${time}:00+08:00`).getTime();
const fail = message => Object.assign(new Error(message), { status: 409 });

function requireFuture(date, time, now = Date.now()) {
  if (!(start(date, time) >= now + leadMinutes * 60000)) throw fail(`Choose a time at least ${leadMinutes} minutes from now (Philippine time).`);
}

async function requireCustomerCapacity(database, userId, date, time, duration, excludedId = '') {
  if (!userId) return;
  const appointments = await database.collection('appointments').find({ userId, status: { $in: ['pending', 'confirmed'] } }).toArray();
  const requested = start(date, time);
  const overlaps = item => {
    const from = start(item.date, item.time);
    return requested < from + (Number(item.durationMinutes) || duration) * 60000 && requested + duration * 60000 > from;
  };
  if (appointments.some(item => String(item._id) !== excludedId && (overlaps(item) || item.rescheduleRequest?.status === 'pending' && overlaps({ ...item, ...item.rescheduleRequest })))) {
    throw fail('Your account already has an overlapping booking or reschedule request. Change or cancel it first, or use one group booking for your party.');
  }
}

function guestKey(req, account, body) {
  // Only the socket/proxy IP supplied by the server is used; client labels are not an identity.
  const ip = process.env.RENDER && req.headers?.['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',').at(-1).trim() : req.socket?.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(`${account?._id || ip}`).digest('hex');
}

async function requireGuestAllowance(database, key, account, customer, now = new Date()) {
  const recent = await database.collection('queue').find({ source: 'shop-qr', createdAt: { $gt: new Date(now.getTime() - 10 * 60000) } }).toArray();
  if (recent.filter(item => item.guestKey === key).length >= 5) throw Object.assign(fail('Too many queue requests. Please ask the front desk for help.'), { status: 429, retryAfter: 600 });
  const active = await database.collection('queue').find({ source: 'shop-qr', status: { $in: ['waiting', 'serving'] } }).toArray();
  const normalized = customer.toLowerCase().replace(/\s+/g, ' ');
  if (active.some(item => account && String(item.userId) === String(account._id) || item.guestKey === key && item.customer.toLowerCase().replace(/\s+/g, ' ') === normalized)) throw fail('You already have an active queue ticket. Keep your ticket open or ask the front desk for help.');
}

function attendance(item, tickets) {
  if (item.cancelledBy === 'no-show') return 'no-show';
  if (item.status !== 'confirmed') return item.status;
  const linked = tickets.filter(ticket => ticket.appointmentId === String(item._id));
  return linked.some(ticket => ticket.status === 'serving') ? 'serving' : linked.some(ticket => ticket.status === 'waiting') ? 'in-queue' : 'confirmed';
}

module.exports = { leadMinutes, requireFuture, requireCustomerCapacity, guestKey, requireGuestAllowance, attendance };
