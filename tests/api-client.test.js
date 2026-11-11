const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
async function main() {
  const storage = new Map();
  const requests = [];
  let responder = async () => ({ ok: true, json: async () => ({ items: [] }) });
  const context = {
    structuredClone, AbortSignal,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    window: {}, location: { hostname: 'example.test', protocol: 'https:', origin: 'https://example.test', pathname: '/index.html' },
    fetch: (...args) => { requests.push(args); return responder(...args); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/shared.js'), 'utf8') + '\nglobalThis.client = BarberCo;', context);
  const { api } = context.client;
  const [first, second] = await Promise.all([api('/catalog'), api('/catalog')]);
  assert.equal(requests.length, 1);
  first.items.push('changed');
  assert.equal(second.items.length, 0);
  assert.equal(requests[0][1].headers['Content-Type'], undefined);
  await api('/catalog');
  assert.equal(requests.length, 2, 'Completed reads must not be cached');
  await api('/booking', { method: 'POST', body: '{}' });
  assert.equal(requests.at(-1)[1].headers['Content-Type'], 'application/json');
  storage.set('barberCoToken', 'token-a');
  const a = api('/me');
  storage.set('barberCoToken', 'token-b');
  const b = api('/me');
  await Promise.all([a, b]);
  assert.equal(requests.at(-2)[1].headers.Authorization, 'Bearer token-a');
  assert.equal(requests.at(-1)[1].headers.Authorization, 'Bearer token-b');
  responder = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  await assert.rejects(api('/catalog'), (error) => error.code === 'REQUEST_TIMEOUT');
  responder = async () => ({ ok: true, json: async () => ({ recovered: true }) });
  assert.equal((await api('/catalog')).recovered, true);
  const app = { hidden: false };
  const staffContext = { ...context, document: { querySelector: () => app },
    location: { ...context.location, pathname: '/admin-dashboard.html', replace: () => assert.fail('Valid staff must not be redirected') } };
  responder = async () => ({ ok: true, json: async () => ({ user: { id: 'staff', email: 'staff@example.test', role: 'admin' } }) });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/shared.js'), 'utf8'), staffContext);
  await new Promise(setImmediate);
  assert.equal(app.hidden, false, 'Staff auth can read during shared-client initialization');
  console.log('API client deduplication, fresh data, auth isolation, JSON writes and timeout recovery passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
