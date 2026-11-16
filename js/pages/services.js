const { state, nav, shopEndcap, initHeader, peso, save, loadCatalog, toast } = BarberCo;
const params = new URLSearchParams(location.search);
if (params.get("service")) state.selectedServiceId = params.get("service");

async function render() {
  try { await loadCatalog(); } catch { toast("Using saved services until backend is online."); }
  document.querySelector("#app").innerHTML = `
    ${nav("services")}
    <section class="section top">
      <div class="section-heading"><p class="eyebrow">The Barber Co</p><h2>Services & pricing</h2></div>
      <div class="service-menu">
        ${state.services.map((service) => `<article class="service-card ${state.selectedServiceId === service.id ? "selected" : ""}"><h3>${service.name}</h3><strong class="price">${peso(service.price)}</strong><p class="muted service-description">${service.detail}</p><small class="muted service-duration">${service.duration}</small><button class="button primary small" type="button" data-service="${service.id}">Book this</button></article>`).join("")}
      </div>
    </section>
    ${shopEndcap({ href: "booking.html", label: "Reserve a slot" })}
  `;

  document.querySelectorAll("[data-service]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedServiceId = button.dataset.service;
      save();
      location.href = "booking.html";
    });
  });
  initHeader("services");
}

render();
