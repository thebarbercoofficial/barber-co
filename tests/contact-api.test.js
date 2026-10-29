const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { memoryDb } = require('./helpers/memory-db');
const security = require('../lib/account-security');
const localRequire = require('node:module').createRequire(path.resolve('api/index.js'));
const database = memoryDb({});
let ready = false;
let reject = false;
const sent = [];
const context = { require: (name) => name === '../lib/account-security' ? { ...security, emailReady: () => ready, sendEmail: async (...args) => { if (reject) throw new Error('Provider unavailable'); sent.push(args); } } : localRequire(name), module: { exports: {} }, process: { env: { JWT_SECRET: 'isolated-contact-test', ADMIN_EMAIL: 'shop@example.com' } }, URL, console, fixtureDatabase: database };
vm.runInNewContext(`${fs.readFileSync('api/index.js', 'utf8')}\ndb = async () => fixtureDatabase;`, context);
async function request(body) {
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, { method: 'POST', url: '/api/contact', headers: {} });
  let result;
  const res = { statusCode: 0, setHeader() {}, end(data) { result = JSON.parse(data); } };
  await context.module.exports(req, res);
  return { status: res.statusCode, ...result };
}
async function main() {
  const body = { name: 'QA Test', email: 'qa@example.com', message: 'Isolated enquiry, no real email is sent.' };
  assert.equal((await request({ ...body, email: 'invalid' })).status, 400);
  assert.equal((await request(body)).status, 503);
  assert.equal(sent.length, 0);
  ready = true;
  assert.equal((await request(body)).status, 200);
  assert.equal(sent[0][0], 'shop@example.com');
  assert.match(sent[0][2], /Reply to: qa@example.com/);
  assert.equal((await request(body)).status, 429);
  assert.equal(sent.length, 1);
  reject = true;
  const other = { ...body, email: 'other@example.com' };
  assert.equal((await request(other)).status, 503);
  reject = false;
  assert.equal((await request(other)).status, 200);
  console.log('Contact API: validation, missing provider, provider acceptance, rate limit and failed-send retry passed without real email.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
