const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const site = 'https://thebarbercoofficial.github.io/barber-co/';
const api = 'https://barber-co-api.onrender.com/api';

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
  for (const path of ['/admin/analytics', '/admin/appointments', '/admin/queue', '/admin/notifications', '/admin/appointments/000000000000000000000000/proof']) await get(path, 401);
  const shared = await (await fetch(`${site}js/shared.js?v=backend-routing-20261102`)).text();
  assert.match(shared, /https:\/\/barber-co-api\.onrender\.com/);
  assert.match(shared, /localStorage\.removeItem\("barberCoApiBase"\)/);
  const html = await (await fetch(`${site}register.html`)).text();
  assert.match(html, /backend-routing-20261102/);
  const script = await (await fetch(`${site}js/pages/register.js?v=production-20261029`)).text();
  assert.match(script, /confirmPassword/);
  const dashboardHtml = await (await fetch(`${site}admin-dashboard.html`)).text();
  assert.match(dashboardHtml, /online-booking-live-20261102/);
  const dashboardScript = await (await fetch(`${site}js/pages/admin-dashboard.js?v=online-booking-live-20261102`)).text();
  assert.match(dashboardScript, /Promise\.allSettled/);
  assert.match(dashboardScript, /Awaiting payment/);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const migrated = await browser.newPage();
    await migrated.addInitScript(() => localStorage.setItem('barberCoApiBase', 'https://barber-co-seven.vercel.app'));
    let catalogOrigin = '';
    await migrated.route('**/api/**', (route) => {
      catalogOrigin = new URL(route.request().url()).origin;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ services: [], barbers: [] }) });
    });
    await migrated.goto(`${site}services.html`, { waitUntil: 'networkidle' });
    assert.equal(catalogOrigin, 'https://barber-co-api.onrender.com', 'Existing browsers must ignore the retired API URL');
    assert.equal(await migrated.evaluate(() => localStorage.getItem('barberCoApiBase')), null, 'Retired API override should be cleared during migration');
    await migrated.close();
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
  assert.equal(settings.paymentMode, 'live', 'Production is still using demo payments; configure real payment details before accepting online bookings.');
  assert.equal(settings.allowDemoPayments, false, 'Demo payments are still enabled in production.');
  console.log('Published smoke checks passed. Read-only: no production accounts, bookings, payments or messages created.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
