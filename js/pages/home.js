const { state, barbers, nav, shopEndcap, initHeader, peso, api, loadCatalog, safeText } = BarberCo;
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
      <h1>The Barber Co</h1>
      <p class="hero-copy">Your cut. Your barber. Your time.<br>Reserve a chair or check the walk-in queue.</p>
      <div class="hero-actions">
        <a class="button primary" href="booking.html">Reserve a slot</a>
        <a class="button secondary" href="queue.html?walkin=1">Join walk-in</a>
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
        <h2>Your neighborhood barbershop.</h2>
        <p>Visit us on JM Loyola Street in Carmona for classic cuts, fades, beard grooming, and a fresh finish.</p>
        <div class="shop-specs">
          <div><strong>Since 2022</strong><span>Local barbershop</span></div>
          <div><strong>Carmona</strong><span>Cavite, Philippines</span></div>
          <div><strong>Walk-ins</strong><span>Scan, join, relax</span></div>
        </div>
        <a class="button primary" href="about.html">Get to know the shop</a>
      </div>
    </div>
  </section>
  <section class="section home-services">
    <div class="section-heading"><p class="eyebrow">Packages</p><h2>Popular services.</h2></div>
    <div class="service-menu">
      ${state.services.map((item) => `<article class="service-card"><h3>${item.name}</h3><strong class="price">${peso(item.price)}</strong><p class="muted service-description">${item.detail}</p><small class="muted service-duration">${item.duration}</small><a class="button primary small" href="booking.html?service=${item.id}">Book this</a></article>`).join("")}
    </div>
  </section>
  ${shopEndcap({ href: 'booking.html', label: 'Book an appointment' })}
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
