const { state, nav, initHeader, peso, save } = BarberCo;
const params = new URLSearchParams(location.search);
if (params.get("service")) state.selectedServiceId = params.get("service");

document.querySelector("#app").innerHTML = `
  ${nav("services")}
  <section class="section top">
    <div class="section-heading"><p class="eyebrow">Service Menu</p><h2>Choose your grooming package.</h2><p class="muted">Click a service to select it for booking.</p></div>
    <div class="grid-5">
      ${state.services.map((service) => `<article class="service-card ${state.selectedServiceId === service.id ? "selected" : ""}"><span class="service-icon">${service.icon}</span><h3>${service.name}</h3><p class="muted">${service.detail}</p><small class="muted">${service.duration}</small><strong class="price">${peso(service.price)}</strong><button class="button primary small" type="button" data-service="${service.id}">Book this</button></article>`).join("")}
    </div>
  </section>
`;

document.querySelectorAll("[data-service]").forEach((button) => {
  button.addEventListener("click", () => {
    state.selectedServiceId = button.dataset.service;
    save();
    location.href = "booking.html";
  });
});
initHeader("services");
