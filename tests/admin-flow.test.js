const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(`<body class="staff-page"><aside class="sidebar"><div class="sidebar-shop">Shop</div><div class="sidebar-group"><p>Daily operations</p><a>Dashboard</a><a>Staff Logbook</a></div></aside><main class="workspace studio-dashboard"><div class="dashboard-layout"><div><section data-analytics><div class="chart-frame"></div></section></div><div><section class="panel" data-bookings>Bookings</section></div><section data-dashboard-team>Team</section></div><div class="reports-layout"><section>Chart</section><section class="report-services">Services</section></div></main></body>`);
      for (const file of ['staff.css', 'studio.css', 'studio-dark.css']) {
        await page.addStyleTag({ path: path.resolve(__dirname, '../css', file) });
      }
      const geometry = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { chart: box('[data-analytics]'), bookings: box('[data-bookings]'), team: box('[data-dashboard-team]'), reports: getComputedStyle(document.querySelector('.reports-layout')).gridTemplateColumns, sidebar: getComputedStyle(document.querySelector('.sidebar')).justifyContent };
      });
      assert(geometry.bookings.y >= geometry.chart.bottom, 'Bookings must follow the full-width chart');
      assert(geometry.team.y >= geometry.bookings.bottom, 'Team must follow bookings');
      assert.equal(geometry.reports.split(' ').length, 1, 'Reports must have one main column');
      if (width > 1260) assert.equal(geometry.sidebar, 'flex-start');
      await page.screenshot({ path: path.resolve(__dirname, `../outputs/admin-flow-${width}.png`), fullPage: true });
      await page.close();
    }
    console.log('Admin vertical section order and navigation spacing passed at desktop and mobile widths');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
