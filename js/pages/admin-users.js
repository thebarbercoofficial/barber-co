const { nav, initHeader, adminSidebar, toast, canAccess, api } = BarberCo;

if (!canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

const protectedAdminEmail = "thebarberco.official@gmail.com";
let accounts = [];

function rows() {
  if (!accounts.length) return `<div class="empty-state">No registered accounts yet.</div>`;
  return accounts.map((account) => {
    const protectedAccount = account.email === protectedAdminEmail;
    return `<div class="appointment-row"><span>${account.name}<br><small class="muted">${account.email}</small></span><strong>${account.role}${protectedAccount ? " - protected" : ""}</strong><span class="button-row"><button class="button secondary small" type="button" data-role="${account.id}:customer" ${protectedAccount || account.role === "customer" ? "disabled" : ""}>Customer</button><button class="button secondary small" type="button" data-role="${account.id}:moderator" ${protectedAccount || account.role === "moderator" ? "disabled" : ""}>Moderator</button><button class="button primary small" type="button" data-role="${account.id}:admin" ${protectedAccount || account.role === "admin" ? "disabled" : ""}>Admin</button></span></div>`;
  }).join("");
}

async function render() {
  document.querySelector("#app").innerHTML = `${nav("admin")}<section class="app-shell">${adminSidebar("users")}<div class="workspace"><p class="eyebrow">Users and Permissions</p><h1>Registered users</h1><p class="muted">Roles are saved to the shared database and apply on every device. The official owner account is protected.</p><form class="panel" data-account-form><div class="form-row"><label>Name<input name="name" required placeholder="Staff name"></label><label>Email<input type="email" name="email" required placeholder="staff@email.com"></label></div><div class="form-row"><label>Temporary password<input type="password" name="password" minlength="6" required></label><label>Permission<select name="role"><option value="customer">Customer</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select></label></div><button class="button primary" type="submit">Create account</button></form><div class="panel" data-user-rows><div class="empty-state">Loading accounts...</div></div></div></section>`;
  initHeader("admin");
  try {
    const payload = await api("/admin/users");
    accounts = payload.users || [];
    document.querySelector("[data-user-rows]").innerHTML = rows();
  } catch (error) { toast(error.message || "Accounts could not be loaded."); }

  document.querySelector("[data-account-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await api("/admin/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      toast("Account created.");
      render();
    } catch (error) { toast(error.message || "Account could not be created."); button.disabled = false; }
  });

  document.querySelector("[data-user-rows]").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-role]");
    if (!button) return;
    const [id, role] = button.dataset.role.split(":");
    button.disabled = true;
    try {
      const payload = await api(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
      toast(`${payload.user.name} is now ${role}.`);
      render();
    } catch (error) { toast(error.message || "Role could not be updated."); button.disabled = false; }
  });
}

render();
