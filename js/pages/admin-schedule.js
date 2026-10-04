const { state, barbers, nav, initHeader, adminSidebar, byId, peso, save, toast, api, loadCatalog, icon, safeText } = BarberCo;

if (!BarberCo.canAccess("moderator")) {
  location.replace("login.html");
  throw new Error("Staff access required.");
}

let lastSnapshot = "";
let refreshInProgress = false;
let statusFilter = 'all';
let latestConnectionError = '';

async function loadAppointments(refreshCatalog = false) {
  try {
    if (refreshCatalog) await loadCatalog();
    const data = await api("/admin/appointments");
    state.appointments = (data.appointments || []).map((item) => ({ ...item, id: item.mongoId, time: item.time || "Next available", status: item.status || "pending" }));
    save();
    return "";
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      BarberCo.clearSession();
      location.replace("login.html");
      return "Your staff session has expired.";
    }
    return error.message || "The appointment service is unavailable.";
  }
}

function appointmentRows(connectionError = "") {
  if (connectionError) return `<div class="connection-error" role="alert">${safeText(connectionError)} <button class="button secondary small" type="button" data-retry>Try again</button></div>`;
  const query = document.querySelector('[data-appointment-search]')?.value.toLowerCase().trim() || '';
  const items = state.appointments.filter((item) => (statusFilter === 'all' || (statusFilter === 'history' ? ['completed', 'cancelled'].includes(item.status) : item.status === statusFilter)) && (!query || `${item.customer} ${item.queueNumber} ${item.date}`.toLowerCase().includes(query)));
  return items.map((item) => `<div class="appointment-row appointment-record"><div class="appointment-date"><strong>${safeText(item.date || 'Unscheduled')}</strong><small>${safeText(item.time)} / #${String(item.queueNumber || '').padStart(2, '0')}</small></div><div class="row-main"><strong>${safeText(item.customer)}</strong><small>${safeText(byId(state.services, item.serviceId).name)} / ${safeText(item.barberId ? byId(barbers, item.barberId).name : 'Unassigned barber')}</small>${item.paymentProof ? `<a class="text-action" href="${item.paymentProof}" target="_blank" rel="noreferrer">${icon('Image')} Payment proof</a>` : ''}</div><div><strong>${peso(item.total || 0)}</strong><small class="muted">Advance payment</small></div><span class="status-pill ${item.status}">${item.status === 'pending' ? 'Needs review' : item.status === 'confirmed' ? 'Accepted' : item.status}</span><span class="button-row">${item.status === 'pending' ? `<button class="button primary small" type="button" data-status="${item.mongoId || item.id}:confirmed">${icon('Check')} Verify / accept</button>` : ''}${item.status === 'confirmed' ? `<button class="button secondary small" type="button" data-status="${item.mongoId || item.id}:completed">Complete</button>` : ''}${!['completed', 'cancelled'].includes(item.status) ? `<button class="icon-button danger-icon" type="button" data-status="${item.mongoId || item.id}:cancelled" aria-label="Cancel appointment" title="Cancel appointment">${icon('X')}</button>` : ''}</span></div>`).join('') || `<div class="staff-empty">${icon('CalendarDays')}<strong>No ${statusFilter === 'pending' ? 'pending ' : ''}appointments${query ? ' match your search' : ' here'}</strong><span>Submitted bookings appear here for payment verification.</span></div>`;
}

function snapshot(connectionError = "") {
  return JSON.stringify({ connectionError, statusFilter, appointments: state.appointments.map(({ id, status, updatedAt }) => ({ id, status, updatedAt })) });
}

function updatePanel(connectionError = "", force = false) {
  latestConnectionError = connectionError;
  const nextSnapshot = snapshot(connectionError);
  if (!force && nextSnapshot === lastSnapshot) return;
  lastSnapshot = nextSnapshot;
  const panel = document.querySelector("[data-appointment-panel]");
  if (panel) panel.innerHTML = appointmentRows(connectionError);
  document.querySelectorAll('[data-filter-count]').forEach((target) => {
    const filter = target.dataset.filterCount;
    target.textContent = state.appointments.filter((item) => filter === 'all' || (filter === 'history' ? ['completed', 'cancelled'].includes(item.status) : item.status === filter)).length;
  });
}

async function refreshAppointments({ force = false, refreshCatalog = false } = {}) {
  if (refreshInProgress) return;
  refreshInProgress = true;
  const connectionError = await loadAppointments(refreshCatalog);
  updatePanel(connectionError, force);
  const updated = document.querySelector("[data-last-updated]");
  if (updated && !connectionError) updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  refreshInProgress = false;
}

async function render() {
  const connectionError = await loadAppointments(true);
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("schedule")}
      <div class="workspace">
        <div class="workspace-heading"><div><p class="eyebrow">RESERVATIONS</p><h1>Appointments</h1><p class="muted">Review payment proof and manage incoming bookings.</p></div><small class="sync-indicator" data-last-updated>Live updates on</small></div>
        <div class="list-toolbar appointment-toolbar"><div class="filter-tabs" role="group" aria-label="Appointment status">${[['all', 'All bookings'], ['pending', 'Needs review'], ['confirmed', 'Accepted'], ['history', 'History']].map(([key, label]) => `<button type="button" data-filter="${key}" aria-pressed="${key === 'all'}" class="${key === 'all' ? 'active' : ''}">${label}<span data-filter-count="${key}">0</span></button>`).join('')}</div><label class="search-field">${icon('Search')}<input type="search" data-appointment-search placeholder="Find a booking" aria-label="Search appointments"></label></div>
        <div class="record-list" data-appointment-panel>${appointmentRows(connectionError)}</div>
      </div>
    </section>
  `;
  lastSnapshot = snapshot(connectionError);
  updatePanel(connectionError, true);
  document.querySelector('[data-appointment-search]').addEventListener('input', () => updatePanel(latestConnectionError, true));
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    statusFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((tab) => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); });
    updatePanel(latestConnectionError, true);
  }));
  document.querySelector("[data-appointment-panel]").addEventListener("click", async (event) => {
    const retry = event.target.closest("[data-retry]");
    if (retry) return refreshAppointments({ force: true, refreshCatalog: true });
    const button = event.target.closest("[data-status]");
    if (!button || button.disabled) return;
    const [id, status] = button.dataset.status.split(":");
    button.disabled = true;
    try {
      await api(`/admin/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast(`Appointment marked ${status}.`);
      await refreshAppointments({ force: true });
    } catch (error) {
      toast(error.message || "Status could not be updated.");
      button.disabled = false;
    }
  });
  initHeader("admin");
}

render().then(() => {
  window.setInterval(() => {
    if (!document.hidden) refreshAppointments();
  }, 4000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAppointments({ force: true });
  });
});
