const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, `.${new URL(req.url, 'http://localhost').pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = process.env.POLICY_TEST_BASE || `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}register.html`);
      await page.locator('[data-open-policy]').waitFor();
      await page.locator('[name="name"]').fill('Policy preview');
      assert.equal(await page.locator('[data-registration-terms]').count(), 0);
      const consent = page.locator('[name="termsAccepted"]');
      assert.equal(await consent.getAttribute('required'), '');
      assert.equal(await consent.isChecked(), false);
      await page.locator('[data-open-policy]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(root, `policy-agreement-${width}.png`) });
      await page.locator('[data-open-policy]').click();
      await page.getByRole('dialog').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-close-policy] svg').count(), 1);
      assert.equal(await consent.isChecked(), false, 'Reading the policy must not grant consent');
      for (const heading of ['Accounts and security', 'Appointments and payments', 'Walk-ins and notifications', 'Your information']) assert.ok(await page.getByRole('dialog').getByRole('heading', { name: heading }).count());
      assert.ok(await page.evaluate(() => document.querySelector('dialog').getBoundingClientRect().right <= innerWidth));
      await page.screenshot({ path: path.join(root, `policy-popup-${width}.png`) });
      await page.getByRole('button', { name: 'Close terms and privacy policy' }).click();
      assert.equal(await page.locator('[name="name"]').inputValue(), 'Policy preview');
      await page.locator('[data-open-policy]').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').isVisible(), false);
      await consent.check();
      assert.equal(await consent.isChecked(), true);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Policy popup, required consent, close/Escape, preserved form, and screenshots passed at ${width}px (${base})`);
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
