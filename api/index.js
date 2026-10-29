const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { buildAnalytics, buildBarberPerformance } = require('../lib/analytics');
const { sanitizeMethod, validateQrImage, realPaymentConfigured, demoMethods, normalizeMobile } = require('../lib/payment-settings');
const { phoneUsers, availablePhone } = require('../lib/phone-login');
const security = require('../lib/account-security');
const messaging = require('../lib/notifications');
const { validateReceipt } = require('../lib/receipt');
const allowUnverified = process.env.ALLOW_UNVERIFIED_ACCOUNTS === 'true';

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
    gcash: { ...defaultSettings.gcash, ...(settings.gcash || {}) },
    maya: { ...defaultSettings.maya, ...(settings.maya || {}) },
    paymentMode: process.env.ALLOW_DEMO_PAYMENTS === 'true' ? settings.paymentMode || 'live' : 'live',
    allowDemoPayments: process.env.ALLOW_DEMO_PAYMENTS === 'true',
    demoMethods,
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
    status: { $in: ["pending", "confirmed"] },
    ...(excludedAppointmentId ? { _id: { $ne: new ObjectId(excludedAppointmentId) } } : {})
  }).toArray();
  const holds = await database.collection("appointmentHolds").find({
    date,
    barberId: { $nin: ["", null] },
    expiresAt: { $gt: now },
    ...(excludedHoldId ? { _id: { $ne: new ObjectId(excludedHoldId) } } : {})
  }).toArray();
  if (!appointments.length && !holds.length) return [];
  const services = await database.collection("services").find().toArray();
  const durations = new Map();
  for (const service of services) {
    const duration = Math.max(30, Number.parseInt(service.duration, 10) || 30);
    durations.set(service.slug, duration);
    durations.set(String(service._id), duration);
  }
  const requestedStart = minutes(time);
  const requestedEnd = requestedStart + durationMinutes;
  const unavailable = appointments.filter((appointment) => {
    const existingStart = minutes(appointment.time);
    const existingEnd = existingStart + (durations.get(appointment.serviceId) || 30);
    return requestedStart < existingEnd && requestedEnd > existingStart;
  }).map((appointment) => appointment.barberId);
  unavailable.push(...holds.filter((hold) => {
    const existingStart = minutes(hold.time);
    const existingEnd = existingStart + Number(hold.durationMinutes || 30);
    return requestedStart < existingEnd && requestedEnd > existingStart;
  }).map((hold) => hold.barberId));
  return [...new Set(unavailable)];
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
  if (!clientPromise) clientPromise = new MongoClient(mongoUri).connect();
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
    })();
  }
  return ensureSeed.promise;
}

function publicUser(user) {
  if (!user) return null;
  return { id: String(user._id), name: user.name, email: user.email, role: user.role || "customer", emailVerified: Boolean(user.emailVerifiedAt), phoneVerified: Boolean(user.phoneVerifiedAt), smsConsent: Boolean(user.smsConsent), birthDate: user.birthDate || '', username: user.username || "", phone: user.phone || "", location: user.location || "", bio: user.bio || "", photo: user.photo || "" };
}

function normalizeDoc(doc) {
  if (!doc) return null;
  return { ...doc, id: doc.slug || String(doc._id), mongoId: String(doc._id), _id: undefined };
}

function tokenFor(user) {
  return jwt.sign({ sub: String(user._id), role: user.role || "customer", version: user.sessionVersion || 0 }, jwtSecret, { expiresIn: "7d" });
}

function paymentConfigured(settings) {
  return settings.paymentMode === 'demo' || realPaymentConfigured(settings);
}

