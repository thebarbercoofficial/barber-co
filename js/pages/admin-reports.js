const { state, nav, initHeader, adminSidebar, byId, peso, save, toast } = BarberCo;
const completed = state.appointments.filter((item) => item.status === "Completed").length;
const pending = state.appointments.filter((item) => item.status === "Pending").length;
const cancelled = state.appointments.filter((item) => item.status === "Cancelled" || item.status === "No-show").length;
const revenue = state.appointments.filter((item) => item.paid).reduce((sum, item) => sum + byId(state.services, item.serviceId).price, 0);
document.querySelector("#app").innerHTML = `
  ${nav("admin")}
  <section class="app-shell">
    ${adminSidebar("reports")}
    <div class="workspace">
      <p class="eyebrow">Reports Records</p><h1>Performance reports</h1>
      <form class="panel" data-report><label>Filter date<input type="date" name="date" value="${state.reportDate}"></label><button class="button primary" type="submit">Apply filter</button></form>
      <div class="grid-4"><article class="metric"><span>Total bookings</span><strong>${state.appointments.length}</strong><small class="muted">${state.reportDate}</small></article><article class="metric"><span>Completed</span><strong>${completed}</strong><small class="muted">Finished cuts</small></article><article class="metric"><span>Pending</span><strong>${pending}</strong><small class="muted">Needs action</small></article><article class="metric"><span>Revenue</span><strong>${peso(revenue)}</strong><small class="muted">Verified only</small></article></div>
      <div class="grid-2 section"><div class="panel"><h3>Appointment status</h3><div class="report-bars"><div class="bar"><span><b>Completed</b><b>${completed}</b></span><i style="width:${Math.max(12, completed * 25)}%"></i></div><div class="bar"><span><b>Pending</b><b>${pending}</b></span><i style="width:${Math.max(12, pending * 25)}%"></i></div><div class="bar"><span><b>Cancelled/No-show</b><b>${cancelled}</b></span><i style="width:${Math.max(12, cancelled * 25)}%"></i></div></div></div><div class="panel"><h3>Service breakdown</h3>${state.services.map((service) => { const count = state.appointments.filter((item) => item.serviceId === service.id).length; return `<div class="summary-list"><div><span>${service.name}</span><strong>${count} bookings - ${peso(count * service.price)}</strong></div></div>`; }).join("")}</div></div>
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
