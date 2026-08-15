const { state, barbers, nav, initHeader, adminSidebar, peso, save, toast, api } = BarberCo;

async function getAnalytics() {
  try {
    return await api("/admin/analytics");
  } catch (error) {
    if (error.message.includes("Admin") && !BarberCo.canAccess("admin")) location.href = "login.html";
    const appointmentRevenue = state.appointments.filter((item) => item.paid).reduce((sum, item) => sum + BarberCo.byId(state.services, item.serviceId).price, 0);
    const walkInRevenue = state.queue.filter((item) => item.paid).reduce((sum, item) => sum + Number(item.price || 0), 0);
    return {
      totals: {
        customers: state.accounts.length,
        bookings: state.appointments.length,
        walkins: state.queue.length,
        revenue: appointmentRevenue + walkInRevenue,
        waiting: state.queue.filter((item) => item.status === "waiting").length
      },
      barbers,
      services: state.services
    };
  }
}

function callNextLocal() {
  const current = state.queue.find((item) => item.status === "serving");
  if (current) return toast(`Finish or cancel queue #${String(current.queueNumber).padStart(2, "0")} before calling the next walk-in.`);
  const next = state.queue.filter((item) => item.status === "waiting").sort((a, b) => a.queueNumber - b.queueNumber)[0];
  if (!next) return toast("No waiting walk-ins.");
  next.status = "serving";
  next.calledAt = new Date().toISOString();
  save();
  toast(`Now serving queue #${String(next.queueNumber).padStart(2, "0")}.`);
  render();
}

async function render() {
  const analytics = await getAnalytics();
  if (analytics.barbers) {
    state.barbers.splice(0, state.barbers.length, ...analytics.barbers);
    save();
  }
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("dashboard")}
      <div class="workspace">
        <p class="eyebrow">Admin Dashboard</p><h1>Shop overview</h1>
        <div class="grid-4"><article class="metric"><span>Total customers</span><strong>${analytics.totals.customers}</strong><small class="muted">Registered accounts</small></article><article class="metric"><span>Bookings</span><strong>${analytics.totals.bookings}</strong><small class="muted">All appointments</small></article><article class="metric"><span>Total earnings</span><strong>${peso(analytics.totals.revenue)}</strong><small class="muted">Verified payments</small></article><article class="metric"><span>Waiting walk-ins</span><strong>${analytics.totals.waiting}</strong><small class="muted">Live queue</small></article></div>
        <div class="grid-2 section"><div class="panel"><h3>Barbers monitoring</h3>${state.barbers.length ? state.barbers.map((barber) => `<div class="summary-list"><div><span>${barber.name}</span><strong>${barber.status || "active"}</strong></div></div>`).join("") : `<div class="empty-state">No barbers added yet.</div>`}<a class="button secondary full" href="admin-barbers.html">Manage barbers</a></div><form class="panel" data-quick-service><h3>Queue and services</h3><button class="button primary full" type="button" data-call-next>Call next walk-in</button><label>New service name<input name="name" required placeholder="New package"></label><label>Price<input type="number" name="price" required placeholder="250"></label><button class="button secondary full" type="submit">Add service</button></form></div>
      </div>
    </section>
  `;
  document.querySelector("[data-call-next]").addEventListener("click", async () => {
    try {
      const payload = await api("/admin/queue/next", { method: "POST", body: "{}" });
      toast(payload.ticket ? `Now serving queue #${payload.ticket.queueNumber}.` : "No waiting walk-ins.");
      render();
    } catch (error) {
      callNextLocal();
    }
  });
  document.querySelector("[data-quick-service]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const id = data.get("name").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const service = { id, name: data.get("name"), price: Number(data.get("price")), duration: "30 min", detail: "New service package.", icon: "NEW" };
  try {
    await api("/admin/services", { method: "POST", body: JSON.stringify(service) });
    toast("Service added.");
    render();
  } catch (error) {
    state.services.push(service);
    state.selectedServiceId = id;
    save();
    toast(error.message || "Service added locally.");
    event.target.reset();
  }
  });
  initHeader("admin");
}

render();
