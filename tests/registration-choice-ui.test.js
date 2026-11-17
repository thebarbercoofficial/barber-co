const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<div id="app"></div>');
      await page.evaluate(() => {
        window.calls = [];
        window.BarberCo = { state: {}, nav: () => '', initHeader() {}, toast() {}, setSession() {}, icon: () => '', api: async (url, options) => {
          window.calls.push({ url, body: JSON.parse(options.body) });
          if (window.failSms && url === '/auth/registration-sms') throw new Error('Please wait before requesting another code.');
          return { message: 'Code requested.' };
        } };
      });
      await page.addScriptTag({ path: path.resolve('js/pages/register.js') });
      await page.evaluate(() => showVerification('customer@example.com'));
      await page.getByRole('button', { name: 'Use SMS instead' }).click();
      assert.equal(await page.evaluate(() => calls.length), 0);
      await page.locator('[name="smsPhone"]').fill('09924708129');
      await page.evaluate(() => { window.failSms = true; });
      await page.getByRole('button', { name: 'Use SMS instead' }).click();
      assert.match(await page.locator('[data-verification-message]').innerText(), /Please wait/);
      assert.equal(await page.getByRole('button', { name: 'Use SMS instead' }).isEnabled(), true);
      await page.evaluate(() => { window.failSms = false; });
      await page.getByRole('button', { name: 'Use SMS instead' }).click();
      await page.getByRole('heading', { name: 'Verify your mobile number' }).waitFor();
      assert.equal(await page.locator('[name="verifyPhone"]').inputValue(), '09924708129');
      await page.getByRole('button', { name: 'Use email instead' }).click();
      await page.getByRole('heading', { name: 'Verify your email' }).waitFor();
      assert.equal(await page.locator('[name="smsPhone"]').inputValue(), '09924708129');
      await page.close();
    }
    console.log('Registration email/SMS switching and cooldown errors passed at mobile and desktop sizes. No messages sent.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
