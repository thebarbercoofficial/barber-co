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

function compactGroupDetails(item) {
  if (!(Number(item.partySize) > 1)) return '';
  const names = Array.isArray(item.partyMembers) ? item.partyMembers.map(safeText).join(', ') : '';
  const duration = Number(item.durationMinutes);
  return `<small style="overflow-wrap:anywhere">Group of ${Number(item.partySize)}${names ? `: ${names}` : ''}</small><small>${Number.isFinite(duration) && duration > 0 ? `${duration} minutes / ` : ''}Sequential, same barber / ${peso(item.total)} total / one group fee</small><small>Actions apply to the whole group.</small>`;
}

function onlineBookingRows(appointments = [], reservations = []) {
  const activity = [
    ...reservations.map((item) => ({ ...item, activityStatus: 'Payment draft / no capacity reserved' })),
    ...appointments.filter((item) => ['pending', 'confirmed'].includes(item.status)).map((item) => ({ ...item, activityStatus: `${item.demoPayment ? 'Test / ' : ''}${item.status === 'confirmed' ? 'Accepted' : 'Needs review / no capacity reserved'}` }))
  ].sort((a, b) => new Date(b.createdAt || b.expiresAt || 0) - new Date(a.createdAt || a.expiresAt || 0));

  return activity.slice(0, 6).map((item) => `<div class="compact-row"><div class="row-main"><strong>${safeText(item.customer)}</strong><small>${safeText(item.date)} / ${safeText(item.time)}</small>${compactGroupDetails(item)}${item.request ? `<small><strong>Customer request:</strong> ${safeText(item.request)}</small>` : ''}</div><span class="status-pill ${item.status === 'pending' ? 'pending' : 'waiting'}">${item.activityStatus}</span><a class="button secondary small" href="admin-schedule.html">Review</a></div>`).join('') || `<div class="staff-empty compact">${icon('CalendarCheck')}<strong>No active online bookings</strong></div>`;
}

async function render() {
  const summaries = Promise.allSettled([api('/admin/queue'), api('/admin/appointments')]);
  const analytics = await getAnalytics();
  const results = await summaries;
  const queue = results[0].status === 'fulfilled' ? results[0].value.queue.filter((item) => ['waiting', 'serving'].includes(item.status)) : [];
  const schedule = results[1].status === 'fulfilled' ? results[1].value : { appointments: [], reservations: [] };
  const requests = schedule.appointments.filter((item) => item.status === 'pending');
  const reservations = schedule.reservations || [];
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
        <div class="dashboard-layout"><div><section class="panel"><div class="panel-heading"><h3>At the front desk <span class="count-badge">${queue.length}</span></h3><a class="text-action" href="admin-logbook.html">View queue ${icon('ArrowUpRight')}</a></div>${queue.length ? queue.slice(0, 6).map((item) => `<div class="compact-row"><span class="ticket-number">#${String(item.queueNumber).padStart(2, '0')}</span><div class="row-main"><strong>${safeText(item.customer)}</strong><small>${safeText(item.cutName || 'Service to be assigned')}</small></div><span class="status-pill ${item.status}">${item.status === 'serving' ? 'Serving' : 'Waiting'}</span></div>`).join('') : `<div class="staff-empty">${icon('ListOrdered')}<strong>${results[0].status === 'rejected' ? 'Queue could not load' : 'The line is clear'}</strong><span>Add a walk-in at the front desk or open the shop QR.</span></div>`}<div class="panel-actions"><button class="button primary" type="button" data-call-next ${!queue.some((item) => item.status === 'waiting') || queue.some((item) => item.status === 'serving') ? 'disabled' : ''}>${icon('Megaphone')} Call next</button><a class="button secondary" href="printables/walk-in-qr.html" target="_blank" rel="noreferrer">${icon('QrCode')} Shop QR</a></div></section><section class="panel"><div class="panel-heading"><h3>Awaiting payment verification <span class="count-badge">${requests.length}</span></h3><a class="text-action" href="admin-schedule.html">Review ${icon('ArrowUpRight')}</a></div>${requests.length ? requests.slice(0, 4).map((item) => `<div class="compact-row"><div class="row-main"><strong>${safeText(item.customer)}</strong><small>${safeText(item.date)} / ${safeText(item.time)}</small>${item.request ? `<small><strong>Customer request:</strong> ${safeText(item.request)}</small>` : ''}</div><strong>${peso(item.total)}</strong><a class="button secondary small" href="admin-schedule.html">Review</a></div>`).join('') : `<div class="staff-empty compact">${icon('CalendarCheck')}<strong>${results[1].status === 'rejected' ? 'Requests could not load' : 'No pending requests'}</strong></div>`}</section></div><div><section class="panel"><div class="panel-heading"><h3>Team availability</h3><a class="text-action" href="admin-barbers.html" aria-label="Manage barbers">${icon('ArrowUpRight')}</a></div>${state.barbers.length ? state.barbers.map((barber) => `<div class="compact-row"><span class="staff-avatar">${BarberCo.initials(barber.name)}</span><div class="row-main"><strong>${safeText(barber.name)}</strong><small>${safeText(barber.role || 'Barber')}</small></div><span class="status-pill ${barber.status || 'active'}">${barber.status === 'on-leave' ? 'On leave' : barber.status === 'fired' ? 'Inactive' : 'Active'}</span></div>`).join('') : `<div class="staff-empty compact"><strong>No barbers added</strong><a href="admin-barbers.html">Add your team</a></div>`}</section><form class="panel" data-quick-service><div class="panel-heading"><h3>Add a service</h3>${icon('Scissors')}</div><label>Service name<input name="name" required placeholder="e.g. Basic haircut"></label><label>Price (PHP)<input type="number" min="0" name="price" required placeholder="150"></label><button class="button secondary full" type="submit">${icon('Plus')} Add service</button></form></div></div>
      </div>
    </section>
  `;
  const onlinePanel = document.querySelector('.dashboard-layout > div:first-child > section:nth-of-type(2)');
  onlinePanel.dataset.onlineActivity = '';
  onlinePanel.innerHTML = `<div class="panel-heading"><h3>Online bookings <span class="count-badge">${schedule.appointments.filter((item) => ['pending', 'confirmed'].includes(item.status)).length + reservations.length}</span></h3><a class="text-action" href="admin-schedule.html">Review ${icon('ArrowUpRight')}</a></div>${onlineBookingRows(schedule.appointments, reservations)}`;
  document.querySelector('[data-call-next]').disabled = !queue.some(item => item.status === 'waiting');
  document.querySelector("[data-call-next]").addEventListener("click", async () => {
    try {
      const payload = await api("/admin/queue/next", { method: "POST", body: "{}" });
      toast(payload.ticket ? `Now serving queue #${payload.ticket.queueNumber}.` : "No customer fits an available barber right now.");
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
  const metricKeys = ['customers', 'bookings', 'revenue', 'waiting'];
  document.querySelectorAll('.metric-grid .metric').forEach((node, index) => { node.dataset.metric = metricKeys[index]; });
  if (results[1].status === 'fulfilled') updateBookingMetric(schedule.appointments);
  document.querySelector('[data-metric="revenue"] small').textContent = 'All time / recorded paid / excludes tests';
  document.querySelector('[data-metric="customers"] small').textContent = 'Customer accounts / excludes staff';
  document.querySelector('[data-metric="waiting"] .metric-label').firstChild.textContent = 'Waiting walk-ins';
  document.querySelector('[data-metric="waiting"] small').textContent = 'Waiting only / excludes now serving';
  document.querySelector('.workspace-heading').insertAdjacentHTML('beforeend', '<small data-dashboard-sync role="status">Live updates connected</small>');
}

