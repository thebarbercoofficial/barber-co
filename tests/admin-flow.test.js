const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [1920, 1440, 1366, 1024, 768, 390, 360]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(`<body class="staff-page"><aside class="sidebar"><div class="sidebar-shop">Shop</div><div class="sidebar-group"><p>Daily operations</p><a>Dashboard</a><a>Staff Logbook</a></div></aside><main class="workspace studio-dashboard"><div class="dashboard-layout"><div><section data-analytics><div class="chart-frame"></div></section></div><div><section class="panel" data-bookings>Bookings</section></div><section data-dashboard-team>Team</section></div><div class="reports-layout"><section>Chart</section><section class="report-services">Services</section></div></main></body>`);
      for (const file of ['styles.css', 'staff.css', 'studio.css', 'studio-dark.css']) {
        await page.addStyleTag({ path: path.resolve(__dirname, '../css', file) });
      }
      const geometry = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { chart: box('[data-analytics]'), bookings: box('[data-bookings]'), team: box('[data-dashboard-team]'), reports: getComputedStyle(document.querySelector('.reports-layout')).gridTemplateColumns, sidebar: getComputedStyle(document.querySelector('.sidebar')).justifyContent };
      });
      assert(geometry.bookings.y >= geometry.chart.bottom, 'Bookings must follow the full-width chart');
      assert(geometry.team.y >= geometry.bookings.bottom, 'Team must follow bookings');
      assert.equal(geometry.reports.split(' ').length, 1, 'Reports must have one main column');
      if (width >= 1440) assert.equal(geometry.sidebar, 'flex-start', `Navigation spacing at ${width}px`);
      await page.locator('.workspace').evaluate(node => {
        node.innerHTML += `<div class="frontdesk-layout"><form class="panel" data-logbook-form><div class="panel-heading"><h3>Check in a customer</h3></div><label>Customer name<input placeholder="Name"></label><label>Service<select><option>Classic Haircut - PHP 150.00</option></select></label><div class="form-row"><label>Price<input value="150"></label><label>Estimated wait minutes<input value="30"></label></div><button class="button">Add to queue</button></form><section><div class="list-toolbar"><input placeholder="Find customer"><select><option>Active customers</option></select></div><div class="queue-list"><article class="appointment-row"><span>Queue #52</span><div class="row-main">Customer with a long name</div><span class="queue-barber">Assigned barber</span><span class="status-pill">Now serving</span><div class="button-row"><button class="button">Serving</button><button class="button">Paid / done</button><button class="button">Cancel</button></div></article></div></section></div>`;
      });
      const responsive = await page.evaluate(() => ({
        border: getComputedStyle(document.querySelector('[data-logbook-form]')).borderTopWidth,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        fields: [...document.querySelectorAll('[data-logbook-form] input')].every(input => input.getBoundingClientRect().right <= document.querySelector('.workspace').getBoundingClientRect().right)
      }));
      assert.equal(responsive.border, '1px', 'Form boundaries must be visible');
      assert.equal(responsive.overflow, false, `Page must not overflow at ${width}px`);
      assert(responsive.fields, 'Fields must stay inside the workspace');
      await page.locator('.workspace').evaluate(node => {
        node.innerHTML += `<div class="list-toolbar appointment-toolbar"><div class="filter-tabs">${Array.from({ length: 14 }, () => '<button>Booking status <span>12</span></button>').join('')}</div><label class="search-field"><input placeholder="Find a booking"></label></div>`;
        node.innerHTML += '<div class="record-list"><article class="appointment-row appointment-record"><div class="appointment-date">2026-11-18</div><div class="row-main"><strong>Customer booking</strong><small>Classic haircut / Assigned barber</small></div><div><strong>PHP 300.00</strong><small>Booking total</small></div><span class="status-pill pending">Pending / needs review</span><span class="button-row"><button class="icon-button">R</button><button class="button primary">Verify / accept</button><button class="icon-button">X</button></span></article></div>';
      });
      assert(await page.locator('.appointment-toolbar').evaluate(el => el.getBoundingClientRect().height < 160), 'Toolbar must not inherit a tall search flex-basis');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Filters must scroll inside the page at ${width}px`);
      const record = await page.locator('.appointment-record').evaluate(row => {
        const boxes = [...row.children].map(el => el.getBoundingClientRect());
        return { overlap: boxes.some((a, i) => boxes.slice(i + 1).some(b => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1)), overflow: row.scrollWidth > row.clientWidth + 1 };
      });
      assert.equal(record.overlap, false, `Appointment columns overlap at ${width}px`);
      assert.equal(record.overflow, false, `Appointment record overflows at ${width}px`);
      await page.screenshot({ path: path.resolve(__dirname, `../outputs/admin-flow-${width}.png`), fullPage: true });
      await page.close();
    }
    console.log('Admin vertical section order and navigation spacing passed at desktop and mobile widths');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
