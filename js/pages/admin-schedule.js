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
  } catch (error) {
    if (error.message.includes("Admin")) location.href = "login.html";
    else toast("Using saved appointments until backend is online.");
  }
}

async function render() {
  await loadAppointments();
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("schedule")}
      <div class="workspace">
        <p class="eyebrow">Appointment and Schedule</p><h1>Incoming requests</h1>
        <div class="panel">
          ${state.appointments.map((item) => `<div class="appointment-row"><span>Queue #${String(item.queueNumber || item.id).padStart(2, "0")}<br><small class="muted">${item.date || ""} ${item.time} - ${byId(barbers, item.barberId).name}</small></span><strong>${item.customer} - ${byId(state.services, item.serviceId).name}<br><small class="muted">${item.source === "online" ? `Online booking paid ${peso(item.total || 0)} including PHP 100 fee` : "Shop entry"}</small></strong><span class="status-pill ${String(item.status).toLowerCase().replace(/\s+/g, "-")}">${item.status}</span><span class="button-row"><button class="button primary small" type="button" data-status="${item.mongoId || item.id}:confirmed">Verify paid</button><button class="button secondary small" type="button" data-status="${item.mongoId || item.id}:completed">Complete</button><button class="button danger small" type="button" data-status="${item.mongoId || item.id}:cancelled">Cancel</button></span></div>`).join("") || "<p class=\"muted\">No appointments yet.</p>"}
        </div>
      </div>
    </section>
  `;
  document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", async () => {
    const [id, status] = button.dataset.status.split(":");
    const item = state.appointments.find((appt) => String(appt.id) === id || appt.mongoId === id);
    try { await api(`/admin/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); } catch {}
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

