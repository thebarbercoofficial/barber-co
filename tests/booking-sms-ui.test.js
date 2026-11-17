const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<html><body></body></html>');
      await page.addScriptTag({ path: path.resolve('js/booking-policy.js') });
      await page.evaluate(() => { window.result = BookingPolicy.confirm(false, false, value => { window.smsChoice = value; }); });
      const sms = page.locator('[data-booking-sms]');
      assert.equal(await sms.isChecked(), false);
      assert.equal(await sms.getAttribute('required'), null);
      assert.equal(await page.locator('.terms-consent').nth(1).locator('input').getAttribute('data-booking-sms'), '');
      await page.locator('[data-accept-booking]').check();
      if (width === 1440) await sms.check();
      await page.getByRole('button', { name: 'Confirm and submit' }).click();
      assert.equal(await page.evaluate(() => window.result), true);
      assert.equal(await page.evaluate(() => window.smsChoice), width === 1440);
      await page.close();
    }
    console.log('Booking SMS optional consent below policy passed at mobile and desktop sizes');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
