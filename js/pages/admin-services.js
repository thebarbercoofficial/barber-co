const { state, nav, initHeader, adminSidebar, peso, save, toast, api } = BarberCo;
function renderRows() {
  return state.services.map((service) => `<div class="appointment-row"><span>${service.name}<br><small class="muted">${service.detail}</small></span><strong>${peso(service.price)} - ${service.duration}</strong><span class="button-row"><button class="button secondary small" type="button" data-edit="${service.mongoId || service.id}">Edit</button><button class="button danger small" type="button" data-delete="${service.mongoId || service.id}">Remove</button></span></div>`).join("");
}

async function loadServices() {
  try {
    const data = await api("/admin/services");
    state.services = data.services || state.services;
    save();
  } catch (error) {
    if (error.message.includes("Admin")) location.href = "login.html";
    else toast("Using saved services until backend is online.");
  }
}

async function render() {
  await loadServices();
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("services")}
      <div class="workspace">
        <p class="eyebrow">Services Management</p><h1>Service records</h1>
        <form class="panel" data-service-form><div class="form-row"><label>Service name<input name="name" required placeholder="Package name"></label><label>Price<input type="number" name="price" required placeholder="150"></label></div><div class="form-row"><label>Duration<input name="duration" required placeholder="30 min"></label><label>Description<input name="detail" required placeholder="Short description"></label></div><button class="button primary" type="submit">Add service</button></form>
        <div class="panel" data-service-rows>${renderRows()}</div>
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
    state.services.push(service);
    save();
    toast(error.message || "Saved locally until backend is online.");
    render();
  }
  });
  document.querySelector("[data-service-rows]").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]");
  const del = event.target.closest("[data-delete]");
  if (edit) {
    const service = state.services.find((item) => item.mongoId === edit.dataset.edit || item.id === edit.dataset.edit) || state.services[0];
    const price = prompt(`Update price for ${service.name}`, service.price);
    if (price) {
      try { await api(`/admin/services/${edit.dataset.edit}`, { method: "PATCH", body: JSON.stringify({ price: Number(price) }) }); } catch {}
      service.price = Number(price);
      save();
      render();
    }
  }
  if (del) {
    if (state.services.length <= 1) return toast("At least one service must remain.");
    try { await api(`/admin/services/${del.dataset.delete}`, { method: "DELETE" }); } catch {}
    state.services = state.services.filter((service) => service.id !== del.dataset.delete && service.mongoId !== del.dataset.delete);
    save();
    render();
  }
  });
  initHeader("admin");
}

render();
