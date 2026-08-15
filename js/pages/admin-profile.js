const { state, nav, initHeader, adminSidebar, avatar, save, toast } = BarberCo;

if (!BarberCo.canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

document.querySelector("#app").innerHTML = `
  ${nav("admin")}
  <section class="app-shell">
    ${adminSidebar("profile")}
    <div class="workspace">
      <p class="eyebrow">Admin Profile</p><h1>Account and settings</h1>
      <div class="grid-2">
        <div class="panel profile-head">
          ${avatar(state.admin.name, state.admin.photo || "")}
          <h2>${state.admin.name}</h2>
          <p class="muted">Verified administrator account</p>
          <label class="upload-box">Upload admin photo<input type="file" accept="image/*" data-admin-photo></label>
        </div>
        <form class="form-card" data-admin-profile>
          <label>Name<input name="name" value="${state.admin.name}"></label>
          <label>Email<input type="email" name="email" value="${state.admin.email}"></label>
          <label>Address<input name="address" value="${state.admin.address}"></label>
          <label>Contact number<input name="contact" value="${state.admin.contact}"></label>
          <div class="form-row"><label>Location<input name="location" value="${state.admin.location}"></label><label>Postal code<input name="postal" value="${state.admin.postal}"></label></div>
          <div class="form-row"><label>GCash account name<input name="gcashName" value="${state.admin.gcashName || ""}"></label><label>GCash number<input name="gcashNumber" value="${state.admin.gcashNumber || ""}"></label></div>
          <label class="upload-box">Upload GCash QR image<input type="file" accept="image/*" data-gcash-qr></label>
          ${state.admin.gcashQr ? `<img class="qr-preview" src="${state.admin.gcashQr}" alt="Saved GCash QR code">` : `<div class="empty-state">No GCash QR uploaded yet.</div>`}
          <div class="button-row"><button class="button primary" type="submit">Save changes</button><button class="button secondary" type="button" data-discard>Discard</button></div>
        </form>
      </div>
    </div>
  </section>
`;

function readImage(file, done) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => done(reader.result));
  reader.readAsDataURL(file);
}

document.querySelector("[data-admin-profile]").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  Object.keys(state.admin).forEach((key) => { if (data.has(key)) state.admin[key] = data.get(key); });
  save();
  toast("Admin profile saved locally.");
});
document.querySelector("[data-admin-photo]").addEventListener("change", (event) => {
  readImage(event.target.files[0], (image) => {
    state.admin.photo = image;
    save();
    toast("Admin photo saved.");
    location.reload();
  });
});
document.querySelector("[data-gcash-qr]").addEventListener("change", (event) => {
  readImage(event.target.files[0], (image) => {
    state.admin.gcashQr = image;
    save();
    toast("GCash QR saved.");
    location.reload();
  });
});
document.querySelector("[data-discard]").addEventListener("click", () => location.reload());
initHeader("admin");
