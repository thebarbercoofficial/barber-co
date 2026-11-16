const crypto = require('node:crypto');

// Events live in the same document and atomic write as their business change.
async function updateWithNotice(database, collection, filter, changes, options) {
  const current = await database.collection(collection).findOne(filter);
  if (!current) return database.collection(collection).updateOne(filter, changes, options);
  const update = changes.$set || {};
  const events = [];
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const skipSms = collection === 'appointments' ? current.date < today : update.cancelledBy === 'day-rollover';
  const add = (key, message) => events.push({ key, message, userId: current.userId, skipSms, ...(collection === 'queue' ? { queueTicketId: current._id } : {}) });
  const prefix = `${collection === 'queue' ? 'queue' : 'appointment'}:${current._id}`;
  if (update.status && update.status !== current.status && update.cancelledBy !== 'no-show' && (collection !== 'queue' || ['serving', 'cancelled'].includes(update.status))) {
    add(`${prefix}:${update.cancelledBy === 'reschedule-expiration' ? 'reschedule-expired' : update.status}`, collection === 'queue'
      ? `Your Barber Co queue ticket #${current.queueNumber} is ${update.status === 'serving' ? 'now serving. Please approach the counter' : update.status}.`
      : `Your Barber Co appointment on ${current.date} at ${current.time} is ${update.status === 'confirmed' ? 'accepted' : update.status}.${update.staffNote ? ` Reason: ${update.staffNote}` : ''}${update.noRefund ? ' No refund will be issued.' : ''}${update.refundStatus ? ' Contact the shop for payment verification and manual refund review.' : ''}`);
  }
  if (collection === 'appointments') {
    if (update.absentMembers?.length && !current.attendanceClosedAt) add(`${prefix}:no-show`, `Your Barber Co booking: ${update.absentMembers.map(member => member.name).join(', ')} did not check in before the grace deadline. Their time was released. No refund is issued.`);
    if (update.date && (update.date !== current.date || update.time !== current.time)) add(`${prefix}:rescheduled:${update.date}:${update.time}`, `Your Barber Co appointment was rescheduled to ${update.date} at ${update.time}.`);
    const request = update.rescheduleRequest;
    if (request?.status === 'pending' && request.initiatedBy === 'staff') add(`${prefix}:reschedule-proposed:${new Date(request.requestedAt).toISOString()}`, `The shop proposes ${request.date} at ${request.time}. Open My bookings to accept or keep your original schedule. Reason: ${request.reason || 'Contact the shop for details.'}`);
    if (request?.status === 'rejected') add(`${prefix}:reschedule-rejected:${new Date(request.requestedAt).toISOString()}`, `Your reschedule request was rejected. Your original booking remains ${current.date} at ${current.time}.`);
    for (const key of Object.keys(update).filter(key => key.startsWith('arrivals.'))) {
      const index = key.split('.')[1];
      if (!current.arrivals?.[index]) add(`${prefix}:check-in:${index}`, `${current.partyMembers?.[index] || current.customer} is checked in and in the Barber Co queue.`);
    }
  }
  const outbox = Object.fromEntries(events.map(event => [`notificationOutbox.${crypto.createHash('sha256').update(event.key).digest('hex')}`, event]));
  return database.collection(collection).updateOne(filter, { ...changes, $set: { ...update, ...outbox } }, options);
}

async function flush(database, notify) {
  for (const collection of ['appointments', 'queue']) {
    const items = await database.collection(collection).find({ notificationOutbox: { $exists: true } }).limit(100).toArray();
    for (const item of items) {
      for (const [id, event] of Object.entries(item.notificationOutbox || {})) {
        await notify(database, event.userId, event.message, event.key, { queueTicketId: event.queueTicketId, skipSms: event.skipSms });
        await database.collection(collection).updateOne({ _id: item._id }, { $unset: { [`notificationOutbox.${id}`]: '' } });
      }
      await database.collection(collection).updateOne({ _id: item._id, notificationOutbox: {} }, { $unset: { notificationOutbox: '' } });
    }
  }
}

module.exports = { updateWithNotice, flush };
