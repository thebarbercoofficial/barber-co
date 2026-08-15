const { state, nav, initHeader, adminSidebar, save, toast, canAccess } = BarberCo;

if (!canAccess("admin")) location.href = "login.html";

function rows() {
  return state.accounts.map((account) => `
    <div class="appointment-row">
      <span>${account.name}<br><small class="muted">${account.email}</small></span>
      <strong>${account.role}</strong>
      <span class="button-row">
        <button class="button secondary small" type="button" data-role="${account.id}:customer">Customer</button>
        <button class="button secondary small" type="button" data-role="${account.id}:moderator">Moderator</button>
        <button class="button primary small" type="button" data-role="${account.id}:admin">Admin</button>
      </span>
    </div>
  `).join("");
}

function render() {
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("users")}
      <div class="workspace">
        <p class="eyebrow">Users and Permissions</p><h1>Staff access</h1>
        <form class="panel" data-account-form>
          <div class="form-row"><label>Name<input name="name" required placeholder="Staff name"></label><label>Email<input type="email" name="email" required placeholder="staff@email.com"></label></div>
          <div class="form-row"><label>Password<input name="password" required placeholder="Temporary password"></label><label>Permission<select name="role"><option value="customer">Customer</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select></label></div>
          <button class="button primary" type="submit">Create account</button>
        </form>
        <div class="panel">${rows()}</div>
      </div>
    </section>
  `;

  document.querySelector("[data-account-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const email = String(data.get("email")).trim().toLowerCase();
    if (state.accounts.some((account) => account.email.toLowerCase() === email)) return toast("Account already exists.");
    state.accounts.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name: data.get("name"), email, password: data.get("password"), role: data.get("role"), phone: "" });
    save();
    toast("Account created.");
    render();
  });

  document.querySelectorAll("[data-role]").forEach((button) => button.addEventListener("click", () => {
    const [id, role] = button.dataset.role.split(":");
    const account = state.accounts.find((item) => item.id === id);
    if (!account) return;
    account.role = role;
    save();
    toast(`${account.name} is now ${role}.`);
    render();
  }));
  initHeader("admin");
}

render();
