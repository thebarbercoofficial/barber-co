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
      const adminEmail = String(process.env.ADMIN_EMAIL || "thebarberco.official@gmail.com").toLowerCase();
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (adminPassword) {
        const hash = await bcrypt.hash(adminPassword, 10);
        await database.collection("users").updateOne(
          { email: adminEmail },
          { $setOnInsert: { name: "The Barber Co Admin", email: adminEmail, passwordHash: hash, role: "admin", phone: "", createdAt: new Date() } },
          { upsert: true }
        );
      }
      const moderatorEmail = String(process.env.MODERATOR_EMAIL || "staff@thebarberco.local").toLowerCase();
      const moderatorPassword = process.env.MODERATOR_PASSWORD;
      if (moderatorPassword) {
        const hash = await bcrypt.hash(moderatorPassword, 10);
        await database.collection("users").updateOne(
          { email: moderatorEmail },
          { $setOnInsert: { name: "Front Desk Staff", email: moderatorEmail, passwordHash: hash, role: "moderator", phone: "", createdAt: new Date() } },
          { upsert: true }
        );
      }
    })();
  }
  return ensureSeed.promise;
}

function publicUser(user) {
  if (!user) return null;
  return { id: String(user._id), name: user.name, email: user.email, role: user.role || "customer", phone: user.phone || "", location: user.location || "", bio: user.bio || "" };
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

  if (req.method === "POST" && path === "/auth/register") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || password.length < 6) return send(res, 400, { error: "Email and a 6-character password are required." });
    const user = { _id: new ObjectId(), name: body.name || "Customer", email, passwordHash: await bcrypt.hash(password, 10), role: "customer", phone: body.phone || "", createdAt: new Date() };
    await database.collection("users").insertOne(user);
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
    const update = {
      name: body.name || user.name,
      username: body.username || "",
      phone: body.phone || "",
      location: body.location || "",
      bio: body.bio || "",
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
      if (!email || password.length < 6) return send(res, 400, { error: "Email and password are required." });
      const user = { _id: new ObjectId(), name: body.name || "Staff", email, passwordHash: await bcrypt.hash(password, 10), role: body.role || "customer", phone: body.phone || "", createdAt: new Date() };
      await database.collection("users").insertOne(user);
      return send(res, 201, { user: publicUser(user) });
    }
  }

  if (path.startsWith("/admin/users/") && req.method === "PATCH") {
    await requireRole(req, database, ["admin"]);
    await database.collection("users").updateOne({ _id: new ObjectId(path.split("/").pop()) }, { $set: { role: body.role, updatedAt: new Date() } });
    return send(res, 200, { ok: true });
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
    const queueNumber = await nextQueueNumber(database);
    const appointment = { _id: new ObjectId(), ...body, userId: user._id, customer: user.name, queueNumber, status: "pending", paid: body.paymentMethod !== "Cash", createdAt: new Date() };
    await database.collection("appointments").insertOne(appointment);
    return send(res, 201, { appointment: normalizeDoc(appointment) });
  }

  if (path === "/admin/appointments") {
    await requireRole(req, database, ["admin", "moderator"]);
    if (req.method === "GET") return send(res, 200, { appointments: (await database.collection("appointments").find().sort({ createdAt: -1 }).toArray()).map(normalizeDoc) });
  }

  if (path.startsWith("/admin/appointments/") && req.method === "PATCH") {
    await requireRole(req, database, ["admin", "moderator"]);
    await database.collection("appointments").updateOne({ _id: new ObjectId(path.split("/").pop()) }, { $set: { status: body.status, updatedAt: new Date() } });
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && path === "/queue/walkin") {
    const queueNumber = await nextQueueNumber(database);
    const ticket = { _id: new ObjectId(), customer: body.customer || "Walk-in customer", phone: "", serviceId: body.serviceId || "", barberId: body.barberId || "", cutName: body.cutName || "To be assigned", source: body.source || "shop-qr", queueNumber, status: "waiting", createdAt: new Date() };
    await database.collection("queue").insertOne(ticket);
    return send(res, 201, { ticket: normalizeDoc(ticket) });
  }

  if (req.method === "GET" && path.startsWith("/queue/ticket/")) {
    const id = path.split("/").pop();
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
