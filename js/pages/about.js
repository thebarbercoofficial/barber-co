const { nav, shopEndcap, initHeader } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("about")}
  <section class="section top alt">
    <div class="feature-layout">
      <div><p class="eyebrow">Who We Are</p><h2>Modern grooming, organized from booking to finish.</h2><p class="muted">The Barber Co system supports the shop by replacing manual logbooks with online scheduling, queue monitoring, payment proof, and cleaner operational records.</p></div>
      <div class="grid-3">
        <article class="card"><p class="eyebrow">01</p><h3>Expert Barbers</h3><p class="muted">Customers select preferred staff and available time slots.</p></article>
        <article class="card"><p class="eyebrow">02</p><h3>Premium Experience</h3><p class="muted">Services are presented with prices, durations, and descriptions.</p></article>
        <article class="card"><p class="eyebrow">03</p><h3>Customer Focus</h3><p class="muted">Queue updates help reduce long waits and overbooking.</p></article>
      </div>
    </div>
  </section>
  ${shopEndcap({ eyebrow: "Our space", title: "A comfortable place to take your turn.", copy: "The shop is warm, practical, and built around the craft. Come in for the cut, stay for the conversation, and let the queue handle the timing.", href: "queue.html", label: "Check the queue" })}
`;
initHeader("about");
