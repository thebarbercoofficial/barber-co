const { state, nav, initHeader, avatar, save, toast, api, setSession } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("login")}
  <section class="section top">
    <div class="grid-2">
      <div class="panel profile-head">${avatar(state.user.name || state.user.email, state.user.photo || "")}<div><h2>${state.user.name || "Customer"}</h2><p class="muted">${state.user.location || "Profile details"}</p></div><label class="upload-box">Change display photo<input type="file" accept="image/*" data-photo></label></div>
      <form class="form-card" data-profile><p class="eyebrow">User Profile</p><h2>Manage account</h2><label>Name<input name="name" value="${state.user.name}"></label><label>Email<input type="email" name="email" value="${state.user.email}"></label><label>Username<input name="username" value="${state.user.username}"></label><label>Phone<input name="phone" value="${state.user.phone}"></label><label>Location<input name="location" value="${state.user.location}"></label><label>Bio<textarea name="bio" rows="4">${state.user.bio}</textarea></label><button class="button primary full" type="submit">Save changes</button></form>
    </div>
  </section>
`;
document.querySelector("[data-profile]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  state.user.name = data.get("name");
  state.user.email = data.get("email");
  state.user.username = data.get("username");
  state.user.phone = data.get("phone");
  state.user.location = data.get("location");
  state.user.bio = data.get("bio");
  save();
  try {
    const payload = await api("/me", { method: "PATCH", body: JSON.stringify(state.user) });
    setSession(payload);
    toast("Profile saved.");
  } catch {
    toast("Profile saved locally until backend is online.");
  }
});
document.querySelector("[data-photo]").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    state.user.photo = reader.result;
    save();
    toast("Display photo saved locally.");
    location.reload();
  });
  reader.readAsDataURL(file);
});
initHeader("login");
