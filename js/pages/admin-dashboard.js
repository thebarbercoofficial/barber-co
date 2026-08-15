const { state, barbers, nav, initHeader, adminSidebar, peso, save, toast } = BarberCo;
const totalRevenue = state.appointments.filter((item) => item.paid).reduce((sum, item) => sum + BarberCo.byId(state.services, item.serviceId).price, 0);
document.querySelector("#app").innerHTML = `
  ${nav("admin")}
  <section class="app-shell">
    ${adminSidebar("dashboard")}
    <div class="workspace">
      <p class="eyebrow">Admin Dashboard</p><h1>Shop overview</h1>
      <div class="grid-4"><article class="metric"><span>Total customers</span><strong>40</strong><small class="muted">+8% this week</small></article><article class="metric"><span>Customers today</span><strong>${state.appointments.length}</strong><small class="muted">Live queue count</small></article><article class="metric"><span>Total earnings</span><strong>${peso(totalRevenue)}</strong><small class="muted">Verified payments</small></article><article class="metric"><span>Pending requests</span><strong>${state.appointments.filter((item) => item.status === "Pending").length}</strong><small class="muted">Need action</small></article></div>
      <div class="grid-2 section"><div class="panel"><h3>Barbers monitoring</h3>${barbers.map((barber) => `<div class="summary-list"><div><span>${barber.name}</span><strong>${barber.status} - ${peso(barber.rate)}</strong></div></div>`).join("")}</div><form class="panel" data-quick-service><h3>Update monitoring</h3><label>New service name<input name="name" required placeholder="New package"></label><label>Price<input type="number" name="price" required placeholder="250"></label><button class="button primary full" type="submit">Add service</button></form></div>
    </div>
  </section>
`;
document.querySelector("[data-quick-service]").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const id = data.get("name").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  state.services.push({ id, name: data.get("name"), price: Number(data.get("price")), duration: "30 min", detail: "New service package.", icon: "NEW" });
  state.selectedServiceId = id;
  save();
  toast("Service added to static data.");
  event.target.reset();
});
initHeader("admin");
