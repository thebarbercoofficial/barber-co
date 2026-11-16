const { nav, shopEndcap, initHeader } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("about")}
  <section class="section top alt">
    <div class="feature-layout">
      <div><p class="eyebrow">Carmona, Cavite / Since 2022</p><h2>A good cut, close to home.</h2><p class="muted">The Barber Co is your neighborhood stop for classic cuts, fades, and beard grooming. Find us at 1197 JM Loyola Street in Carmona.</p><img class="about-shop-image" src="images/shop-interior.png" alt="Barber chairs inside The Barber Co"></div>
      <div class="grid-3 about-benefits">
        <article class="card"><h3>Your barber</h3><p class="muted">Choose a member of our team or book with any available barber.</p><a href="barbers.html">Meet the team</a></article>
        <article class="card"><h3>Your service</h3><p class="muted">Haircuts, beard trims, and grooming packages with prices shown before you book.</p><a href="services.html">View services</a></article>
        <article class="card"><h3>Your time</h3><p class="muted">Reserve an appointment or join the walk-in line at the shop.</p><a href="queue.html">Check the queue</a></article>
      </div>
    </div>
  </section>
  ${shopEndcap({ eyebrow: "Our space", title: "A comfortable place to take your turn.", copy: "The shop is warm, practical, and built around the craft. Come in for the cut, stay for the conversation, and let the queue handle the timing.", href: "queue.html", label: "Check the queue" })}
`;
initHeader("about");
