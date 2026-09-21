const { state, barbers, nav, initHeader, byId, peso, save, toast, api, loadSettings } = BarberCo;

if (!BarberCo.isAuthenticated()) {
  location.replace("login.html?next=booking.html");
  throw new Error("A customer account is required to book.");
}
if (!state.booking?.date || !state.booking?.time) {
  location.replace("booking.html");
  throw new Error("Complete the booking details first.");
}

const booking = state.booking;
const service = byId(state.services, booking.serviceId);

async function render() {
  let settings;
  try { settings = await loadSettings(); }
  catch (error) { toast(error.message || "Payment details could not be loaded."); settings = state.shopSettings || {}; }
  const methods = [
    { id: "GCash", ...(settings.gcash || {}) },
    { id: "Maya", ...(settings.maya || {}) }
  ].filter((method) => method.enabled !== false && (method.accountNumber || method.qrImage));
  if (!methods.length) {
    document.querySelector("#app").innerHTML = `${nav("booking")}<section class="section top"><div class="panel"><p class="eyebrow">Payment unavailable</p><h2>Online payment is not configured yet.</h2><p class="muted">Please contact the shop or join the walk-in queue instead.</p><a class="button primary" href="queue.html?walkin=1">Join as walk-in</a></div></section>`;
    initHeader("booking");
    return;
  }
  if (!methods.some((method) => method.id === state.paymentMethod)) state.paymentMethod = methods[0].id;
  const selectedMethod = methods.find((method) => method.id === state.paymentMethod) || methods[0];
  const bookingFee = Math.max(0, Number(settings.bookingFee ?? 100));
  const total = Number(service.price) + bookingFee;

  document.querySelector("#app").innerHTML = `
    ${nav("booking")}
    <section class="section top"><div class="payment-layout">
      <div class="form-card"><p class="eyebrow">Advance Payment</p><h2>Reservation summary</h2><div class="summary-list"><div><span>Service</span><strong>${service.name}</strong></div><div><span>Barber</span><strong>${byId(barbers, booking.barberId).name}</strong></div><div><span>Date and time</span><strong>${booking.date} ${booking.time}</strong></div><div><span>Cut price</span><strong>${peso(service.price)}</strong></div><div><span>Online booking fee</span><strong>${peso(bookingFee)}</strong></div><div><span>Total advance payment</span><strong>${peso(total)}</strong></div></div><div class="payment-methods">${methods.map((method) => `<button class="method ${state.paymentMethod === method.id ? "active" : ""}" type="button" data-payment="${method.id}">${method.id}</button>`).join("")}</div><label class="upload-box">Upload proof of payment<input type="file" accept="image/jpeg,image/png,image/webp" data-payment-proof required><small>JPG, PNG, or WebP. Maximum 2 MB.</small></label><button class="button primary full" type="button" data-confirm-payment>Submit for verification</button></div>
      <div class="panel"><p class="eyebrow">Pay with ${selectedMethod.id}</p><h2>Scan or transfer</h2><div class="summary-list"><div><span>Account name</span><strong>${selectedMethod.accountName || "The Barber Co"}</strong></div><div><span>Number</span><strong>${selectedMethod.accountNumber || "Not provided"}</strong></div></div>${selectedMethod.qrImage ? `<img class="qr-preview" src="${selectedMethod.qrImage}" alt="The Barber Co ${selectedMethod.id} QR code">` : `<div class="empty-state">Use the account number above.</div>`}</div>
    </div></section>`;

  document.querySelectorAll("[data-payment]").forEach((button) => button.addEventListener("click", () => {
    state.paymentMethod = button.dataset.payment;
    save();
    render();
  }));
  document.querySelector("[data-confirm-payment]").addEventListener("click", async () => {
    const button = document.querySelector("[data-confirm-payment]");
    const proofFile = document.querySelector("[data-payment-proof]").files[0];
    if (!proofFile) return toast("Upload your payment proof before submitting.");
    if (proofFile.size > 2 * 1024 * 1024) return toast("Payment proof must be 2 MB or smaller.");
    button.disabled = true;
    button.textContent = "Submitting...";
    try {
      const paymentProof = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Payment proof could not be read."));
        reader.readAsDataURL(proofFile);
      });
      const payload = await api("/appointments", { method: "POST", body: JSON.stringify({ ...booking, paymentMethod: state.paymentMethod, paymentProof }) });
      toast(`Booking created. Queue #${String(payload.appointment.queueNumber).padStart(2, "0")}.`);
      state.booking = null;
      save();
      window.setTimeout(() => { location.href = "queue.html"; }, 700);
    } catch (error) {
      toast(error.message || "The booking could not be submitted.");
      button.disabled = false;
      button.textContent = "Submit for verification";
    }
  });
  initHeader("booking");
}

render();
