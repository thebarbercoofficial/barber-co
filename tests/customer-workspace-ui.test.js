// Layout fixtures never contact production APIs or send messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const user = { id: 'layout-user', name: 'Customer Layout Test', email: 'layout@example.test', role: 'customer', emailVerified: true, phoneVerified: true, phone: '09123456789' };
const services = [{ id: 'basic', name: 'Classic Haircut', price: 150, duration: '30 min', detail: 'Haircut and finishing', icon: 'CUT' }];
const barbers = [
  { id: 'alex', name: 'Alex Santos', status: 'active', role: 'Classic cuts' },
  { id: 'leave', name: 'Scheduled Leave', status: 'active', leaveFrom: '2000-01-01', leaveTo: '2100-12-31' },
  { id: 'future', name: 'Future Leave', status: 'active', leaveFrom: '2100-01-01', leaveTo: '2100-01-03' },
  { id: 'inactive', name: 'Inactive Barber', status: 'inactive' }
];
const settings = { paymentMode: 'live', bookingFee: 100, gcash: { enabled: true, accountName: 'Fixture shop', accountNumber: '09123456789' }, maya: { enabled: false } };
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const output = path.join(root, 'outputs/customer-workspace');
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const width of [2560, 1440, 768, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(({ base, user, services, barbers }) => {
        localStorage.setItem('barberCoApiBase', base);
        localStorage.setItem('barberCoToken', 'isolated-layout-token');
        localStorage.setItem('barberCoState', JSON.stringify({ user, services, barbers, selectedServiceId: 'basic', booking: { serviceId: 'basic', barberId: 'alex', customer: user.name, date: '2100-03-03', time: '14:00', holdId: 'layout-hold', holdExpiresAt: new Date(Date.now() + 600000).toISOString() } }));
      }, { base, user, services, barbers });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        let data;
        if (url.pathname === '/api/me') data = { user };
        else if (url.pathname === '/api/catalog') data = { services, barbers };
        else if (url.pathname === '/api/settings') data = { settings };
        else if (url.pathname === '/api/queue') data = { queue: [] };
        else if (url.pathname === '/api/availability') data = { unavailableBarberIds: [] };
        else if (url.pathname === '/api/appointments/mine') data = { appointments: [] };
        else if (url.pathname.includes('/notifications')) data = { notifications: [] };
        else if (url.pathname === '/api/checkout/validate') data = { valid: true };
        else throw new Error(`Unexpected fixture request: ${url.pathname}`);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const pages = { index: '.hero', about: '.feature-layout', services: '.service-card', barbers: '.barber-card', queue: '[data-walkin]', booking: '[data-booking]', payment: '.payment-layout', contact: '[data-contact]', login: '[data-login]', register: '[data-register]', 'user-profile': '.account-layout' };
      for (const [name, selector] of Object.entries(pages)) {
        await page.goto(`${base}/${name}.html`);
        await page.locator(selector).first().waitFor();
        const check = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          smallFields: [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]),select,textarea')].filter(el => el.getBoundingClientRect().width && getComputedStyle(el).fontSize.replace('px', '') < 16).map(el => el.name),
          customerTheme: document.body.classList.contains('customer-page')
        }));
        assert.equal(check.overflow, false, `${name} overflow at ${width}px`);
        assert.equal(check.customerTheme, true);
        assert.deepEqual(check.smallFields, [], `${name} small fields at ${width}px`);
        assert.deepEqual(errors, [], `${name} script errors at ${width}px`);
        if (name === 'barbers') {
          assert.equal(await page.locator('[data-barber="leave"]').isDisabled(), true);
          assert.equal(await page.locator('[data-barber="inactive"]').isDisabled(), true);
          assert.equal(await page.locator('[data-barber="future"]').isEnabled(), true);
          assert.match(await page.locator('.barber-roster').innerText(), /Leave: Jan 1, 2100 - Jan 3, 2100/);
        }
        if ([1440, 390].includes(width) && ['index', 'barbers', 'booking', 'queue', 'user-profile'].includes(name)) await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
      }
      await context.close();
      console.log(`Customer pages passed at ${width}px: 11 pages, readable fields, no overflow or script errors`);
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
