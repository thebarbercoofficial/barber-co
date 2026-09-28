const { state, barbers, nav, initHeader, adminSidebar, byId, peso, save, toast, api, loadCatalog } = BarberCo;

if (!BarberCo.canAccess("moderator")) {
  location.replace("login.html");
  throw new Error("Staff access required.");
}

let lastSnapshot = "";
let refreshInProgress = false;

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
  if (connectionError) return `<p class="muted">${connectionError} <button class="button secondary small" type="button" data-retry>Try again</button></p>`;
  return state.appointments.map((item) => `<div class="appointment-row"><span>Queue #${String(item.queueNumber || item.id).padStart(2, "0")}<br><small class="muted">${item.date || ""} ${item.time} - ${byId(barbers, item.barberId).name}</small></span><strong>${item.customer} - ${byId(state.services, item.serviceId).name}<br><small class="muted">Call name: ${item.customer}. ${item.source === "online" ? `Online booking submitted ${peso(item.total || 0)} including PHP 100 fee` : "Shop entry"}</small>${item.paymentProof ? `<br><a class="inline" href="${item.paymentProof}" target="_blank" rel="noreferrer">View payment proof</a>` : ""}</strong><span class="status-pill ${String(item.status).toLowerCase().replace(/\s+/g, "-")}">${item.status}</span><span class="button-row">${item.status === "pending" ? `<button class="button primary small" type="button" data-status="${item.mongoId || item.id}:confirmed">Accept / verify paid</button>` : `<button class="button primary small" type="button" disabled>${item.status === "confirmed" ? "Accepted" : item.status}</button>`}${item.status === "confirmed" ? `<button class="button secondary small" type="button" data-status="${item.mongoId || item.id}:completed">Complete</button>` : ""}${!["completed", "cancelled"].includes(item.status) ? `<button class="button danger small" type="button" data-status="${item.mongoId || item.id}:cancelled">Cancel</button>` : ""}</span></div>`).join("") || "<p class=\"muted\">No appointments yet.</p>";
}

function snapshot(connectionError = "") {
  return JSON.stringify({ connectionError, appointments: state.appointments.map(({ id, status, updatedAt }) => ({ id, status, updatedAt })) });
}

function updatePanel(connectionError = "", force = false) {
  const nextSnapshot = snapshot(connectionError);
  if (!force && nextSnapshot === lastSnapshot) return;
  lastSnapshot = nextSnapshot;
  const panel = document.querySelector("[data-appointment-panel]");
  if (panel) panel.innerHTML = appointmentRows(connectionError);
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
        <div class="section-heading"><div><p class="eyebrow">Appointment and Schedule</p><h1>Incoming requests</h1></div><small class="muted" data-last-updated>Live updates on</small></div>
        <div class="panel" data-appointment-panel>${appointmentRows(connectionError)}</div>
      </div>
    </section>
  `;
  lastSnapshot = snapshot(connectionError);
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
