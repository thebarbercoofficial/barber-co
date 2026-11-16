const { barbers, state, nav, initHeader, initials, save, loadCatalog, toast, safeText } = BarberCo;

function availability(barber) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const onLeave = barber.status === 'on-leave' || Boolean(barber.leaveFrom && barber.leaveTo && today >= barber.leaveFrom && today <= barber.leaveTo);
  const label = onLeave ? 'On leave' : barber.status === 'active' ? 'Available' : 'Unavailable';
  const dateLabel = value => new Date(`${value}T12:00:00+08:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  const dates = barber.leaveFrom && barber.leaveTo ? `Leave: ${dateLabel(barber.leaveFrom)} - ${dateLabel(barber.leaveTo)}` : '';
  return { label, dates, selectable: !onLeave && barber.status === 'active', status: onLeave ? 'on-leave' : barber.status };
}

async function render() {
  try { await loadCatalog(); } catch { toast("Using saved barbers until backend is online."); }
  document.querySelector("#app").innerHTML = `
    ${nav("barbers")}
    <section class="section top">
      <div class="section-heading"><p class="eyebrow">Meet The Team</p><h2>Our barbers</h2></div>
      <div class="grid-3 barber-roster">
        ${barbers.filter((barber) => barber.status !== "fired").map((barber) => {
          const info = availability(barber);
          return `<article class="barber-card"><span class="avatar">${safeText(initials(barber.name))}</span><div class="barber-details"><h3>${safeText(barber.name)}</h3><p>${safeText(barber.role || '')}</p><p class="muted">${safeText(barber.bio || '')}</p><p><span class="status-pill ${safeText(info.status)}">${info.label}</span></p>${info.dates ? `<p class="barber-leave-dates">${safeText(info.dates)}</p>` : ''}</div><button class="button primary small" data-barber="${safeText(barber.id)}" type="button" ${info.selectable ? '' : 'disabled'}>${info.selectable ? 'Choose barber' : info.label}</button></article>`;
        }).join("") || `<div class="empty-state">No barbers are listed yet. Please check again after staff updates the roster.</div>`}
      </div>
    </section>
  `;
  document.querySelectorAll("[data-barber]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedBarberId = button.dataset.barber;
      save();
      location.href = "booking.html";
    });
  });
  initHeader("barbers");
}

render();
