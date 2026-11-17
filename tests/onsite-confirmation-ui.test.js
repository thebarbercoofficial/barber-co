const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<button id="book">Book</button>');
      await page.addStyleTag({ path: path.resolve('css/styles.css') });
      await page.addScriptTag({ path: path.resolve('js/booking-policy.js') });
      await page.evaluate(() => { document.querySelector('#book').onclick = () => BookingPolicy.confirm(false, true); });
      await page.locator('#book').click();
      const dialog = page.getByRole('dialog', { name: 'Confirm your booking' });
      const text = await dialog.innerText();
      assert.ok(text.includes('confirmed immediately'));
      assert.ok(text.includes('No online payment is collected'));
      assert.ok(!text.includes('Submission does not guarantee your time'));
      assert.ok(await dialog.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
      await page.close();
    }
    console.log('Cash confirmation copy and responsive dialog passed at 390px and 1440px');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
