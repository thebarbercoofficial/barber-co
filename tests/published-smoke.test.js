const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const site = 'https://thebarbercoofficial.github.io/barber-co/';
const api = 'https://barber-co-seven.vercel.app/api';

async function main() {
  const timings = [];
  async function get(path, expected = 200) {
    const started = performance.now();
    const response = await fetch(`${api}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, expected, path);
    assert.match(response.headers.get('cache-control'), /no-store/);
    timings.push({ path, status: response.status, milliseconds: Math.round(performance.now() - started) });
    return response.json();
  }
  const capabilities = await get('/auth/capabilities');
  assert.equal(capabilities.verificationRequired, true);
  const { settings } = await get('/settings');
  assert.equal(settings.paymentMode, 'live');
  assert.equal(settings.allowDemoPayments, false);
  for (const path of ['/admin/analytics', '/admin/appointments', '/admin/queue', '/admin/notifications', '/admin/appointments/000000000000000000000000/proof']) await get(path, 401);
  const html = await (await fetch(`${site}register.html`)).text();
  assert.match(html, /production-20261029/);
  const script = await (await fetch(`${site}js/pages/register.js?v=production-20261029`)).text();
  assert.match(script, /confirmPassword/);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${site}register.html`, { waitUntil: 'networkidle' });
      await page.locator('[name="confirmPassword"]').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: `published-register-${width}-check.png`, fullPage: true });
      await page.goto(`${site}admin-dashboard.html`, { waitUntil: 'networkidle' });
      await page.waitForURL(/login\.html/);
      console.log(`Published registration and anonymous admin redirect passed at ${width}px`);
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({ capabilities, timings }, null, 2));
  console.log('Published smoke checks passed. Read-only: no production accounts, bookings, payments or messages created.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