function requireBookingEligibility(user) {
  if (allowUnverified || ['admin', 'moderator'].includes(user.role)) return;
  if (!user.emailVerifiedAt) throw Object.assign(new Error('Verify your email in your profile before booking online.'), { status: 403 });
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
    const current = await database.collection('queue').findOne({ status: 'serving' });
    if (current) {
      if (id && String(current._id) === id) return current;
      throw Object.assign(new Error('Finish the current customer before calling the next customer.'), { status: 409 });
    }
    const ticket = await database.collection('queue').findOneAndUpdate({ status: 'waiting', ...(id ? { _id: new ObjectId(id) } : {}) }, { $set: { status: 'serving', calledAt: new Date(), updatedAt: new Date() } }, { sort: { queueNumber: 1 }, returnDocument: 'after' });
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

  if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true });
  if (req.method === 'GET' && path === '/auth/capabilities') return send(res, 200, { email: security.emailReady(), sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM), verificationRequired: !allowUnverified });

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
    const duration = Math.max(30, Number.parseInt(service.duration, 10) || 30);
    return send(res, 200, { unavailableBarberIds: await unavailableBarbers(database, date, time, duration) });
  }

  if (req.method === "POST" && path === "/appointment-holds") {
    const user = await requireUser(req, database);
    requireBookingEligibility(user);
    const date = String(body.date || "");
    const time = String(body.time || "");
    const serviceId = String(body.serviceId || "");
    const barberId = String(body.barberId || "");
    const appointmentAt = new Date(`${date}T${time}:00+08:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || appointmentAt.getTime() <= Date.now()) {
      return send(res, 400, { error: "Choose a valid future appointment date and time." });
    }
    const service = await database.collection("services").findOne({ $or: [{ slug: serviceId }, ...(ObjectId.isValid(serviceId) ? [{ _id: new ObjectId(serviceId) }] : [])], active: { $ne: false } });
    if (!service) return send(res, 400, { error: "Choose an available service." });
    let selectedBarber = null;
    if (barberId) {
      selectedBarber = await database.collection("barbers").findOne({ $or: [{ slug: barberId }, ...(ObjectId.isValid(barberId) ? [{ _id: new ObjectId(barberId) }] : [])], status: { $nin: ["fired", "on-leave"] } });
      if (!selectedBarber) return send(res, 400, { error: "The selected barber is not available." });
    }
    const settings = mergedSettings(await database.collection("settings").findOne({ _id: "shop" }));
    const durationMinutes = Math.max(30, Number.parseInt(service.duration, 10) || 30);
    const window = bookingWindow(date, time, settings, durationMinutes);
    if (window.error) return send(res, 400, { error: window.error });
    if (!paymentConfigured(settings)) return send(res, 409, { error: "Online booking is unavailable until the administrator adds a payment number or QR code in Shop settings." });
    const previousHolds = await database.collection("appointmentHolds").find({ userId: user._id }).toArray();
    const previousIds = previousHolds.map((hold) => String(hold._id));
    if (previousIds.length) {
      await database.collection("appointmentSlots").deleteMany({ appointmentId: { $in: previousIds } });
      await database.collection("appointmentHolds").deleteMany({ userId: user._id });
    }
    if (barberId) {
      const unavailable = await unavailableBarbers(database, date, time, durationMinutes);
      if (unavailable.includes(barberId)) return send(res, 409, { error: "That barber is already reserved for this time. Choose another barber or time." });
    }
    const hold = {
      _id: new ObjectId(), userId: user._id, customer: user.name, serviceId, barberId, date, time, durationMinutes,
      total: Number(service.price) + Math.max(0, Number(settings.bookingFee) || 0),
      demoPayment: settings.paymentMode === 'demo',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), createdAt: new Date()
    };
    await lockAppointmentSlots(database, hold._id, date, selectedBarber ? String(selectedBarber._id) : "", time, durationMinutes, hold.expiresAt);
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
    if (!allowUnverified && !security.emailReady()) return send(res, 503, { error: 'Email verification is temporarily unavailable. Contact the shop; no account has been created.' });
    if (name.length < 2 || !email || password.length < 6) return send(res, 400, { error: "Name, email, and a 6-character password are required." });
    const phone = await availablePhone(database, body.phone);
    const user = { _id: new ObjectId(), name, email, birthDate: body.birthDate || '', passwordHash: await bcrypt.hash(password, 10), role: "customer", phone, ...(phone ? { phoneLogin: phone } : {}), verificationRequired: !allowUnverified, createdAt: new Date() };
    try {
      await database.collection("users").insertOne(user);
    } catch (error) {
      if (error?.code === 11000) return send(res, 409, { error: error.keyPattern?.phoneLogin ? 'An account with this mobile number already exists. Try logging in.' : "An account with this email already exists. Try logging in." });
      throw error;
    }
    if (!allowUnverified) { await security.issueCode(database, email, 'verify'); return send(res, 201, { verificationRequired: true, email }); }
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
    if (!user || !(await bcrypt.compare(String(body.password || ""), user.passwordHash))) { await security.failedLogin(database, attemptKey); return send(res, 401, { error: "Incorrect login details. Try email if your account has no linked mobile number." }); }
    await database.collection('loginAttempts').deleteOne({ _id: security.digest(attemptKey) });
    if (user.verificationRequired && !user.emailVerifiedAt) return send(res, 403, { error: 'Verify your email before signing in.', verificationRequired: true, email: user.email });
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
    return send(res, 200, { emailConfigured: security.emailReady(), smsConfigured: messaging.smsReady(), smsVerificationConfigured: Boolean(process.env.TWILIO_VERIFY_SERVICE_SID), notifications: await database.collection('notifications').find().sort({ createdAt: -1 }).limit(50).toArray() });
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
      await messaging.verifyPhone(phone);
      await database.collection('loginAttempts').updateOne({ _id: key }, { $set: { sentAt: new Date(), expiresAt: new Date(Date.now() + 600000) } }, { upsert: true });
      return send(res, 200, { message: 'SMS verification requested. Enter the code you receive.' });
    }
    if (!/^\d{6}$/.test(String(body.code || ''))) return send(res, 400, { error: 'Enter the six-digit SMS code.' });
    await messaging.verifyPhone(phone, body.code);
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
    await requireRole(req, database, ["admin"]);
    const id = path.split("/").pop();
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
    const paymentMode = body.paymentMode || 'live';
    if (paymentMode === 'demo' && process.env.ALLOW_DEMO_PAYMENTS !== 'true') return send(res, 400, { error: 'Only real payment methods can be configured on this website.' });
    if (!['live', 'demo'].includes(paymentMode)) return send(res, 400, { error: 'Choose demo or real payments.' });
    if (paymentMode === 'live' && body.paymentDetailsConfirmed !== true) return send(res, 400, { error: 'Confirm that you checked the payment recipient in GCash/Maya before enabling real payments.' });
    const gcash = await sanitizeMethod(body.gcash, 'GCash', paymentMode);
    const maya = await sanitizeMethod(body.maya, 'Maya', paymentMode);
    if (paymentMode === 'live' && !realPaymentConfigured({ gcash, maya })) return send(res, 400, { error: 'Enable at least one configured payment method before switching to real payments.' });
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
    if (req.method === "GET") return send(res, 200, { services: (await database.collection("services").find().sort({ createdAt: 1 }).toArray()).map(normalizeDoc) });
    if (req.method === "POST") {
      const service = { _id: new ObjectId(), slug: slugify(body.name), name: body.name, price: Number(body.price), duration: body.duration || "30 min", detail: body.detail || "", icon: body.icon || "NEW", active: body.active !== false, createdAt: new Date() };
      await database.collection("services").insertOne(service);
      return send(res, 201, { service: normalizeDoc(service) });
    }
  }

  if (path.startsWith("/admin/services/")) {
    await requireRole(req, database, ["admin"]);
    const id = path.split("/").pop();
    if (req.method === "PATCH") {
      const update = { ...body, updatedAt: new Date() };
      if (body.price != null) update.price = Number(body.price);
      await database.collection("services").updateOne({ _id: new ObjectId(id) }, { $set: update });
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      await database.collection("services").updateOne({ _id: new ObjectId(id) }, { $set: { active: false, updatedAt: new Date() } });
      return send(res, 200, { ok: true });
    }
  }

  if (path === "/admin/barbers") {
    await requireRole(req, database, ["admin"]);
    if (req.method === "GET") return send(res, 200, { barbers: (await database.collection("barbers").find().sort({ createdAt: 1 }).toArray()).map(normalizeDoc) });
    if (req.method === "POST") {
      const barber = { _id: new ObjectId(), slug: slugify(body.name), name: body.name, role: body.role || "Barber", status: body.status || "active", bio: body.bio || "", createdAt: new Date() };
      await database.collection("barbers").insertOne(barber);
      return send(res, 201, { barber: normalizeDoc(barber) });
    }
  }

  if (path.startsWith("/admin/barbers/")) {
    await requireRole(req, database, ["admin"]);
    const id = path.split("/").pop();
    if (req.method === "PATCH") {
      const update = { ...body, updatedAt: new Date() };
      await database.collection("barbers").updateOne({ _id: new ObjectId(id) }, { $set: update });
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      await database.collection("barbers").updateOne({ _id: new ObjectId(id) }, { $set: { status: "fired", updatedAt: new Date() } });
      return send(res, 200, { ok: true });
    }
  }

  if (req.method === "POST" && path === "/appointments") {
    const user = await requireUser(req, database);
    requireBookingEligibility(user);
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
    let selectedBarber = null;
    if (body.barberId) {
      selectedBarber = await database.collection("barbers").findOne({ $or: [{ slug: body.barberId }, ...(ObjectId.isValid(body.barberId) ? [{ _id: new ObjectId(body.barberId) }] : [])], status: { $nin: ["fired", "on-leave"] } });
      if (!selectedBarber) return send(res, 400, { error: "The selected barber is not available." });
    }
    const settings = mergedSettings(await database.collection("settings").findOne({ _id: "shop" }));
    const durationMinutes = Math.max(30, Number.parseInt(service.duration, 10) || 30);
    const window = bookingWindow(date, time, settings, durationMinutes);
    if (window.error) return send(res, 400, { error: window.error });
    const holdId = String(body.holdId || "");
    const hold = holdId && ObjectId.isValid(holdId) ? await database.collection("appointmentHolds").findOne({
      _id: new ObjectId(holdId),
      userId: user._id,
      expiresAt: { $gt: new Date() }
    }) : null;
    if (holdId && (!hold || hold.serviceId !== body.serviceId || hold.barberId !== (body.barberId || "") || hold.date !== date || hold.time !== time)) {
      return send(res, 409, { error: "Your temporary reservation expired or changed. Return to booking and choose the slot again." });
    }
    if (body.barberId) {
      const unavailable = await unavailableBarbers(database, date, time, durationMinutes, hold ? holdId : "");
      if (unavailable.includes(body.barberId)) return send(res, 409, { error: "That barber was just booked for this time. Choose another barber or time." });
    }
    const demoPayment = settings.paymentMode === 'demo';
    if (!paymentConfigured(settings)) return send(res, 409, { error: 'Online payments are not configured. Please contact the shop.' });
    if (body.paymentMode && body.paymentMode !== settings.paymentMode) return send(res, 409, { error: 'Payment mode changed. Reload the payment page before proceeding.' });
    const methods = demoPayment ? settings.demoMethods : settings;
    const paymentMethod = ["GCash", "Maya"].find((name) => name === body.paymentMethod && methods[name.toLowerCase()]?.enabled) || "";
    const paymentProof = String(body.paymentProof || "");
    if (!paymentMethod || !/^data:image\/(jpeg|png|webp);base64,/.test(paymentProof)) {
      return send(res, 400, { error: "Upload a valid payment proof." });
    }
    if (paymentProof.length > 2.8 * 1024 * 1024) {
      return send(res, 413, { error: "Payment proof must be 2 MB or smaller." });
    }
    await validateReceipt(paymentProof);
    const queueNumber = await nextQueueNumber(database);
    const bookingFee = Math.max(0, Number(settings.bookingFee) || 0);
    const appointment = { _id: new ObjectId(), serviceId: body.serviceId, barberId: body.barberId || "", date, time, request: String(body.request || "").slice(0, 1000), source: "online", bookingFee, total: Number(service.price) + bookingFee, paymentMethod, paymentProof, demoPayment, userId: user._id, customer: user.name, customerEmail: user.email, queueNumber, status: "pending", paid: false, createdAt: new Date() };
    if (hold && selectedBarber) {
      const transfer = await database.collection("appointmentSlots").updateMany(
        { appointmentId: holdId, expiresAt: { $gt: new Date() } },
        { $set: { appointmentId: String(appointment._id) }, $unset: { expiresAt: "" } }
      );
      if (!transfer.modifiedCount) return send(res, 409, { error: "Your temporary reservation expired. Return to booking and choose the slot again." });
    } else if (selectedBarber) {
      await lockAppointmentSlots(database, appointment._id, date, String(selectedBarber._id), time, durationMinutes);
    }
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
    const appointments = await database.collection("appointments").find({ userId: user._id }, { projection: { paymentProof: 0 } }).sort({ createdAt: -1 }).limit(50).toArray();
    return send(res, 200, { appointments: appointments.map(normalizeDoc) });
  }

  if (path === "/admin/appointments") {
    await requireRole(req, database, ["admin", "moderator"]);
    if (req.method === "GET") {
      const [appointments, holds, settings] = await Promise.all([
        database.collection("appointments").find({}, { projection: { paymentProof: 0 } }).sort({ createdAt: -1 }).toArray(),
        database.collection("appointmentHolds").find({ expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).toArray(),
        database.collection("settings").findOne({ _id: "shop" })
      ]);
      const owners = holds.length ? await database.collection("users").find({ _id: { $in: holds.map((hold) => hold.userId) } }, { projection: { name: 1 } }).toArray() : [];
      res.setHeader("Cache-Control", "no-store");
      return send(res, 200, {
        appointments: appointments.map((item) => ({ ...normalizeDoc(item), hasPaymentProof: item.hasPaymentProof !== false })),
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

  if (req.method === 'PATCH' && /^\/admin\/appointments\/[a-f0-9]{24}\/reschedule$/.test(path)) {
    await requireRole(req, database, ['admin', 'moderator']);
    const id = path.split('/')[3];
    const current = await database.collection('appointments').findOne({ _id: new ObjectId(id) });
    if (!current || !['pending', 'confirmed'].includes(current.status)) return send(res, 409, { error: 'Only active appointments can be rescheduled.' });
    const date = String(body.date || '');
    const time = String(body.time || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !(new Date(`${date}T${time}:00+08:00`).getTime() > Date.now())) return send(res, 400, { error: 'Choose a valid future date and time.' });
    if (current.date === date && current.time === time) return send(res, 200, { appointment: normalizeDoc(current) });
    const service = await database.collection('services').findOne({ $or: [{ slug: current.serviceId }, ...(ObjectId.isValid(current.serviceId) ? [{ _id: new ObjectId(current.serviceId) }] : [])] });
    const settings = mergedSettings(await database.collection('settings').findOne({ _id: 'shop' }));
    const duration = Math.max(30, Number.parseInt(service?.duration, 10) || 30);
    const window = bookingWindow(date, time, settings, duration);
    if (window.error) return send(res, 400, { error: window.error });
    const unavailable = await unavailableBarbers(database, date, time, duration, '', id);
    if (current.barberId && unavailable.includes(current.barberId)) return send(res, 409, { error: 'This barber is already reserved at that time.' });
    const barber = current.barberId ? await database.collection('barbers').findOne({ $or: [{ slug: current.barberId }, ...(ObjectId.isValid(current.barberId) ? [{ _id: new ObjectId(current.barberId) }] : [])] }) : null;
    const newSlots = barber ? appointmentSlotIds(date, String(barber._id), time, duration) : [];
    const existing = await database.collection('appointmentSlots').find({ appointmentId: id }).toArray();
    const retained = new Set(existing.map((slot) => slot._id));
    const tempId = String(new ObjectId());
    const extraSlots = newSlots.filter((slot) => !retained.has(slot)).map((_id) => ({ _id, appointmentId: tempId, createdAt: new Date(), expiresAt: new Date(Date.now() + 120000) }));
    try {
      if (extraSlots.length) await database.collection('appointmentSlots').insertMany(extraSlots, { ordered: true });
      const changed = await database.collection('appointments').updateOne({ _id: current._id, date: current.date, time: current.time, status: current.status }, { $set: { date, time, updatedAt: new Date() } });
      if (!changed.modifiedCount) throw Object.assign(new Error('This appointment changed. Refresh and try again.'), { status: 409 });
      await database.collection('appointmentSlots').updateMany({ appointmentId: tempId }, { $set: { appointmentId: id }, $unset: { expiresAt: '' } });
      await database.collection('appointmentSlots').deleteMany({ appointmentId: id, _id: { $nin: newSlots } });
    } catch (error) {
      await database.collection('appointmentSlots').deleteMany({ appointmentId: tempId });
      if (error.code === 11000) return send(res, 409, { error: 'This barber was just reserved. Choose another time.' });
      throw error;
    }
    await messaging.notify(database, current.userId, `Your Barber Co appointment was rescheduled to ${date} at ${time}. Contact the shop if this does not suit you.`, `appointment:${id}:rescheduled:${date}:${time}`);
    return send(res, 200, { appointment: normalizeDoc({ ...current, date, time }) });
  }

  if (path.startsWith("/admin/appointments/") && req.method === "PATCH") {
    await requireRole(req, database, ["admin", "moderator"]);
    const id = path.split("/").pop();
    const allowed = ["pending", "confirmed", "completed", "cancelled"];
    if (!ObjectId.isValid(id) || !allowed.includes(body.status)) return send(res, 400, { error: "Choose a valid appointment status." });
    const current = await database.collection('appointments').findOne({ _id: new ObjectId(id) });
    if (!current) return send(res, 404, { error: 'Appointment not found.' });
    const update = { status: body.status, updatedAt: new Date() };
    if (current.status === body.status) return send(res, 200, { appointment: normalizeDoc(current) });
    const transitions = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'], completed: [], cancelled: [] };
    if (!transitions[current.status]?.includes(body.status)) return send(res, 409, { error: 'This appointment has already changed. Refresh before proceeding.' });
    if (["confirmed", "completed"].includes(body.status) && !current.demoPayment) {
      update.paid = true;
      if (!current.paid) update.paidAt = new Date();
    }
    const changed = await database.collection("appointments").updateOne({ _id: new ObjectId(id), status: current.status }, { $set: update });
    if (changed?.modifiedCount === 0) return send(res, 409, { error: 'This appointment changed while you were reviewing it. Refresh and try again.' });
    if (["completed", "cancelled"].includes(body.status)) {
      await database.collection("appointmentSlots").deleteMany({ appointmentId: id });
    }
    const appointment = await database.collection("appointments").findOne({ _id: new ObjectId(id) });
    await messaging.notify(database, current.userId, `Your Barber Co appointment on ${current.date} at ${current.time} is ${body.status === 'confirmed' ? 'accepted' : body.status}.`, `appointment:${id}:${body.status}`);
    return send(res, 200, { appointment: normalizeDoc(appointment) });
  }

  if (req.method === "POST" && path === "/queue/walkin") {
    const account = req.headers.authorization ? await requireUser(req, database) : null;
    const customer = String(body.customer || "").trim().slice(0, 120);
    if (customer.length < 2) return send(res, 400, { error: "Enter the customer's name." });
    const service = body.serviceId ? await database.collection("services").findOne({ $or: [{ slug: body.serviceId }, ...(ObjectId.isValid(body.serviceId) ? [{ _id: new ObjectId(body.serviceId) }] : [])], active: { $ne: false } }) : null;
    if (body.serviceId && !service) return send(res, 400, { error: "Choose an available service." });
    const waiting = await database.collection("queue").countDocuments({ status: { $in: ["waiting", "serving"] } });
    const queueNumber = await nextQueueNumber(database);
    const ticket = { _id: new ObjectId(), customer, phone: "", serviceId: service?.slug || "", barberId: "", cutName: service?.name || "To be assigned", price: Number(service?.price || 0), waitMinutes: waiting * 30, source: "shop-qr", queueNumber, status: "waiting", paid: false, createdAt: new Date() };
    await database.collection("queue").insertOne(ticket);
    if (account) await database.collection('queue').updateOne({ _id: ticket._id }, { $set: { userId: account._id } });
    return send(res, 201, { ticket: normalizeDoc(ticket) });
  }

  if (req.method === "GET" && path.startsWith("/queue/ticket/")) {
    const id = path.split("/").pop();
    if (!ObjectId.isValid(id)) return send(res, 404, { error: "Ticket not found." });
    const ticket = await database.collection("queue").findOne({ _id: new ObjectId(id) });
    if (!ticket) return send(res, 404, { error: "Ticket not found." });
    const waitingAhead = await database.collection("queue").countDocuments({ status: "waiting", queueNumber: { $lt: ticket.queueNumber } });
    return send(res, 200, { ticket: normalizeDoc(ticket), position: ticket.status === "waiting" ? waitingAhead + 1 : 0, waitingAhead });
  }

  if (req.method === "GET" && path === "/queue") {
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { queue: (await database.collection("queue").find({ status: { $in: ["waiting", "serving"] } }).sort({ queueNumber: 1 }).toArray()).map(normalizeDoc) });
  }

  if (req.method === "POST" && path === "/admin/queue/next") {
    await requireRole(req, database, ["admin", "moderator"]);
    const next = await startServing(database);
    if (next) await messaging.notify(database, next.userId, `It is your turn at The Barber Co. Queue #${next.queueNumber}. Please approach the counter.`, `queue:${next._id}:serving`);
    return send(res, 200, { ticket: normalizeDoc(next) });
  }

  if (path === "/admin/queue") {
    await requireRole(req, database, ["admin", "moderator"]);
    if (req.method === "GET") {
      return send(res, 200, { queue: (await database.collection("queue").find().sort({ createdAt: -1 }).toArray()).map(normalizeDoc) });
    }
    if (req.method === "POST") {
      const customer = String(body.customer || "").trim().slice(0, 120);
      if (customer.length < 2) return send(res, 400, { error: "Enter the customer's name." });
      const queueNumber = await nextQueueNumber(database);
      const ticket = {
        _id: new ObjectId(), customer, phone: "", serviceId: String(body.serviceId || ""),
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
    if (body.status === 'serving') {
      const served = await startServing(database, id);
      await messaging.notify(database, served.userId, `It is your turn at The Barber Co. Queue #${served.queueNumber}. Please approach the counter.`, `queue:${id}:serving`);
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
    if (customer != null) update.customer = customer;
    if (body.status === "serving") update.calledAt = new Date();
    if (body.status === "done") Object.assign(update, { paid: true, paidAt: new Date() });
    await database.collection("queue").updateOne({ _id: new ObjectId(id) }, { $set: update });
    if (body.status === 'serving') await messaging.notify(database, ticket.userId, `It is your turn at The Barber Co. Queue #${ticket.queueNumber}. Please approach the counter.`, `queue:${id}:serving`);
    if (body.status === 'cancelled') await messaging.notify(database, ticket.userId, `Your Barber Co queue ticket #${ticket.queueNumber} was cancelled. Contact the counter if this is unexpected.`, `queue:${id}:cancelled`);
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
    await database.collection("queue").updateOne({ _id: new ObjectId(id), status: ticket.status }, { $set: { status: "done", paid: true, paidAt: new Date(), updatedAt: new Date() } });
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
    return send(res, 200, {
      ...buildAnalytics(appointments, queue, users, services),
      barberPerformance: buildBarberPerformance(appointments, queue, barbers, services),
      barbers: barbers.map(normalizeDoc),
      services: services.map((service) => ({ ...normalizeDoc(service), bookings: appointments.filter((item) => !item.demoPayment && (item.serviceId === String(service._id) || item.serviceId === service.slug)).length }))
    });
  }

  return send(res, 404, { error: "Not found." });
}

module.exports = async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    send(res, error.status || 500, { error: error.message || "Server error." });
  }
};
