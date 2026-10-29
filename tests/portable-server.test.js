const assert = require('node:assert/strict');
const { createServer } = require('../server');

async function main() {
  const server = createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, method: req.method }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    response = await fetch(`${base}/healthz`, { method: 'HEAD' });
    assert.equal(await response.text(), '');
    response = await fetch(`${base}/api/availability?date=2100-03-03`);
    assert.deepEqual(await response.json(), { path: '/api/availability?date=2100-03-03', method: 'GET' });
    for (const path of ['/.env', '/server.js', '/package.json', '/lib/account-security.js', '/api-extra']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, path);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  const realServer = createServer();
  await new Promise(resolve => realServer.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${realServer.address().port}/api/auth/capabilities`, { method: 'OPTIONS' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  } finally {
    await new Promise(resolve => realServer.close(resolve));
  }
  console.log('Portable API: health, routing, private-file isolation, and real handler passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
