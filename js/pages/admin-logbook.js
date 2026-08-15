const { state, barbers, nav, initHeader, adminSidebar, byId, peso, save, toast, canAccess } = BarberCo;

if (!canAccess("moderator")) {
  location.replace("login.html");
  throw new Error("Staff access required.");
}

function nextQueueNumber() {
  const existing = [...state.queue, ...state.appointments].map((item) => Number(item.queueNumber || item.id || 0));
  return Math.max(0, ...existing) + 1;
}

function statusText(status) {
  return status === "serving" ? "Now serving" : status === "done" ? "Paid / done" : status === "cancelled" ? "Cancelled" : "Waiting";
}

function callNextCustomer() {
  const current = state.queue.find((item) => item.status === "serving");
  if (current) return toast(`Finish or cancel queue #${String(current.queueNumber).padStart(2, "0")} before calling the next customer.`);
  const next = state.queue.filter((item) => item.status === "waiting").sort((a, b) => a.queueNumber - b.queueNumber)[0];
  if (!next) return toast("No waiting customers.");
  next.status = "serving";
  next.calledAt = new Date().toISOString();
  save();
  toast(`Now serving queue #${String(next.queueNumber).padStart(2, "0")}.`);
  render();
}

function queueRows() {
  const active = state.queue.filter((item) => item.status !== "done" && item.status !== "cancelled").sort((a, b) => a.queueNumber - b.queueNumber);
  if (!active.length) return `<p class="muted">No walk-ins in the logbook yet.</p>`;
  return active.map((item) => `
    <div class="appointment-row">
      <span>Queue #${String(item.queueNumber).padStart(2, "0")}<br><small class="muted">${item.waitMinutes || 0} min estimate</small></span>
      <strong>${item.customer}<br><small class="muted">${item.cutName} - ${peso(item.price)} - ${item.source === "online" ? "Online booking" : "In shop"}</small></strong>
      <span>${byId(barbers, item.barberId).name}</span>
      <span class="status-pill ${item.status}">${statusText(item.status)}</span>
      <span class="button-row">
        <button class="button primary small" type="button" data-serve="${item.id}">Serve</button>
        <button class="button secondary small" type="button" data-paid="${item.id}">Paid / done</button>
        <button class="button danger small" type="button" data-cancel="${item.id}">Cancel</button>
      </span>
    </div>
  `).join("");
}

function render() {
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("logbook")}
      <div class="workspace">
        <p class="eyebrow">Staff Logbook</p><h1>Walk-in queue</h1>
        <div class="grid-2">
          <form class="panel" data-logbook-form>
            <h3>Manual entry</h3>
            <label>Customer name<input name="customer" required placeholder="Customer name"></label>
            <label>Entry source<select name="source"><option value="shop">In shop walk-in</option><option value="online">Online booking / message</option></select></label>
            <div class="form-row"><label>Cut / service<input name="cutName" required placeholder="Skin fade, trim, shave"></label><label>Price<input type="number" name="price" required placeholder="150"></label></div>
            <div class="form-row"><label>Estimated wait minutes<input type="number" name="waitMinutes" required value="30"></label><label>Barber<select name="barberId">${barbers.filter((barber) => barber.status !== "fired").map((barber) => `<option value="${barber.id}">${barber.name}</option>`).join("") || `<option value="">Assign later</option>`}</select></label></div>
            <label>Notes<input name="notes" placeholder="No phone, prefers scissors, paid cash, etc."></label>
            <button class="button primary" type="submit">Add to queue</button>
          </form>
          <div class="panel">
            <h3>Today</h3>
            <div class="summary-list"><div><span>Waiting</span><strong>${state.queue.filter((item) => item.status === "waiting").length}</strong></div><div><span>Serving</span><strong>${state.queue.filter((item) => item.status === "serving").length}</strong></div><div><span>Completed</span><strong>${state.queue.filter((item) => item.status === "done").length}</strong></div></div>
            <button class="button primary full" type="button" data-next>Call next customer</button>
          </div>
        </div>
        <div class="panel section">${queueRows()}</div>
      </div>
    </section>
  `;

  document.querySelector("[data-logbook-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const item = {
      id: String(Date.now()),
      queueNumber: nextQueueNumber(),
      customer: data.get("customer"),
      source: data.get("source"),
      cutName: data.get("cutName"),
      serviceId: "",
      price: Number(data.get("price")),
      waitMinutes: Number(data.get("waitMinutes")),
      barberId: data.get("barberId"),
      notes: data.get("notes"),
      status: "waiting",
      createdAt: new Date().toISOString()
    };
    state.queue.push(item);
    save();
    toast(`Queue #${String(item.queueNumber).padStart(2, "0")} added.`);
    render();
  });

  document.querySelector("[data-next]").addEventListener("click", () => {
    callNextCustomer();
  });

  document.querySelectorAll("[data-serve], [data-paid], [data-cancel]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.serve || button.dataset.paid || button.dataset.cancel;
    const item = state.queue.find((entry) => entry.id === id);
    if (!item) return;
    if (button.dataset.serve) {
      const current = state.queue.find((entry) => entry.status === "serving" && entry.id !== id);
      if (current) return toast(`Finish queue #${String(current.queueNumber).padStart(2, "0")} first.`);
      item.status = "serving";
      item.calledAt = new Date().toISOString();
    } else if (button.dataset.paid) {
      item.status = "done";
      item.paid = true;
      item.paidAt = new Date().toISOString();
    } else {
      item.status = "cancelled";
    }
    save();
    render();
  }));
  initHeader("admin");
}

render();
