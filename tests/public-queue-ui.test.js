// Isolated live-queue responses; no production records or Facebook messages are changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const services = [{ id: 'basic', name: 'Basic Haircut', price: 150, duration: '30 min', detail: 'Haircut', icon: 'CUT' }];
const barbers = [{ id: 'alex', name: 'Alex Santos', status: 'active' }];
const nickname = 'Miguel Alexander Dela Cruz With A Longer Call Name';
function contrast(a, b) {
  const luminance = (values) => values.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
async function main() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = process.env.PUBLIC_UI_BASE || `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const width of [1440, 900, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      let queue = [{ id: '000000000000000000000012', queueNumber: 12, customer: nickname, cutName: 'Basic Haircut', serviceId: 'basic', barberId: 'alex', status: 'serving' }, { id: '000000000000000000000013', queueNumber: 13, customer: 'Ria', cutName: 'Basic Haircut', status: 'waiting' }];
      let fail = false;
      let queueRequests = 0;
      await context.addInitScript(() => {
        localStorage.setItem('barberCoApiBase', 'https://barber-co-seven.vercel.app');
        localStorage.setItem('barberCoState', JSON.stringify({ appointments: [{ id: 99, customer: 'Stale appointment', status: 'Ongoing' }], queue: [{ queueNumber: 88, customer: 'Stale cached queue', status: 'serving' }] }));
      });
      await context.route('https://fonts.googleapis.com/**', (route) => route.abort());
      await context.route('https://fonts.gstatic.com/**', (route) => route.abort());
      await context.route('**/api/**', (route) => {
        const endpoint = new URL(route.request().url()).pathname;
        if (endpoint === '/api/catalog') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ services, barbers }) });
        assert.equal(endpoint, '/api/queue');
        queueRequests++;
        return route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { error: 'Isolated queue outage' } : { queue }) });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let navigations = 0;
      page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++; });
      await page.goto(`${base}/index.html`);
      await page.locator('[data-home-queue]').filter({ hasText: 'Queue #12' }).waitFor();
      await page.locator('[data-home-queue]').filter({ hasText: 'Alex Santos' }).waitFor();
      const preview = page.locator('[data-home-queue]');
      assert.ok((await preview.innerText()).includes(nickname));
      assert.ok((await preview.innerText()).includes('#13 / Ria'));
      assert.ok(!(await preview.innerText()).includes('Stale'));
      const panel = await preview.boundingBox();
      const content = await page.locator('.hero-content').boundingBox();
      assert.ok(panel.x >= content.x + content.width - 1 || panel.y >= content.y + content.height - 1, `Home queue overlaps booking content at ${width}px`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(root, `public-home-queue-${width}-check.png`), fullPage: true });
      queue = [{ ...queue[1], status: 'waiting', customer: 'Changed <b>call name</b>' }];
      await preview.filter({ hasText: 'Next in line' }).waitFor({ timeout: 8000 });
      assert.ok((await preview.innerText()).includes('Changed <b>call name</b>'));
      assert.equal(await preview.locator('b').count(), 0, 'Call names must render as text, not HTML');
      assert.ok(!(await preview.innerText()).includes('Now serving'));
      fail = true;
      await preview.filter({ hasText: 'Live queue unavailable' }).waitFor({ timeout: 8000 });
      assert.ok(!(await preview.innerText()).includes('Stale'));
      fail = false;
      queue = [];
      await preview.filter({ hasText: 'No active queue yet' }).waitFor({ timeout: 8000 });
      assert.ok(queueRequests >= 4);
      assert.equal(navigations, 1, 'Polling must not reload the Home page');
      await page.goto(`${base}/contact.html`);
      const facebook = page.locator('[data-facebook-contact]');
      await facebook.waitFor();
      await facebook.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      assert.equal(await facebook.getAttribute('href'), 'https://www.facebook.com/TheBarberCo.Carmona/');
      assert.equal(await facebook.getAttribute('target'), '_blank');
      for (const interaction of ['normal', 'hover', 'focus']) {
        if (interaction === 'hover') await facebook.hover();
        if (interaction === 'focus') await facebook.focus();
        const style = await facebook.evaluate((element) => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundImage }));
        const foreground = style.color.match(/\d+/g).slice(0, 3).map(Number);
        const colors = [...style.background.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)].map((match) => match.slice(1).map(Number));
        assert.equal(colors.length, 2);
        assert.ok(colors.every((background) => contrast(foreground, background) >= 4.5), `Facebook ${interaction} contrast fails at ${width}px`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(root, `public-facebook-${width}-check.png`), fullPage: true });
      assert.equal(errors.length, 0, errors.join(', '));
      await context.close();
      console.log(`Home live call name/number, auto-refresh/error/empty states, no overlaps, and Facebook contrast/link passed at ${width}px`);
    }
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
