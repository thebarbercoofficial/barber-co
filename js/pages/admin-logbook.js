const { state, barbers, nav, initHeader, adminSidebar, byId, peso, api, loadCatalog, serviceOptions, toast, canAccess } = BarberCo;

if (!canAccess("moderator")) {
  location.replace("login.html");
  throw new Error("Staff access required.");
}

let liveQueue = [];
let refreshBusy = false;

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function statusText(status) {
  return status === "serving" ? "Now serving" : status === "done" ? "Paid / done" : status === "cancelled" ? "Cancelled" : "Waiting";
}

function queueRows() {
  const active = liveQueue.filter((item) => !["done", "cancelled"].includes(item.status)).sort((a, b) => a.queueNumber - b.queueNumber);
  if (!active.length) return `<div class="empty-state">No active walk-ins.</div>`;
  return active.map((item) => `
    <div class="appointment-row" data-ticket-row="${item.mongoId || item.id}">
      <span>Queue #${String(item.queueNumber).padStart(2, "0")}<br><small class="muted">${item.waitMinutes || 0} min estimate</small></span>
      <strong>${escapeHtml(item.customer)}<br><small class="muted">${escapeHtml(item.cutName || byId(state.services, item.serviceId).name)} - ${peso(item.price || byId(state.services, item.serviceId).price)} - ${item.source === "shop-qr" ? "Customer QR" : "Staff entry"}</small></strong>
      <span>${byId(barbers, item.barberId).name}</span>
      <span class="status-pill ${item.status}">${statusText(item.status)}</span>
      <span class="button-row"><button class="button secondary small" type="button" data-rename="${item.mongoId || item.id}">Edit name</button>${item.status === "waiting" ? `<button class="button primary small" type="button" data-status="${item.mongoId || item.id}:serving">Serve</button>` : `<button class="button primary small" type="button" disabled>Serving</button>`}<button class="button secondary small" type="button" data-status="${item.mongoId || item.id}:done">Paid / done</button><button class="button danger small" type="button" data-status="${item.mongoId || item.id}:cancelled">Cancel</button></span>
    </div>`).join("");
}

function updateQueueUI() {
  const counts = {
    waiting: liveQueue.filter((item) => item.status === "waiting").length,
    serving: liveQueue.filter((item) => item.status === "serving").length,
    done: liveQueue.filter((item) => item.status === "done").length
  };
  Object.entries(counts).forEach(([key, value]) => {
    const target = document.querySelector(`[data-count="${key}"]`);
    if (target) target.textContent = value;
  });
  const rows = document.querySelector("[data-queue-rows]");
  if (rows) rows.innerHTML = queueRows();
  const stamp = document.querySelector("[data-last-sync]");
  if (stamp) stamp.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const nextButton = document.querySelector("[data-next]");
  if (nextButton) {
    const serving = liveQueue.find((item) => item.status === "serving");
    const hasWaiting = liveQueue.some((item) => item.status === "waiting");
    nextButton.disabled = Boolean(serving) || !hasWaiting;
    nextButton.textContent = serving ? `Serving ${serving.customer}` : hasWaiting ? "Call next customer" : "No customers waiting";
  }
}

async function refreshQueue({ quiet = false } = {}) {
  if (refreshBusy) return;
  refreshBusy = true;
  try {
    const payload = await api("/admin/queue");
    liveQueue = payload.queue || [];
    updateQueueUI();
  } catch (error) {
    if (!quiet) toast(error.message || "The shared queue could not be loaded.");
  } finally { refreshBusy = false; }
}

async function initialize() {
  try { await loadCatalog(); } catch (error) { toast(error.message || "Services and barbers could not be loaded."); }
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">${adminSidebar("logbook")}<div class="workspace">
      <div class="workspace-heading"><div><p class="eyebrow">Staff Logbook</p><h1>Walk-in queue</h1></div><span class="muted" data-last-sync>Connecting...</span></div>
      <div class="grid-2">
        <form class="panel" data-logbook-form>
          <h3>Manual entry</h3>
          <label>Customer call name<input name="customer" required maxlength="120" placeholder="Name or nickname to call out"></label>
          <label>Cut / service<select name="serviceId" required>${serviceOptions()}</select></label>
          <div class="form-row"><label>Price<input type="number" name="price" min="0" required value="150"></label><label>Estimated wait minutes<input type="number" name="waitMinutes" min="0" required value="30"></label></div>
          <label>Barber<select name="barberId"><option value="">Assign later</option>${barbers.filter((barber) => !["fired", "on-leave"].includes(barber.status)).map((barber) => `<option value="${barber.id}">${barber.name}</option>`).join("")}</select></label>
          <label>Notes<input name="notes" placeholder="No phone, prefers scissors, paid cash, etc."></label>
          <button class="button primary" type="submit">Add to queue</button>
        </form>
        <div class="panel"><h3>Live counter</h3><div class="summary-list"><div><span>Waiting</span><strong data-count="waiting">0</strong></div><div><span>Serving</span><strong data-count="serving">0</strong></div><div><span>Completed</span><strong data-count="done">0</strong></div></div><button class="button primary full" type="button" data-next>Call next customer</button><a class="button secondary full" href="queue-display.html" target="_blank" rel="noreferrer">Open TV queue display</a><a class="button secondary full" href="printables/walk-in-qr.html" target="_blank" rel="noreferrer">Open walk-in QR</a></div>
      </div>
      <div class="panel section" data-queue-rows><div class="empty-state">Loading the shared queue...</div></div>
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
      event.target.reset();
      document.querySelector('[name="price"]').value = byId(state.services, document.querySelector('[name="serviceId"]').value).price || 0;
      await refreshQueue();
    } catch (error) { toast(error.message || "Customer could not be added."); }
    finally { button.disabled = false; }
  });

  document.querySelector("[data-next]").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      const payload = await api("/admin/queue/next", { method: "POST", body: "{}" });
      toast(payload.ticket ? `Now serving ${payload.ticket.customer}, queue #${payload.ticket.queueNumber}.` : "No waiting customers.");
      await refreshQueue();
    } catch (error) { toast(error.message || "The next customer could not be called."); }
    finally { updateQueueUI(); }
  });

  document.querySelector("[data-queue-rows]").addEventListener("click", async (event) => {
    const statusButton = event.target.closest("[data-status]");
    const renameButton = event.target.closest("[data-rename]");
    if (!statusButton && !renameButton) return;
    const button = statusButton || renameButton;
    button.disabled = true;
    try {
      if (renameButton) {
        const ticket = liveQueue.find((item) => (item.mongoId || item.id) === renameButton.dataset.rename);
        const customer = prompt("Name or nickname to call out", ticket?.customer || "");
        if (customer == null) return;
        await api(`/admin/queue/${renameButton.dataset.rename}`, { method: "PATCH", body: JSON.stringify({ customer }) });
        toast("Customer call name updated.");
      } else {
        const [id, status] = statusButton.dataset.status.split(":");
        await api(`/admin/queue/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
        toast(status === "done" ? "Customer marked paid and completed." : "Queue updated.");
      }
      await refreshQueue();
    } catch (error) { toast(error.message || "Queue could not be updated."); }
    finally { button.disabled = false; }
  });

  initHeader("admin");
  await refreshQueue();
}

initialize();
window.setInterval(() => {
  if (!document.hidden) refreshQueue({ quiet: true });
}, 5000);
