const { state, barbers, nav, initHeader, byId, peso, serviceOptions, barberOptions, save, loadCatalog, toast } = BarberCo;
const params = new URLSearchParams(location.search);
if (params.get("service")) state.selectedServiceId = params.get("service");

async function render() {
  try { await loadCatalog(); } catch { toast("Using saved booking options until backend is online."); }
  const selected = byId(state.services, state.selectedServiceId);
  const hasBarbers = barbers.filter((barber) => barber.status !== "fired" && barber.status !== "on-leave").length > 0;
  const onlineFee = 100;
  document.querySelector("#app").innerHTML = `
    ${nav("booking")}
    <section class="section top">
      <div class="booking-layout">
        <div><p class="eyebrow">Online Booking</p><h2>Reserve before arriving.</h2><p class="muted">Online bookings require advance payment and include a PHP 100 booking fee. Walk-ins are handled by staff at the shop.</p><div class="panel"><h3>Selected summary</h3><div class="summary-list"><div><span>Service</span><strong>${selected.name}</strong></div><div><span>Cut price</span><strong>${peso(selected.price)}</strong></div><div><span>Online booking fee</span><strong>${peso(onlineFee)}</strong></div><div><span>Total advance payment</span><strong>${peso(Number(selected.price) + onlineFee)}</strong></div><div><span>Duration</span><strong>${selected.duration}</strong></div></div></div></div>
        <form class="form-card" data-booking><label>Email address<input type="email" name="email" value="${state.user.email}" required></label><label>Service<select name="service">${serviceOptions()}</select></label><label>Preferred barber<select name="barber">${barberOptions()}</select></label>${hasBarbers ? "" : `<p class="muted">No active barber is assigned yet. Staff can assign one from the logbook.</p>`}<div class="form-row"><label>Date<input type="date" name="date" required></label><label>Time<input type="time" name="time" required></label></div><label>Special request<textarea name="request" rows="4" placeholder="Fade preference, beard trim details, or notes"></textarea></label><button class="button primary full" type="submit">Proceed to payment</button></form>
      </div>
    </section>
  `;
  document.querySelector("[data-booking]").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const service = byId(state.services, data.get("service"));
    state.booking = { email: data.get("email"), serviceId: data.get("service"), barberId: data.get("barber"), date: data.get("date"), time: data.get("time"), request: data.get("request"), source: "online", bookingFee: onlineFee, total: Number(service.price) + onlineFee };
    state.selectedServiceId = state.booking.serviceId;
    state.selectedBarberId = state.booking.barberId;
    save();
    location.href = "payment.html";
  });
  initHeader("booking");
}

render();
