const { state, nav, initHeader, adminSidebar, peso, save, toast, api } = BarberCo;

async function render() {
  let analytics;
  try {
    analytics = await api("/admin/analytics");
  } catch (error) {
    if (error.message.includes("Admin")) location.href = "login.html";
    const revenue = state.appointments.filter((item) => item.paid).reduce((sum, item) => sum + BarberCo.byId(state.services, item.serviceId).price, 0);
    analytics = { totals: { bookings: state.appointments.length, waiting: 0, customers: 0, revenue }, services: state.services.map((service) => ({ ...service, bookings: state.appointments.filter((item) => item.serviceId === service.id).length })) };
  }
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("reports")}
      <div class="workspace">
        <p class="eyebrow">Reports Records</p><h1>Performance reports</h1>
        <form class="panel" data-report><label>Filter date<input type="date" name="date" value="${state.reportDate}"></label><button class="button primary" type="submit">Apply filter</button></form>
        <div class="grid-4"><article class="metric"><span>Total bookings</span><strong>${analytics.totals.bookings}</strong><small class="muted">${state.reportDate}</small></article><article class="metric"><span>Registered customers</span><strong>${analytics.totals.customers}</strong><small class="muted">Accounts</small></article><article class="metric"><span>Waiting walk-ins</span><strong>${analytics.totals.waiting}</strong><small class="muted">Live queue</small></article><article class="metric"><span>Revenue</span><strong>${peso(analytics.totals.revenue)}</strong><small class="muted">Verified only</small></article></div>
        <div class="grid-2 section"><div class="panel"><h3>Service bookings</h3><div class="report-bars">${analytics.services.map((service) => `<div class="bar"><span><b>${service.name}</b><b>${service.bookings || 0}</b></span><i style="width:${Math.max(12, (service.bookings || 0) * 18)}%"></i></div>`).join("")}</div></div><div class="panel"><h3>Service breakdown</h3>${analytics.services.map((service) => `<div class="summary-list"><div><span>${service.name}</span><strong>${service.bookings || 0} bookings - ${peso((service.bookings || 0) * service.price)}</strong></div></div>`).join("")}</div></div>
      </div>
    </section>
  `;
  document.querySelector("[data-report]").addEventListener("submit", (event) => {
  event.preventDefault();
  state.reportDate = new FormData(event.target).get("date");
  save();
  toast(`Reports filtered for ${state.reportDate}.`);
  });
  initHeader("admin");
}

render();
