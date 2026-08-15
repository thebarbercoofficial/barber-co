const { state, barbers, nav, initHeader, byId, peso, save, toast, api } = BarberCo;
const booking = state.booking || { serviceId: state.selectedServiceId, barberId: state.selectedBarberId, date: "Not selected", time: "Not selected" };
const service = byId(state.services, booking.serviceId);
document.querySelector("#app").innerHTML = `
  ${nav("booking")}
  <section class="section top">
    <div class="payment-layout">
      <div class="form-card"><p class="eyebrow">Payment Method</p><h2>Reservation summary</h2><div class="summary-list"><div><span>Service</span><strong>${service.name}</strong></div><div><span>Barber</span><strong>${byId(barbers, booking.barberId).name}</strong></div><div><span>Date and time</span><strong>${booking.date} ${booking.time}</strong></div><div><span>Total</span><strong>${peso(service.price)}</strong></div></div><div class="payment-methods">${["GCash", "Maya", "Cash"].map((m) => `<button class="method ${state.paymentMethod === m ? "active" : ""}" type="button" data-payment="${m}">${m}</button>`).join("")}</div><label class="upload-box">Upload proof of payment<input type="file"></label><button class="button primary full" type="button" data-confirm-payment>Submit for verification</button></div>
      <div class="panel"><p class="eyebrow">Manual Verification</p><h2>Ready for backend later.</h2><p class="muted">For now this creates a pending appointment and assigns a queue number.</p></div>
    </div>
  </section>
`;
document.querySelectorAll("[data-payment]").forEach((button) => button.addEventListener("click", () => {
  state.paymentMethod = button.dataset.payment;
  save();
  location.reload();
}));
document.querySelector("[data-confirm-payment]").addEventListener("click", async () => {
  try {
    const payload = await api("/appointments", {
      method: "POST",
      body: JSON.stringify({ ...booking, paymentMethod: state.paymentMethod })
    });
    toast(`Booking created. Queue #${String(payload.appointment.queueNumber).padStart(2, "0")}.`);
  } catch (error) {
    const nextId = Math.max(...state.appointments.map((item) => item.id)) + 1;
    state.appointments.push({ id: nextId, customer: state.user.name, barberId: booking.barberId, serviceId: booking.serviceId, time: booking.time || "Next available", status: "Pending", paid: state.paymentMethod !== "Cash" });
    save();
    toast(error.message === "Login required" ? "Please login first. Saved locally for now." : `Payment submitted. Queue #${String(nextId).padStart(2, "0")} created.`);
  }
  location.href = "queue.html";
});
initHeader("booking");