render();
function updateBookingMetric(appointments) {
  const target = document.querySelector('[data-metric="bookings"]');
  const demos = appointments.filter((item) => item.demoPayment).length;
  target.querySelector('strong').textContent = appointments.length;
  target.querySelector('small').textContent = `All appointments / ${demos} test bookings`;
}
let dashboardBusy = false;
async function refreshDashboard() {
  if (dashboardBusy || document.hidden || !document.querySelector('[data-dashboard-sync]')) return;
  dashboardBusy = true;
  try {
    const [analyticsResult, lineResult, scheduleResult] = await Promise.allSettled([api('/admin/analytics'), api('/admin/queue'), api('/admin/appointments')]);
    let receivedUpdate = false;
    if (analyticsResult.status === 'fulfilled') {
      const analytics = analyticsResult.value;
      ['customers', 'revenue', 'waiting'].forEach((key) => {
        document.querySelector(`[data-metric="${key}"] strong`).textContent = key === 'revenue' ? peso(analytics.totals[key]) : analytics.totals[key];
      });
      BarberAnalytics.refresh?.(analytics);
      receivedUpdate = true;
    }
    const panels = document.querySelectorAll('.dashboard-layout > div:first-child > section');
    let active = null;
    if (lineResult.status === 'fulfilled') {
      active = lineResult.value.queue.filter((item) => ['waiting', 'serving'].includes(item.status));
      const panel = panels[0];
      panel.querySelector('.count-badge').textContent = active.length;
      panel.querySelectorAll('.compact-row,.staff-empty').forEach((node) => node.remove());
      const markup = active.slice(0, 6).map((item) => `<div class="compact-row"><span class="ticket-number">#${String(item.queueNumber).padStart(2, '0')}</span><div class="row-main"><strong>${safeText(item.customer)}</strong><small>${safeText(item.cutName || 'Service to be assigned')}</small></div><span class="status-pill ${item.status}">${item.status === 'serving' ? 'Serving' : 'Waiting'}</span></div>`).join('') || `<div class="staff-empty">${icon('ListOrdered')}<strong>The line is clear</strong></div>`;
      panel.querySelector('.panel-heading').insertAdjacentHTML('afterend', markup);
      document.querySelector('[data-call-next]').disabled = !active.some((item) => item.status === 'waiting');
      receivedUpdate = true;
    }
    if (scheduleResult.status === 'fulfilled') {
      const schedule = scheduleResult.value;
      const appointments = schedule.appointments || [];
      const reservations = schedule.reservations || [];
      updateBookingMetric(appointments);
      const panel = document.querySelector('[data-online-activity]');
      panel.querySelector('.count-badge').textContent = appointments.filter((item) => ['pending', 'confirmed'].includes(item.status)).length + reservations.length;
      panel.querySelectorAll('.compact-row,.staff-empty').forEach((node) => node.remove());
      panel.querySelector('.panel-heading').insertAdjacentHTML('afterend', onlineBookingRows(appointments, reservations));
      receivedUpdate = true;
    }
    const failures = [analyticsResult, lineResult, scheduleResult].filter((result) => result.status === 'rejected');
    if (failures.some((result) => [401, 403].includes(result.reason?.status))) {
      location.replace('login.html');
      return;
    }
    const sync = document.querySelector('[data-dashboard-sync]');
    sync.textContent = failures.length ? (receivedUpdate ? `Partially updated ${new Date().toLocaleTimeString()}` : 'Connection interrupted; showing last update') : `Updated ${new Date().toLocaleTimeString()}`;
  } finally { dashboardBusy = false; }
}
setInterval(refreshDashboard, 3000);
document.addEventListener('visibilitychange', refreshDashboard);
window.addEventListener('focus', refreshDashboard);
