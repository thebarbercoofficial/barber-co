const { state, barbers, nav, initHeader, byId } = BarberCo;
const current = state.appointments.find((item) => item.status === "Ongoing") || state.appointments[0];
const next = state.appointments.find((item) => item.status === "Next") || state.appointments[1] || current;
document.querySelector("#app").innerHTML = `
  ${nav("queue")}
  <section class="section top">
    <div class="section-heading"><p class="eyebrow">Customer Queue</p><h2>Live appointment status.</h2><p class="muted">Customers can monitor now serving, next serving, estimated waiting time, and appointment status records.</p></div>
    <div class="now-next">
      ${[["Now serving", current], ["Next serving", next]].map(([label, item]) => `<article><span>${label}</span><strong>Queue #${String(item.id).padStart(2, "0")}</strong><p>${item.customer} - ${byId(state.services, item.serviceId).name}</p></article>`).join("")}
    </div>
    <div class="panel">
      ${state.appointments.map((item) => `<div class="queue-row"><span>Queue #${String(item.id).padStart(2, "0")} - ${byId(barbers, item.barberId).name}</span><strong>${item.customer} - ${byId(state.services, item.serviceId).name}</strong><span class="status-pill ${item.status.toLowerCase()}">${item.status}</span></div>`).join("")}
    </div>
  </section>
`;
initHeader("queue");
