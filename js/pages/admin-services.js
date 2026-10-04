const { state, nav, initHeader, adminSidebar, peso, save, toast, api, icon, safeText } = BarberCo;

if (!BarberCo.canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

function renderRows() {
  if (!state.services.length) return `<div class="staff-empty">${icon('Scissors')}<strong>No services yet</strong></div>`;
  return state.services.map((service) => `<div class="appointment-row management-record"><div><strong>${safeText(service.name)}</strong><small>${safeText(service.detail)}</small></div><div><strong>${peso(service.price)}</strong><small>${safeText(service.duration)}</small></div><span class="button-row"><button class="icon-button" type="button" data-edit="${service.mongoId || service.id}" title="Edit service price" aria-label="Edit ${safeText(service.name)}">${icon('Pencil')}</button><button class="icon-button danger-icon" type="button" data-delete="${service.mongoId || service.id}" title="Remove service" aria-label="Remove ${safeText(service.name)}">${icon('Trash2')}</button></span></div>`).join("");
}

async function loadServices() {
  try {
    const data = await api("/admin/services");
    state.services = data.services || state.services;
    save();
  } catch (error) {
    if (error.message.includes("Admin")) location.href = "login.html";
    else toast(error.message || "Services could not be loaded.");
  }
}

async function render() {
  await loadServices();
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("services")}
      <div class="workspace">
        <div class="workspace-heading"><div><p class="eyebrow">SHOP MANAGEMENT</p><h1>Services & pricing</h1><p class="muted">Cut prices and durations used in booking and at the front desk.</p></div><span class="count-badge">${state.services.length} services</span></div>
        <div class="management-layout"><section><div class="panel-heading"><h3>Service menu</h3>${icon('Scissors')}</div><div class="record-list" data-service-rows>${renderRows()}</div></section><form class="panel" data-service-form><div class="panel-heading"><h3>Add a service</h3>${icon('Plus')}</div><label>Service name<input name="name" required placeholder="Package name"></label><div class="form-row"><label>Price (PHP)<input type="number" min="0" name="price" required placeholder="150"></label><label>Duration<input name="duration" required placeholder="30 min"></label></div><label>Description<input name="detail" required placeholder="Short description"></label><button class="button primary full" type="submit">${icon('Plus')} Add service</button></form></div>
      </div>
    </section>
  `;
  document.querySelector("[data-service-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const id = data.get("name").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const service = { id, name: data.get("name"), price: Number(data.get("price")), duration: data.get("duration"), detail: data.get("detail"), icon: "NEW" };
  try {
    await api("/admin/services", { method: "POST", body: JSON.stringify(service) });
    toast("Service added.");
    render();
  } catch (error) {
    toast(error.message || "Service could not be added.");
  }
  });
  document.querySelector("[data-service-rows]").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]");
  const del = event.target.closest("[data-delete]");
  if (edit) {
    const service = state.services.find((item) => item.mongoId === edit.dataset.edit || item.id === edit.dataset.edit) || state.services[0];
    const price = prompt(`Update price for ${service.name}`, service.price);
    if (price) {
      try {
        await api(`/admin/services/${edit.dataset.edit}`, { method: "PATCH", body: JSON.stringify({ price: Number(price) }) });
        toast("Service updated.");
        render();
      } catch (error) { toast(error.message || "Service could not be updated."); }
    }
  }
  if (del) {
    if (state.services.length <= 1) return toast("At least one service must remain.");
    try {
      await api(`/admin/services/${del.dataset.delete}`, { method: "DELETE" });
      toast("Service removed.");
      render();
    } catch (error) { toast(error.message || "Service could not be removed."); }
  }
  });
  initHeader("admin");
}

render();
