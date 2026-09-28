const { state, barbers, nav, initHeader, byId, peso, serviceOptions, barberOptions, save, loadCatalog, loadSettings, toast, api } = BarberCo;
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

const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const fixedHolidays = new Set(["01-01", "02-25", "04-09", "05-01", "06-12", "08-21", "11-01", "11-02", "11-30", "12-08", "12-24", "12-25", "12-30", "12-31"]);

function toMinutes(value) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  return hour * 60 + minute;
}

function timeLabel(value) {
  const [hour, minute] = value.split(":").map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayFor(date) {
  return dayNames[new Date(`${date}T12:00:00`).getDay()];
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
  const hours = settings.operatingHours || {};
  const closedDates = new Set(settings.closedDates || []);
  const minimumDate = localDateValue();
  document.querySelector("#app").innerHTML = `
    ${nav("booking")}
    <section class="section top">
      <div class="booking-layout">
        <div><p class="eyebrow">Online Booking</p><h2>Reserve before arriving.</h2><p class="muted">Online bookings require advance payment and include a PHP 100 booking fee. Walk-ins are handled by staff at the shop.</p><div class="panel"><h3>Selected summary</h3><div class="summary-list"><div><span>Service</span><strong>${selected.name}</strong></div><div><span>Cut price</span><strong>${peso(selected.price)}</strong></div><div><span>Online booking fee</span><strong>${peso(onlineFee)}</strong></div><div><span>Total advance payment</span><strong>${peso(Number(selected.price) + onlineFee)}</strong></div><div><span>Duration</span><strong>${selected.duration}</strong></div></div></div></div>
        <form class="form-card" data-booking><div class="account-booking-note"><span>Name staff will call</span><strong>${escapeAttr(state.user.name)}</strong><small>From your customer account</small></div><label>Service<select name="service">${serviceOptions()}</select></label><label>Preferred barber<select name="barber">${barberOptions()}</select><small data-barber-help>Select a date and time to check barber availability.</small></label>${hasBarbers ? "" : `<p class="muted">No active barber is assigned yet. Staff can assign one from the logbook.</p>`}<div class="form-row"><label>Date<input type="date" name="date" min="${minimumDate}" required></label><label>Available time<select name="time" required disabled><option value="">Choose a date first</option></select></label></div><p class="field-help" data-schedule-help>Reservations start at 1:00 PM. Closed days, holidays, past times, and times outside booking hours are unavailable.</p><label>Special request<textarea name="request" rows="4" placeholder="Fade preference, beard trim details, or notes"></textarea></label><button class="button primary full" type="submit">Proceed to payment</button></form>
      </div>
    </section>
  `;
  const dateInput = document.querySelector('[name="date"]');
  const timeInput = document.querySelector('[name="time"]');
  const scheduleHelp = document.querySelector("[data-schedule-help]");
  const serviceInput = document.querySelector('[name="service"]');
  const barberInput = document.querySelector('[name="barber"]');
  const barberHelp = document.querySelector("[data-barber-help]");
  let availabilityRequest = 0;
  const updateBarberAvailability = async () => {
    const request = ++availabilityRequest;
    const date = dateInput.value;
    const time = timeInput.value;
    barberInput.querySelectorAll("option").forEach((option) => {
      if (!option.value) return;
      const barber = barbers.find((item) => item.id === option.value);
      option.disabled = barber?.status === "on-leave";
      option.textContent = `${barber?.name || option.textContent}${barber?.status === "on-leave" ? " - on leave" : ""}`;
    });
    if (!date || !time) {
      barberHelp.textContent = "Select a date and time to check barber availability.";
      return;
    }
    try {
      const query = new URLSearchParams({ date, time, serviceId: serviceInput.value });
      const payload = await api(`/availability?${query}`);
      if (request !== availabilityRequest) return;
      const unavailable = new Set(payload.unavailableBarberIds || []);
      barberInput.querySelectorAll("option").forEach((option) => {
        if (!option.value) return;
        const barber = barbers.find((item) => item.id === option.value);
        const busy = unavailable.has(option.value);
        option.disabled = busy || barber?.status === "on-leave";
        option.textContent = `${barber?.name || option.textContent}${busy ? " - unavailable" : barber?.status === "on-leave" ? " - on leave" : ""}`;
      });
      if (barberInput.selectedOptions[0]?.disabled) {
        barberInput.value = "";
        toast("That barber is unavailable at this time. Choose another barber or assign later.");
      }
      barberHelp.textContent = unavailable.size ? "Unavailable barbers are disabled for this timeslot." : "All active barbers are available for this timeslot.";
    } catch (error) {
      if (request === availabilityRequest) barberHelp.textContent = error.message || "Availability could not be checked.";
    }
  };
  const updateTimes = () => {
    const date = dateInput.value;
    const shopHours = date ? hours[dayFor(date)] : null;
    const holiday = date && (fixedHolidays.has(date.slice(5)) || closedDates.has(date));
    if (!date || holiday || !shopHours || shopHours.closed) {
      timeInput.innerHTML = `<option value="">${date ? "Shop closed on this date" : "Choose a date first"}</option>`;
      timeInput.disabled = true;
      if (date) scheduleHelp.textContent = holiday ? "The selected date is a holiday or special shop closure." : "The shop is closed on the selected day.";
      return;
    }
    const service = byId(state.services, document.querySelector('[name="service"]').value);
    const duration = Math.max(30, Number.parseInt(service.duration, 10) || 30);
    const today = localDateValue();
    const now = new Date(Date.now() + 5 * 60 * 1000);
    const earliestToday = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
    const first = Math.max(toMinutes(shopHours.open), date === today ? earliestToday : 0);
    const last = toMinutes(shopHours.close) - duration;
    const slots = [];
    for (let value = Math.ceil(first / 30) * 30; value <= last; value += 30) {
      const slot = `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
      slots.push(`<option value="${slot}">${timeLabel(slot)}</option>`);
    }
    timeInput.innerHTML = slots.length ? `<option value="">Choose a time</option>${slots.join("")}` : `<option value="">No remaining times</option>`;
    timeInput.disabled = !slots.length;
    scheduleHelp.textContent = slots.length ? `Open ${timeLabel(shopHours.open)} to ${timeLabel(shopHours.close)}. Times fit the selected service duration.` : "No appointment times remain for this date.";
    updateBarberAvailability();
  };
  dateInput.addEventListener("change", updateTimes);
  serviceInput.addEventListener("change", updateTimes);
  timeInput.addEventListener("change", updateBarberAvailability);
  updateTimes();
  document.querySelector("[data-booking]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = event.submitter || event.target.querySelector('[type="submit"]');
    const data = new FormData(event.target);
    const appointmentTime = new Date(`${data.get("date")}T${data.get("time")}:00`);
    if (!Number.isFinite(appointmentTime.getTime()) || appointmentTime <= new Date()) {
      toast("Choose a date and time that has not already passed.");
      return;
    }
    if (timeInput.disabled || !timeInput.value) return toast("Choose an available date and time during shop hours.");
    const service = byId(state.services, data.get("service"));
    const booking = { customer: state.user.name, serviceId: data.get("service"), barberId: data.get("barber"), date: data.get("date"), time: data.get("time"), request: data.get("request"), source: "online", bookingFee: onlineFee, total: Number(service.price) + onlineFee };
    submitButton.disabled = true;
    submitButton.textContent = "Reserving slot...";
    try {
      const payload = await api("/appointment-holds", { method: "POST", body: JSON.stringify(booking) });
      state.booking = { ...booking, holdId: payload.hold.id, holdExpiresAt: payload.hold.expiresAt };
      state.selectedServiceId = booking.serviceId;
      state.selectedBarberId = booking.barberId;
      save();
      location.href = "payment.html";
    } catch (error) {
      toast(error.message || "That appointment time could not be reserved.");
      submitButton.disabled = false;
      submitButton.textContent = "Proceed to payment";
      await updateBarberAvailability();
    }
  });
  initHeader("booking");
}

render();
