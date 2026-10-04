const { nav, initHeader, adminSidebar, toast, canAccess, api, icon, safeText } = BarberCo;

if (!canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

const protectedAdminEmail = "thebarberco.official@gmail.com";
let accounts = [];

function rows() {
  if (!accounts.length) return `<div class="empty-state">No registered accounts yet.</div>`;
  const query = document.querySelector('[data-user-search]')?.value.toLowerCase().trim() || '';
  const filtered = accounts.filter((account) => `${account.name} ${account.email}`.toLowerCase().includes(query));
  if (!filtered.length) return `<div class="staff-empty"><strong>No matching accounts</strong></div>`;
  return filtered.map((account) => {
    const protectedAccount = account.email === protectedAdminEmail;
    return `<div class="appointment-row management-record"><div class="person-cell"><span class="staff-avatar">${BarberCo.initials(account.name)}</span><div><strong>${safeText(account.name)}</strong><small>${safeText(account.email)}</small></div></div><span class="status-pill">${protectedAccount ? 'Protected owner' : safeText(account.role)}</span><select class="permission-select" data-role-select="${account.id}" aria-label="Role for ${safeText(account.name)}" ${protectedAccount ? 'disabled' : ''}>${['customer','moderator','admin'].map((role) => `<option value="${role}" ${account.role === role ? 'selected' : ''}>${role[0].toUpperCase() + role.slice(1)}</option>`).join('')}</select></div>`;
  }).join("");
}

async function render() {
  document.querySelector("#app").innerHTML = `${nav("admin")}<section class="app-shell">${adminSidebar("users")}<div class="workspace"><div class="workspace-heading"><div><p class="eyebrow">ACCESS MANAGEMENT</p><h1>Users & permissions</h1><p class="muted">The owner account is protected. Staff roles apply across all devices.</p></div></div><div class="management-layout"><section><div class="panel-heading"><h3>Registered accounts</h3>${icon('Users')}</div><div class="list-toolbar"><label class="search-field">${icon('Search')}<input type="search" data-user-search placeholder="Search name or email" aria-label="Search accounts"></label></div><div class="record-list" data-user-rows><div class="empty-state">Loading accounts...</div></div></section><form class="panel" data-account-form autocomplete="off"><div class="panel-heading"><h3>Create an account</h3>${icon('UserRoundPlus')}</div><label>Name<input name="name" autocomplete="off" required placeholder="Staff name"></label><label>Email<input type="email" name="email" autocomplete="off" required placeholder="staff@email.com"></label><label>Temporary password<input type="password" name="password" autocomplete="new-password" minlength="6" required></label><label>Permission<select name="role"><option value="customer">Customer</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select></label><button class="button primary full" type="submit">${icon('Plus')} Create account</button></form></div></div></section>`;
  initHeader("admin");
  try {
    const payload = await api("/admin/users");
    accounts = payload.users || [];
    document.querySelector("[data-user-rows]").innerHTML = rows();
  } catch (error) { document.querySelector('[data-user-rows]').innerHTML = `<div class="connection-error" role="alert">${safeText(error.message || 'Accounts could not be loaded.')}</div>`; }
  document.querySelector('[data-user-search]').addEventListener('input', () => { document.querySelector('[data-user-rows]').innerHTML = rows(); });

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

  document.querySelector("[data-user-rows]").addEventListener("change", async (event) => {
    const button = event.target.closest("[data-role-select]");
    if (!button) return;
    const id = button.dataset.roleSelect;
    const role = button.value;
    button.disabled = true;
    try {
      const payload = await api(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
      toast(`${payload.user.name} is now ${role}.`);
      render();
    } catch (error) { toast(error.message || "Role could not be updated."); button.value = accounts.find((item) => item.id === id)?.role || 'customer'; button.disabled = false; }
  });
}

render();
