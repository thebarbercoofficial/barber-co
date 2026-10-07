const { state, barbers, nav, initHeader, peso, api, loadCatalog, safeText } = BarberCo;
let queueRefreshInProgress = false;
let lastQueueSnapshot = '';

function queuePreview(queue) {
  const serving = queue.find((ticket) => ticket.status === 'serving');
  const waiting = queue.filter((ticket) => ticket.status === 'waiting').sort((a, b) => Number(a.queueNumber) - Number(b.queueNumber));
  const current = serving || waiting[0];
  if (!current) return '<p><span class="status-dot"></span>Queue ready</p><h3>No active queue yet</h3><p>Customers will appear here when they join the shop queue.</p>';
  const service = state.services.find((item) => item.id === current.serviceId || item.mongoId === current.serviceId);
  const barber = barbers.find((item) => item.id === current.barberId || item.mongoId === current.barberId);
  return `<p><span class="status-dot"></span>${serving ? 'Now serving' : 'Next in line'}</p><h3>Queue #${safeText(String(current.queueNumber).padStart(2, '0'))}</h3><p class="home-queue-customer">${safeText(current.customer)}</p><p class="home-queue-detail">${safeText(current.cutName || service?.name || 'Service assigned at the counter')}<br>${safeText(barber?.name || 'Barber not assigned yet')}</p>${serving && waiting[0] ? `<div class="home-queue-next"><span>Up next</span><strong>#${safeText(String(waiting[0].queueNumber).padStart(2, '0'))} / ${safeText(waiting[0].customer)}</strong></div>` : ''}`;
}

async function refreshQueue() {
  if (queueRefreshInProgress || document.hidden) return;
  queueRefreshInProgress = true;
  const panel = document.querySelector('[data-home-queue]');
  try {
    const { queue = [] } = await api('/queue', { cache: 'no-store' });
    const next = queuePreview(queue);
    if (next !== lastQueueSnapshot && panel) panel.innerHTML = next;
    lastQueueSnapshot = next;
  } catch {
    if (panel) panel.innerHTML = '<p>Live queue unavailable</p><h3>Unable to check the queue</h3><p>Please try again shortly or check with the front desk.</p>';
    lastQueueSnapshot = '';
  } finally { queueRefreshInProgress = false; }
}

document.querySelector("#app").innerHTML = `
  ${nav("home")}
  <section class="hero hero-store">
    <div class="hero-content">
      <p class="eyebrow">Carmona, Cavite</p>
      <h1>Book sharp cuts without the long wait.</h1>
      <p class="hero-copy">Book a cut, choose a service, and follow your place in line from any phone, tablet, or desktop. The team can manage walk-ins, barber availability, payment proof, and live queue updates from the shop.</p>
      <div class="hero-actions">
        <a class="button primary" href="booking.html">Reserve a slot</a>
        <a class="button ghost" href="queue.html">Check queue</a>
      </div>
    </div>
    <aside class="status-panel" data-home-queue role="status" aria-live="polite" aria-label="Live shop queue">
      <p>Live queue</p><h3>Checking the shop queue...</h3>
    </aside>
  </section>
  <section class="section shop-section">
    <div class="shop-showcase">
      <figure class="shop-photo">
        <img src="images/shop-interior.png" alt="The Barber Co barbershop interior with black barber chairs and oak flooring">
        <figcaption>Inside The Barber Co, Carmona</figcaption>
      </figure>
      <div class="shop-copy">
        <p class="eyebrow">The shop</p>
        <h2>Warm oak. Sharp lines. A proper barbershop.</h2>
        <p>Come into a space built for good conversations, clean fades, and a comfortable wait. The digital queue keeps the front desk moving while the shop stays focused on the craft.</p>
        <div class="shop-specs">
          <div><strong>Since 2022</strong><span>Local barbershop</span></div>
          <div><strong>Carmona</strong><span>Cavite, Philippines</span></div>
          <div><strong>Walk-ins</strong><span>Scan, join, relax</span></div>
        </div>
        <a class="button primary" href="about.html">Get to know the shop</a>
      </div>
    </div>
  </section>
  <section class="section alt">
    <div class="feature-layout">
      <div><p class="eyebrow">Who We Are</p><h2>Modern grooming, organized from booking to finish.</h2><p class="muted">The Barber Co system replaces manual logbooks and social media scheduling with a clear online flow that works across phones, tablets, and desktops for appointments, walk-ins, barber availability, and customer updates.</p></div>
      <div class="grid-3">
        <article class="card"><p class="eyebrow">01</p><h3>Expert Barbers</h3><p class="muted">Customers choose a preferred barber and available time slot.</p></article>
        <article class="card"><p class="eyebrow">02</p><h3>Premium Experience</h3><p class="muted">Packages, prices, duration, and requests are visible before booking.</p></article>
        <article class="card"><p class="eyebrow">03</p><h3>Customer Focus</h3><p class="muted">Queue status and appointment updates reduce waiting and confusion.</p></article>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="section-heading"><p class="eyebrow">Packages</p><h2>Popular services.</h2></div>
    <div class="grid-5">
      ${state.services.map((item) => `<article class="service-card"><span class="service-icon">${item.icon}</span><h3>${item.name}</h3><p class="muted">${item.detail}</p><small class="muted">${item.duration}</small><strong class="price">${peso(item.price)}</strong><a class="button primary small" href="booking.html?service=${item.id}">Book this</a></article>`).join("")}
    </div>
  </section>
`;

initHeader("home");
refreshQueue();
loadCatalog().catch(() => {}).then(refreshQueue);
let queueTimer = window.setInterval(refreshQueue, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQueue(); });
window.addEventListener('pagehide', () => window.clearInterval(queueTimer));
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { refreshQueue(); queueTimer = window.setInterval(refreshQueue, 5000); }
});
