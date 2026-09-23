const { state, barbers, nav, initHeader, byId, peso, serviceOptions, barberOptions, save, loadCatalog, loadSettings, toast } = BarberCo;
const params = new URLSearchParams(location.search);
if (params.get("service")) state.selectedServiceId = params.get("service");

if (!BarberCo.isAuthenticated()) {
  location.replace(`register.html?next=${encodeURIComponent(`booking.html${location.search}`)}`);
  throw new Error("A customer account is required to book.");
}

function escapeAttr(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

async function render() {
  let settings = state.shopSettings || {};
  try {
    const results = await Promise.all([loadCatalog(), loadSettings()]);
    settings = results[1];
  } catch { toast("Using saved booking options until backend is online."); }
  const selected = byId(state.services, state.selectedServiceId);
  const hasBarbers = barbers.filter((barber) => barber.status !== "fired" && barber.status !== "on-leave").length > 0;
  const onlineFee = Math.max(0, Number(settings.bookingFee ?? 100));
  const minimumDate = localDateValue();
  document.querySelector("#app").innerHTML = `
    ${nav("booking")}
    <section class="section top">
      <div class="booking-layout">
        <div><p class="eyebrow">Online Booking</p><h2>Reserve before arriving.</h2><p class="muted">Online bookings require advance payment and include a PHP 100 booking fee. Walk-ins are handled by staff at the shop.</p><div class="panel"><h3>Selected summary</h3><div class="summary-list"><div><span>Service</span><strong>${selected.name}</strong></div><div><span>Cut price</span><strong>${peso(selected.price)}</strong></div><div><span>Online booking fee</span><strong>${peso(onlineFee)}</strong></div><div><span>Total advance payment</span><strong>${peso(Number(selected.price) + onlineFee)}</strong></div><div><span>Duration</span><strong>${selected.duration}</strong></div></div></div></div>
        <form class="form-card" data-booking><div class="account-booking-note"><span>Booking account</span><strong>${escapeAttr(state.user.name)}</strong><small>${escapeAttr(state.user.email)}</small></div><label>Name or nickname to call<input name="customer" required minlength="2" maxlength="120" value="${escapeAttr(state.user.name)}" placeholder="Name staff should call out"></label><label>Service<select name="service">${serviceOptions()}</select></label><label>Preferred barber<select name="barber">${barberOptions()}</select></label>${hasBarbers ? "" : `<p class="muted">No active barber is assigned yet. Staff can assign one from the logbook.</p>`}<div class="form-row"><label>Date<input type="date" name="date" min="${minimumDate}" required></label><label>Time<input type="time" name="time" required></label></div><p class="field-help">Past dates and times cannot be booked.</p><label>Special request<textarea name="request" rows="4" placeholder="Fade preference, beard trim details, or notes"></textarea></label><button class="button primary full" type="submit">Proceed to payment</button></form>
      </div>
    </section>
  `;
  const dateInput = document.querySelector('[name="date"]');
  const timeInput = document.querySelector('[name="time"]');
  const updateMinimumTime = () => {
    const today = localDateValue();
    if (dateInput.value === today) {
      const now = new Date(Date.now() + 5 * 60 * 1000);
      timeInput.min = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    } else {
      timeInput.removeAttribute("min");
    }
  };
  dateInput.addEventListener("change", updateMinimumTime);
  updateMinimumTime();
  document.querySelector("[data-booking]").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const appointmentTime = new Date(`${data.get("date")}T${data.get("time")}:00`);
    if (!Number.isFinite(appointmentTime.getTime()) || appointmentTime <= new Date()) {
      toast("Choose a date and time that has not already passed.");
      return;
    }
    const service = byId(state.services, data.get("service"));
    state.booking = { customer: data.get("customer"), serviceId: data.get("service"), barberId: data.get("barber"), date: data.get("date"), time: data.get("time"), request: data.get("request"), source: "online", bookingFee: onlineFee, total: Number(service.price) + onlineFee };
    state.selectedServiceId = state.booking.serviceId;
    state.selectedBarberId = state.booking.barberId;
    save();
    location.href = "payment.html";
  });
  initHeader("booking");
}

render();
