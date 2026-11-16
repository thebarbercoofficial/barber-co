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
const operatingHours = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { open: '13:00', close: '20:00' }]));
const settings = { paymentMode: 'live', paymentRevision: 'layout-fixture', bookingFee: 100, operatingHours, gcash: { enabled: true, accountName: 'Fixture shop', accountNumber: '09123456789' }, maya: { enabled: false } };
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
      const holdSubmissions = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (url.pathname === '/api/appointment-holds' && route.request().method() === 'POST') {
          const body = route.request().postDataJSON();
          holdSubmissions.push(body);
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ hold: { ...body, id: `fixture-hold-${width}`, barberId: 'alex', partySize: 1, partyMembers: [user.name], expiresAt: new Date(Date.now() + 600000).toISOString() } }) });
        }
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
        await page.evaluate(() => document.fonts.ready);
        const check = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          smallFields: [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]),select,textarea')].filter(el => el.getBoundingClientRect().width && getComputedStyle(el).fontSize.replace('px', '') < 16).map(el => el.name),
          customerTheme: document.body.classList.contains('customer-page')
        }));
        assert.equal(check.overflow, false, `${name} overflow at ${width}px`);
        assert.equal(check.customerTheme, true);
        assert.equal(await page.locator('link[href*="css/customer.css"]').count(), 1, `${name}: customer design stylesheet missing`);
        assert.deepEqual(check.smallFields, [], `${name} small fields at ${width}px`);
        assert.deepEqual(errors, [], `${name} script errors at ${width}px`);
        if (name === 'index') {
          assert.equal(await page.locator('body').evaluate(el => el.classList.contains('home-page')), true);
          const shopBox = await page.locator('.shop-showcase').boundingBox();
          assert.ok(shopBox.x <= Math.max(24, width * 0.04), `Homepage shop section has an oversized left gutter at ${width}px: ${shopBox.x}px`);
          assert.ok(shopBox.x + shopBox.width >= width - Math.max(24, width * 0.04), `Homepage shop section has an oversized right gutter at ${width}px`);
          const sections = await page.locator('#app > section').evaluateAll(items => items.map(el => el.getBoundingClientRect().height));
          assert.equal(sections.length, 3, 'Homepage has three separate sections');
          assert.ok(sections.every(height => height >= 828), `Homepage sections must remain screen-sized at ${width}px: ${sections}`);
          assert.equal(await page.locator('.site-header').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(43, 32, 26)');
          if (width === 2560) {
            await page.setViewportSize({ width, height: 1440 });
            const homepageScale = await page.evaluate(() => ({
              heroHeading: getComputedStyle(document.querySelector('.hero h1')).fontSize,
              shopImage: document.querySelector('.shop-photo img').getBoundingClientRect().height,
              servicePrice: getComputedStyle(document.querySelector('.service-card .price')).fontSize
            }));
            assert.equal(homepageScale.heroHeading, '88px');
            assert.ok(homepageScale.shopImage >= 850, `Large desktop shop photo should scale with the larger layout: ${homepageScale.shopImage}px`);
            assert.equal(homepageScale.servicePrice, '26px');
            await page.screenshot({ path: path.join(output, 'homepage-brown-gold-2560.png'), fullPage: true });
            const heights = await page.locator('#app > section').evaluateAll(items => items.map(el => el.getBoundingClientRect().height));
            assert.ok(heights.every(height => height >= 1368), `Large desktop section heights: ${heights}`);
            await page.setViewportSize({ width, height: 900 });
          }
        }
        if (name === 'barbers') {
          assert.equal(await page.locator('[data-barber="leave"]').isDisabled(), true);
          assert.equal(await page.locator('[data-barber="inactive"]').isDisabled(), true);
          assert.equal(await page.locator('[data-barber="future"]').isEnabled(), true);
          assert.match(await page.locator('.barber-roster').innerText(), /Leave: Jan 1, 2100 - Jan 3, 2100/);
        }
        if (name === 'booking') {
          assert.equal(await page.locator('[name="partySize"], [name="partyMember"], [data-party-members]').count(), 0, 'New booking form has no group controls');
          assert.deepEqual(await page.locator('.summary-list strong').allTextContents(), ['Classic Haircut', 'PHP 150.00', 'PHP 100.00', 'PHP 250.00', '30 minutes']);
          await page.locator('[name="date"]').fill('2100-03-03');
          await page.locator('[name="date"]').dispatchEvent('change');
          await page.locator('[name="time"] option[value="14:00"]').waitFor({ state: 'attached' });
          await page.locator('[name="time"]').selectOption('14:00');
          await page.getByRole('button', { name: 'Proceed to payment' }).click();
          await page.waitForURL('**/payment.html');
          assert.equal(holdSubmissions.length, 1);
          assert.equal(Object.hasOwn(holdSubmissions[0], 'partySize'), false);
          assert.equal(Object.hasOwn(holdSubmissions[0], 'partyMembers'), false);
          assert.match(await page.locator('.payment-layout').innerText(), /Customer\s+Customer Layout Test/);
          assert.match(await page.locator('.payment-layout').innerText(), /Duration\s+30 minutes/);
          assert.doesNotMatch(await page.locator('.payment-layout').innerText(), /Group \(/);
        }
        if ([1440, 390].includes(width) && ['index', 'services', 'barbers', 'booking', 'queue', 'user-profile', 'login'].includes(name)) await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
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
