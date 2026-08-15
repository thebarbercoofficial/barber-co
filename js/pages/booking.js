const { state, nav, initHeader, byId, peso, serviceOptions, barberOptions, save } = BarberCo;
const params = new URLSearchParams(location.search);
if (params.get("service")) state.selectedServiceId = params.get("service");
const selected = byId(state.services, state.selectedServiceId);
document.querySelector("#app").innerHTML = `
  ${nav("booking")}
  <section class="section top">
    <div class="booking-layout">
      <div><p class="eyebrow">Book Your Haircut</p><h2>Finalize appointment details.</h2><p class="muted">Selected service summary, email, date, time, barber, and special request.</p><div class="panel"><h3>Selected summary</h3><div class="summary-list"><div><span>Service</span><strong>${selected.name}</strong></div><div><span>Price</span><strong>${peso(selected.price)}</strong></div><div><span>Duration</span><strong>${selected.duration}</strong></div></div></div></div>
      <form class="form-card" data-booking><label>Email address<input type="email" name="email" value="${state.user.email}" required></label><label>Service<select name="service">${serviceOptions()}</select></label><label>Preferred barber<select name="barber">${barberOptions()}</select></label><div class="form-row"><label>Date<input type="date" name="date" required></label><label>Time<input type="time" name="time" required></label></div><label>Special request<textarea name="request" rows="4" placeholder="Fade preference, beard trim details, or notes"></textarea></label><button class="button primary full" type="submit">Proceed to payment</button></form>
    </div>
  </section>
`;
document.querySelector("[data-booking]").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  state.booking = { email: data.get("email"), serviceId: data.get("service"), barberId: data.get("barber"), date: data.get("date"), time: data.get("time"), request: data.get("request") };
  state.selectedServiceId = state.booking.serviceId;
  state.selectedBarberId = state.booking.barberId;
  save();
  location.href = "payment.html";
});
initHeader("booking");
