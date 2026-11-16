// New bookings are single-customer; old group appointments remain readable by staff.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

async function main() {
  const bookingSource = fs.readFileSync(path.join(root, 'js/pages/booking.js'), 'utf8');
  const paymentSource = fs.readFileSync(path.join(root, 'js/pages/payment.js'), 'utf8');
  const registrationSource = fs.readFileSync(path.join(root, 'js/pages/register.js'), 'utf8');
  assert.doesNotMatch(bookingSource, /name=["']partySize|name=["']partyMember|data-party-members/);
  assert.doesNotMatch(bookingSource, /partySize\s*[:,(]/);
  assert.doesNotMatch(paymentSource, /partySize\s*[:,]\s*partySize|partyMembers\s*[:,]\s*partyMembers/);
  assert.match(paymentSource, /Group bookings are no longer available/);
  assert.match(registrationSource, /Each appointment is for one customer and one service/i);
  assert.doesNotMatch(registrationSource, /Each group member must check in/);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<!doctype html><html lang="en"><body><main id="app"></main></body></html>');
      await page.addStyleTag({ path: path.join(root, 'css/styles.css') });
      await page.addScriptTag({ path: path.join(root, 'js/booking-policy.js') });
      await page.evaluate(() => BookingPolicy.terms());
      const terms = page.getByRole('dialog', { name: 'Booking terms and policy' });
      assert.match(await terms.innerText(), /Each new booking covers one customer and one service/);
      assert.match(await terms.innerText(), /Group bookings are not available/);
      assert.doesNotMatch(await terms.innerText(), /group member|whole group|sequential service|one group fee/);
      await terms.getByRole('button', { name: 'Close booking terms' }).click();

      const dashboardSource = fs.readFileSync(path.join(root, 'js/pages/admin-dashboard.js'), 'utf8');
      const rowSource = dashboardSource.slice(dashboardSource.indexOf('function compactGroupDetails'), dashboardSource.indexOf('async function render'));
      const legacyMarkup = await page.evaluate((source) => {
        const safeText = (value) => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        const peso = (value) => `PHP ${value}`;
        const icon = () => '';
        const BarberCo = { timeLabel: (value) => value };
        return new Function('safeText', 'peso', 'icon', 'BarberCo', `${source}; return onlineBookingRows;`)(safeText, peso, icon, BarberCo)([
          { customer: 'Legacy Group', date: '2100-03-03', time: '14:00', status: 'confirmed', partySize: 2, partyMembers: ['Account', '<Guest>'], durationMinutes: 60, total: 400 }
        ]);
      }, rowSource);
      await page.locator('#app').evaluate((node, html) => { node.innerHTML = html; }, legacyMarkup);
      assert.match(await page.locator('#app').innerText(), /Legacy Group/);
      assert.match(await page.locator('#app').innerText(), /Group of 2: Account, <Guest>/);
      assert.match(await page.locator('#app').innerText(), /Actions apply to the whole group/);
      assert.equal(await page.locator('#app Guest').count(), 0, 'Historical member names are escaped as text');
      await page.close();
      console.log(`Single-booking policy and legacy group history passed at ${width}px`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
