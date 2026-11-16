const { updateWithNotice } = require('../lib/notification-outbox');
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { buildAnalytics, buildBarberPerformance } = require('../lib/analytics');
const { paymentChoice, bookingPaymentChoice, paymentUpdate, paymentNotice } = require('../lib/booking-payments');
const { sanitizeMethod, validateQrImage, realPaymentConfigured, normalizeMobile } = require('../lib/payment-settings');
const { phoneUsers, availablePhone } = require('../lib/phone-login');
const security = require('../lib/account-security');
const messaging = require('../lib/notifications');
const { validateReceipt } = require('../lib/receipt');
const bookingGuards = require('../lib/booking-guards');
const { onLeave, leaveDates } = require('../lib/barber-leave');
const allowUnverified = process.env.ALLOW_UNVERIFIED_ACCOUNTS === 'true';
const nonRefundablePolicyVersion = '2026-11-15';
const frontDesk = require('../lib/front-desk')({ withAppointmentMutation, notify: (...args) => messaging.notify(...args), serviceDuration, nextQueueNumber });

function serviceDuration(value) {
  const text = String(value || '').toLowerCase();
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const mins = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/);
  return Math.max(30, hours || mins ? Number(hours?.[1] || 0) * 60 + Number(mins?.[1] || 0) : Number.parseFloat(text) || 30);
}

function partyQuote(body, user, service, settings) {
  const partySize = body.partySize === undefined ? 1 : body.partySize;
  const partyMembers = partySize === 1 ? [user.name] : body.partyMembers;
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10 || !Array.isArray(partyMembers) || partyMembers.length !== partySize || partyMembers.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 120)) {
    throw Object.assign(new Error('Bookings are for one person only.'), { status: 400 });
  }
  const unitDurationMinutes = serviceDuration(service.duration);
  const unitPrice = Number(service.price);
  const bookingFee = Math.max(0, Number(settings.bookingFee) || 0);
  return { partySize, partyMembers: partyMembers.map(name => name.trim()), unitDurationMinutes, unitPrice, durationMinutes: unitDurationMinutes * partySize, bookingFee, total: unitPrice * partySize + bookingFee };
}

function requireSingleBooking(body) {
  if ((body.partySize !== undefined && body.partySize !== 1) || (body.partyMembers !== undefined && (!Array.isArray(body.partyMembers) || body.partyMembers.length !== 1))) {
    throw Object.assign(new Error('Bookings are for one person only. Group bookings are no longer available.'), { status: 400 });
  }
}

function appointmentDuration(appointment, service) {
  return Number(appointment.durationMinutes) || (Number(appointment.unitDurationMinutes) || serviceDuration(service?.duration)) * (appointment.partySize || 1);
}

function partyNotice(appointment) {
  return appointment.partySize > 1 ? ` Group (${appointment.partySize}): ${(appointment.partyMembers || []).join(', ')}.` : '';
}

async function cleanLegacyCapacity(database) {
  const pending = await database.collection('appointments').find({ status: 'pending' }).toArray();
  for (const appointment of pending) {
    await withAppointmentMutation(database, String(appointment._id), async () => {
      const current = await database.collection('appointments').findOne({ _id: appointment._id });
      if (current?.status === 'pending') await database.collection('appointmentSlots').deleteMany({ appointmentId: String(appointment._id) });
    }).catch(error => { if (error.status !== 409) throw error; });
  }
  const holds = await database.collection('appointmentHolds').find().toArray();
  for (const hold of holds) {
    const appointment = await database.collection('appointments').findOne({ _id: hold._id });
    if (!appointment) await database.collection('appointmentSlots').deleteMany({ appointmentId: String(hold._id) });
  }
}

function rescheduleDeadline(appointment, request) {
  return new Date(Math.min(...[appointment, request].map(({ date, time }) => new Date(`${date}T${time}:00+08:00`).getTime())));
}

async function withAppointmentMutation(database, id, action) {
  const owner = String(new ObjectId());
  const locks = database.collection('counters');
  const key = `appointment-mutation:${id}`;
  try {
    await locks.findOneAndUpdate({ _id: key, $or: [{ expiresAt: { $lt: new Date() } }, { owner: { $exists: false } }] }, { $set: { owner, expiresAt: new Date(Date.now() + 300000) } }, { upsert: true, returnDocument: 'after' });
  } catch (error) {
    if (error.code === 11000) throw Object.assign(new Error('This appointment is being updated. Refresh and retry.'), { status: 409 });
    throw error;
  }
  const { setInterval, clearInterval } = require('node:timers');
  const heartbeat = setInterval(() => {
    locks.updateOne({ _id: key, owner }, { $set: { expiresAt: new Date(Date.now() + 300000) } }).catch(error => console.error('Appointment lease renewal failed:', error.message));
  }, 30000);
  heartbeat.unref();
  try { return await action(); }
  finally {
    clearInterval(heartbeat);
    await locks.deleteOne({ _id: key, owner });
  }
}

async function sweepRescheduleRequests(database, now = new Date()) {
  database = database || await db();
  let failure;
  const appointments = await database.collection('appointments').find({ $or: [{ status: { $in: ['pending', 'confirmed'] } }, { status: 'cancelled', cancelledBy: 'reschedule-expiration' }], 'rescheduleRequest.status': 'pending' }).toArray();
  for (const current of appointments) {
    if (!(rescheduleDeadline(current, current.rescheduleRequest) <= now)) continue;
    try {
      await withAppointmentMutation(database, String(current._id), async () => {
        if (current.rescheduleRequest.initiatedBy === 'staff') {
          await updateWithNotice(database, 'appointments', { _id: current._id, rescheduleRequest: current.rescheduleRequest }, { $set: { 'rescheduleRequest.status': 'expired', updatedAt: now } });
          return;
        }
        // Keep the request pending until side effects finish so a failed sweep can retry.
        if (current.status !== 'cancelled') {
          const changed = await updateWithNotice(database, 'appointments', { _id: current._id, status: current.status, date: current.date, time: current.time, rescheduleRequest: current.rescheduleRequest }, { $set: { status: 'cancelled', cancelledBy: 'reschedule-expiration', noRefund: true, updatedAt: now } });
          if (!changed.modifiedCount) return;
        }
        await database.collection('appointmentSlots').deleteMany({ appointmentId: String(current._id) });
        await messaging.notify(database, current.userId, `Your Barber Co booking was cancelled because the reschedule request was not reviewed before its deadline.${partyNotice(current)} No refund will be issued.`, `appointment:${current._id}:reschedule-expired`);
        await updateWithNotice(database, 'appointments', { _id: current._id, status: 'cancelled', cancelledBy: 'reschedule-expiration', rescheduleRequest: current.rescheduleRequest }, { $set: { 'rescheduleRequest.status': 'expired' } });
      });
    } catch (error) {
      if (error.status !== 409) failure ||= error;
    }
  }
  if (failure) throw failure;
}

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "barber_co";
const jwtSecret = process.env.JWT_SECRET || "local-dev-only-secret";
let clientPromise;

const seedServices = [
  { slug: "basic", name: "Basic Haircut", price: 150, duration: "30 min", detail: "Clean haircut finished with pomade.", icon: "CUT", active: true },
  { slug: "shave", name: "Haircut + Shave", price: 200, duration: "45 min", detail: "Haircut paired with a sharp beard shave.", icon: "SHV", active: true },
  { slug: "premium", name: "Premium Cut", price: 250, duration: "45 min", detail: "Detailed cut with styling and finishing.", icon: "PRO", active: true },
  { slug: "kids", name: "Kids Cut", price: 200, duration: "30 min", detail: "Simple grooming package for younger clients.", icon: "KID", active: true },
  { slug: "groom", name: "Premium Groom", price: 350, duration: "60 min", detail: "Haircut, beard shave, and hot towel service.", icon: "VIP", active: true }
];

const seedBarbers = [];

const defaultSettings = {
  _id: "shop",
  gcash: { enabled: true, accountName: "The Barber Co", accountNumber: "", qrImage: "" },
  maya: { enabled: false, accountName: "The Barber Co", accountNumber: "", qrImage: "" },
  bookingFee: 100,
  gracePeriodMinutes: 10,
  operatingHours: {
    sunday: { open: "13:00", close: "20:00", closed: false },
    monday: { open: "13:00", close: "20:00", closed: false },
    tuesday: { open: "13:00", close: "20:00", closed: false },
    wednesday: { open: "13:00", close: "20:00", closed: false },
    thursday: { open: "13:00", close: "20:00", closed: false },
    friday: { open: "13:00", close: "20:00", closed: false },
    saturday: { open: "13:00", close: "20:00", closed: false }
  },
  closedDates: []
};

const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const fixedPhilippineHolidays = new Set(["01-01", "02-25", "04-09", "05-01", "06-12", "08-21", "11-01", "11-02", "11-30", "12-08", "12-24", "12-25", "12-30", "12-31"]);

function minutes(value) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : NaN;
}

function mergedSettings(settings = {}) {
  const operatingHours = { ...defaultSettings.operatingHours, ...(settings.operatingHours || {}) };
  const gcash = { ...defaultSettings.gcash, ...(settings.gcash || {}) };
  const maya = { ...defaultSettings.maya, ...(settings.maya || {}) };
  // Saved test-era recipients must not become payable just because demo mode ended.
  if (settings.paymentMode === 'demo' && settings.paymentDetailsConfirmed !== true) {
    gcash.enabled = false;
    maya.enabled = false;
  }
  const allowDemoPayments = false;
  const paymentMode = 'live';
  for (const day of dayNames) {
    const hours = operatingHours[day] || defaultSettings.operatingHours[day];
    operatingHours[day] = {
      ...hours,
      open: minutes(hours.open) < minutes("13:00") ? "13:00" : hours.open
    };
  }
  return {
    ...defaultSettings,
    ...settings,
    gcash,
    maya,
    paymentMode,
    paymentRevision: security.digest(JSON.stringify({ paymentMode, gcash, maya, bookingFee: settings.bookingFee ?? defaultSettings.bookingFee })),
    allowDemoPayments,
    operatingHours,
    closedDates: Array.isArray(settings.closedDates) ? settings.closedDates : []
  };
}

function bookingWindow(date, time, settings, durationMinutes = 30) {
  const localNoon = new Date(`${date}T12:00:00+08:00`);
  if (!Number.isFinite(localNoon.getTime()) || new Date(localNoon.getTime() + 8 * 3600000).toISOString().slice(0, 10) !== date) return { error: 'Choose a valid calendar date.' };
  const day = dayNames[localNoon.getUTCDay()];
  const hours = settings.operatingHours[day];
  if (fixedPhilippineHolidays.has(date.slice(5)) || settings.closedDates.includes(date)) return { error: "The shop is closed on the selected holiday." };
  if (!hours || hours.closed) return { error: "The shop is closed on the selected day." };
  const start = minutes(time);
  if (start < minutes(hours.open) || start + durationMinutes > minutes(hours.close)) {
    return { error: `Choose a time between ${hours.open} and ${hours.close}.` };
  }
  if (start % 30 !== 0) return { error: "Appointments are available in 30-minute time slots." };
  return { day, hours };
}

async function unavailableBarbers(database, date, time, durationMinutes, excludedHoldId = "", excludedAppointmentId = '') {
  const now = new Date();
  const appointments = await database.collection("appointments").find({
    date,
    barberId: { $nin: ["", null] },
    status: 'confirmed',
    ...(excludedAppointmentId ? { _id: { $ne: new ObjectId(excludedAppointmentId) } } : {})
  }).toArray();
  const serving = await database.collection('queue').find({ status: 'serving' }).toArray();
  const services = await database.collection("services").find().toArray();
  const durations = new Map();
  for (const service of services) {
    const duration = serviceDuration(service.duration);
    durations.set(service.slug, duration);
    durations.set(String(service._id), duration);
  }
  const requestedStart = minutes(time);
  const requestedEnd = requestedStart + durationMinutes;
  const unavailable = appointments.filter((appointment) => {
    const existingStart = minutes(appointment.time);
    const existingEnd = existingStart + (Number(appointment.reservedDurationMinutes) || Number(appointment.durationMinutes) || (Number(appointment.unitDurationMinutes) || durations.get(appointment.serviceId) || 30) * (appointment.partySize || 1));
    return requestedStart < existingEnd && requestedEnd > existingStart;
  }).map((appointment) => appointment.barberId);
  const requestedAt = new Date(`${date}T${time}:00+08:00`).getTime();
  for (const ticket of serving) {
    const called = new Date(ticket.calledAt || ticket.updatedAt || now).getTime();
    const duration = Number(ticket.durationMinutes) || durations.get(ticket.serviceId) || 30;
    const expectedEnd = Math.max(called + duration * 60000, now.getTime() + 15 * 60000);
    if (requestedAt < expectedEnd && requestedAt + durationMinutes * 60000 > called) {
      if (ticket.barberId) unavailable.push(ticket.barberId);
      else unavailable.push(...(await database.collection('barbers').find({ status: { $nin: ['fired', 'on-leave'] } }).toArray()).flatMap(barber => [barber.slug, String(barber._id)]).filter(Boolean));
    }
  }
  const roster = await database.collection('barbers').find().toArray();
  for (const barber of roster) if (onLeave(barber, date)) unavailable.push(barber.slug, String(barber._id));
  for (const barber of roster) if ([barber.slug, String(barber._id)].some(id => unavailable.includes(id))) unavailable.push(barber.slug, String(barber._id));
  return [...new Set(unavailable.filter(Boolean))];
}

