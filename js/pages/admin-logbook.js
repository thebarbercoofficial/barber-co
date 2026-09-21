const { state, barbers, nav, initHeader, adminSidebar, byId, peso, api, loadCatalog, serviceOptions, toast, canAccess } = BarberCo;

if (!canAccess("moderator")) {
  location.replace("login.html");
  throw new Error("Staff access required.");
}

let liveQueue = [];

function statusText(status) {
  return status === "serving" ? "Now serving" : status === "done" ? "Paid / done" : status === "cancelled" ? "Cancelled" : "Waiting";
}

function queueRows() {
  const active = liveQueue.filter((item) => !["done", "cancelled"].includes(item.status)).sort((a, b) => a.queueNumber - b.queueNumber);
  if (!active.length) return `<div class="empty-state">No active walk-ins.</div>`;
  return active.map((item) => `
    <div class="appointment-row">
      <span>Queue #${String(item.queueNumber).padStart(2, "0")}<br><small class="muted">${item.waitMinutes || 0} min estimate</small></span>
      <strong>${item.customer}<br><small class="muted">${item.cutName || byId(state.services, item.serviceId).name} - ${peso(item.price || byId(state.services, item.serviceId).price)} - ${item.source === "shop-qr" ? "Customer QR" : "Staff entry"}</small></strong>
      <span>${byId(barbers, item.barberId).name}</span>
      <span class="status-pill ${item.status}">${statusText(item.status)}</span>
      <span class="button-row"><button class="button primary small" type="button" data-status="${item.mongoId || item.id}:serving">Serve</button><button class="button secondary small" type="button" data-status="${item.mongoId || item.id}:done">Paid / done</button><button class="button danger small" type="button" data-status="${item.mongoId || item.id}:cancelled">Cancel</button></span>
    </div>`).join("");
}

async function refreshQueue() {
  const payload = await api("/admin/queue");
  liveQueue = payload.queue || [];
}

async function render() {
  try {
    await Promise.all([loadCatalog(), refreshQueue()]);
  } catch (error) {
    toast(error.message || "The shared queue could not be loaded.");
  }
  const waiting = liveQueue.filter((item) => item.status === "waiting").length;
  const serving = liveQueue.filter((item) => item.status === "serving").length;
  const completed = liveQueue.filter((item) => item.status === "done").length;
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">${adminSidebar("logbook")}<div class="workspace">
      <p class="eyebrow">Staff Logbook</p><h1>Walk-in queue</h1>
      <div class="grid-2">
        <form class="panel" data-logbook-form>
          <h3>Manual entry</h3>
          <label>Customer name<input name="customer" required placeholder="Customer name"></label>
          <label>Cut / service<select name="serviceId" required>${serviceOptions()}</select></label>
          <div class="form-row"><label>Price<input type="number" name="price" min="0" required value="150"></label><label>Estimated wait minutes<input type="number" name="waitMinutes" min="0" required value="30"></label></div>
          <label>Barber<select name="barberId"><option value="">Assign later</option>${barbers.filter((barber) => !["fired", "on-leave"].includes(barber.status)).map((barber) => `<option value="${barber.id}">${barber.name}</option>`).join("")}</select></label>
          <label>Notes<input name="notes" placeholder="No phone, prefers scissors, paid cash, etc."></label>
          <button class="button primary" type="submit">Add to queue</button>
        </form>
        <div class="panel"><h3>Live counter</h3><div class="summary-list"><div><span>Waiting</span><strong>${waiting}</strong></div><div><span>Serving</span><strong>${serving}</strong></div><div><span>Completed</span><strong>${completed}</strong></div></div><button class="button primary full" type="button" data-next>Call next customer</button><a class="button secondary full" href="printables/walk-in-qr.html" target="_blank" rel="noreferrer">Open shop QR display</a></div>
      </div>
      <div class="panel section">${queueRows()}</div>
    </div></section>`;

  document.querySelector('[name="serviceId"]').addEventListener("change", (event) => {
    document.querySelector('[name="price"]').value = byId(state.services, event.target.value).price || 0;
  });
  document.querySelector("[data-logbook-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const data = new FormData(event.target);
    const service = byId(state.services, data.get("serviceId"));
    button.disabled = true;
    try {
      const payload = await api("/admin/queue", { method: "POST", body: JSON.stringify({ customer: data.get("customer"), serviceId: data.get("serviceId"), cutName: service.name, price: Number(data.get("price")), waitMinutes: Number(data.get("waitMinutes")), barberId: data.get("barberId"), notes: data.get("notes") }) });
      toast(`Queue #${String(payload.ticket.queueNumber).padStart(2, "0")} added.`);
      await render();
    } catch (error) { toast(error.message || "Customer could not be added."); button.disabled = false; }
  });
  document.querySelector("[data-next]").addEventListener("click", async () => {
    try {
      const payload = await api("/admin/queue/next", { method: "POST", body: "{}" });
      toast(payload.ticket ? `Now serving queue #${payload.ticket.queueNumber}.` : "No waiting customers.");
      await render();
    } catch (error) { toast(error.message || "The next customer could not be called."); }
  });
  document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", async () => {
    const [id, status] = button.dataset.status.split(":");
    try {
      await api(`/admin/queue/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast(status === "done" ? "Customer marked paid and completed." : "Queue updated.");
      await render();
    } catch (error) { toast(error.message || "Queue status could not be updated."); }
  }));
  initHeader("admin");
}

render();
window.setInterval(async () => {
  if (document.hidden) return;
  try { await render(); } catch {}
}, 15000);
