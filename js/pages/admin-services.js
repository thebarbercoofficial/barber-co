const { state, nav, initHeader, adminSidebar, peso, save, toast } = BarberCo;
function renderRows() {
  return state.services.map((service) => `<div class="appointment-row"><span>${service.name}<br><small class="muted">${service.detail}</small></span><strong>${peso(service.price)} - ${service.duration}</strong><span class="button-row"><button class="button secondary small" type="button" data-edit="${service.id}">Edit</button><button class="button danger small" type="button" data-delete="${service.id}">Remove</button></span></div>`).join("");
}
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
document.querySelector("[data-service-form]").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const id = data.get("name").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  state.services.push({ id, name: data.get("name"), price: Number(data.get("price")), duration: data.get("duration"), detail: data.get("detail"), icon: "NEW" });
  save();
  location.reload();
});
document.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit]");
  const del = event.target.closest("[data-delete]");
  if (edit) {
    const service = BarberCo.byId(state.services, edit.dataset.edit);
    const price = prompt(`Update price for ${service.name}`, service.price);
    if (price) { service.price = Number(price); save(); location.reload(); }
  }
  if (del) {
    if (state.services.length <= 1) return toast("At least one service must remain.");
    state.services = state.services.filter((service) => service.id !== del.dataset.delete);
    save();
    location.reload();
  }
});
initHeader("admin");
