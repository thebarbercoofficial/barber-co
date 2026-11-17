const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent('<div id="app"></div>');
      await page.evaluate(() => {
        window.fixture = { blocked: ['leave', 'busy'], leave: ['leave'], posts: 0 };
        window.BarberCo = {
          state: { services: [{ id: 'basic', name: 'Basic', price: 150 }] },
          barbers: ['leave', 'busy', 'free'].map(id => ({ id, name: id === 'leave' ? 'Alex' : id, status: 'active' })),
          nav: () => '', adminSidebar: () => '', initHeader() {}, loadCatalog: async () => {},
          canAccess: () => true, icon: () => '', toast() {}, peso: String,
          byId: (items, id) => items.find(item => item.id === id) || {},
          serviceOptions: () => '<option value="basic">Basic</option>',
          api: async (url, options) => {
            if (url.startsWith('/queue/barber-availability')) return { unavailableBarberIds: fixture.blocked, onLeaveBarberIds: fixture.leave };
            if (options?.method === 'POST') { fixture.posts++; return { ticket: { queueNumber: 1 } }; }
            return { queue: [] };
          }
        };
      });
      await page.addScriptTag({ path: path.resolve('js/pages/admin-logbook.js') });
      const picker = page.locator('[name="barberId"]');
      await picker.waitFor();
      await page.waitForFunction(() => !document.querySelector('[name="barberId"]').disabled);
      assert.equal(await picker.locator('[value="leave"]').textContent(), 'Alex - on leave');
      assert.equal(await picker.locator('[value="leave"]').evaluate(el => el.disabled), true);
      assert.equal(await picker.locator('[value="busy"]').evaluate(el => el.disabled), true);
      await page.locator('[name="customer"]').fill('Customer');
      await picker.selectOption('free');
      await page.evaluate(() => fixture.blocked.push('free'));
      await page.locator('[type="submit"]').click();
      await page.locator('[data-add-error]').filter({ hasText: 'no longer available' }).waitFor();
      assert.equal(await page.evaluate(() => fixture.posts), 0);
      assert.equal(await picker.inputValue(), '');
      await page.locator('[type="submit"]').click();
      await page.waitForFunction(() => fixture.posts === 1);
      await page.close();
    }
    console.log('Desktop/mobile disabled leave and busy options, stale-selection rejection and unassigned submit passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