function appointmentSlotIds(date, barberId, time, durationMinutes) {
  const start = minutes(time);
  const ids = [];
  for (let value = start; value < start + durationMinutes; value += 15) {
    ids.push(`${date}:${barberId}:${value}`);
  }
  return ids;
}

async function lockAppointmentSlots(database, appointmentId, date, barberId, time, durationMinutes, expiresAt = null) {
  if (!barberId) return;
  const locks = appointmentSlotIds(date, barberId, time, durationMinutes).map((_id) => ({
    _id,
    appointmentId: String(appointmentId),
    createdAt: new Date(),
    ...(expiresAt ? { expiresAt } : {})
  }));
  try {
    await database.collection("appointmentSlots").insertMany(locks, { ordered: true });
  } catch (error) {
    await database.collection("appointmentSlots").deleteMany({ appointmentId: String(appointmentId) });
    if (error?.code === 11000) {
      const conflict = new Error("That barber was just booked for this time. Choose another barber or time.");
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}

async function reserveAnyBarber(database, appointmentId, date, time, durationMinutes, expiresAt) {
  const candidates = await database.collection("barbers").find({ status: { $nin: ["fired", "on-leave"] } }).toArray();
  const unavailable = new Set(await unavailableBarbers(database, date, time, durationMinutes));
  for (const barber of candidates) {
    const barberId = barber.slug || String(barber._id);
    if (unavailable.has(barberId) || unavailable.has(String(barber._id))) continue;
    return barber;
  }
  const error = new Error("No barber is available at that time. Choose another time or a specific barber.");
  error.status = 409;
  throw error;
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let rejected = false;
    req.setEncoding?.('utf8');
    req.on("data", (chunk) => {
      if (rejected) return;
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) { rejected = true; raw = ''; reject(Object.assign(new Error('Request is too large.'), { status: 413 })); }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      if (rejected) return;
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('Invalid JSON request.'), { status: 400 })); }
    });
  });
}

async function db() {
  if (!mongoUri) throw new Error("MONGODB_URI is not configured");
  if (!clientPromise) {
    const client = new MongoClient(mongoUri);
    clientPromise = client.connect().catch(async (error) => {
      clientPromise = null;
      await client.close().catch(() => {});
      throw error;
    });
  }
  const client = await clientPromise;
  const database = client.db(dbName);
  await ensureSeed(database);
  return database;
}

async function ensureSeed(database) {
  if (!ensureSeed.promise) {
    ensureSeed.promise = (async () => {
      await Promise.all([
        database.collection("users").createIndex({ email: 1 }, { unique: true }),
        database.collection("users").createIndex({ phoneLogin: 1 }, { unique: true, partialFilterExpression: { phoneLogin: { $type: 'string' } } }),
        database.collection("services").createIndex({ slug: 1 }, { unique: true }),
        database.collection("barbers").createIndex({ slug: 1 }, { unique: true }),
        database.collection("queue").createIndex({ queueNumber: 1 }),
        database.collection("appointments").createIndex({ createdAt: -1 }),
        database.collection("appointmentHolds").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        database.collection("appointmentSlots").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        database.collection('loginAttempts').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        database.collection('accountCodes').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        database.collection('notifications').createIndex({ userId: 1, createdAt: -1 })
      ]);
      await cleanLegacyCapacity(database);
      for (const service of seedServices) {
        await database.collection("services").updateOne({ slug: service.slug }, { $setOnInsert: { ...service, createdAt: new Date() } }, { upsert: true });
      }
      for (const barber of seedBarbers) {
        await database.collection("barbers").updateOne({ slug: barber.slug }, { $setOnInsert: { ...barber, createdAt: new Date() } }, { upsert: true });
      }
      await database.collection("settings").updateOne(
        { _id: "shop" },
        { $setOnInsert: { ...defaultSettings, createdAt: new Date() } },
        { upsert: true }
      );
      const adminEmail = String(process.env.ADMIN_EMAIL || "thebarberco.official@gmail.com").toLowerCase();
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (adminPassword && !await database.collection('users').findOne({ email: adminEmail })) {
        const hash = await bcrypt.hash(adminPassword, 10);
        await database.collection("users").updateOne(
          { email: adminEmail },
          {
            $set: { passwordHash: hash, role: "admin" },
            $setOnInsert: { name: "The Barber Co Admin", email: adminEmail, phone: "", createdAt: new Date() }
          },
          { upsert: true }
        );
      }
      const moderatorEmail = String(process.env.MODERATOR_EMAIL || "staff@thebarberco.local").toLowerCase();
      const moderatorPassword = process.env.MODERATOR_PASSWORD;
      if (moderatorPassword && !await database.collection('users').findOne({ email: moderatorEmail })) {
        const hash = await bcrypt.hash(moderatorPassword, 10);
        await database.collection("users").updateOne(
          { email: moderatorEmail },
          {
            $set: { passwordHash: hash, role: "moderator" },
            $setOnInsert: { name: "Front Desk Staff", email: moderatorEmail, phone: "", createdAt: new Date() }
          },
          { upsert: true }
        );
      }
    })().catch(error => { ensureSeed.promise = null; throw error; });
  }
  return ensureSeed.promise;
}

function publicUser(user) {
  if (!user) return null;
  return { id: String(user._id), name: user.name, email: user.email, role: user.role || "customer", emailVerified: Boolean(user.emailVerifiedAt), phoneVerified: Boolean(user.phoneVerifiedAt), smsConsent: Boolean(user.smsConsent), birthDate: user.birthDate || '', username: user.username || "", phone: user.phone || "", location: user.location || "", bio: user.bio || "", photo: user.photo || "" };
}

function normalizeDoc(doc) {
  if (!doc) return null;
  const { notificationOutbox, ...publicDoc } = doc;
  return { ...publicDoc, id: doc.slug || String(doc._id), mongoId: String(doc._id), _id: undefined };
}

function queueContact(body) {
  const contactEmail = String(body.contactEmail || '').trim().toLowerCase();
  const emailConsent = body.emailConsent === true;
  if (contactEmail && (contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  if (emailConsent && !contactEmail) throw Object.assign(new Error('Enter an email address to receive updates.'), { status: 400 });
  return { contactEmail: emailConsent ? contactEmail : '', emailConsent };
}

function publicQueueTicket(ticket) {
  if (!ticket) return null;
  return normalizeDoc({
    _id: ticket._id,
    slug: ticket.slug,
    queueNumber: ticket.queueNumber,
    customer: ticket.customer,
    serviceId: ticket.serviceId,
    barberId: ticket.barberId,
    cutName: ticket.cutName,
    status: ticket.status,
    source: ticket.source,
    waitMinutes: ticket.waitMinutes,
    createdAt: ticket.createdAt,
    calledAt: ticket.calledAt, scheduledAt: ticket.scheduledAt, durationMinutes: ticket.durationMinutes
  });
}

function tokenFor(user) {
  return jwt.sign({ sub: String(user._id), role: user.role || "customer", version: user.sessionVersion || 0 }, jwtSecret, { expiresIn: "7d" });
}

function paymentConfigured(settings) {
  return realPaymentConfigured(settings);
}

function requireBookingEligibility(user) {
  if (allowUnverified || ['admin', 'moderator'].includes(user.role)) return;
  if (!user.emailVerifiedAt && !user.phoneVerifiedAt && !user.adminTestAccess) throw Object.assign(new Error('Verify your mobile number or email before booking online.'), { status: 403 });
  const age = security.ageOn(user.birthDate);
  if (age == null || age < 18) throw Object.assign(new Error('Online wallet bookings are for customers aged 18 or older under shop policy. Younger customers may join the walk-in queue or have a parent book using their own account.'), { status: 403 });
}

async function requireUser(req, database, adminOnly = false) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    const error = new Error("Login required");
    error.status = 401;
    throw error;
  }
  let payload;
  try { payload = jwt.verify(token, jwtSecret); }
  catch { throw Object.assign(new Error('Your session expired. Please log in again.'), { status: 401 }); }
  if (!ObjectId.isValid(payload.sub)) throw Object.assign(new Error('Invalid session. Please log in again.'), { status: 401 });
  const user = await database.collection("users").findOne({ _id: new ObjectId(payload.sub) });
  if (!user || (payload.version || 0) !== (user.sessionVersion || 0) || (adminOnly && user.role !== "admin")) {
    const error = new Error("Admin access required");
    error.status = adminOnly ? 403 : 401;
    throw error;
  }
  return user;
}

async function requireRole(req, database, roles) {
  const user = await requireUser(req, database);
  if (!roles.includes(user.role)) {
    const error = new Error("Permission denied");
    error.status = 403;
    throw error;
  }
  return user;
}

function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || String(Date.now());
}

