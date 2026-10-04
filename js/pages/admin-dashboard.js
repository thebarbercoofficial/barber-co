const { state, barbers, nav, initHeader, adminSidebar, peso, save, toast, api, icon, safeText } = BarberCo;

if (!BarberCo.canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

async function getAnalytics() {
  try {
    return await api("/admin/analytics");
  } catch (error) {
    if (error.message.includes("Admin") && !BarberCo.canAccess("admin")) location.href = "login.html";
    return {
      connectionError: error.message,
      totals: {
        customers: 0, bookings: 0, walkins: 0, revenue: 0, waiting: 0
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
  const results = await Promise.allSettled([api('/admin/queue'), api('/admin/appointments')]);
  const queue = results[0].status === 'fulfilled' ? results[0].value.queue.filter((item) => ['waiting', 'serving'].includes(item.status)) : [];
  const requests = results[1].status === 'fulfilled' ? results[1].value.appointments.filter((item) => item.status === 'pending') : [];
  const dateLabel = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' }).format(new Date());
  if (analytics.barbers) {
    state.barbers.splice(0, state.barbers.length, ...analytics.barbers);
    save();
  }
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("dashboard")}
      <div class="workspace">
        <div class="workspace-heading"><div><p class="eyebrow">DAILY OPERATIONS</p><h1>Shop overview</h1><p class="muted">${dateLabel}</p></div><a class="button primary" href="admin-logbook.html">${icon('ListOrdered')} Open front desk</a></div>
        ${analytics.connectionError ? `<div class="connection-error" role="alert">${safeText(analytics.connectionError)}</div>` : ''}
        <div class="grid-4 metric-grid">${[['Users', 'Customers', analytics.totals.customers, 'Registered accounts'], ['CalendarDays', 'Bookings', analytics.totals.bookings, 'All appointments'], ['Wallet', 'Collected revenue', peso(analytics.totals.revenue), 'Online + paid walk-ins'], ['ListOrdered', 'In the queue', analytics.totals.waiting, 'Waiting walk-ins']].map(([symbol, label, value, detail]) => `<article class="metric"><div class="metric-label">${label}${icon(symbol)}</div><strong>${analytics.connectionError ? '--' : value}</strong><small class="muted">${detail}</small></article>`).join('')}</div>
        ${BarberAnalytics.markup()}
        <div class="dashboard-layout"><div><section class="panel"><div class="panel-heading"><h3>At the front desk <span class="count-badge">${queue.length}</span></h3><a class="text-action" href="admin-logbook.html">View queue ${icon('ArrowUpRight')}</a></div>${queue.length ? queue.slice(0, 6).map((item) => `<div class="compact-row"><span class="ticket-number">#${String(item.queueNumber).padStart(2, '0')}</span><div class="row-main"><strong>${safeText(item.customer)}</strong><small>${safeText(item.cutName || 'Service to be assigned')}</small></div><span class="status-pill ${item.status}">${item.status === 'serving' ? 'Serving' : 'Waiting'}</span></div>`).join('') : `<div class="staff-empty">${icon('ListOrdered')}<strong>${results[0].status === 'rejected' ? 'Queue could not load' : 'The line is clear'}</strong><span>Add a walk-in at the front desk or open the shop QR.</span></div>`}<div class="panel-actions"><button class="button primary" type="button" data-call-next ${!queue.some((item) => item.status === 'waiting') || queue.some((item) => item.status === 'serving') ? 'disabled' : ''}>${icon('Megaphone')} Call next</button><a class="button secondary" href="printables/walk-in-qr.html" target="_blank" rel="noreferrer">${icon('QrCode')} Shop QR</a></div></section><section class="panel"><div class="panel-heading"><h3>Awaiting payment verification <span class="count-badge">${requests.length}</span></h3><a class="text-action" href="admin-schedule.html">Review ${icon('ArrowUpRight')}</a></div>${requests.length ? requests.slice(0, 4).map((item) => `<div class="compact-row"><div class="row-main"><strong>${safeText(item.customer)}</strong><small>${item.date} / ${item.time}</small></div><strong>${peso(item.total)}</strong><a class="button secondary small" href="admin-schedule.html">Review</a></div>`).join('') : `<div class="staff-empty compact">${icon('CalendarCheck')}<strong>${results[1].status === 'rejected' ? 'Requests could not load' : 'No pending requests'}</strong></div>`}</section></div><div><section class="panel"><div class="panel-heading"><h3>Team availability</h3><a class="text-action" href="admin-barbers.html" aria-label="Manage barbers">${icon('ArrowUpRight')}</a></div>${state.barbers.length ? state.barbers.map((barber) => `<div class="compact-row"><span class="staff-avatar">${BarberCo.initials(barber.name)}</span><div class="row-main"><strong>${safeText(barber.name)}</strong><small>${safeText(barber.role || 'Barber')}</small></div><span class="status-pill ${barber.status || 'active'}">${barber.status === 'on-leave' ? 'On leave' : barber.status === 'fired' ? 'Inactive' : 'Active'}</span></div>`).join('') : `<div class="staff-empty compact"><strong>No barbers added</strong><a href="admin-barbers.html">Add your team</a></div>`}</section><form class="panel" data-quick-service><div class="panel-heading"><h3>Add a service</h3>${icon('Scissors')}</div><label>Service name<input name="name" required placeholder="e.g. Basic haircut"></label><label>Price (PHP)<input type="number" min="0" name="price" required placeholder="150"></label><button class="button secondary full" type="submit">${icon('Plus')} Add service</button></form></div></div>
      </div>
    </section>
  `;
  document.querySelector("[data-call-next]").addEventListener("click", async () => {
    try {
      const payload = await api("/admin/queue/next", { method: "POST", body: "{}" });
      toast(payload.ticket ? `Now serving queue #${payload.ticket.queueNumber}.` : "No waiting walk-ins.");
      render();
    } catch (error) { toast(error.message || "The next walk-in could not be called."); }
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
    toast(error.message || "Service could not be added.");
  }
  });
  initHeader("admin");
  BarberAnalytics.mount(analytics);
}

render();
