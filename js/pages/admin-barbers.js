const { state, barbers, nav, initHeader, adminSidebar, initials, save, toast, api, icon, safeText } = BarberCo;

if (!BarberCo.canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

function statusLabel(status) {
  return status === "on-leave" ? "On leave" : status === "fired" ? "Inactive" : "Active";
}

function rows() {
  if (!barbers.length) return `<div class="staff-empty">${icon('Scissors')}<strong>No barbers added</strong><span>Add your team to open barber selection for customers.</span></div>`;
  return barbers.map((barber) => `
    <div class="appointment-row management-record">
      <div class="person-cell"><span class="staff-avatar">${initials(barber.name)}</span><div><strong>${safeText(barber.name)}</strong><small>${safeText(barber.role)}</small></div></div>
      <span class="status-pill ${barber.status}">${statusLabel(barber.status)}</span>
      <span class="button-row">
        <button class="button secondary small" type="button" data-status="${barber.mongoId || barber.id}:active" ${barber.status === 'active' ? 'disabled' : ''}>Active</button>
        <button class="button secondary small" type="button" data-status="${barber.mongoId || barber.id}:on-leave" ${barber.status === 'on-leave' ? 'disabled' : ''}>On leave</button>
        <button class="icon-button danger-icon" type="button" data-delete="${barber.mongoId || barber.id}" title="Remove barber" aria-label="Remove ${safeText(barber.name)}">${icon('Trash2')}</button>
      </span>
    </div>
  `).join("");
}

async function loadBarbers() {
  try {
    const data = await api("/admin/barbers");
    state.barbers.splice(0, state.barbers.length, ...(data.barbers || state.barbers));
    save();
  } catch (error) {
    if (error.message.includes("Admin") && !BarberCo.canAccess("admin")) location.href = "login.html";
    else toast(error.message || "Barbers could not be loaded.");
  }
}

async function render() {
  await loadBarbers();
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("barbers")}
      <div class="workspace">
        <div class="workspace-heading"><div><p class="eyebrow">TEAM MANAGEMENT</p><h1>Barbers</h1><p class="muted">Manage the team and availability for online reservations.</p></div><span class="count-badge">${barbers.filter((item) => item.status === 'active').length} active</span></div>
        <div class="management-layout"><section><div class="panel-heading"><h3>Your team</h3>${icon('Scissors')}</div><div class="record-list" data-barber-rows>${rows()}</div></section>
        <form class="panel" data-barber-form>
          <div class="panel-heading"><h3>Add a barber</h3>${icon('UserRoundPlus')}</div>
          <label>Name<input name="name" required placeholder="Barber name"></label><label>Specialty<input name="role" required placeholder="Fade specialist"></label>
          <label>Status<select name="status"><option value="active">Active</option><option value="on-leave">On leave</option></select></label>
          <label>Bio<input name="bio" placeholder="Short public profile"></label>
          <button class="button primary full" type="submit">${icon('Plus')} Add barber</button>
        </form>
        </div>
      </div>
    </section>
  `;

  document.querySelector("[data-barber-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const barber = { name: data.get("name"), role: data.get("role"), status: data.get("status"), bio: data.get("bio") };
    try {
      await api("/admin/barbers", { method: "POST", body: JSON.stringify(barber) });
      toast("Barber added.");
      render();
    } catch (error) {
      toast(error.message || "Barber could not be added.");
    }
  });

  document.querySelector("[data-barber-rows]").addEventListener("click", async (event) => {
    const status = event.target.closest("[data-status]");
    const del = event.target.closest("[data-delete]");
    try {
      if (status) {
        const [id, value] = status.dataset.status.split(":");
        await api(`/admin/barbers/${id}`, { method: "PATCH", body: JSON.stringify({ status: value }) });
        toast("Barber status updated.");
        render();
      }
      if (del) {
        await api(`/admin/barbers/${del.dataset.delete}`, { method: "DELETE" });
        toast("Barber removed from public booking.");
        render();
      }
    } catch (error) {
      toast(error.message || "Backend is not online yet.");
    }
  });
  initHeader("admin");
}

render();
