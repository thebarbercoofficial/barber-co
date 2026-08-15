const { barbers, state, nav, initHeader, initials, save } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("barbers")}
  <section class="section top">
    <div class="section-heading"><p class="eyebrow">Meet The Team</p><h2>Select a barber for your appointment.</h2></div>
    <div class="grid-3">
      ${barbers.map((barber) => `<article class="barber-card"><span class="avatar">${initials(barber.name)}</span><h3>${barber.name}</h3><p><strong>${barber.role}</strong></p><p class="muted">${barber.bio}</p><p><span class="status-pill">${barber.status}</span></p><button class="button primary small" data-barber="${barber.id}" type="button">Choose barber</button></article>`).join("")}
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
