const { state, nav, initHeader, avatar, toast, api, setSession, isAuthenticated } = BarberCo;

if (!isAuthenticated()) {
  location.replace("login.html");
  throw new Error("Login required.");
}

function escapeValue(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function draw() {
  const user = state.user;
  document.querySelector("#app").innerHTML = `${nav("login")}<section class="section top"><div class="grid-2"><div class="panel profile-head">${avatar(user.name || user.email, user.photo || "")}<div><h2>${escapeValue(user.name || "Customer")}</h2><p class="muted">${escapeValue(user.location || "Profile details")}</p></div><label class="upload-box">Change display photo<input type="file" accept="image/jpeg,image/png,image/webp" data-photo></label></div><form class="form-card" data-profile><p class="eyebrow">User Profile</p><h2>Manage account</h2><label>Name<input name="name" required value="${escapeValue(user.name)}"></label><label>Email<input type="email" value="${escapeValue(user.email)}" readonly></label><label>Username<input name="username" value="${escapeValue(user.username)}"></label><label>Phone<input name="phone" value="${escapeValue(user.phone)}"></label><label>Location<input name="location" value="${escapeValue(user.location)}"></label><label>Bio<textarea name="bio" rows="4">${escapeValue(user.bio)}</textarea></label><button class="button primary full" type="submit">Save changes</button></form></div></section>`;

  document.querySelector("[data-profile]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const payload = await api("/me", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      setSession(payload);
      toast("Profile saved.");
      draw();
    } catch (error) { toast(error.message || "Profile could not be saved."); button.disabled = false; }
  });

  document.querySelector("[data-photo]").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast("Profile photo must be 2 MB or smaller.");
    const reader = new FileReader();
    reader.addEventListener("load", async () => {
      try {
        const payload = await api("/me", { method: "PATCH", body: JSON.stringify({ photo: reader.result }) });
        setSession(payload);
        toast("Display photo saved.");
        draw();
      } catch (error) { toast(error.message || "Display photo could not be saved."); }
    });
    reader.readAsDataURL(file);
  });
  initHeader("login");
}

api("/me").then((payload) => { setSession(payload); draw(); }).catch((error) => {
  toast(error.message || "Profile could not be loaded.");
  if (/login|required|token/i.test(error.message)) location.replace("login.html");
});
