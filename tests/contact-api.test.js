const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { memoryDb } = require('./helpers/memory-db');
const security = require('../lib/account-security');
const localRequire = require('node:module').createRequire(path.resolve('api/index.js'));
const secret = 'isolated-contact-test';
const users = ['admin', 'moderator', 'customer'].map((role) => ({ _id: new ObjectId(), email: `${role}@review.test`, role }));
const database = memoryDb({ users });
let ready = false;
let reject = false;
const sent = [];
const context = { require: (name) => name === '../lib/account-security' ? { ...security, emailReady: () => ready, sendEmail: async (...args) => { if (reject) throw new Error('Provider unavailable'); sent.push(args); } } : localRequire(name), module: { exports: {} }, process: { env: { JWT_SECRET: secret, ADMIN_EMAIL: 'shop@example.com' } }, URL, console, fixtureDatabase: database };
vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\ndb = async () => fixtureDatabase;`, context);
const token = (role) => jwt.sign({ sub: String(users.find((user) => user.role === role)._id) }, secret);

async function request({ body = {}, method = 'POST', path: pathname = '/api/contact', role } = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, { method, url: pathname, headers: role ? { authorization: `Bearer ${token(role)}` } : {} });
  let result;
  const res = { statusCode: 0, setHeader() {}, end(data) { result = JSON.parse(data); } };
  await context.module.exports(req, res);
  return { status: res.statusCode, ...result };
}

async function main() {
  const body = { name: 'QA Test', email: 'qa@example.com', message: 'Isolated enquiry, no real email is sent.' };
  assert.equal((await request({ body: { ...body, email: 'invalid' } })).status, 400);
  const initial = await request({ body });
  assert.equal(initial.status, 201, 'Messages should still reach the staff inbox without configured email');
  assert.match(initial.message, /saved to the staff inbox/i);
  assert.equal(sent.length, 0);
  assert.equal((await request({ body: { ...body, email: 'qa@example.com' } })).status, 429);
  assert.equal((await request({ method: 'GET', path: '/api/admin/contacts' })).status, 401);
  assert.equal((await request({ method: 'GET', path: '/api/admin/contacts', role: 'customer' })).status, 403);
  let inbox = await request({ method: 'GET', path: '/api/admin/contacts', role: 'moderator' });
  assert.equal(inbox.status, 200);
  assert.equal(inbox.contacts.length, 1);
  assert.equal(inbox.contacts[0].email, body.email);
  assert.equal((await request({ method: 'GET', path: '/api/admin/contacts', role: 'admin' })).contacts.length, 1);

  ready = true;
  const second = { ...body, email: 'other@example.com' };
  assert.equal((await request({ body: second })).status, 201);
  assert.equal(sent[0][0], 'shop@example.com');
  assert.match(sent[0][2], /Reply to: other@example.com/);
  reject = true;
  const third = { ...body, email: 'third@example.com' };
  const savedDespiteEmailFailure = await request({ body: third });
  assert.equal(savedDespiteEmailFailure.status, 201);
  assert.match(savedDespiteEmailFailure.message, /email alert is unavailable/i);
  inbox = await request({ method: 'GET', path: '/api/admin/contacts', role: 'admin' });
  assert.equal(inbox.contacts.length, 3, 'The staff inbox must retain messages if email delivery fails');
  console.log('Contact API: validation, persistence, email fallback, rate limits, and staff-only inbox access passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
