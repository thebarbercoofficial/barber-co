const { state, barbers, nav, initHeader, byId, peso } = BarberCo;
const current = state.appointments.find((item) => item.status === "Ongoing") || state.appointments[0];
const service = current ? byId(state.services, current.serviceId) : null;
const barber = current ? byId(barbers, current.barberId) : null;
const statusPanel = current
  ? `
    <p><span class="status-dot"></span>Now serving</p>
    <h3>Queue #${String(current.id).padStart(2, "0")}</h3>
    <p>${service.name} with ${barber.name}</p>
  `
  : `
    <p><span class="status-dot"></span>Queue ready</p>
    <h3>No active queue yet</h3>
    <p>Walk-ins and bookings will appear once staff starts serving customers.</p>
  `;

document.querySelector("#app").innerHTML = `
  ${nav("home")}
  <section class="hero hero-store">
    <div class="hero-content">
      <p class="eyebrow">Carmona, Cavite</p>
      <h1>Book sharp cuts without the long wait.</h1>
      <p class="hero-copy">A mobile-responsive appointment system for The Barber Co with service selection, barber schedules, reservation payment proof, and live queue updates.</p>
      <div class="hero-actions">
        <a class="button primary" href="booking.html">Reserve a slot</a>
        <a class="button ghost" href="queue.html">Check queue</a>
      </div>
    </div>
    <aside class="status-panel">
      ${statusPanel}
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
      <div><p class="eyebrow">Who We Are</p><h2>Modern grooming, organized from booking to finish.</h2><p class="muted">The Barber Co system replaces manual logbooks and social media scheduling with a clear online flow for appointments, walk-ins, barber availability, and customer updates.</p></div>
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
