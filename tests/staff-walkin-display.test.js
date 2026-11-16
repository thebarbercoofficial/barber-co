const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const QRCode = require('qrcode');
const root = path.resolve(__dirname, '..');
(async () => {
  const qrImage = await QRCode.toDataURL('https://shop.test/queue.html?walkinToken=test');
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.addInitScript(base => localStorage.setItem('barberCoApiBase', base), base);
      await page.clock.install();
      let calls = 0;
      let denied = false;
      const external = [];
      page.on('request', req => { if (!req.url().startsWith(base) && !req.url().startsWith('data:')) external.push(req.url()); });
      await page.route('**/api/admin/queue/qr', route => {
        calls++;
        return route.fulfill({ status: denied ? 403 : 200, contentType: 'application/json', body: JSON.stringify(denied ? { error: 'Denied' } : { token: `token-${calls}`, qrImage, expiresAt: new Date(Date.now() + 120000).toISOString() }) });
      });
      await page.goto(`${base}/printables/walk-in-qr.html`);
      await page.locator('[data-shop-qr]:visible').waitFor();
      assert.equal(await page.locator('[data-shop-qr]').evaluate(img => img.complete && img.naturalWidth > 0), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(root, `outputs/staff-qr-${width}.png`) });
      await page.clock.fastForward(101000);
      await page.waitForFunction(() => document.querySelector('[data-qr-status]').textContent.includes('Scan to join'));
      assert.ok(calls >= 2, 'Refresh before expiry');
      denied = true;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.locator('[data-qr-status]').filter({ hasText: 'Staff login required' }).waitFor();
      assert.equal(await page.locator('[data-shop-qr]').isVisible(), false);
      assert.equal(await page.locator('[data-shop-qr]').getAttribute('src'), null);
      assert.deepEqual(external, []);
      await page.close();
    }
    console.log('Staff QR desktop/mobile display, rotation and access checks passed');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
