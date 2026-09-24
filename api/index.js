const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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
    sunday: { open: "09:00", close: "20:00", closed: false },
    monday: { open: "10:00", close: "20:00", closed: false },
    tuesday: { open: "10:00", close: "20:00", closed: false },
    wednesday: { open: "10:00", close: "20:00", closed: false },
    thursday: { open: "10:00", close: "20:00", closed: false },
    friday: { open: "10:00", close: "20:00", closed: false },
    saturday: { open: "09:00", close: "20:00", closed: false }
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
  return {
    ...defaultSettings,
    ...settings,
    gcash: { ...defaultSettings.gcash, ...(settings.gcash || {}) },
    maya: { ...defaultSettings.maya, ...(settings.maya || {}) },
    operatingHours: { ...defaultSettings.operatingHours, ...(settings.operatingHours || {}) },
    closedDates: Array.isArray(settings.closedDates) ? settings.closedDates : []
  };
}

function bookingWindow(date, time, settings, durationMinutes = 30) {
  const localNoon = new Date(`${date}T12:00:00+08:00`);
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

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
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
        database.collection("services").createIndex({ slug: 1 }, { unique: true }),
        database.collection("barbers").createIndex({ slug: 1 }, { unique: true }),
        database.collection("queue").createIndex({ queueNumber: 1 }),
        database.collection("appointments").createIndex({ createdAt: -1 })
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
      if (adminPassword) {
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
      if (moderatorPassword) {
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
  return { id: String(user._id), name: user.name, email: user.email, role: user.role || "customer", username: user.username || "", phone: user.phone || "", location: user.location || "", bio: user.bio || "", photo: user.photo || "" };
}

function normalizeDoc(doc) {
  if (!doc) return null;
  return { ...doc, id: doc.slug || String(doc._id), mongoId: String(doc._id), _id: undefined };
}

function tokenFor(user) {
  return jwt.sign({ sub: String(user._id), role: user.role || "customer" }, jwtSecret, { expiresIn: "7d" });
}

async function requireUser(req, database, adminOnly = false) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    const error = new Error("Login required");
    error.status = 401;
    throw error;
  }
  const payload = jwt.verify(token, jwtSecret);
  const user = await database.collection("users").findOne({ _id: new ObjectId(payload.sub) });
  if (!user || (adminOnly && user.role !== "admin")) {
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

async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });
  const database = await db();
  const path = new URL(req.url, "https://barber.local").pathname.replace(/^\/api/, "") || "/";
  const body = ["POST", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : {};

  if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true });

  if (req.method === "GET" && path === "/settings") {
    const settings = await database.collection("settings").findOne({ _id: "shop" });
    return send(res, 200, { settings: mergedSettings(settings) });
  }

  if (req.method === "POST" && path === "/auth/register") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (name.length < 2 || !email || password.length < 6) return send(res, 400, { error: "Name, email, and a 6-character password are required." });
    const user = { _id: new ObjectId(), name, email, passwordHash: await bcrypt.hash(password, 10), role: "customer", phone: body.phone || "", createdAt: new Date() };
    try {
      await database.collection("users").insertOne(user);
    } catch (error) {
      if (error?.code === 11000) return send(res, 409, { error: "An account with this email already exists. Try logging in." });
      throw error;
    }
    return send(res, 201, { user: publicUser(user), token: tokenFor(user) });
  }

  if (req.method === "POST" && path === "/auth/login") {
    const email = String(body.email || "").trim().toLowerCase();
    const user = await database.collection("users").findOne({ email });
    if (!user || !(await bcrypt.compare(String(body.password || ""), user.passwordHash))) return send(res, 401, { error: "Wrong email or password." });
    return send(res, 200, { user: publicUser(user), token: tokenFor(user) });
  }

  if (req.method === "GET" && path === "/me") {
    const user = await requireUser(req, database);
    return send(res, 200, { user: publicUser(user) });
  }

  if (req.method === "PATCH" && path === "/me") {
    const user = await requireUser(req, database);
    const photo = body.photo == null ? (user.photo || "") : String(body.photo);
    if (photo && !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) return send(res, 400, { error: "Profile photo must be a JPG, PNG, or WebP image." });
    if (photo.length > 2.8 * 1024 * 1024) return send(res, 413, { error: "Profile photo must be 2 MB or smaller." });
    const update = {
      name: String(body.name || user.name).trim().slice(0, 120),
      username: String(body.username || "").trim().slice(0, 60),
      phone: String(body.phone || "").trim().slice(0, 40),
      location: String(body.location || "").trim().slice(0, 160),
      bio: String(body.bio || "").trim().slice(0, 1000),
      photo,
      updatedAt: new Date()
    };
    await database.collection("users").updateOne({ _id: user._id }, { $set: update });
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
      const user = { _id: new ObjectId(), name: String(body.name || "Staff").trim(), email, passwordHash: await bcrypt.hash(password, 10), role, phone: body.phone || "", createdAt: new Date() };
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

  if (path === "/admin/settings" && req.method === "PATCH") {
    await requireRole(req, database, ["admin"]);
    const sanitizeMethod = (method = {}) => {
      const qrImage = String(method.qrImage || "");
      if (qrImage && !/^data:image\/(jpeg|png|webp);base64,/.test(qrImage)) {
        const error = new Error("Payment QR must be a JPG, PNG, or WebP image.");
        error.status = 400;
        throw error;
      }
      if (qrImage.length > 2.8 * 1024 * 1024) {
        const error = new Error("Payment QR image must be 2 MB or smaller.");
        error.status = 413;
        throw error;
      }
      return {
        enabled: method.enabled !== false,
        accountName: String(method.accountName || "").trim().slice(0, 120),
        accountNumber: String(method.accountNumber || "").trim().slice(0, 60),
        qrImage
      };
    };
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
      gcash: sanitizeMethod(body.gcash),
      maya: sanitizeMethod(body.maya),
      bookingFee: Math.max(0, Number(body.bookingFee) || 0),
      operatingHours,
      closedDates,
      updatedAt: new Date()
    };
    await database.collection("settings").updateOne({ _id: "shop" }, { $set: update }, { upsert: true });
    return send(res, 200, { settings: { _id: "shop", ...update } });
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
    if (body.barberId) {
      const barber = await database.collection("barbers").findOne({ $or: [{ slug: body.barberId }, ...(ObjectId.isValid(body.barberId) ? [{ _id: new ObjectId(body.barberId) }] : [])], status: { $nin: ["fired", "on-leave"] } });
      if (!barber) return send(res, 400, { error: "The selected barber is not available." });
    }
    const settings = mergedSettings(await database.collection("settings").findOne({ _id: "shop" }));
    const durationMinutes = Math.max(30, Number.parseInt(service.duration, 10) || 30);
    const window = bookingWindow(date, time, settings, durationMinutes);
    if (window.error) return send(res, 400, { error: window.error });
    const paymentMethod = ["GCash", "Maya"].find((name) => name === body.paymentMethod && settings[name.toLowerCase()]?.enabled) || "";
    const paymentProof = String(body.paymentProof || "");
    if (!paymentMethod || !/^data:image\/(jpeg|png|webp);base64,/.test(paymentProof)) {
      return send(res, 400, { error: "Upload a valid payment proof." });
    }
    if (paymentProof.length > 2.8 * 1024 * 1024) {
      return send(res, 413, { error: "Payment proof must be 2 MB or smaller." });
    }
    const queueNumber = await nextQueueNumber(database);
    const bookingFee = Math.max(0, Number(settings.bookingFee) || 0);
    const appointment = { _id: new ObjectId(), serviceId: body.serviceId, barberId: body.barberId || "", date, time, request: String(body.request || "").slice(0, 1000), source: "online", bookingFee, total: Number(service.price) + bookingFee, paymentMethod, paymentProof, userId: user._id, customer, customerEmail: user.email, queueNumber, status: "pending", paid: false, createdAt: new Date() };
    await database.collection("appointments").insertOne(appointment);
    return send(res, 201, { appointment: normalizeDoc(appointment) });
  }

  if (req.method === "GET" && path === "/appointments/mine") {
    const user = await requireUser(req, database);
    const appointments = await database.collection("appointments").find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).toArray();
    return send(res, 200, { appointments: appointments.map(normalizeDoc) });
  }

  if (path === "/admin/appointments") {
    await requireRole(req, database, ["admin", "moderator"]);
    if (req.method === "GET") return send(res, 200, { appointments: (await database.collection("appointments").find().sort({ createdAt: -1 }).toArray()).map(normalizeDoc) });
  }

  if (path.startsWith("/admin/appointments/") && req.method === "PATCH") {
    await requireRole(req, database, ["admin", "moderator"]);
    const id = path.split("/").pop();
    const allowed = ["pending", "confirmed", "completed", "cancelled"];
    if (!ObjectId.isValid(id) || !allowed.includes(body.status)) return send(res, 400, { error: "Choose a valid appointment status." });
    const update = { status: body.status, updatedAt: new Date() };
    if (["confirmed", "completed"].includes(body.status)) update.paid = true;
    await database.collection("appointments").updateOne({ _id: new ObjectId(id) }, { $set: update });
    const appointment = await database.collection("appointments").findOne({ _id: new ObjectId(id) });
    return send(res, 200, { appointment: normalizeDoc(appointment) });
  }

  if (req.method === "POST" && path === "/queue/walkin") {
    const customer = String(body.customer || "").trim().slice(0, 120);
    if (customer.length < 2) return send(res, 400, { error: "Enter the customer's name." });
    const service = body.serviceId ? await database.collection("services").findOne({ $or: [{ slug: body.serviceId }, ...(ObjectId.isValid(body.serviceId) ? [{ _id: new ObjectId(body.serviceId) }] : [])], active: { $ne: false } }) : null;
    if (body.serviceId && !service) return send(res, 400, { error: "Choose an available service." });
    const waiting = await database.collection("queue").countDocuments({ status: { $in: ["waiting", "serving"] } });
    const queueNumber = await nextQueueNumber(database);
    const ticket = { _id: new ObjectId(), customer, phone: "", serviceId: service?.slug || "", barberId: "", cutName: service?.name || "To be assigned", price: Number(service?.price || 0), waitMinutes: waiting * 30, source: "shop-qr", queueNumber, status: "waiting", paid: false, createdAt: new Date() };
    await database.collection("queue").insertOne(ticket);
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
    return send(res, 200, { queue: (await database.collection("queue").find({ status: { $in: ["waiting", "serving"] } }).sort({ queueNumber: 1 }).toArray()).map(normalizeDoc) });
  }

  if (req.method === "POST" && path === "/admin/queue/next") {
    await requireRole(req, database, ["admin", "moderator"]);
    const current = await database.collection("queue").findOne({ status: "serving" });
    if (current) return send(res, 409, { error: "Finish the current customer before calling next.", ticket: normalizeDoc(current) });
    const next = await database.collection("queue").findOneAndUpdate({ status: "waiting" }, { $set: { status: "serving", calledAt: new Date(), updatedAt: new Date() } }, { sort: { queueNumber: 1 }, returnDocument: "after" });
    return send(res, 200, { ticket: normalizeDoc(next) });
  }

  if (path === "/admin/queue") {
    await requireRole(req, database, ["admin", "moderator"]);
    if (req.method === "GET") {
      return send(res, 200, { queue: (await database.collection("queue").find().sort({ createdAt: -1 }).limit(250).toArray()).map(normalizeDoc) });
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
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && path.startsWith("/admin/queue/") && path.endsWith("/paid")) {
    await requireRole(req, database, ["admin", "moderator"]);
    const id = path.split("/")[3];
    await database.collection("queue").updateOne({ _id: new ObjectId(id) }, { $set: { status: "done", paid: true, paidAt: new Date(), updatedAt: new Date() } });
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && path === "/admin/analytics") {
    await requireRole(req, database, ["admin"]);
    const [appointments, queue, users, services, barbers] = await Promise.all([
      database.collection("appointments").find().toArray(),
      database.collection("queue").find().toArray(),
      database.collection("users").countDocuments({ role: "customer" }),
      database.collection("services").find().toArray(),
      database.collection("barbers").find().toArray()
    ]);
    const revenue = appointments.filter((item) => item.paid).reduce((sum, item) => {
      const service = services.find((candidate) => String(candidate._id) === item.serviceId || candidate.slug === item.serviceId);
      return sum + Number(service?.price || 0);
    }, 0);
    return send(res, 200, {
      totals: { customers: users, bookings: appointments.length, walkins: queue.length, revenue, waiting: queue.filter((item) => item.status === "waiting").length },
      barbers: barbers.map(normalizeDoc),
      services: services.map((service) => ({ ...normalizeDoc(service), bookings: appointments.filter((item) => item.serviceId === String(service._id) || item.serviceId === service.slug).length }))
    });
  }

  return send(res, 404, { error: "Not found." });
}

module.exports = async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    send(res, error.status || 500, { error: error.message || "Server error." });
  }
};
