const { state, nav, initHeader, initials, save, toast } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("login")}
  <section class="section top">
    <div class="grid-2">
      <div class="panel profile-head"><span class="profile-photo">${initials(state.user.name)}</span><div><h2>${state.user.name}</h2><p class="muted">Member since June 2027 - ${state.user.location}</p></div><button class="button secondary" type="button" data-photo>Change display photo</button></div>
      <form class="form-card" data-profile><p class="eyebrow">User Profile</p><h2>Manage account</h2><label>Email<input type="email" name="email" value="${state.user.email}"></label><label>Username<input name="username" value="${state.user.username}"></label><label>Phone<input name="phone" value="${state.user.phone}"></label><label>Location<input name="location" value="${state.user.location}"></label><label>Bio<textarea name="bio" rows="4">${state.user.bio}</textarea></label><button class="button primary full" type="submit">Save changes</button></form>
    </div>
  </section>
`;
document.querySelector("[data-profile]").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  state.user.email = data.get("email");
  state.user.username = data.get("username");
  state.user.phone = data.get("phone");
  state.user.location = data.get("location");
  state.user.bio = data.get("bio");
  save();
  toast("User profile saved locally.");
});
document.querySelector("[data-photo]").addEventListener("click", () => toast("Photo picker placeholder. Backend storage can be connected later."));
initHeader("login");
