const { state, barbers, nav, initHeader, byId, peso, save, toast, api } = BarberCo;

if (!BarberCo.isAuthenticated()) {
  location.replace("login.html?next=booking.html");
  throw new Error("A customer account is required to book.");
}

if (!state.booking?.date || !state.booking?.time) {
  location.replace("booking.html");
  throw new Error("Complete the booking details first.");
}
const booking = state.booking || { serviceId: state.selectedServiceId, barberId: state.selectedBarberId, date: "Not selected", time: "Not selected" };
const service = byId(state.services, booking.serviceId);
const bookingFee = Number(booking.bookingFee || 100);
const total = Number(booking.total || Number(service.price) + bookingFee);
if (state.paymentMethod === "Cash") {
  state.paymentMethod = "GCash";
  save();
}
document.querySelector("#app").innerHTML = `
  ${nav("booking")}
  <section class="section top">
    <div class="payment-layout">
      <div class="form-card"><p class="eyebrow">Advance Payment</p><h2>Reservation summary</h2><div class="summary-list"><div><span>Service</span><strong>${service.name}</strong></div><div><span>Barber</span><strong>${byId(barbers, booking.barberId).name}</strong></div><div><span>Date and time</span><strong>${booking.date} ${booking.time}</strong></div><div><span>Cut price</span><strong>${peso(service.price)}</strong></div><div><span>Online booking fee</span><strong>${peso(bookingFee)}</strong></div><div><span>Total advance payment</span><strong>${peso(total)}</strong></div></div><div class="payment-methods">${["GCash", "Maya"].map((m) => `<button class="method ${state.paymentMethod === m ? "active" : ""}" type="button" data-payment="${m}">${m}</button>`).join("")}</div><label class="upload-box">Upload proof of payment<input type="file" accept="image/jpeg,image/png,image/webp" data-payment-proof required><small>JPG, PNG, or WebP. Maximum 2 MB.</small></label><button class="button primary full" type="button" data-confirm-payment>Submit for verification</button></div>
      <div class="panel"><p class="eyebrow">Shop Payment</p><h2>${state.paymentMethod === "GCash" ? "GCash details" : "Manual verification"}</h2>${state.paymentMethod === "GCash" ? `<div class="summary-list"><div><span>Account name</span><strong>${state.admin.gcashName || "The Barber Co"}</strong></div><div><span>Number</span><strong>${state.admin.gcashNumber || "+63 900 000 0000"}</strong></div></div>${state.admin.gcashQr ? `<img class="qr-preview" src="${state.admin.gcashQr}" alt="The Barber Co GCash QR code">` : `<div class="empty-state">Admin has not uploaded a GCash QR yet.</div>`}` : `<p class="muted">Staff will confirm this payment manually at the shop.</p>`}</div>
    </div>
  </section>
`;
document.querySelectorAll("[data-payment]").forEach((button) => button.addEventListener("click", () => {
  state.paymentMethod = button.dataset.payment;
  save();
  location.reload();
}));
document.querySelector("[data-confirm-payment]").addEventListener("click", async () => {
  const button = document.querySelector("[data-confirm-payment]");
  const proofFile = document.querySelector("[data-payment-proof]").files[0];
  if (!proofFile) {
    toast("Upload your payment proof before submitting.");
    return;
  }
  if (proofFile.size > 2 * 1024 * 1024) {
    toast("Payment proof must be 2 MB or smaller.");
    return;
  }
  button.disabled = true;
  button.textContent = "Submitting...";
  try {
    const paymentProof = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Payment proof could not be read."));
      reader.readAsDataURL(proofFile);
    });
    const payload = await api("/appointments", {
      method: "POST",
      body: JSON.stringify({ ...booking, bookingFee, total, source: "online", paymentMethod: state.paymentMethod, paymentProof })
    });
    toast(`Booking created. Queue #${String(payload.appointment.queueNumber).padStart(2, "0")}.`);
    state.booking = null;
    save();
    window.setTimeout(() => { location.href = "queue.html"; }, 700);
  } catch (error) {
    toast(error.message || "The booking could not be submitted. Please try again.");
    button.disabled = false;
    button.textContent = "Submit for verification";
  }
});
initHeader("booking");
