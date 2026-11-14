const { ObjectId } = require('mongodb');

module.exports = function frontDesk({ withAppointmentMutation, notify, serviceDuration }) {
  const fail = message => Object.assign(new Error(message), { status: 409 });
  const startAt = item => new Date(`${item.date}T${item.time}:00+08:00`);
  const members = item => item.partyMembers || [item.customer];
  const grace = settings => Number.isInteger(settings.gracePeriodMinutes) && settings.gracePeriodMinutes >= 0 && settings.gracePeriodMinutes <= 60 ? settings.gracePeriodMinutes : 10;
  const deadline = item => new Date(item.graceDeadline);
  const ticketId = (id, index) => new ObjectId(require('node:crypto').createHash('sha256').update(`booking:${id}:${index}`).digest('hex').slice(0, 24));

  async function ensureTickets(database, item) {
    for (const [index, arrival] of Object.entries(item.arrivals || {})) {
      if (!arrival) continue;
      const memberIndex = Number(index);
      const ticket = { _id: ticketId(item._id, memberIndex), appointmentId: String(item._id), memberIndex, source: 'appointment', customer: members(item)[memberIndex], userId: item.userId, serviceId: item.serviceId, barberId: item.barberId, cutName: 'Booked service', durationMinutes: item.unitDurationMinutes || Math.max(30, (item.durationMinutes || 30) / (item.partySize || 1)), scheduledAt: startAt(item), queueNumber: item.queueNumber, price: 0, paid: false, demoPayment: item.demoPayment === true, status: 'waiting', createdAt: new Date(arrival), checkedInAt: new Date(arrival) };
      await database.collection('queue').updateOne({ _id: ticket._id }, { $setOnInsert: ticket }, { upsert: true });
    }
  }

  async function settle(database, item) {
    const tickets = await database.collection('queue').find({ appointmentId: String(item._id) }).toArray();
    const allArrived = Object.keys(item.arrivals || {}).length === members(item).length;
    if ((allArrived || item.attendanceClosedAt) && tickets.length && tickets.every(ticket => ['done', 'cancelled'].includes(ticket.status))) {
      const servedMemberCount = tickets.filter(ticket => ticket.status === 'done').length;
      await database.collection('appointments').updateOne({ _id: item._id, status: 'confirmed' }, { $set: { status: servedMemberCount ? 'completed' : 'cancelled', servedMemberCount, noRefund: true, completedAt: new Date(), updatedAt: new Date() } });
      await database.collection('appointmentSlots').deleteMany({ appointmentId: String(item._id) });
    }
  }

  async function releaseAbsentSlots(database, item) {
    const arrived = Object.keys(item.arrivals || {}).length;
    const locks = await database.collection('appointmentSlots').find({ appointmentId: String(item._id) }).toArray();
    const [hour, minute] = item.time.split(':').map(Number);
    const end = hour * 60 + minute + (item.reservedDurationMinutes || 0);
    for (const lock of locks) if (!arrived || Number(String(lock._id).split(':').pop()) >= end) await database.collection('appointmentSlots').deleteOne({ _id: lock._id });
  }

  async function notifyAbsence(database, item, settings) {
    if (!item.absentMembers?.length || item.attendanceNoticeSentAt) return;
    await notify(database, item.userId, `Your Barber Co booking on ${item.date} at ${item.time}: ${item.absentMembers.map(member => member.name).join(', ')} did not check in before the ${item.gracePeriodMinutes ?? grace(settings)}-minute grace deadline. Their reserved time was released. No refund is issued. Late arrivals may join the walk-in queue.`, `appointment:${item._id}:no-show`);
    await database.collection('appointments').updateOne({ _id: item._id }, { $set: { attendanceNoticeSentAt: new Date() } });
  }

  async function sweep(database, now = new Date()) {
    const settings = await database.collection('settings').findOne({ _id: 'shop' }) || {};
    const appointments = await database.collection('appointments').find({ $or: [{ status: 'confirmed' }, { status: 'cancelled', cancelledBy: 'no-show' }] }).toArray();
    for (const candidate of appointments) {
      // Do not retroactively forfeit legacy reservations whose start predates rollout.
      if (!candidate.graceDeadline && startAt(candidate) < now) continue;
      await withAppointmentMutation(database, String(candidate._id), async () => {
        let item = await database.collection('appointments').findOne({ _id: candidate._id });
        if (item?.attendanceClosedAt) {
          await releaseAbsentSlots(database, item);
          await notifyAbsence(database, item, settings);
        }
        if (item?.status !== 'confirmed') return;
        if (!item.graceDeadline) {
          const graceDeadline = new Date(startAt(item).getTime() + grace(settings) * 60000);
          await database.collection('appointments').updateOne({ _id: item._id }, { $set: { graceDeadline } });
          item = { ...item, graceDeadline };
        }
        await ensureTickets(database, item);
        if (deadline(item) <= now && !item.attendanceClosedAt) {
          const absentMembers = members(item).map((name, index) => ({ name, index })).filter(member => !item.arrivals?.[member.index]);
          const arrived = Object.keys(item.arrivals || {}).length;
          const update = { absentMembers, attendanceClosedAt: now, updatedAt: now, noRefund: true };
          if (!arrived) Object.assign(update, { status: 'cancelled', cancelledBy: 'no-show', attendanceStatus: 'no-show' });
          else update.reservedDurationMinutes = (item.unitDurationMinutes || (item.durationMinutes || 30) / members(item).length) * arrived;
          await database.collection('appointments').updateOne({ _id: item._id, status: 'confirmed' }, { $set: update });
          item = { ...item, ...update };
          await releaseAbsentSlots(database, item);
          await notifyAbsence(database, item, settings);
        }
        await settle(database, item);
      }).catch(error => { if (error.status !== 409) throw error; });
    }
    // Terminal booking changes must not leave linked customers active in the queue.
    const linked = await database.collection('queue').find({ source: 'appointment', status: { $in: ['waiting', 'serving'] } }).toArray();
    for (const ticket of linked) {
      const item = await database.collection('appointments').findOne({ _id: new ObjectId(ticket.appointmentId) });
      if (!item || ['cancelled', 'completed'].includes(item.status)) await database.collection('queue').updateOne({ _id: ticket._id }, { $set: { status: item?.status === 'completed' ? 'done' : 'cancelled', updatedAt: now } });
    }
  }

  async function checkIn(database, id, indices, now = new Date()) {
    const item = await database.collection('appointments').findOne({ _id: new ObjectId(id) });
    if (!item || item.status !== 'confirmed') throw fail('Only staff-approved bookings can check in.');
    if (!item.graceDeadline || now >= deadline(item)) throw fail('The grace period has ended. Late customers must join as walk-ins; no refund is issued.');
    if (now < new Date(startAt(item).getTime() - 30 * 60000)) throw fail('Check-in opens 30 minutes before the appointment.');
    if (!Array.isArray(indices) || !indices.length || indices.some(index => !Number.isInteger(index) || index < 0 || index >= members(item).length)) throw Object.assign(new Error('Select the group members who have arrived.'), { status: 400 });
    const arrivals = { ...item.arrivals };
    indices.forEach(index => { arrivals[index] ||= now; });
    await database.collection('appointments').updateOne({ _id: item._id, status: 'confirmed' }, { $set: { arrivals, checkedInAt: item.checkedInAt || now, updatedAt: now } });
    await ensureTickets(database, { ...item, arrivals });
    return { ...item, arrivals };
  }

  async function selectService(database, id = '', now = new Date()) {
    const waiting = await database.collection('queue').find({ status: 'waiting' }).sort({ queueNumber: 1 }).toArray();
    const serving = await database.collection('queue').find({ status: 'serving' }).toArray();
    const bookings = await database.collection('appointments').find({ status: 'confirmed' }).toArray();
    const barbers = await database.collection('barbers').find({ status: { $nin: ['fired', 'on-leave'] } }).toArray();
    const services = await database.collection('services').find().toArray();
    const sameBarber = (value, barber) => [String(barber._id), barber.slug, barber.id].filter(Boolean).includes(String(value));
    const due = waiting.filter(ticket => ticket.source === 'appointment' && new Date(ticket.scheduledAt) <= now);
    const candidates = id ? waiting.filter(ticket => String(ticket._id) === id) : [...due, ...waiting.filter(ticket => ticket.source !== 'appointment')];
    for (const ticket of candidates) {
      if (ticket.source === 'appointment' && new Date(ticket.scheduledAt) > now) continue;
      // Legacy shops without a barber roster retain one shared service lane.
      if (!barbers.length && !ticket.barberId && !serving.length) return { ticket, barberId: '' };
      for (const barber of barbers.filter(barber => !ticket.barberId || sameBarber(ticket.barberId, barber))) {
        if (serving.some(other => !other.barberId || sameBarber(other.barberId, barber))) continue;
        if (ticket.source !== 'appointment') {
          const duration = ticket.durationMinutes || serviceDuration(services.find(service => [service.slug, String(service._id)].includes(ticket.serviceId))?.duration);
          const end = new Date(now.getTime() + duration * 60000);
          if (bookings.some(item => sameBarber(item.barberId, barber) && startAt(item) < end && new Date(startAt(item).getTime() + (item.reservedDurationMinutes || item.durationMinutes || 30) * 60000) > now)) continue;
        }
        return { ticket, barberId: barber.slug || String(barber._id) };
      }
    }
    if (id) throw fail('This customer cannot start yet: the barber is busy, the appointment is not due, or a walk-in would overlap a reserved appointment.');
    return null;
  }

  async function complete(database, ticket, status) {
    if (!ticket.appointmentId) return;
    await withAppointmentMutation(database, ticket.appointmentId, async () => {
      const item = await database.collection('appointments').findOne({ _id: new ObjectId(ticket.appointmentId) });
      if (item) await settle(database, item);
    });
  }
  return { sweep, checkIn, selectService, complete, startAt, grace, members };
};
