const { state, barbers, nav, initHeader, adminSidebar, byId, save, toast } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("admin")}
  <section class="app-shell">
    ${adminSidebar("schedule")}
    <div class="workspace">
      <p class="eyebrow">Appointment and Schedule</p><h1>Incoming requests</h1>
      <div class="panel">
        ${state.appointments.map((item) => `<div class="appointment-row"><span>Queue #${String(item.id).padStart(2, "0")}<br><small class="muted">${item.time} - ${byId(barbers, item.barberId).name}</small></span><strong>${item.customer} - ${byId(state.services, item.serviceId).name}</strong><span class="status-pill ${item.status.toLowerCase()}">${item.status}</span><span class="button-row"><button class="button primary small" type="button" data-status="${item.id}:Confirmed">Confirm</button><button class="button secondary small" type="button" data-status="${item.id}:Completed">Complete</button><button class="button danger small" type="button" data-status="${item.id}:Cancelled">Cancel</button></span></div>`).join("")}
      </div>
    </div>
  </section>
`;
document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => {
  const [id, status] = button.dataset.status.split(":");
  const item = state.appointments.find((appt) => appt.id === Number(id));
  if (!item) return;
  item.status = status;
  if (status === "Completed" || status === "Confirmed") item.paid = true;
  save();
  toast(`Appointment marked ${status}.`);
  location.reload();
}));
initHeader("admin");
