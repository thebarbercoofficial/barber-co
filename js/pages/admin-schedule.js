const { state, barbers, nav, initHeader, adminSidebar, byId, peso, save, toast, api, loadCatalog } = BarberCo;

if (!BarberCo.canAccess("moderator")) {
  location.replace("login.html");
  throw new Error("Staff access required.");
}

async function loadAppointments() {
  try {
    await loadCatalog();
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

async function render() {
  const connectionError = await loadAppointments();
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("schedule")}
      <div class="workspace">
        <p class="eyebrow">Appointment and Schedule</p><h1>Incoming requests</h1>
        ${connectionError ? `<div class="connection-error" role="alert"><strong>Appointments could not load.</strong><span>${connectionError}</span><button class="button secondary small" type="button" data-retry>Try again</button></div>` : ""}
        <div class="panel">
          ${connectionError ? "<p class=\"muted\">Reconnect to the backend to view the shared appointment list.</p>" : state.appointments.map((item) => `<div class="appointment-row"><span>Queue #${String(item.queueNumber || item.id).padStart(2, "0")}<br><small class="muted">${item.date || ""} ${item.time} - ${byId(barbers, item.barberId).name}</small></span><strong>${item.customer} - ${byId(state.services, item.serviceId).name}<br><small class="muted">${item.source === "online" ? `Online booking submitted ${peso(item.total || 0)} including PHP 100 fee` : "Shop entry"}</small>${item.paymentProof ? `<br><a class="inline" href="${item.paymentProof}" target="_blank" rel="noreferrer">View payment proof</a>` : ""}</strong><span class="status-pill ${String(item.status).toLowerCase().replace(/\s+/g, "-")}">${item.status}</span><span class="button-row"><button class="button primary small" type="button" data-status="${item.mongoId || item.id}:confirmed">Verify paid</button><button class="button secondary small" type="button" data-status="${item.mongoId || item.id}:completed">Complete</button><button class="button danger small" type="button" data-status="${item.mongoId || item.id}:cancelled">Cancel</button></span></div>`).join("") || "<p class=\"muted\">No appointments yet.</p>"}
        </div>
      </div>
    </section>
  `;
  document.querySelector("[data-retry]")?.addEventListener("click", render);
  document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", async () => {
    const [id, status] = button.dataset.status.split(":");
    const item = state.appointments.find((appt) => String(appt.id) === id || appt.mongoId === id);
    try {
      await api(`/admin/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    } catch (error) {
      toast(error.message || "Status could not be updated.");
      return;
    }
    if (item) {
      item.status = status;
      if (status === "completed" || status === "confirmed") item.paid = true;
      save();
    }
    toast(`Appointment marked ${status}.`);
    render();
  }));
  initHeader("admin");
}

render();