async function nextQueueNumber(database) {
  const counter = await database.collection("counters").findOneAndUpdate(
    { _id: "queue" },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return counter.value;
}

async function startServing(database, id = '') {
  const leaseOwner = String(new ObjectId());
  try {
    await database.collection('counters').findOneAndUpdate({ _id: 'serving-transition', $or: [{ busy: { $ne: true } }, { lockedAt: { $lt: new Date(Date.now() - 60000) } }] }, { $set: { busy: true, leaseOwner, lockedAt: new Date() } }, { upsert: true, returnDocument: 'after' });
  } catch (error) {
    if (error.code === 11000) throw Object.assign(new Error('Another staff member is updating the queue. Please retry.'), { status: 409 });
    throw error;
  }
  try {
    const current = id && await database.collection('queue').findOne({ _id: new ObjectId(id), status: 'serving' });
    if (current) return current;
    const selection = await frontDesk.selectService(database, id);
    if (!selection) return null;
    const transition = () => database.collection('queue').findOneAndUpdate({ status: 'waiting', _id: selection.ticket._id }, { $set: { status: 'serving', barberId: selection.barberId, calledAt: new Date(), updatedAt: new Date() } }, { returnDocument: 'after' });
    const ticket = selection.ticket.appointmentId ? await withAppointmentMutation(database, selection.ticket.appointmentId, async () => {
      const appointment = await database.collection('appointments').findOne({ _id: new ObjectId(selection.ticket.appointmentId) });
      if (appointment?.status !== 'confirmed') throw Object.assign(new Error('This appointment is no longer active. Refresh the queue.'), { status: 409 });
      return transition();
    }) : await transition();
    if (id && !ticket) throw Object.assign(new Error('This customer is no longer waiting.'), { status: 409 });
    return ticket;
  } finally { await database.collection('counters').updateOne({ _id: 'serving-transition', leaseOwner }, { $set: { busy: false } }); }
}

async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });
  const database = await db();
  const requestUrl = new URL(req.url, "https://barber.local");
  const path = requestUrl.pathname.replace(/^\/api/, "") || "/";
  const body = ["POST", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : {};
  // Admin lists use the scheduled cleanup worker; reads must not wait on notification delivery.
  if (req.method === 'GET' && path === '/availability') await sweepRescheduleRequests(database);
  if (req.method === 'GET' && ['/availability', '/queue'].includes(path) || req.method === 'POST' && path === '/admin/queue/next' || req.method === 'PATCH' && (path.startsWith('/admin/queue/') || /^\/queue\/ticket\/[a-f0-9]{24}\/cancel$/.test(path))) await frontDesk.sweep(database);

  if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true });
  if (req.method === 'GET' && path === '/auth/capabilities') return send(res, 200, { email: security.emailReady(), sms: messaging.smsReady(), smsVerification: messaging.smsVerificationReady(), verificationRequired: !allowUnverified });

  if (req.method === 'POST' && path === '/contact') {
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const message = String(body.message || '').trim();
    if (name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || message.length < 5 || message.length > 5000) return send(res, 400, { error: 'Enter your name, a valid email and a message of 5-5000 characters.' });
    const key = security.digest(`contact:${email}`);
    const attempts = database.collection('loginAttempts');
    try {
      await attempts.findOneAndUpdate({ _id: key, $or: [{ sentAt: { $exists: false } }, { sentAt: { $lt: new Date(Date.now() - 60000) } }] }, { $set: { sentAt: new Date(), expiresAt: new Date(Date.now() + 86400000) } }, { upsert: true, returnDocument: 'after' });
    } catch (error) {
      if (error.code === 11000) return send(res, 429, { error: 'Wait a minute before sending another message.' });
      throw error;
    }
    const contact = { _id: new ObjectId(), name, email, message, status: 'new', createdAt: new Date() };
    await database.collection('contactMessages').insertOne(contact);
    let emailAccepted = false;
    if (security.emailReady()) {
      try {
        await security.sendEmail(process.env.ADMIN_EMAIL || 'thebarberco.official@gmail.com', 'The Barber Co website enquiry', `From: ${name}\nReply to: ${email}\n\n${message}`, `contact-${contact._id}`);
        emailAccepted = true;
      } catch { /* The saved staff inbox remains the source of truth. */ }
    }
    return send(res, 201, { message: emailAccepted ? 'Your message was saved to the staff inbox. An email alert was also accepted by the provider.' : 'Your message was saved to the staff inbox. The email alert is unavailable, but staff can still read it on the website.' });
  }

  if (req.method === 'POST' && path === '/payments/recovery') {
    const user = await requireUser(req, database);
    requireBookingEligibility(user);
    const paymentProof = String(body.paymentProof || '');
    await validateReceipt(paymentProof);
    const reference = String(body.reference || '').trim().slice(0, 120);
    if (!reference) return send(res, 400, { error: 'Enter the wallet transaction reference.' });
    const _id = new ObjectId(security.digest(`payment-recovery:${user._id}:${reference}`).slice(0, 24));
    if (!await database.collection('contactMessages').findOne({ _id }) && await database.collection('contactMessages').countDocuments({ userId: user._id, hasPaymentProof: true, createdAt: { $gt: new Date(Date.now() - 86400000) } }) >= 5) return send(res, 429, { error: 'You have already sent five payment recovery cases today. Contact the shop for further assistance.' });
    const contact = { _id, userId: user._id, name: user.name, email: user.email, message: `PAYMENT RECOVERY - not a confirmed reservation. Transaction reference: ${reference}. Requested schedule: ${String(body.date || '').slice(0, 10)} ${String(body.time || '').slice(0, 5)}. Please verify the actual wallet transfer and contact the customer before arranging a booking or manual refund.`, paymentProof, hasPaymentProof: true, status: 'new', createdAt: new Date() };
    await database.collection('contactMessages').updateOne({ _id }, { $setOnInsert: contact }, { upsert: true });
    return send(res, 201, { message: 'Payment proof saved to the staff inbox. No reservation or automatic refund has been made. Do not pay again.', reference: String(_id) });
  }
  if (req.method === 'GET' && /^\/admin\/contacts\/[a-f0-9]{24}\/payment-proof$/.test(path)) {
    await requireRole(req, database, ['admin', 'moderator']);
    const contact = await database.collection('contactMessages').findOne({ _id: new ObjectId(path.split('/')[3]) });
    if (!contact?.paymentProof) return send(res, 404, { error: 'No proof found.' });
    return send(res, 200, { paymentProof: contact.paymentProof });
  }
  if (req.method === 'GET' && path === '/admin/contacts') {
    await requireRole(req, database, ['admin', 'moderator']);
    const contacts = await database.collection('contactMessages').find({ archived: requestUrl.searchParams.get('archived') === 'true' ? true : { $ne: true } }, { projection: { name: 1, email: 1, message: 1, status: 1, createdAt: 1, archived: 1, hasPaymentProof: 1 } }).sort({ createdAt: -1 }).limit(100).toArray();
    const replies = await database.collection('contactReplies').find({ contactId: { $in: contacts.map((item) => String(item._id)) } }, { projection: { contactId: 1, message: 1, status: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray();
    contacts.forEach((contact) => { contact.replies = replies.filter((reply) => reply.contactId === String(contact._id)); });
    return send(res, 200, { contacts });
  }

  if (req.method === 'POST' && /^\/admin\/contacts\/[^/]+\/reply$/.test(path)) {
    const admin = await requireRole(req, database, ['admin', 'moderator']);
    const id = path.split('/')[3];
    if (!ObjectId.isValid(id)) return send(res, 400, { error: 'Invalid contact message.' });
    const message = String(body.message || '').trim();
    const requestId = String(body.requestId || '');
    if (message.length < 2 || message.length > 5000 || !/^[a-f0-9-]{36}$/i.test(requestId)) return send(res, 400, { error: 'Enter a reply of 2-5000 characters.' });
    const contact = await database.collection('contactMessages').findOne({ _id: new ObjectId(id) });
    if (!contact) return send(res, 404, { error: 'Contact message not found.' });
    if (!security.emailReady()) return send(res, 503, { error: 'Email delivery is not configured. Your reply was not sent.' });
    const collection = database.collection('contactReplies');
    const reply = { _id: security.digest(`contact-reply:${id}:${requestId}`), contactId: id, adminId: admin._id, staffRole: admin.role, message, status: 'sending', createdAt: new Date() };
    try { await collection.insertOne(reply); }
    catch (error) {
      if (error.code !== 11000) throw error;
      const previous = await collection.findOne({ _id: reply._id });
      if (previous.message !== message) return send(res, 409, { error: 'This reply attempt has different content. Refresh before sending a new reply.' });
      if (previous.status === 'accepted') return send(res, 200, { message: 'Reply already accepted by the email provider.' });
      const claimed = await collection.updateOne({ _id: reply._id, status: 'failed' }, { $set: { status: 'sending' } });
      if (!claimed.modifiedCount) return send(res, 409, { error: 'This reply is being processed. Refresh to check its status before retrying.' });
    }
    try {
      await security.sendEmail(contact.email, 'Re: The Barber Co enquiry', `${message}\n\nThe Barber Co\n\nYour original enquiry:\n${contact.message}`, reply._id);
    } catch {
      await collection.updateOne({ _id: reply._id }, { $set: { status: 'failed' } });
      return send(res, 503, { error: 'The email provider could not accept your reply. The failed attempt is saved; you can retry.' });
    }
    await collection.updateOne({ _id: reply._id }, { $set: { status: 'accepted' } });
    await database.collection('contactMessages').updateOne({ _id: contact._id }, { $set: { status: 'replied' } });
    return send(res, 200, { message: 'Reply accepted by the email provider. This is not a delivery confirmation.' });
  }

  if (req.method === 'PATCH' && /^\/admin\/(contacts|appointments)\/[a-f0-9]{24}\/archive$/.test(path)) {
    const actor = await requireRole(req, database, ['admin', 'moderator']);
    const [, , kind, id] = path.split('/');
    if (typeof body.archived !== 'boolean') return send(res, 400, { error: 'Choose archive or restore.' });
    const collection = database.collection(kind === 'contacts' ? 'contactMessages' : 'appointments');
    const record = await collection.findOne({ _id: new ObjectId(id) });
    if (!record) return send(res, 404, { error: 'Record not found.' });
    if (kind === 'appointments' && !['completed', 'cancelled', 'disapproved'].includes(record.status)) return send(res, 409, { error: 'Only completed, cancelled or disapproved appointments can be archived.' });
    await collection.updateOne({ _id: record._id }, { $set: { archived: body.archived, archivedBy: actor._id, archivedAt: new Date() } });
    return send(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && /^\/admin\/users\/[^/]+$/.test(path)) {
    const admin = await requireRole(req, database, ['admin']);
    const id = path.split('/')[3];
    if (!ObjectId.isValid(id)) return send(res, 400, { error: 'Invalid account.' });
    const target = await database.collection('users').findOne({ _id: new ObjectId(id) });
    if (!target) return send(res, 404, { error: 'Account not found.' });
    const ownerEmail = 'thebarberco.official@gmail.com';
    if (String(admin._id) === id || target.role === 'admin' || target.email === ownerEmail) return send(res, 403, { error: 'Admin accounts cannot be deleted here.' });
    if (body.confirmEmail !== target.email) return send(res, 400, { error: 'Enter the account email to confirm permanent deletion.' });
    const deleted = await database.collection('users').deleteOne({ _id: target._id, role: { $ne: 'admin' }, email: { $ne: ownerEmail } });
    if (!deleted.deletedCount) return send(res, 409, { error: 'The account changed. Refresh before trying again.' });
    return send(res, 200, { message: 'Account deleted. Booking and payment history were preserved.' });
  }

  if (req.method === 'POST' && ['/auth/sms-recovery', '/auth/sms-recovery/complete'].includes(path)) {
    const phone = normalizeMobile(body.phone);
    if (!/^09\d{9}$/.test(phone)) return send(res, 400, { error: 'Enter a valid Philippine mobile number.' });
    const user = await database.collection('users').findOne({ phoneLogin: phone });
    const eligible = user && user.phoneVerifiedAt;
    const purpose = body.purpose === 'email' ? 'email' : 'password';
    const identity = `recovery:${purpose}:${user?._id || 'unknown'}`;
    if (path.endsWith('/complete')) {
      if (!eligible) return send(res, 400, { error: 'The code is invalid or expired.' });
      if (purpose === 'password' && (String(body.password || '').length < 8 || body.password !== body.confirmPassword)) return send(res, 400, { error: 'Use matching passwords of at least 8 characters.' });
      await messaging.verifyPhoneCode(database, identity, phone, body.code);
      if (purpose === 'email') {
        const [local, domain] = user.email.split('@');
        return send(res, 200, { message: `Your account email is ${local.slice(0, 2)}***@${domain}. You can also sign in using your mobile number.` });
      }
      await database.collection('users').updateOne({ _id: user._id }, { $set: { passwordHash: await bcrypt.hash(body.password, 10), sessionVersion: (user.sessionVersion || 0) + 1 } });
      await database.collection('loginAttempts').deleteOne({ _id: security.digest(String(user._id)) });
      return send(res, 200, { message: 'Password changed. Sign in with your new password.' });
    }
    if (eligible) await messaging.requestPhoneVerification(database, identity, phone);
    return send(res, 200, { message: 'If this number is verified on an account, a recovery code was sent. SMS coverage depends on your network.' });
  }

  if (req.method === 'POST' && ['/auth/registration-sms', '/auth/registration-sms/verify'].includes(path)) {
    const email = String(body.email || '').trim().toLowerCase();
    const phone = normalizeMobile(body.phone);
    const user = phone && await database.collection('users').findOne({ email, phoneLogin: phone });
    if (!user || !user.verificationRequired || user.phoneVerifiedAt || user.emailVerifiedAt) return send(res, 400, { error: 'No pending registration matches these details. Sign in or check your registration details.' });
    const identity = `registration:${user._id}`;
    if (path.endsWith('/verify')) {
      await messaging.verifyPhoneCode(database, identity, phone, body.code);
      const update = { phoneVerifiedAt: new Date() };
      await database.collection('users').updateOne({ _id: user._id }, { $set: update });
      return send(res, 200, { user: publicUser({ ...user, ...update }), token: tokenFor({ ...user, ...update }) });
    }
    await messaging.requestPhoneVerification(database, identity, phone);
    return send(res, 200, { message: 'SMS code requested. Check your phone; provider acceptance does not guarantee delivery.' });
  }

  if (req.method === 'POST' && ['/auth/forgot-password', '/auth/resend-verification'].includes(path)) {
    if (!security.emailReady()) return send(res, 503, { error: 'Email delivery is not configured. Contact the shop for account assistance.' });
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    const user = await database.collection('users').findOne({ email });
    const purpose = path.endsWith('forgot-password') ? 'reset' : 'verify';
    if (user && (purpose === 'reset' || !user.emailVerifiedAt)) await security.issueCode(database, email, purpose);
    return send(res, 200, { message: 'If this account is eligible, a code has been emailed. Check your inbox and spam folder.' });
  }
  if (req.method === 'POST' && ['/auth/verify-email', '/auth/reset-password'].includes(path)) {
    const email = String(body.email || '').trim().toLowerCase();
    const reset = path.endsWith('reset-password');
    if (reset && (String(body.password || '').length < 8 || body.password !== body.confirmPassword)) return send(res, 400, { error: 'Use a matching password and confirmation of at least 8 characters.' });
    await security.consumeCode(database, email, reset ? 'reset' : 'verify', body.code);
    const user = await database.collection('users').findOne({ email });
    if (!user) return send(res, 400, { error: 'The code is invalid or expired.' });
    const update = { emailVerifiedAt: new Date(), ...(reset ? { passwordHash: await bcrypt.hash(body.password, 10), sessionVersion: (user.sessionVersion || 0) + 1 } : {}) };
    await database.collection('users').updateOne({ _id: user._id }, { $set: update });
    await database.collection('loginAttempts').deleteOne({ _id: security.digest(String(user._id)) });
    return send(res, 200, reset ? { message: 'Password changed. Sign in with your new password.' } : { user: publicUser({ ...user, ...update }), token: tokenFor({ ...user, ...update }) });
  }

  if (req.method === "GET" && path === "/settings") {
    const settings = await database.collection("settings").findOne({ _id: "shop" });
    return send(res, 200, { settings: mergedSettings(settings) });
  }

  if (req.method === "GET" && path === "/availability") {
    const date = String(requestUrl.searchParams.get("date") || "");
    const time = String(requestUrl.searchParams.get("time") || "");
    const serviceId = String(requestUrl.searchParams.get("serviceId") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return send(res, 400, { error: "Choose a valid date and time." });
    const service = await database.collection("services").findOne({ $or: [{ slug: serviceId }, ...(ObjectId.isValid(serviceId) ? [{ _id: new ObjectId(serviceId) }] : [])], active: { $ne: false } });
    if (!service) return send(res, 400, { error: "Choose an available service." });
    const partySize = Number(requestUrl.searchParams.get('partySize') || 1);
    if (partySize !== 1) return send(res, 400, { error: 'Bookings are for one person only.' });
    const duration = serviceDuration(service.duration) * partySize;
    return send(res, 200, { unavailableBarberIds: await unavailableBarbers(database, date, time, duration) });
  }

  if (req.method === "POST" && path === "/appointment-holds") {
    const user = await requireUser(req, database);
    requireBookingEligibility(user);
    requireSingleBooking(body);
    const date = String(body.date || "");
    const time = String(body.time || "");
    const serviceId = String(body.serviceId || "");
    let barberId = String(body.barberId || "");
    const anyBarber = barberId === "any";
    const appointmentAt = new Date(`${date}T${time}:00+08:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || appointmentAt.getTime() <= Date.now()) {
      return send(res, 400, { error: "Choose a valid future appointment date and time." });
    }
    const service = await database.collection("services").findOne({ $or: [{ slug: serviceId }, ...(ObjectId.isValid(serviceId) ? [{ _id: new ObjectId(serviceId) }] : [])], active: { $ne: false } });
    if (!service) return send(res, 400, { error: "Choose an available service." });
    let selectedBarber = null;
    if (barberId && !anyBarber) {
      selectedBarber = await database.collection("barbers").findOne({ $or: [{ slug: barberId }, ...(ObjectId.isValid(barberId) ? [{ _id: new ObjectId(barberId) }] : [])], status: { $nin: ["fired", "on-leave"] } });
      if (!selectedBarber) return send(res, 400, { error: "The selected barber is not available." });
      if (onLeave(selectedBarber, date)) return send(res, 409, { error: "The selected barber is on leave for this date. Choose another barber or date." });
    }
    const settings = mergedSettings(await database.collection("settings").findOne({ _id: "shop" }));
    const quote = partyQuote(body, user, service, settings);
    const { durationMinutes } = quote;
    bookingGuards.requireFuture(date, time);
    await bookingGuards.requireCustomerCapacity(database, user._id, date, time, durationMinutes);
    const window = bookingWindow(date, time, settings, durationMinutes);
    if (window.error) return send(res, 400, { error: window.error });
    if (!paymentConfigured(settings)) return send(res, 409, { error: "Online booking is unavailable until the administrator adds a payment number or QR code in Shop settings." });
    const previousHolds = await database.collection("appointmentHolds").find({ userId: user._id }).toArray();
    const previousIds = previousHolds.map((hold) => String(hold._id));
    if (previousIds.length) {
      await database.collection("appointmentSlots").deleteMany({ appointmentId: { $in: previousIds } });
      await database.collection("appointmentHolds").deleteMany({ userId: user._id });
    }
    if (barberId && !anyBarber) {
      const unavailable = await unavailableBarbers(database, date, time, durationMinutes);
      if (unavailable.includes(barberId)) return send(res, 409, { error: "That barber is already reserved for this time. Choose another barber or time." });
    }
    const hold = {
      _id: new ObjectId(), userId: user._id, customer: user.name, serviceId, barberId, date, time, request: String(body.request || "").trim().slice(0, 1000), durationMinutes,
      ...quote,
      demoPayment: settings.paymentMode === 'demo',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), createdAt: new Date()
    };
    try {
      if (anyBarber) {
        selectedBarber = await reserveAnyBarber(database, hold._id, date, time, durationMinutes, hold.expiresAt);
        barberId = selectedBarber.slug || String(selectedBarber._id);
        hold.barberId = barberId;
      }
    } catch (error) {
      await database.collection("appointmentSlots").deleteMany({ appointmentId: String(hold._id) });
      throw error;
    }
    try {
      await database.collection("appointmentHolds").insertOne(hold);
    } catch (error) {
      await database.collection("appointmentSlots").deleteMany({ appointmentId: String(hold._id) });
      throw error;
    }
    return send(res, 201, { hold: normalizeDoc(hold) });
  }

  if (req.method === "POST" && path === "/auth/register") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    if (!allowUnverified && (password.length < 8 || password !== body.confirmPassword || security.ageOn(body.birthDate) == null)) return send(res, 400, { error: 'Enter a valid birth date and matching passwords of at least 8 characters.' });
    if (!allowUnverified && !security.emailReady() && !messaging.smsVerificationReady()) return send(res, 503, { error: 'Account verification is temporarily unavailable. Contact the shop; no account has been created.' });
    if (name.length < 2 || !email || password.length < 6) return send(res, 400, { error: "Name, email, and a 6-character password are required." });
    const phone = await availablePhone(database, body.phone);
    const user = { _id: new ObjectId(), name, email, birthDate: body.birthDate || '', passwordHash: await bcrypt.hash(password, 10), role: "customer", phone, ...(phone ? { phoneLogin: phone } : {}), verificationRequired: !allowUnverified, createdAt: new Date() };
    try {
      await database.collection("users").insertOne(user);
    } catch (error) {
      if (error?.code === 11000) return send(res, 409, { error: error.keyPattern?.phoneLogin ? 'An account with this mobile number already exists. Try logging in.' : "An account with this email already exists. Try logging in." });
      throw error;
    }
    if (!allowUnverified) {
      if (phone && messaging.smsVerificationReady()) {
        try {
          await messaging.requestPhoneVerification(database, `registration:${user._id}`, phone);
          return send(res, 201, { verificationRequired: true, channel: 'sms', email, phone });
        } catch (error) {
          if (!security.emailReady()) return send(res, 201, { verificationRequired: true, channel: 'sms', email, phone, message: 'SMS could not be sent. Retry from this screen later.' });
        }
      }
      await security.issueCode(database, email, 'verify');
      return send(res, 201, { verificationRequired: true, channel: 'email', email });
    }
    return send(res, 201, { user: publicUser(user), token: tokenFor(user) });
  }

  if (req.method === "POST" && path === "/auth/login") {
    const identifier = String(body.identifier ?? body.phone ?? body.email ?? '').trim();
    if ((body.method === 'phone' && identifier.includes('@')) || (body.method === 'email' && !identifier.includes('@'))) return send(res, 400, { error: 'Use the selected sign-in method.' });
    let user;
    if (identifier.includes('@')) {
      user = await database.collection('users').findOne({ email: identifier.toLowerCase() });
    } else {
      const phone = normalizeMobile(identifier);
      if (!phone) return send(res, 400, { error: 'Enter your mobile number or email.' });
      const matches = await phoneUsers(database, phone);
      // Ambiguous legacy numbers must use email; never choose an arbitrary account.
      if (matches.length === 1) user = matches[0];
    }
    const attemptKey = user ? String(user._id) : identifier.toLowerCase();
    await security.checkLogin(database, attemptKey);
    if (!user || !(await bcrypt.compare(String(body.password || ""), user.passwordHash))) {
      const attemptsRemaining = await security.failedLogin(database, attemptKey);
      return send(res, 401, { error: `Incorrect login details. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining before a temporary lock.`, attemptsRemaining });
    }
    await database.collection('loginAttempts').deleteOne({ _id: security.digest(attemptKey) });
    if (user.verificationRequired && !user.emailVerifiedAt && !user.phoneVerifiedAt && !user.adminTestAccess) return send(res, 403, { error: 'Verify your mobile number or email before signing in.', verificationRequired: true, email: user.email });
    return send(res, 200, { user: publicUser(user), token: tokenFor(user) });
  }

  if (req.method === "GET" && path === "/me") {
    const user = await requireUser(req, database);
    return send(res, 200, { user: publicUser(user) });
  }
  if (req.method === 'GET' && path === '/notifications/mine') {
    const user = await requireUser(req, database);
    return send(res, 200, { notifications: await database.collection('notifications').find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).toArray() });
  }
  if (req.method === 'GET' && path === '/admin/notifications') {
    await requireRole(req, database, ['admin']);
    return send(res, 200, { emailConfigured: security.emailReady(), smsConfigured: messaging.smsReady(), smsProvider: messaging.smsProviderName(), smsVerificationConfigured: messaging.smsVerificationReady(), notifications: await database.collection('notifications').find().sort({ createdAt: -1 }).limit(50).toArray() });
  }
  if (req.method === 'POST' && path === '/admin/notifications/retry') {
    await requireRole(req, database, ['admin']);
    const record = await database.collection('notifications').findOne({ _id: String(body.id || '') });
    if (!record) return send(res, 404, { error: 'Notification not found.' });
    await messaging.deliver(database, record);
    return send(res, 200, { message: 'Delivery attempt recorded. Accepted means the provider accepted the message, not confirmed delivery.' });
  }
  if (req.method === 'POST' && ['/me/phone/send-code', '/me/phone/verify'].includes(path)) {
    const user = await requireUser(req, database);
    const phone = normalizeMobile(user.phone);
    if (!phone) return send(res, 400, { error: 'Save a mobile number in your profile first.' });
    const key = security.digest(`phone-code:${user._id}`);
    if (path.endsWith('send-code')) {
      const previous = await database.collection('loginAttempts').findOne({ _id: key });
      if (previous?.sentAt && Date.now() - new Date(previous.sentAt).getTime() < 60000) return send(res, 429, { error: 'Wait a minute before requesting another SMS code.' });
      await messaging.requestPhoneVerification(database, user._id, phone);
      await database.collection('loginAttempts').updateOne({ _id: key }, { $set: { sentAt: new Date(), expiresAt: new Date(Date.now() + 600000) } }, { upsert: true });
      return send(res, 200, { message: 'SMS verification requested. Enter the code you receive.' });
    }
    if (!/^\d{6}$/.test(String(body.code || ''))) return send(res, 400, { error: 'Enter the six-digit SMS code.' });
    await messaging.verifyPhoneCode(database, user._id, phone, body.code);
    await database.collection('users').updateOne({ _id: user._id }, { $set: { phoneVerifiedAt: new Date(), smsConsent: body.smsConsent === true } });
    return send(res, 200, { user: publicUser({ ...user, phoneVerifiedAt: new Date(), smsConsent: body.smsConsent === true }) });
  }

  if (req.method === "PATCH" && path === "/me") {
    const user = await requireUser(req, database);
    const photo = body.photo == null ? (user.photo || "") : String(body.photo);
    if (photo && !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) return send(res, 400, { error: "Profile photo must be a JPG, PNG, or WebP image." });
    if (photo.length > 2.8 * 1024 * 1024) return send(res, 413, { error: "Profile photo must be 2 MB or smaller." });
    const phone = body.phone == null ? (user.phone || '') : await availablePhone(database, body.phone, user._id);
    const update = {
      name: String(body.name || user.name).trim().slice(0, 120),
      username: String(body.username || "").trim().slice(0, 60),
      phone,
      location: String(body.location || "").trim().slice(0, 160),
      bio: String(body.bio || "").trim().slice(0, 1000),
      photo,
      updatedAt: new Date()
    };
    if (body.birthDate != null) {
      if (security.ageOn(body.birthDate) == null) return send(res, 400, { error: 'Enter a valid birth date.' });
      update.birthDate = body.birthDate;
    }
    if (body.smsConsent != null) update.smsConsent = body.smsConsent === true;
    if (phone !== user.phone) update.phoneVerifiedAt = null;
    if (body.phone != null && phone) update.phoneLogin = phone;
    try {
      await database.collection("users").updateOne({ _id: user._id }, { $set: update, ...(body.phone != null && !phone ? { $unset: { phoneLogin: '' } } : {}) });
    } catch (error) {
      if (error?.code === 11000) return send(res, 409, { error: 'This mobile number is already linked to another account.' });
      throw error;
    }
    return send(res, 200, { user: publicUser({ ...user, ...update }) });
  }

  if (path === "/admin/users") {
    await requireRole(req, database, ["admin"]);
    if (req.method === "GET") return send(res, 200, { users: (await database.collection("users").find({}, { projection: { passwordHash: 0 } }).sort({ createdAt: -1 }).toArray()).map(normalizeDoc) });
    if (req.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = ["customer", "moderator", "admin"].includes(body.role) ? body.role : "customer";
      if (!email || password.length < 6) return send(res, 400, { error: "Email and a 6-character password are required." });
      const phone = await availablePhone(database, body.phone);
      const user = { _id: new ObjectId(), name: String(body.name || "Staff").trim(), email, passwordHash: await bcrypt.hash(password, 10), role, phone, ...(phone ? { phoneLogin: phone } : {}), createdAt: new Date() };
      try {
        await database.collection("users").insertOne(user);
      } catch (error) {
        if (error?.code === 11000) return send(res, 409, { error: "An account with this email already exists." });
        throw error;
      }
      return send(res, 201, { user: publicUser(user) });
    }
  }

  if (path.startsWith("/admin/users/") && req.method === "PATCH") {
    const admin = await requireRole(req, database, ["admin"]);
    const id = path.split("/").pop();
    if (typeof body.adminTestAccess === 'boolean') {
      if (!ObjectId.isValid(id)) return send(res, 400, { error: 'Choose a valid account.' });
      const target = await database.collection('users').findOne({ _id: new ObjectId(id) });
      if (!target || target.role !== 'customer') return send(res, 400, { error: 'Test access is only available for customer accounts.' });
      await database.collection('users').updateOne({ _id: target._id }, { $set: { adminTestAccess: body.adminTestAccess, testAccessGrantedBy: admin._id, updatedAt: new Date() } });
      return send(res, 200, { message: body.adminTestAccess ? 'Test sign-in and booking enabled without SMS verification. The phone number is still unverified.' : 'Test access removed. Normal verification applies.' });
    }
    const role = String(body.role || "");
    if (!ObjectId.isValid(id) || !["customer", "moderator", "admin"].includes(role)) return send(res, 400, { error: "Choose a valid account and role." });
    const target = await database.collection("users").findOne({ _id: new ObjectId(id) });
    if (!target) return send(res, 404, { error: "Account not found." });
    const protectedEmail = String(process.env.ADMIN_EMAIL || "thebarberco.official@gmail.com").toLowerCase();
    if (target.email === protectedEmail && role !== "admin") return send(res, 403, { error: "The official owner account cannot be demoted." });
    await database.collection("users").updateOne({ _id: target._id }, { $set: { role, updatedAt: new Date() } });
    return send(res, 200, { user: publicUser({ ...target, role }) });
  }

  if (path === "/admin/payment-qr/validate" && req.method === "POST") {
    await requireRole(req, database, ["admin"]);
    return send(res, 200, { validation: await validateQrImage(body.qrImage) });
  }

  if (path === "/admin/settings" && req.method === "PATCH") {
    await requireRole(req, database, ["admin"]);
    if (body.gracePeriodMinutes !== undefined && (!Number.isInteger(body.gracePeriodMinutes) || body.gracePeriodMinutes < 0 || body.gracePeriodMinutes > 60)) return send(res, 400, { error: 'Grace period must be 0 to 60 whole minutes.' });
    const paymentMode = body.paymentMode || 'live';
    if (paymentMode !== 'live') return send(res, 400, { error: 'Demo payments are no longer supported. Configure a real GCash or Maya payment method.' });
    if (paymentMode === 'live' && body.paymentDetailsConfirmed !== true) return send(res, 400, { error: 'Confirm that you checked the payment recipient in GCash/Maya before enabling real payments.' });
    const gcash = await sanitizeMethod(body.gcash, 'GCash', paymentMode);
    const maya = await sanitizeMethod(body.maya, 'Maya', paymentMode);
    const operatingHours = {};
    for (const day of dayNames) {
      const supplied = body.operatingHours?.[day] || defaultSettings.operatingHours[day];
      const open = String(supplied.open || "");
      const close = String(supplied.close || "");
      const closed = Boolean(supplied.closed);
      if (!closed && (!/^\d{2}:\d{2}$/.test(open) || !/^\d{2}:\d{2}$/.test(close) || minutes(open) >= minutes(close))) {
        return send(res, 400, { error: `Enter valid opening and closing times for ${day}.` });
      }
      operatingHours[day] = { open, close, closed };
    }
    const closedDates = [...new Set((Array.isArray(body.closedDates) ? body.closedDates : []).map(String).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
    const update = {
      gcash,
      maya,
      paymentMode,
      paymentDetailsConfirmed: paymentMode === 'live' && body.paymentDetailsConfirmed === true,
      bookingFee: Math.max(0, Number(body.bookingFee) || 0),
      gracePeriodMinutes: body.gracePeriodMinutes ?? 10,
      operatingHours,
      closedDates,
      updatedAt: new Date()
    };
    await database.collection("settings").updateOne({ _id: "shop" }, { $set: update }, { upsert: true });
    return send(res, 200, { settings: mergedSettings({ _id: "shop", ...update }) });
  }

  if (req.method === "GET" && path === "/catalog") {
    const [services, barbers] = await Promise.all([
      database.collection("services").find({ active: { $ne: false } }).sort({ createdAt: 1 }).toArray(),
      database.collection("barbers").find({ status: { $ne: "fired" } }).sort({ createdAt: 1 }).toArray()
    ]);
    return send(res, 200, { services: services.map(normalizeDoc), barbers: barbers.map(normalizeDoc) });
  }

  if (path === "/admin/services") {
    await requireRole(req, database, ["admin"]);
    if (req.method === "GET") return send(res, 200, { services: (await database.collection("services").find({ active: { $ne: false } }).sort({ createdAt: 1 }).toArray()).map(normalizeDoc) });
    if (req.method === "POST") {
      const name = String(body.name || '').trim();
      const slug = slugify(name);
      if (!name || !slug || body.price == null || body.price === '' || !Number.isFinite(Number(body.price)) || Number(body.price) < 0) return send(res, 400, { error: 'Enter a service name and a valid non-negative price.' });
      const services = await database.collection('services').find({}).toArray();
      const existing = services.find(item => item.slug === slug || String(item.name || '').trim().toLowerCase() === name.toLowerCase());
      if (existing && existing.active !== false) return send(res, 409, { error: 'This service already exists. Edit the existing service instead.' });
      const service = { _id: existing?._id || new ObjectId(), slug: existing?.slug || slug, name, price: Number(body.price), duration: body.duration || "30 min", detail: body.detail || "", icon: body.icon || "NEW", active: true, createdAt: existing?.createdAt || new Date() };
      if (existing) {
        await database.collection('services').updateOne({ _id: existing._id }, { $set: { ...service, updatedAt: new Date() } });
      } else {
        try { await database.collection("services").insertOne(service); }
        catch (error) {
          if (error.code === 11000) return send(res, 409, { error: 'This service already exists. Refresh the list and edit it instead.' });
          throw error;
        }
      }
      return send(res, 201, { service: normalizeDoc(service) });
    }
  }

  if (path.startsWith("/admin/services/")) {
    await requireRole(req, database, ["admin"]);
    const id = path.split("/").pop();
    if (!ObjectId.isValid(id)) return send(res, 400, { error: 'Choose a valid service.' });
    if (req.method === "PATCH") {
      const update = { ...body, updatedAt: new Date() };
      if (body.price != null) update.price = Number(body.price);
      await database.collection("services").updateOne({ _id: new ObjectId(id) }, { $set: update });
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      const service = await database.collection('services').findOne({ _id: new ObjectId(id), active: { $ne: false } });
      if (!service) return send(res, 404, { error: 'Service is already removed or does not exist.' });
      const activeServices = await database.collection('services').find({ active: { $ne: false } }).toArray();
      if (activeServices.length <= 1) return send(res, 409, { error: 'At least one service must remain.' });
      await database.collection("services").updateOne({ _id: new ObjectId(id) }, { $set: { active: false, updatedAt: new Date() } });
      return send(res, 200, { ok: true });
    }
  }

  if (path === "/admin/barbers") {
    await requireRole(req, database, ["admin"]);
    if (req.method === "GET") return send(res, 200, { barbers: (await database.collection("barbers").find({ status: { $ne: 'fired' } }).sort({ createdAt: 1 }).toArray()).map(normalizeDoc) });
    if (req.method === "POST") {
      const name = String(body.name || '').trim();
      if (!name) return send(res, 400, { error: 'Enter the barber name.' });
      const slug = slugify(name);
      const existing = (await database.collection('barbers').find({}).toArray()).find(item => item.slug === slug || String(item.name || '').trim().toLowerCase() === name.toLowerCase());
      if (existing && existing.status !== 'fired') return send(res, 409, { error: 'This barber is already on the team. Update their status instead.' });
      const barber = { _id: existing?._id || new ObjectId(), slug: existing?.slug || slug, name, role: body.role || "Barber", status: body.status === 'on-leave' ? 'on-leave' : 'active', bio: body.bio || "", createdAt: existing?.createdAt || new Date() };
      if (existing) {
        await database.collection('barbers').updateOne({ _id: existing._id }, { $set: { ...barber, updatedAt: new Date() } });
      } else {
        try { await database.collection("barbers").insertOne(barber); }
        catch (error) {
          if (error.code === 11000) return send(res, 409, { error: 'This barber already exists. Refresh the team list and try again.' });
          throw error;
        }
      }
      return send(res, 201, { barber: normalizeDoc(barber) });
    }
  }

  if (path.startsWith("/admin/barbers/")) {
    await requireRole(req, database, ["admin"]);
    const id = path.split("/").pop();
    if (!ObjectId.isValid(id)) return send(res, 400, { error: 'Choose a valid barber.' });
    const leave = req.method === 'PATCH' && (body.leaveFrom !== undefined || body.leaveTo !== undefined) ? leaveDates(body) : null;
    if (req.method === 'DELETE' || req.method === 'PATCH' && (['fired', 'on-leave'].includes(body.status) || leave?.leaveFrom)) {
      const barber = await database.collection('barbers').findOne({ _id: new ObjectId(id) });
      if (!barber) return send(res, 404, { error: 'Barber not found.' });
      const ids = [id, barber.slug].filter(Boolean);
      const bookings = await database.collection('appointments').find({ barberId: { $in: ids }, status: { $in: ['pending', 'confirmed'] } }).toArray();
      const unresolved = bookings.some(item => (!leave?.leaveFrom || item.date >= leave.leaveFrom && item.date <= leave.leaveTo) && new Date(`${item.date}T${item.time}:00+08:00`).getTime() + Number(item.durationMinutes || 30) * 60000 > Date.now());
      const queued = await database.collection('queue').findOne({ barberId: { $in: ids }, status: { $in: ['waiting', 'serving'] } });
      const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      if (unresolved || queued && (!leave?.leaveFrom || today >= leave.leaveFrom && today <= leave.leaveTo)) return send(res, 409, { error: 'Resolve this barber\'s bookings and queue tickets during the affected dates first. Rescheduling requires customer approval.' });
    }
    if (req.method === "PATCH") {
      const update = { ...(body.status && ['active', 'on-leave'].includes(body.status) ? { status: body.status } : {}), ...(leave || {}), updatedAt: new Date() };
      await database.collection("barbers").updateOne({ _id: new ObjectId(id) }, { $set: update });
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      const barber = await database.collection('barbers').findOne({ _id: new ObjectId(id), status: { $ne: 'fired' } });
      if (!barber) return send(res, 404, { error: 'Barber is already removed or does not exist.' });
      await database.collection("barbers").updateOne({ _id: new ObjectId(id) }, { $set: { status: "fired", updatedAt: new Date() } });
      return send(res, 200, { ok: true });
    }
  }

  if (req.method === 'POST' && path === '/checkout/validate') {
    const user = await requireUser(req, database);
    const bookingPaymentMethod = bookingPaymentChoice(body.bookingPaymentMethod);
    const hold = ObjectId.isValid(body.holdId) ? await database.collection('appointmentHolds').findOne({ _id: new ObjectId(body.holdId), userId: user._id, expiresAt: { $gt: new Date() } }) : null;
    if (!hold) return send(res, 409, { error: 'Checkout expired. Do not transfer money. Start a new booking, or submit payment recovery if you already paid.' });
    requireSingleBooking(hold);
    if (hold.barberId) {
      const barber = await database.collection('barbers').findOne({ $or: [{ slug: hold.barberId }, ...(ObjectId.isValid(hold.barberId) ? [{ _id: new ObjectId(hold.barberId) }] : [])] });
      if (!barber || ['fired', 'on-leave'].includes(barber.status)) return send(res, 409, { error: 'The selected barber is no longer available. Return to booking and choose another barber.' });
      if (onLeave(barber, hold.date)) return send(res, 409, { error: 'The selected barber is on leave for this date. Return to booking and choose another barber or date.' });
    }
    const settings = mergedSettings(await database.collection('settings').findOne({ _id: 'shop' }));
    const service = await database.collection('services').findOne({ $or: [{ slug: hold.serviceId }, ...(ObjectId.isValid(hold.serviceId) ? [{ _id: new ObjectId(hold.serviceId) }] : [])], active: { $ne: false } });
    if (!service || settings.paymentRevision !== body.paymentRevision || bookingPaymentMethod === 'online' && !paymentConfigured(settings)) return send(res, 409, { error: 'Payment details changed or online payment is unavailable. Do not pay using this checkout. Start again or choose payment at the shop.' });
    const quote = partyQuote(hold, user, service, settings);
    if (quote.total !== hold.total || quote.durationMinutes !== hold.durationMinutes) return send(res, 409, { error: 'The service quote changed. Start again or submit payment recovery if already paid.' });
    bookingGuards.requireFuture(hold.date, hold.time);
    return send(res, 200, { valid: true, splitPaymentVersion: 1, bookingPaymentChoices: ['online', 'onsite'] });
  }
  if (req.method === "POST" && path === "/appointments") {
    const user = await requireUser(req, database);
    const bookingPaymentMethod = bookingPaymentChoice(body.bookingPaymentMethod);
    const servicePaymentMethod = paymentChoice(body.servicePaymentMethod);
    if (body.nonRefundableAccepted !== true) return send(res, 400, { error: 'Accept the non-refundable booking policy before booking.' });
    requireBookingEligibility(user);
    requireSingleBooking(body);
    const customer = String(body.customer || user.name || "").trim().slice(0, 120);
    if (customer.length < 2) return send(res, 400, { error: "Enter the name or nickname staff should call." });
    const date = String(body.date || "");
    const time = String(body.time || "");
    const appointmentAt = new Date(`${date}T${time}:00+08:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !Number.isFinite(appointmentAt.getTime())) {
      return send(res, 400, { error: "Choose a valid appointment date and time." });
    }
    if (appointmentAt.getTime() <= Date.now()) {
      return send(res, 400, { error: "Past dates and times cannot be booked." });
    }
    const service = await database.collection("services").findOne({ $or: [{ slug: body.serviceId }, ...(ObjectId.isValid(body.serviceId) ? [{ _id: new ObjectId(body.serviceId) }] : [])], active: { $ne: false } });
    if (!service) return send(res, 400, { error: "Choose an available service." });
    const settings = mergedSettings(await database.collection("settings").findOne({ _id: "shop" }));
    const quote = partyQuote(body, user, service, settings);
    const { durationMinutes } = quote;
    bookingGuards.requireFuture(date, time);
    await bookingGuards.requireCustomerCapacity(database, user._id, date, time, durationMinutes);
    const window = bookingWindow(date, time, settings, durationMinutes);
    if (window.error) return send(res, 400, { error: window.error });
    const holdId = String(body.holdId || "");
    const hold = holdId && ObjectId.isValid(holdId) ? await database.collection("appointmentHolds").findOne({
      _id: new ObjectId(holdId),
      userId: user._id,
      expiresAt: { $gt: new Date() }
    }) : null;
    if (hold) requireSingleBooking(hold);
    const requestedBarberId = String(body.barberId || "");
    let barberId = requestedBarberId === "any" && hold ? hold.barberId : requestedBarberId;
    if (barberId === 'any') {
      const candidate = await reserveAnyBarber(database, '', date, time, durationMinutes);
      barberId = candidate.slug || String(candidate._id);
    }
    if (holdId && (!hold || hold.serviceId !== body.serviceId || (requestedBarberId !== "any" && hold.barberId !== requestedBarberId) || hold.date !== date || hold.time !== time)) {
      return send(res, 409, { error: "Your temporary reservation expired or changed. Return to booking and choose the slot again." });
    }
    let selectedBarber = null;
    if (barberId) {
      selectedBarber = await database.collection("barbers").findOne({ $or: [{ slug: barberId }, ...(ObjectId.isValid(barberId) ? [{ _id: new ObjectId(barberId) }] : [])], status: { $nin: ["fired", "on-leave"] } });
      if (!selectedBarber) return send(res, 400, { error: "The selected barber is not available." });
      if (onLeave(selectedBarber, date)) return send(res, 409, { error: "The selected barber is on leave for this date. Choose another barber or date." });
    }
    if (barberId) {
      const unavailable = await unavailableBarbers(database, date, time, durationMinutes, hold ? holdId : "");
      if (unavailable.includes(barberId)) return send(res, 409, { error: "That barber was just booked for this time. Choose another barber or time." });
    }
    const demoPayment = bookingPaymentMethod === 'online' && settings.paymentMode === 'demo';
    if (hold && (hold.partySize !== quote.partySize || JSON.stringify(hold.partyMembers) !== JSON.stringify(quote.partyMembers) || hold.total !== quote.total || hold.durationMinutes !== quote.durationMinutes)) return send(res, 409, { error: 'Your group or service quote changed. Return to booking.' });
    if (bookingPaymentMethod === 'online' && !paymentConfigured(settings)) return send(res, 409, { error: 'Online payments are not configured. Choose payment at the shop instead.' });
    if (bookingPaymentMethod === 'online' && body.paymentMode && body.paymentMode !== settings.paymentMode) return send(res, 409, { error: 'Payment mode changed. Reload the payment page before proceeding.' });
    if (body.paymentRevision && body.paymentRevision !== settings.paymentRevision) return send(res, 409, { error: 'Payment recipient or fee changed. Reload the payment page and check the latest details. If you already paid, contact the shop before paying again.' });
    const methods = demoPayment ? settings.demoMethods : settings;
    const paymentMethod = bookingPaymentMethod === 'onsite' ? 'On-site' : ["GCash", "Maya"].find((name) => name === body.paymentMethod && methods[name.toLowerCase()]?.enabled) || "";
    const paymentProof = bookingPaymentMethod === 'onsite' ? '' : String(body.paymentProof || "");
    if (bookingPaymentMethod === 'online' && (!paymentMethod || !/^data:image\/(jpeg|png|webp);base64,/.test(paymentProof))) {
      return send(res, 400, { error: "Upload a valid payment proof." });
    }
    if (paymentProof.length > 2.8 * 1024 * 1024) {
      return send(res, 413, { error: "Payment proof must be 2 MB or smaller." });
    }
    if (bookingPaymentMethod === 'online') await validateReceipt(paymentProof);
    const queueNumber = await nextQueueNumber(database);
    const bookingFee = Math.max(0, Number(settings.bookingFee) || 0);
    const appointment = { _id: new ObjectId(), serviceId: body.serviceId, barberId, date, time, request: String(body.request || "").slice(0, 1000), source: "online", bookingFee, total: Number(service.price) + bookingFee, paymentMethod, paymentProof, demoPayment, userId: user._id, customer: user.name, customerEmail: user.email, queueNumber, status: "pending", paid: false, createdAt: new Date() };
    Object.assign(appointment, { nonRefundableAccepted: true, nonRefundableAcceptedAt: new Date(), policyVersion: nonRefundablePolicyVersion });
    Object.assign(appointment, quote);
    Object.assign(appointment, { bookingPaymentMethod, servicePaymentMethod: bookingPaymentMethod === 'onsite' ? 'cash' : servicePaymentMethod, onlineAmount: bookingPaymentMethod === 'onsite' ? 0 : servicePaymentMethod === 'cash' ? quote.bookingFee : quote.total, cashDue: bookingPaymentMethod === 'onsite' ? quote.total : servicePaymentMethod === 'cash' ? quote.total - quote.bookingFee : 0, bookingFeePaid: false, servicePaid: false });
    try {
      await database.collection("appointments").insertOne(appointment);
      if (hold) await database.collection("appointmentHolds").deleteOne({ _id: hold._id });
    } catch (error) {
      await database.collection("appointmentSlots").deleteMany({ appointmentId: String(appointment._id) });
      throw error;
    }
    return send(res, 201, { appointment: normalizeDoc(appointment) });
  }

  if (req.method === "GET" && path === "/appointments/mine") {
    const user = await requireUser(req, database);
    const appointments = await database.collection("appointments").find({ userId: user._id, demoPayment: { $ne: true } }, { projection: { paymentProof: 0, notificationOutbox: 0 } }).sort({ createdAt: -1 }).limit(50).toArray();
    const tickets = await database.collection('queue').find({ source: 'appointment', userId: user._id }).toArray();
    return send(res, 200, { appointments: appointments.map(item => normalizeDoc({ ...item, attendanceStatus: bookingGuards.attendance(item, tickets) })) });
  }

  if (req.method === 'GET' && path === '/admin/appointment-requests') {
    await requireRole(req, database, ['admin', 'moderator']);
    const appointments = await database.collection('appointments').find({ demoPayment: { $ne: true }, archived: { $ne: true }, $or: [{ status: 'pending' }, { 'rescheduleRequest.status': 'pending' }] }, { projection: { customer: 1, serviceId: 1, barberId: 1, date: 1, time: 1, status: 1, rescheduleRequest: 1 } }).sort({ createdAt: -1 }).limit(50).toArray();
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { appointments: appointments.map(normalizeDoc) });
  }

  if (path === "/admin/appointments") {
    await requireRole(req, database, ["admin", "moderator"]);
    if (req.method === "GET") {
      const [appointments, holds, settings, tickets] = await Promise.all([
        database.collection("appointments").find({ demoPayment: { $ne: true } }, { projection: { paymentProof: 0, notificationOutbox: 0 } }).sort({ createdAt: -1 }).toArray(),
        database.collection("appointmentHolds").find({ demoPayment: { $ne: true }, expiresAt: { $gt: new Date() } }, { projection: { paymentProof: 0 } }).sort({ createdAt: -1 }).toArray(),
        database.collection("settings").findOne({ _id: "shop" }),
        database.collection('queue').find({ source: 'appointment' }, { projection: { appointmentId: 1, status: 1 } }).toArray()
      ]);
      const owners = holds.length ? await database.collection("users").find({ _id: { $in: holds.map((hold) => hold.userId) } }, { projection: { name: 1 } }).toArray() : [];
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, {
        appointments: appointments.map(item => ({ ...normalizeDoc(item), attendanceStatus: bookingGuards.attendance(item, tickets), hasPaymentProof: item.bookingPaymentMethod !== 'onsite' && item.hasPaymentProof !== false })),
        reservations: holds.map((hold) => ({ ...normalizeDoc(hold), customer: hold.customer || owners.find((user) => String(user._id) === String(hold.userId))?.name || "Customer", status: "awaiting-payment" })),
        paymentMode: mergedSettings(settings || {}).paymentMode,
        paymentConfigured: paymentConfigured(mergedSettings(settings || {}))
      });
    }
  }

  if (req.method === 'GET' && /^\/admin\/appointments\/[a-f0-9]{24}\/proof$/.test(path)) {
    await requireRole(req, database, ['admin', 'moderator']);
    const appointment = await database.collection('appointments').findOne({ _id: new ObjectId(path.split('/')[3]) });
    if (!appointment?.paymentProof) return send(res, 404, { error: 'No payment proof is saved for this booking.' });
    await validateReceipt(appointment.paymentProof);
    return send(res, 200, { paymentProof: appointment.paymentProof });
  }

  if (req.method === 'PATCH' && /^\/(admin\/)?appointments\/[a-f0-9]{24}\/(reschedule|reschedule-review)$/.test(path)) {
    const customerRequest = !path.startsWith('/admin/');
    const review = path.endsWith('/reschedule-review');
    const staffNote = customerRequest ? '' : String(body.reason || '').trim().slice(0, 500);
    const actor = customerRequest ? await requireUser(req, database) : await requireRole(req, database, ['admin', 'moderator']);
    const id = path.split('/').at(-2);
    const current = await database.collection('appointments').findOne({ _id: new ObjectId(id) });
    if (customerRequest && (!current || String(current.userId) !== String(actor._id))) return send(res, 404, { error: 'Appointment not found.' });
    if (!current || !['pending', 'confirmed'].includes(current.status)) return send(res, 409, { error: 'Only active appointments can be rescheduled.' });
    if (current.checkedInAt) return send(res, 409, { error: 'This booking has checked in. Manage the customers in the staff queue instead.' });
    const revision = { _id: current._id, date: current.date, time: current.time, status: current.status, rescheduleRequest: current.rescheduleRequest || { $exists: false } };
    if (review) {
      if (!['approve', 'reject'].includes(body.decision)) return send(res, 400, { error: 'Choose approve or reject.' });
      if (current.rescheduleRequest?.status !== 'pending') return send(res, 409, { error: 'There is no pending reschedule request.' });
      if (customerRequest !== (current.rescheduleRequest.initiatedBy === 'staff')) return send(res, 403, { error: 'The other side must review this reschedule request.' });
      if (body.requestedAt !== new Date(current.rescheduleRequest.requestedAt).toISOString()) return send(res, 409, { error: 'This reschedule request changed. Refresh before reviewing.' });
      revision['rescheduleRequest.expiresAt'] = { $gt: new Date() };
      if (body.decision === 'reject') {
        const rescheduleRequest = { ...current.rescheduleRequest, status: 'rejected', reviewedAt: new Date(), reason: staffNote };
        const changed = await updateWithNotice(database, 'appointments', revision, { $set: { rescheduleRequest, updatedAt: new Date() } });
        if (!changed.modifiedCount) return send(res, 409, { error: 'This appointment changed. Refresh and try again.' });
        await messaging.notify(database, current.userId, `Your reschedule request was rejected. Your original booking remains ${current.date} at ${current.time}.${partyNotice(current)}${staffNote ? ` Reason: ${staffNote}` : ''}`, `appointment:${id}:reschedule-rejected:${new Date(current.rescheduleRequest.requestedAt).toISOString()}`);
        return send(res, 200, { appointment: normalizeDoc({ ...current, rescheduleRequest }) });
      }
    }
    if (!review && current.rescheduleRequest?.status === 'pending') return send(res, 409, { error: 'A reschedule request is already pending.' });
    if (customerRequest && new Date(`${current.date}T${current.time}:00+08:00`).getTime() <= Date.now()) return send(res, 409, { error: 'This appointment has already started. Contact the shop.' });
    const date = String((review ? current.rescheduleRequest.date : body.date) || '');
    const time = String((review ? current.rescheduleRequest.time : body.time) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !(new Date(`${date}T${time}:00+08:00`).getTime() > Date.now())) return send(res, 400, { error: 'Choose a valid future date and time.' });
    if (current.date === date && current.time === time) return send(res, 409, { error: 'Choose a different date or time. The current schedule cannot be requested again.' });
    bookingGuards.requireFuture(date, time);
    const service = await database.collection('services').findOne({ $or: [{ slug: current.serviceId }, ...(ObjectId.isValid(current.serviceId) ? [{ _id: new ObjectId(current.serviceId) }] : [])] });
    const settings = mergedSettings(await database.collection('settings').findOne({ _id: 'shop' }));
    const duration = appointmentDuration(current, service);
    await bookingGuards.requireCustomerCapacity(database, current.userId, date, time, duration, id);
    const window = bookingWindow(date, time, settings, duration);
    if (window.error) return send(res, 400, { error: window.error });
    const barber = current.barberId ? await database.collection('barbers').findOne({ $or: [{ slug: current.barberId }, ...(ObjectId.isValid(current.barberId) ? [{ _id: new ObjectId(current.barberId) }] : [])] }) : null;
    if (current.barberId && (!barber || ['fired', 'on-leave'].includes(barber.status))) return send(res, 409, { error: 'The selected barber is not available.' });
    if (barber && onLeave(barber, date)) return send(res, 409, { error: 'The selected barber is on leave for this date. Choose another date.' });
    const unavailable = await unavailableBarbers(database, date, time, duration, '', id);
    if (current.barberId && unavailable.includes(current.barberId)) return send(res, 409, { error: 'This barber is already reserved at that time.' });
    if (!review) {
      const requestedAt = new Date(Math.max(Date.now(), (new Date(current.rescheduleRequest?.requestedAt).getTime() || 0) + 1));
      const rescheduleRequest = { date, time, originalDate: current.date, originalTime: current.time, requestedAt, initiatedBy: customerRequest ? 'customer' : 'staff', reason: staffNote, status: 'pending', expiresAt: rescheduleDeadline(current, { date, time }) };
      const changed = await updateWithNotice(database, 'appointments', revision, { $set: { rescheduleRequest, updatedAt: new Date() } });
      if (!changed.modifiedCount) return send(res, 409, { error: 'This appointment changed. Refresh and try again.' });
      if (!customerRequest) await messaging.notify(database, current.userId, `The shop proposes moving your booking to ${date} at ${time}. Open My bookings to accept or keep your original schedule (${current.date} at ${current.time}). Reason: ${staffNote}`, `appointment:${id}:reschedule-proposed:${requestedAt.toISOString()}`);
      return send(res, 200, { appointment: normalizeDoc({ ...current, rescheduleRequest }) });
    }
    const rescheduleRequest = current.rescheduleRequest?.status === 'pending' ? { ...current.rescheduleRequest, status: review ? 'approved' : 'superseded', reviewedAt: new Date(), reason: staffNote } : current.rescheduleRequest;
    const newSlots = barber && current.status === 'confirmed' ? appointmentSlotIds(date, String(barber._id), time, duration) : [];
    const existing = await database.collection('appointmentSlots').find({ appointmentId: id }).toArray();
    const retained = new Set(existing.map((slot) => slot._id));
    const tempId = String(new ObjectId());
    const extraSlots = newSlots.filter((slot) => !retained.has(slot)).map((_id) => ({ _id, appointmentId: tempId, createdAt: new Date(), expiresAt: new Date(Date.now() + 120000) }));
    try {
      if (extraSlots.length) await database.collection('appointmentSlots').insertMany(extraSlots, { ordered: true });
      if (review) revision['rescheduleRequest.expiresAt'] = { $gt: new Date() };
      const changed = await updateWithNotice(database, 'appointments', revision, { $set: { date, time, ...(current.status === 'confirmed' ? { graceDeadline: new Date(frontDesk.startAt({ date, time }).getTime() + (current.gracePeriodMinutes ?? frontDesk.grace(settings)) * 60000) } : {}), ...(rescheduleRequest ? { rescheduleRequest } : {}), ...(staffNote ? { staffNote } : {}), updatedAt: new Date() } });
      if (!changed.modifiedCount) throw Object.assign(new Error('This appointment changed. Refresh and try again.'), { status: 409 });
      await database.collection('appointmentSlots').updateMany({ appointmentId: tempId }, { $set: { appointmentId: id }, $unset: { expiresAt: '' } });
      await database.collection('appointmentSlots').deleteMany({ appointmentId: id, _id: { $nin: newSlots } });
    } catch (error) {
      await database.collection('appointmentSlots').deleteMany({ appointmentId: tempId });
      if (error.code === 11000) return send(res, 409, { error: 'This barber was just reserved. Choose another time.' });
      throw error;
    }
    await messaging.notify(database, current.userId, `Your Barber Co appointment was rescheduled from ${current.date} at ${current.time} to ${date} at ${time}.${partyNotice(current)}${staffNote ? ` Reason: ${staffNote}.` : ''} Contact the shop if this does not suit you.`, `appointment:${id}:rescheduled:${date}:${time}`);
    return send(res, 200, { appointment: normalizeDoc({ ...current, date, time, ...(rescheduleRequest ? { rescheduleRequest } : {}) }) });
  }

  if (req.method === 'PATCH' && /^\/appointments\/[a-f0-9]{24}\/cancel$/.test(path)) {
    const user = await requireUser(req, database);
    const id = path.split('/')[2];
    const current = await database.collection('appointments').findOne({ _id: new ObjectId(id), userId: user._id });
    if (!current) return send(res, 404, { error: 'Appointment not found.' });
    if (!['pending', 'confirmed'].includes(current.status) || new Date(`${current.date}T${current.time}:00+08:00`).getTime() <= Date.now()) return send(res, 409, { error: 'Only upcoming active appointments can be cancelled.' });
    if (body.acceptNoRefund !== true) return send(res, 400, { error: 'Confirm that cancellation does not include a refund.' });
    const changed = await updateWithNotice(database, 'appointments', { _id: current._id, status: current.status, date: current.date, time: current.time }, { $set: { status: 'cancelled', cancelledBy: 'customer', noRefund: true, updatedAt: new Date() } });
    if (!changed.modifiedCount) return send(res, 409, { error: 'This appointment changed. Refresh and try again.' });
    await database.collection('appointmentSlots').deleteMany({ appointmentId: id });
    await database.collection('queue').updateMany({ appointmentId: id, status: { $in: ['waiting', 'serving'] } }, { $set: { status: 'cancelled', updatedAt: new Date() } });
    await messaging.notify(database, user._id, `Your Barber Co appointment on ${current.date} at ${current.time} was cancelled.${partyNotice(current)} No refund will be issued.`, `appointment:${id}:cancelled`);
    return send(res, 200, { appointment: normalizeDoc({ ...current, status: 'cancelled', noRefund: true }) });
  }

  if (/^\/admin\/appointments\/[a-f0-9]{24}\/check-in$/.test(path) && req.method === 'PATCH') {
    await requireRole(req, database, ['admin', 'moderator']);
    const appointment = await frontDesk.checkIn(database, path.split('/')[3], body.memberIndices);
    return send(res, 200, { appointment: normalizeDoc(appointment) });
  }

  if (path.startsWith("/admin/appointments/") && req.method === "PATCH") {
    await requireRole(req, database, ["admin", "moderator"]);
    const id = path.split("/").pop();
    const allowed = ["pending", "confirmed", "completed", "cancelled", "disapproved"];
    if (!ObjectId.isValid(id) || !allowed.includes(body.status)) return send(res, 400, { error: "Choose a valid appointment status." });
    const current = await database.collection('appointments').findOne({ _id: new ObjectId(id) });
    if (!current) return send(res, 404, { error: 'Appointment not found.' });
    const update = { status: body.status, updatedAt: new Date() };
    if (body.status === 'cancelled' && current.status === 'pending' && !current.demoPayment) Object.assign(update, { refundStatus: 'review-required', noRefund: false, cancelledBy: 'shop' });
    if (body.status === 'disapproved' && current.status === 'pending') Object.assign(update, { ...(!current.demoPayment ? { refundStatus: 'review-required', noRefund: false } : {}), cancelledBy: 'shop' });
    if (current.rescheduleRequest?.status === 'pending' && ['confirmed', 'completed'].includes(body.status)) return send(res, 409, { error: 'Review the pending reschedule request first.' });
    const staffNote = ['cancelled', 'disapproved'].includes(body.status) ? String(body.reason || '').trim().slice(0, 500) : '';
    if (body.status === 'disapproved' && !staffNote) return send(res, 400, { error: 'Enter a reason for disapproving the request.' });
    if (staffNote) update.staffNote = staffNote;
    if (current.status === body.status) return send(res, 200, { appointment: normalizeDoc(current) });
    const transitions = { pending: ['confirmed', 'cancelled', 'disapproved'], confirmed: ['completed', 'cancelled'], completed: [], cancelled: [], disapproved: [] };
    if (!transitions[current.status]?.includes(body.status)) return send(res, 409, { error: 'This appointment has already changed. Refresh before proceeding.' });
    Object.assign(update, paymentUpdate(current, body.status, new Date(), body));
    const acquiring = current.status === 'pending' && body.status === 'confirmed';
    if (acquiring) {
      const service = await database.collection('services').findOne({ $or: [{ slug: current.serviceId }, ...(ObjectId.isValid(current.serviceId) ? [{ _id: new ObjectId(current.serviceId) }] : [])] });
      const duration = appointmentDuration(current, service);
      await bookingGuards.requireCustomerCapacity(database, current.userId, current.date, current.time, duration, id);
      const settings = mergedSettings(await database.collection('settings').findOne({ _id: 'shop' }));
      if (!service || service.active === false) return send(res, 409, { error: 'The selected service is no longer available.' });
      if (!(new Date(`${current.date}T${current.time}:00+08:00`).getTime() > Date.now())) return send(res, 409, { error: 'Past appointments cannot be approved.' });
      const window = bookingWindow(current.date, current.time, settings, duration);
      if (window.error) return send(res, 409, { error: window.error });
      const barber = current.barberId ? await database.collection('barbers').findOne({ $or: [{ slug: current.barberId }, ...(ObjectId.isValid(current.barberId) ? [{ _id: new ObjectId(current.barberId) }] : [])] }) : await reserveAnyBarber(database, id, current.date, current.time, duration);
      if (!barber) return send(res, 409, { error: 'The selected barber is not available.' });
      if (['fired', 'on-leave'].includes(barber.status)) return send(res, 409, { error: 'The selected barber is not available.' });
      if (onLeave(barber, current.date)) return send(res, 409, { error: 'This barber is on leave on the appointment date. Resolve the booking before approving it.' });
      const unavailable = await unavailableBarbers(database, current.date, current.time, duration, '', id);
      if (unavailable.includes(barber.slug) || unavailable.includes(String(barber._id))) return send(res, 409, { error: 'This barber is already booked at that time.' });
      await lockAppointmentSlots(database, id, current.date, String(barber._id), current.time, duration);
      update.barberId = barber.slug || String(barber._id);
      update.graceDeadline = new Date(frontDesk.startAt(current).getTime() + frontDesk.grace(settings) * 60000);
      update.gracePeriodMinutes = frontDesk.grace(settings);
    }
    try {
      const changed = await updateWithNotice(database, "appointments", { _id: new ObjectId(id), status: current.status, date: current.date, time: current.time, rescheduleRequest: current.rescheduleRequest || { $exists: false } }, { $set: update });
      if (changed?.modifiedCount === 0) throw Object.assign(new Error('This appointment changed while you were reviewing it. Refresh and try again.'), { status: 409 });
    } catch (error) {
      if (acquiring) await database.collection('appointmentSlots').deleteMany({ appointmentId: id });
      throw error;
    }
    if (["completed", "cancelled", "disapproved"].includes(body.status)) {
      await database.collection("appointmentSlots").deleteMany({ appointmentId: id });
      await database.collection('queue').updateMany({ appointmentId: id, status: { $in: ['waiting', 'serving'] } }, { $set: { status: body.status === 'completed' ? 'done' : 'cancelled', updatedAt: new Date() } });
    }
    const appointment = await database.collection("appointments").findOne({ _id: new ObjectId(id) });
    await messaging.notify(database, current.userId, `Your Barber Co appointment on ${current.date} at ${current.time} is ${body.status === 'confirmed' ? 'accepted' : body.status}.${partyNotice(current)}${paymentNotice(appointment)}${staffNote ? ` Reason: ${staffNote}.` : ''}${update.refundStatus ? ' The shop must verify your transfer and arrange a manual refund for a rejected paid request. No automatic wallet refund has been sent.' : ''}`, `appointment:${id}:${body.status}`);
    return send(res, 200, { appointment: normalizeDoc(appointment) });
  }

  if (req.method === 'GET' && path === '/admin/queue/qr') {
    await requireRole(req, database, ['admin', 'moderator']);
    res.setHeader('Cache-Control', 'no-store');
    const token = jwt.sign({ purpose: 'shop-walkin', nonce: require('node:crypto').randomUUID() }, jwtSecret, { algorithm: 'HS256', expiresIn: 120 });
    const expiresAt = new Date(jwt.decode(token).exp * 1000).toISOString();
    const url = new URL('queue.html', `${(process.env.PUBLIC_SITE_URL || 'https://thebarbercoofficial.github.io/barber-co').replace(/\/$/, '')}/`);
    url.searchParams.set('walkinToken', token);
    const qrImage = await require('qrcode').toDataURL(url.href, { width: 700, margin: 4 });
    return send(res, 200, { token, expiresAt, qrImage });
  }

  if (req.method === 'GET' && path === '/queue/walkin-access' || req.method === 'POST' && path === '/queue/walkin') {
    res.setHeader('Cache-Control', 'no-store');
    let access;
    try {
      const token = req.method === 'GET' ? requestUrl.searchParams.get('token') : body.walkinToken;
      if (typeof token !== 'string' || !token) throw new Error('Missing token');
      access = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
      if (access.purpose !== 'shop-walkin' || !Number.isFinite(access.exp)) throw new Error('Invalid purpose');
    } catch {
      return send(res, 403, { error: 'Scan the current shop QR code to join the walk-in queue.' });
    }
    if (req.method === 'GET') return send(res, 200, { valid: true, expiresAt: new Date(access.exp * 1000).toISOString() });
  }

  if (req.method === "POST" && path === "/queue/walkin") {
    let account = null;
    if (req.headers.authorization) {
      try { account = await requireUser(req, database); }
      catch (error) { if (error.status !== 401) throw error; }
    }
    const customer = String(body.customer || "").trim().slice(0, 120);
    if (customer.length < 2) return send(res, 400, { error: "Enter the customer's name." });
    const guestKey = bookingGuards.guestKey(req, account, body);
    await bookingGuards.requireGuestAllowance(database, guestKey, account, customer);
    const contact = { contactEmail: '', emailConsent: false };
    const service = body.serviceId ? await database.collection("services").findOne({ $or: [{ slug: body.serviceId }, ...(ObjectId.isValid(body.serviceId) ? [{ _id: new ObjectId(body.serviceId) }] : [])], active: { $ne: false } }) : null;
    if (body.serviceId && !service) return send(res, 400, { error: "Choose an available service." });
    const waiting = await database.collection("queue").countDocuments({ status: { $in: ["waiting", "serving"] } });
    const queueNumber = await nextQueueNumber(database);
    const cancelToken = require('node:crypto').randomBytes(32).toString('base64url');
    const cancelTokenHash = require('node:crypto').createHash('sha256').update(cancelToken).digest('hex');
    const ticket = { _id: new ObjectId(), customer, phone: "", ...contact, serviceId: service?.slug || "", barberId: "", cutName: service?.name || "To be assigned", price: Number(service?.price || 0), waitMinutes: waiting * 30, source: "shop-qr", queueNumber, status: "waiting", paid: false, cancelTokenHash, createdAt: new Date() };
    Object.assign(ticket, { guestKey, ...(account ? { userId: account._id } : {}) });
    await database.collection("queue").insertOne(ticket);
    return send(res, 201, { ticket: publicQueueTicket(ticket), cancelToken, emailUpdatesEnabled: contact.emailConsent });
  }

  if (req.method === "GET" && path.startsWith("/queue/ticket/")) {
    const id = path.split("/").pop();
    if (!ObjectId.isValid(id)) return send(res, 404, { error: "Ticket not found." });
    const ticket = await database.collection("queue").findOne({ _id: new ObjectId(id) });
    if (!ticket) return send(res, 404, { error: "Ticket not found." });
    const waitingAhead = await database.collection("queue").countDocuments({ status: "waiting", queueNumber: { $lt: ticket.queueNumber } });
    return send(res, 200, { ticket: publicQueueTicket(ticket), position: ticket.status === "waiting" ? waitingAhead + 1 : ticket.status === 'serving' ? 0 : null, waitingAhead: ticket.status === 'waiting' ? waitingAhead : 0 });
  }

  const customerCancelMatch = path.match(/^\/queue\/ticket\/([a-f0-9]{24})\/cancel$/);
  if (req.method === 'PATCH' && customerCancelMatch) {
    const id = customerCancelMatch[1];
    const ticket = await database.collection('queue').findOne({ _id: new ObjectId(id) });
    if (!ticket || ticket.source !== 'shop-qr') return send(res, 404, { error: 'QR walk-in ticket not found.' });
    if (ticket.status !== 'waiting') return send(res, 409, { error: ticket.status === 'serving' ? 'Your turn has already been called. Please speak with the counter.' : 'This ticket is no longer waiting.' });
    const suppliedToken = String(body.cancelToken || '');
    const storedHash = Uint8Array.from(String(ticket.cancelTokenHash || '').match(/.{2}/g) || [], pair => Number.parseInt(pair, 16));
    const suppliedHash = require('node:crypto').createHash('sha256').update(suppliedToken).digest();
    if (!suppliedToken || storedHash.length !== suppliedHash.length || !require('node:crypto').timingSafeEqual(storedHash, suppliedHash)) {
      return send(res, 403, { error: 'This ticket can only be cancelled from the device that joined through the shop QR.' });
    }
    const changed = await database.collection('queue').updateOne(
      { _id: ticket._id, source: 'shop-qr', status: 'waiting', cancelTokenHash: ticket.cancelTokenHash },
      { $set: { status: 'cancelled', cancelledBy: 'customer', updatedAt: new Date() }, $unset: { cancelTokenHash: '' } }
    );
    if (!changed.modifiedCount) return send(res, 409, { error: 'Your turn has already been called or this ticket has already been cancelled.' });
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && path === "/queue") {
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { queue: (await database.collection("queue").find({ status: { $in: ["waiting", "serving"] } }).sort({ queueNumber: 1 }).toArray()).map(publicQueueTicket) });
  }

  if (req.method === "POST" && path === "/admin/queue/next") {
    await requireRole(req, database, ["admin", "moderator"]);
    const next = await startServing(database);
    if (next?.source === 'appointment') await messaging.notify(database, next.userId, `It is your turn at The Barber Co. Queue #${next.queueNumber}. Please approach the counter.`, `queue:${next._id}:serving`, { queueTicketId: next._id });
    return send(res, 200, { ticket: normalizeDoc(next) });
  }

  if (path === "/admin/queue") {
    await requireRole(req, database, ["admin", "moderator"]);
    if (req.method === "GET") {
      const queue = await database.collection("queue").find().sort({ createdAt: -1 }).toArray();
      return send(res, 200, { queue: queue.map(({ cancelTokenHash, ...ticket }) => normalizeDoc(ticket)) });
    }
    if (req.method === "POST") {
      const customer = String(body.customer || "").trim().slice(0, 120);
      if (customer.length < 2) return send(res, 400, { error: "Enter the customer's name." });
      const contact = { contactEmail: '', emailConsent: false };
      const queueNumber = await nextQueueNumber(database);
      const ticket = {
        _id: new ObjectId(), customer, phone: "", ...contact, serviceId: String(body.serviceId || ""),
        barberId: String(body.barberId || ""), cutName: String(body.cutName || "To be assigned").slice(0, 120),
        price: Math.max(0, Number(body.price) || 0), waitMinutes: Math.max(0, Number(body.waitMinutes) || 0),
        notes: String(body.notes || "").slice(0, 500), source: "staff", queueNumber, status: "waiting", paid: false, createdAt: new Date()
      };
      await database.collection("queue").insertOne(ticket);
      return send(res, 201, { ticket: normalizeDoc(ticket) });
    }
  }

  if (path.startsWith("/admin/queue/") && req.method === "PATCH") {
    await requireRole(req, database, ["admin", "moderator"]);
    const id = path.split("/").pop();
    if (!ObjectId.isValid(id)) return send(res, 404, { error: "Queue ticket not found." });
    const ticket = await database.collection('queue').findOne({ _id: new ObjectId(id) });
    if (!ticket) return send(res, 404, { error: 'Queue ticket not found.' });
    if (body.status && ticket.status === body.status) return send(res, 200, { ok: true });
    if (['done', 'cancelled'].includes(ticket.status) && body.status) return send(res, 409, { error: 'This customer has already left the active queue.' });
    if (body.status === 'done' && ticket.status !== 'serving') return send(res, 409, { error: 'Serve this customer before completing the service and recording payment.' });
    if (body.status === 'done') await frontDesk.validateCollection(database, ticket, body);
    if (body.status === 'serving') {
      const served = await startServing(database, id);
      if (served.source === 'appointment') await messaging.notify(database, served.userId, `It is your turn at The Barber Co. Queue #${served.queueNumber}. Please approach the counter.`, `queue:${id}:serving`, { queueTicketId: served._id });
      return send(res, 200, { ok: true });
    }
    const allowed = ["waiting", "serving", "done", "cancelled"];
    const customer = body.customer == null ? null : String(body.customer).trim().slice(0, 120);
    if (body.status != null && !allowed.includes(body.status)) return send(res, 400, { error: "Choose a valid queue status." });
    if (customer != null && customer.length < 2) return send(res, 400, { error: "Enter at least two characters for the customer name." });
    if (body.status == null && customer == null) return send(res, 400, { error: "No queue changes were provided." });
    if (body.status === "serving") {
      const current = await database.collection("queue").findOne({ status: "serving", _id: { $ne: new ObjectId(id) } });
      if (current) return send(res, 409, { error: "Finish the current customer before serving another." });
    }
    const update = { updatedAt: new Date() };
    if (body.status != null) update.status = body.status;
    if (body.status === 'done' && ticket.source === 'appointment') Object.assign(update, { cashCollected: body.cashCollected === true, cashAmount: body.cashAmount });
    if (customer != null) update.customer = customer;
    if (body.status === "serving") update.calledAt = new Date();
    if (body.status === "done" && ticket.source !== 'appointment') Object.assign(update, { paid: true, paidAt: new Date() });
    await updateWithNotice(database, "queue", { _id: new ObjectId(id) }, { $set: update });
    if (['done', 'cancelled'].includes(body.status)) await frontDesk.complete(database, ticket, body.status);
    if (ticket.source === 'appointment' && body.status === 'serving') await messaging.notify(database, ticket.userId, `It is your turn at The Barber Co. Queue #${ticket.queueNumber}. Please approach the counter.`, `queue:${id}:serving`, { queueTicketId: ticket._id });
    if (ticket.source === 'appointment' && body.status === 'cancelled') await messaging.notify(database, ticket.userId, `Your Barber Co queue ticket #${ticket.queueNumber} was cancelled. Contact the counter if this is unexpected.`, `queue:${id}:cancelled`, { queueTicketId: ticket._id });
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && path.startsWith("/admin/queue/") && path.endsWith("/paid")) {
    await requireRole(req, database, ["admin", "moderator"]);
    const id = path.split("/")[3];
    if (!ObjectId.isValid(id)) return send(res, 404, { error: 'Queue ticket not found.' });
    const ticket = await database.collection('queue').findOne({ _id: new ObjectId(id) });
    if (!ticket) return send(res, 404, { error: 'Queue ticket not found.' });
    if (ticket.status === 'done') return send(res, 200, { ok: true });
    if (ticket.status === 'cancelled') return send(res, 409, { error: 'A cancelled queue ticket cannot be completed.' });
    if (ticket.status !== 'serving') return send(res, 409, { error: 'Serve this customer before completing the service and recording payment.' });
    if (ticket.source === 'appointment') {
      await frontDesk.validateCollection(database, ticket, body);
      await updateWithNotice(database, 'queue', { _id: ticket._id }, { $set: { status: 'done', cashCollected: body.cashCollected === true, cashAmount: body.cashAmount, updatedAt: new Date() } });
      await frontDesk.complete(database, ticket, 'done');
      return send(res, 200, { ok: true });
    }
    await updateWithNotice(database, "queue", { _id: new ObjectId(id), status: ticket.status }, { $set: { status: "done", paid: true, paidAt: new Date(), updatedAt: new Date() } });
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && path === "/admin/analytics") {
    await requireRole(req, database, ["admin"]);
    res.setHeader('Cache-Control', 'no-store');
    const [appointments, queue, users, services, barbers] = await Promise.all([
      database.collection("appointments").find({}, { projection: { paymentProof: 0 } }).toArray(),
      database.collection("queue").find().toArray(),
      database.collection("users").countDocuments({ role: "customer" }),
      database.collection("services").find().toArray(),
      database.collection("barbers").find().toArray()
    ]);
    const analytics = buildAnalytics(appointments, queue.filter(item => item.source !== 'appointment'), users, services);
    analytics.totals.waiting = queue.filter(item => item.status === 'waiting').length;
    return send(res, 200, {
      ...analytics,
      barberPerformance: buildBarberPerformance(appointments, queue.filter(item => item.source !== 'appointment'), barbers, services),
      barbers: barbers.map(normalizeDoc),
      services: services.map((service) => ({ ...normalizeDoc(service), bookings: appointments.filter((item) => item.serviceId === String(service._id) || item.serviceId === service.slug).length }))
    });
  }

  return send(res, 404, { error: "Not found." });
}

module.exports = async (req, res) => {
  try {
    const path = new URL(req.url, 'https://barber.local').pathname.replace(/^\/api/, '');
    const mutation = req.method === 'PATCH' && /^\/(?:admin\/)?appointments\/([a-f0-9]{24})(?:\/[^/]+)?$/.exec(path);
    if (mutation) {
      const database = await db();
      await sweepRescheduleRequests(database);
      await frontDesk.sweep(database);
      await withAppointmentMutation(database, 'booking-capacity', () => withAppointmentMutation(database, mutation[1], () => handler(req, res)));
    } else if (req.method === 'POST' && (['/appointments', '/appointment-holds', '/queue/walkin', '/admin/queue/next'].includes(path) || /^\/admin\/queue\/[a-f0-9]{24}\/paid$/.test(path)) || req.method === 'PATCH' && (path.startsWith('/admin/queue/') || /^\/queue\/ticket\/[a-f0-9]{24}\/cancel$/.test(path)) || ['PATCH', 'DELETE'].includes(req.method) && path.startsWith('/admin/barbers/')) {
      const database = await db();
      await withAppointmentMutation(database, 'booking-capacity', () => handler(req, res));
    } else await handler(req, res);
  } catch (error) {
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    send(res, error.status || 500, { error: error.message || "Server error." });
  }
};
module.exports.sweepRescheduleRequests = sweepRescheduleRequests;
module.exports.sweepAttendance = async () => frontDesk.sweep(await db());
module.exports.sweepNotifications = async () => {
  const database = await db();
  await require('../lib/notification-outbox').flush(database, messaging.notify);
  await messaging.retryPending(database);
};
module.exports.checkReadiness = async () => (await db()).command({ ping: 1 });
