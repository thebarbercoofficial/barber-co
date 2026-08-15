const { state, nav, initHeader, adminSidebar, initials, save, toast } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("admin")}
  <section class="app-shell">
    ${adminSidebar("profile")}
    <div class="workspace">
      <p class="eyebrow">Admin Profile</p><h1>Account and settings</h1>
      <div class="grid-2"><div class="panel profile-head"><span class="profile-photo">${initials(state.admin.name)}</span><h2>${state.admin.name}</h2><p class="muted">Verified administrator account</p></div><form class="form-card" data-admin-profile><label>Name<input name="name" value="${state.admin.name}"></label><label>Email<input type="email" name="email" value="${state.admin.email}"></label><label>Address<input name="address" value="${state.admin.address}"></label><label>Contact number<input name="contact" value="${state.admin.contact}"></label><div class="form-row"><label>Location<input name="location" value="${state.admin.location}"></label><label>Postal code<input name="postal" value="${state.admin.postal}"></label></div><div class="button-row"><button class="button primary" type="submit">Save changes</button><button class="button secondary" type="button" data-discard>Discard</button></div></form></div>
    </div>
  </section>
`;
document.querySelector("[data-admin-profile]").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  Object.keys(state.admin).forEach((key) => { if (data.has(key)) state.admin[key] = data.get(key); });
  save();
  toast("Admin profile saved locally.");
});
document.querySelector("[data-discard]").addEventListener("click", () => location.reload());
initHeader("admin");
