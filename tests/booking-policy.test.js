const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const http = require('node:http');

(async () => {
  const root = path.resolve(__dirname, '..');
  const submissions = [];
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (pathname === '/api/settings') return res.end(JSON.stringify({ settings: { paymentMode: 'demo', bookingFee: 100, paymentRevision: 'test-revision', demoMethods: { gcash: { enabled: true, accountName: 'Test', accountNumber: 'DEMO' }, maya: { enabled: false } } } }));
      if (pathname === '/api/appointments') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        return req.on('end', () => { submissions.push(JSON.parse(body)); res.end(JSON.stringify({ appointment: { queueNumber: 1 } })); });
      }
      return res.end('{}');
    }
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<!doctype html><html><body><button id="open">Submit booking</button></body></html>');
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8') });
      await page.addScriptTag({ path: path.join(root, 'js/booking-policy.js') });
      await page.evaluate(() => {
        window.result = null;
        document.querySelector('#open').onclick = async () => { window.result = await BookingPolicy.confirm(true); };
      });
      await page.locator('#open').click();
      const confirm = page.getByRole('dialog', { name: 'Confirm your booking' });
      await confirm.getByRole('button', { name: 'Confirm and submit' }).click();
      assert.equal(await page.evaluate(() => window.result), null);
      await confirm.getByRole('link', { name: 'Read our booking terms and policy' }).click();
      const terms = page.getByRole('dialog', { name: 'Booking terms and policy', exact: true });
      await terms.waitFor({ state: 'visible' });
      assert.ok((await terms.textContent()).includes('staff approval'));
      assert.equal(await confirm.locator('input').isChecked(), false);
      await page.keyboard.press('Escape');
      assert.equal(await terms.count(), 0);
      assert.equal(await confirm.isVisible(), true);
      assert.ok(await confirm.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
      await confirm.locator('input').check();
      await confirm.getByRole('button', { name: 'Confirm and submit' }).click();
      await page.waitForFunction(() => window.result === true);
      assert.equal(await page.evaluate(() => window.result), true);
      await page.locator('#open').click();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.result === false);
      assert.equal(await page.evaluate(() => window.result), false);
      await page.close();
      console.log(`Booking confirmation and nested policy passed at ${width}px`);
    }
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('barberCoToken', 'isolated-test-token');
      localStorage.setItem('barberCoState', JSON.stringify({ user: { id: 'customer', email: 'customer@test.invalid', role: 'customer' }, booking: { date: '2100-03-04', time: '14:00', serviceId: 'basic' } }));
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/payment.html`);
    await page.locator('[data-payment-proof]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64') });
    await page.locator('[data-confirm-payment]').click();
    assert.equal(submissions.length, 0, 'Opening the confirmation must not book');
    await page.getByRole('button', { name: 'Go back', exact: true }).click();
    assert.equal(submissions.length, 0, 'Cancelling must not book');
    await page.locator('[data-confirm-payment]').click();
    await page.locator('[data-accept-booking]').check();
    await page.getByRole('button', { name: 'Confirm and submit' }).click();
    await page.waitForFunction(() => document.querySelector('[data-toast]').textContent.includes('Booking submitted'));
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].nonRefundableAccepted, true);
    await page.close();
    console.log('Actual checkout sends one acknowledged booking only after final consent');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
