const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
async function main() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const base = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('barberCoToken', 'isolated-test');
      localStorage.setItem('barberCoState', JSON.stringify({ user: { id: 'test', email: 'queue@example.test', name: 'Queue Test', role: 'customer' } }));
    });
    let submitted;
    let estimate = 25;
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      let data = {};
      if (url.pathname.endsWith('/catalog')) data = { services: [{ id: 'basic', name: 'Haircut', price: 150, duration: '30 min' }], barbers: [{ id: 'alex', name: 'Alex', status: 'active' }, { id: 'ria', name: 'Ria', status: 'active' }] };
      else if (url.pathname.endsWith('/settings')) data = { settings: { paymentMode: 'demo', operatingHours: { tuesday: { open: '13:00', close: '15:00' } } } };
      else if (url.pathname.endsWith('/availability')) data = { unavailableBarberIds: url.searchParams.get('time') === '13:00' ? ['alex', 'ria'] : url.searchParams.get('time') === '13:30' ? ['alex'] : [] };
      else if (url.pathname.endsWith('/queue/walkin')) { submitted = route.request().postDataJSON(); data = { ticket: { id: 'test-ticket' } }; }
      else if (url.pathname.endsWith('/queue')) data = { queue: [{ id: 'waiting', customer: 'Test Waiting', queueNumber: 2, cutName: 'Haircut', status: 'waiting', waitMinutes: estimate }] };
      else if (url.pathname.includes('/queue/ticket/')) data = { ticket: { id: 'test-ticket', queueNumber: 2, status: 'waiting' }, waitingAhead: 1 };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    await page.goto(`${base}/booking.html`);
    await page.locator('[name=date]').fill('2099-03-03');
    await page.locator('[name=date]').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('[name=time] option[value="13:00"]')?.disabled);
    assert.equal(await page.locator('[name=time] option[value="13:30"]').isDisabled(), false, 'Any barber stays available if one barber is free');
    await page.locator('[name=barber]').selectOption('alex');
    await page.waitForFunction(() => document.querySelector('[name=time] option[value="13:30"]').disabled);
    assert.match(await page.locator('[name=time] option[value="13:30"]').innerText(), /unavailable/);
    await page.locator('[name=barber]').selectOption('ria');
    await page.waitForFunction(() => !document.querySelector('[name=time] option[value="13:30"]').disabled);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/queue.html`);
      assert.equal(await page.locator('[name=contactEmail]').isVisible(), false);
      await page.locator('[name=emailConsent]').check();
      await page.locator('[name=contactEmail]').fill('none');
      assert.equal(await page.locator('[name=contactEmail]').evaluate((input) => input.validity.valid), false);
      await page.locator('[name=emailConsent]').uncheck();
      assert.equal(await page.locator('[name=contactEmail]').isDisabled(), true);
      await page.locator('[name=customer]').fill('No Email Guest');
      await page.getByRole('button', { name: 'Get queue number', exact: true }).click();
      await page.waitForURL('**/queue.html?ticket=test-ticket');
      assert.equal(submitted.emailConsent, false);
      assert.equal(submitted.contactEmail, null);
      await page.goto(`${base}/queue-display.html`);
      await page.getByText('Estimated wait: about 25 minutes', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(root, '..', `queue-estimate-${width}.png`), fullPage: true });
    }
    estimate = 10;
    await page.getByText('Estimated wait: about 10 minutes', { exact: true }).waitFor({ timeout: 10000 });
    console.log('PASS: all-barber/specific-barber disabled times, optional email with invalid stale text, guest submission, TV estimates and live estimate updates; desktop/mobile.');
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
