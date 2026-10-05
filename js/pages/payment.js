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
  const demo = settings.paymentMode === 'demo';
  const paymentSettings = demo ? settings.demoMethods || {} : settings;
  const methods = [
    { id: "GCash", ...(paymentSettings.gcash || {}) },
    { id: "Maya", ...(paymentSettings.maya || {}) }
  ].filter((method) => method.enabled !== false && (method.accountNumber || method.qrImage));
  if (!methods.length) {
    document.querySelector("#app").innerHTML = `${nav("booking")}<section class="section top"><div class="panel"><p class="eyebrow">Payment unavailable</p><h2>Online payment is not configured yet.</h2><p class="muted">Your slot is only a temporary hold. No booking has been submitted for staff approval.</p>${BarberCo.canAccess('admin') ? '<a class="button primary" href="admin-profile.html">Set up payments</a><a class="button secondary" href="admin-schedule.html">View appointments</a>' : '<p class="muted">Please contact the shop or join the walk-in queue instead.</p>'}<a class="button secondary" href="queue.html?walkin=1">Join as walk-in</a></div></section>`;
    initHeader("booking");
    return;
  }
  if (!methods.some((method) => method.id === state.paymentMethod)) state.paymentMethod = methods[0].id;
  const selectedMethod = methods.find((method) => method.id === state.paymentMethod) || methods[0];
  const bookingFee = Math.max(0, Number(settings.bookingFee ?? 100));
  const total = Number(service.price) + bookingFee;
  const holdUntil = booking.holdExpiresAt ? new Date(booking.holdExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "the next 10 minutes";

  document.querySelector("#app").innerHTML = `
    ${nav("booking")}
    <section class="section top"><div class="payment-layout">
      <div class="form-card"><p class="eyebrow">${demo ? 'DEMO - NO REAL PAYMENT' : 'Advance Payment'}</p><h2>Reservation summary</h2><p class="field-help">This barber and time are held for you until ${holdUntil}.</p><div class="summary-list"><div><span>Service</span><strong>${service.name}</strong></div><div><span>Barber</span><strong>${byId(barbers, booking.barberId).name}</strong></div><div><span>Date and time</span><strong>${booking.date} ${booking.time}</strong></div><div><span>Cut price</span><strong>${peso(service.price)}</strong></div><div><span>Online booking fee</span><strong>${peso(bookingFee)}</strong></div><div><span>${demo ? 'Demo total (not charged)' : 'Total advance payment'}</span><strong>${peso(total)}</strong></div></div><div class="payment-methods">${methods.map((method) => `<button class="method ${state.paymentMethod === method.id ? "active" : ""}" type="button" data-payment="${method.id}">${method.id}${demo ? ' demo' : ''}</button>`).join("")}</div>${demo ? '<p class="field-help">No transfer or payment proof is needed for this demo.</p>' : '<label class="upload-box">Upload proof of payment<input type="file" accept="image/jpeg,image/png,image/webp" data-payment-proof required><small>JPG, PNG, or WebP. Maximum 2 MB.</small></label>'}<button class="button primary full" type="button" data-confirm-payment>${demo ? 'Submit demo booking' : 'Submit for verification'}</button></div>
      <div class="panel"><p class="eyebrow">${demo ? 'DEMO ONLY' : 'Pay with'} ${selectedMethod.id}</p><h2>${demo ? 'Sample payment details' : 'Scan or transfer'}</h2>${demo ? '<p class="field-help">This QR cannot receive money. Do not send a real payment.</p>' : ''}<div class="summary-list"><div><span>Account name</span><strong>${selectedMethod.accountName || "The Barber Co"}</strong></div><div><span>${demo ? 'Demo reference' : 'Number'}</span><strong>${selectedMethod.accountNumber || "Not provided"}</strong></div></div>${selectedMethod.qrImage ? `<img class="qr-preview" src="${selectedMethod.qrImage}" alt="${demo ? 'Non-payable demo' : 'The Barber Co'} ${selectedMethod.id} QR code">` : `<div class="empty-state">Use the account number above.</div>`}</div>
    </div></section>`;

  document.querySelectorAll("[data-payment]").forEach((button) => button.addEventListener("click", () => {
    state.paymentMethod = button.dataset.payment;
    save();
    render();
  }));
  document.querySelector("[data-confirm-payment]").addEventListener("click", async () => {
    const button = document.querySelector("[data-confirm-payment]");
    if (button.disabled) return;
    const proofFile = document.querySelector("[data-payment-proof]")?.files[0];
    if (!demo && !proofFile) return toast("Upload your payment proof before submitting.");
    if (proofFile?.size > 2 * 1024 * 1024) return toast("Payment proof must be 2 MB or smaller.");
    button.disabled = true;
    button.textContent = "Submitting...";
    try {
      const paymentProof = demo ? '' : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Payment proof could not be read."));
        reader.readAsDataURL(proofFile);
      });
      const payload = await api("/appointments", { method: "POST", body: JSON.stringify({ ...booking, paymentMethod: state.paymentMethod, paymentProof, paymentMode: settings.paymentMode || 'live' }) });
      toast(`Booking submitted for approval. Queue #${String(payload.appointment.queueNumber).padStart(2, "0")}.`);
      state.booking = null;
      save();
      window.setTimeout(() => { location.href = BarberCo.canAccess('moderator') ? 'admin-schedule.html' : 'user-profile.html#bookings'; }, 900);
    } catch (error) {
      toast(error.message || "The booking could not be submitted.");
      button.disabled = false;
      button.textContent = demo ? 'Submit demo booking' : 'Submit for verification';
    }
  });
  initHeader("booking");
}

render();
