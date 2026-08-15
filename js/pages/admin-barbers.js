const { state, barbers, nav, initHeader, adminSidebar, initials, save, toast, api } = BarberCo;

if (!BarberCo.canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

function statusLabel(status) {
  return status === "on-leave" ? "On leave" : status === "fired" ? "Inactive" : "Active";
}

function rows() {
  if (!barbers.length) return `<div class="empty-state">No barbers yet. Add the first real barber above.</div>`;
  return barbers.map((barber) => `
    <div class="appointment-row">
      <span class="avatar small-avatar">${initials(barber.name)}</span>
      <span>${barber.name}<br><small class="muted">${barber.role}</small></span>
      <strong>${statusLabel(barber.status)}</strong>
      <span class="button-row">
        <button class="button secondary small" type="button" data-status="${barber.mongoId || barber.id}:active">Active</button>
        <button class="button secondary small" type="button" data-status="${barber.mongoId || barber.id}:on-leave">On leave</button>
        <button class="button danger small" type="button" data-delete="${barber.mongoId || barber.id}">Remove</button>
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
    else toast("Using saved barbers until backend is online.");
  }
}

async function render() {
  await loadBarbers();
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("barbers")}
      <div class="workspace">
        <p class="eyebrow">Barber Management</p><h1>Team availability</h1>
        <form class="panel" data-barber-form>
          <div class="form-row"><label>Name<input name="name" required placeholder="New barber"></label><label>Specialty<input name="role" required placeholder="Fade specialist"></label></div>
          <label>Status<select name="status"><option value="active">Active</option><option value="on-leave">On leave</option></select></label>
          <label>Bio<input name="bio" placeholder="Short public profile"></label>
          <button class="button primary" type="submit">Add barber</button>
        </form>
        <div class="panel" data-barber-rows>${rows()}</div>
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
      barber.id = String(data.get("name")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      state.barbers.push(barber);
      save();
      toast(error.message || "Saved locally until backend is online.");
      render();
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
