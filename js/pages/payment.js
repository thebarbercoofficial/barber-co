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
let receiptFile = null;
const escapeText = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const partySize = Number(booking.partySize || 1);
const partyMembers = booking.partyMembers || [booking.customer || state.user.name];
function unitDuration(value) {
  const text = String(value || '').toLowerCase();
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/);
  return Math.max(30, hours || minutes ? Number(hours?.[1] || 0) * 60 + Number(minutes?.[1] || 0) : Number.parseFloat(text) || 30);
}

async function render() {
  let settings;
  try { settings = await loadSettings(); }
  catch (error) {
    document.querySelector('#app').innerHTML = `${nav('booking')}<section class="section top"><div class="panel"><h2>Payment details could not be loaded.</h2><p>Do not transfer money using old details. Retry to get the current recipient and amount.</p><button class="button primary" type="button" data-retry-payment>Retry</button></div></section>`;
    document.querySelector('[data-retry-payment]').addEventListener('click', render);
    initHeader('booking');
    return;
  }
  const demo = settings.paymentMode === 'demo';
  const paymentSettings = demo ? settings.demoMethods || {} : settings;
  const methods = [
    { id: "GCash", ...(paymentSettings.gcash || {}) },
    { id: "Maya", ...(paymentSettings.maya || {}) }
  ].filter((method) => method.enabled !== false && (method.accountNumber || method.qrImage));
  if (!methods.length) {
    document.querySelector("#app").innerHTML = `${nav("booking")}<section class="section top"><div class="panel"><p class="eyebrow">Payment unavailable</p><h2>Online payment is not configured yet.</h2><p class="muted">Checkout does not block this time for other customers. No booking has been submitted for staff approval.</p>${BarberCo.canAccess('admin') ? '<a class="button primary" href="admin-profile.html">Set up payments</a><a class="button secondary" href="admin-schedule.html">View appointments</a>' : '<p class="muted">Please contact the shop or join the walk-in queue instead.</p>'}<a class="button secondary" href="queue.html?walkin=1">Join as walk-in</a></div></section>`;
    initHeader("booking");
    return;
  }
  if (!methods.some((method) => method.id === state.paymentMethod)) state.paymentMethod = methods[0].id;
  const selectedMethod = methods.find((method) => method.id === state.paymentMethod) || methods[0];
  const bookingFee = Math.max(0, Number(booking.bookingFee ?? settings.bookingFee ?? 100));
  const total = Number(booking.total ?? (Number(service.price) * partySize + bookingFee));
  const duration = Number(booking.durationMinutes || (Number(booking.unitDurationMinutes ?? booking.serviceDurationMinutes) || unitDuration(service.duration)) * partySize);
  const checkoutUntil = booking.holdExpiresAt ? new Date(booking.holdExpiresAt).toLocaleString() : null;

  document.querySelector("#app").innerHTML = `
    ${nav("booking")}
    <section class="section top"><div class="payment-layout">
      <div class="form-card"><p class="eyebrow">${demo ? 'DEMO - NO REAL PAYMENT' : 'Advance Payment'}</p><h2>Appointment request summary</h2><p class="field-help">Pending request, not a guaranteed appointment. Checkout and pending requests do not block other customers. Only staff-approved bookings block time. Competing requests may be rejected. ${checkoutUntil ? `Checkout details expire ${escapeText(checkoutUntil)}; this does not reserve the time.` : ''}</p><div class="summary-list"><div><span>Service</span><strong>${service.name}</strong></div><div><span>Barber</span><strong>${byId(barbers, booking.barberId).name}</strong></div><div><span>Date and time</span><strong>${booking.date} ${booking.time}</strong></div><div><span>Group (${partySize} people)</span><strong>${partyMembers.map(escapeText).join(', ')}</strong></div><div><span>Duration</span><strong>${duration} minutes, sequential service with the same barber</strong></div><div><span>Service subtotal</span><strong>${peso(total - bookingFee)}</strong></div><div><span>One group booking fee</span><strong>${peso(bookingFee)}</strong></div><div><span>${demo ? 'Demo total (not charged)' : 'Total advance payment'}</span><strong>${peso(total)}</strong></div></div><div class="payment-methods">${methods.map((method) => `<button class="method ${state.paymentMethod === method.id ? "active" : ""}" type="button" data-payment="${method.id}">${method.id}${demo ? ' demo' : ''}</button>`).join("")}</div>
        ${demo ? '<p class="field-help">Upload a sample receipt for staff review. Do not send real money.</p>' : ''}
        <label class="upload-box payment-receipt-upload">${demo ? 'Upload sample payment receipt' : 'Upload proof of payment'}<input type="file" accept="image/jpeg,image/png,image/webp" data-payment-proof required><small>JPG, PNG, or WebP. Maximum 2 MB.</small></label>
        <p class="field-help">Before submitting: payment does not guarantee approval. Competing requests may be rejected. Your group receives the same service sequentially with one barber, not simultaneous appointments.</p><button class="button primary full" type="button" data-confirm-payment>${demo ? 'Submit demo booking' : 'Submit for verification'}</button></div>
      <div class="panel"><p class="eyebrow">${demo ? 'DEMO ONLY' : 'Pay with'} ${selectedMethod.id}</p><h2>${demo ? 'Sample payment details' : 'Scan or transfer'}</h2>${demo ? '<p class="field-help">This QR cannot receive money. Do not send a real payment.</p>' : ''}<div class="summary-list"><div><span>Account name</span><strong>${selectedMethod.accountName || "The Barber Co"}</strong></div><div><span>${demo ? 'Demo reference' : 'Number'}</span><strong>${selectedMethod.accountNumber || "Not provided"}</strong></div></div>${selectedMethod.qrImage ? `<img class="qr-preview" src="${selectedMethod.qrImage}" alt="${demo ? 'Non-payable demo' : 'The Barber Co'} ${selectedMethod.id} QR code">` : `<div class="empty-state">Use the account number above.</div>`}</div>
    </div></section>`;

  if (booking.request) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = 'Special request';
    const value = document.createElement('strong');
    value.textContent = booking.request;
    row.append(label, value);
    document.querySelector('.form-card .summary-list').append(row);
  }
  const proofInput = document.querySelector('[data-payment-proof]');
  const policyNotice = document.createElement('p');
  document.querySelector('[data-confirm-payment]').insertAdjacentHTML('beforebegin', `<p class="field-help">Check in with staff within ${Number(settings.gracePeriodMinutes ?? 10)} minutes after your appointment. Each group member must arrive. No-shows lose their reserved time without a refund; late customers may join as walk-ins.</p>`);
  policyNotice.className = 'field-help';
  policyNotice.innerHTML = 'Bookings are non-refundable, including the service payment and booking fee. <a class="inline" href="#booking-terms" data-payment-terms>Read our booking terms and policy</a> before paying.';
  document.querySelector('.form-card .summary-list').after(policyNotice);
  policyNotice.querySelector('a').onclick = (event) => { event.preventDefault(); BookingPolicy.terms(); };
  if (receiptFile) {
    const transfer = new DataTransfer();
    transfer.items.add(receiptFile);
    proofInput.files = transfer.files;
  }
  proofInput.addEventListener('change', () => { receiptFile = proofInput.files[0] || null; });
  document.querySelectorAll("[data-payment]").forEach((button) => button.addEventListener("click", () => {
    state.paymentMethod = button.dataset.payment;
    save();
    render();
  }));
  document.querySelector("[data-confirm-payment]").addEventListener("click", async () => {
    const button = document.querySelector("[data-confirm-payment]");
    if (button.disabled) return;
    const proofFile = document.querySelector("[data-payment-proof]")?.files[0];
    if (!proofFile) return toast("Upload your payment proof before submitting.");
    if (proofFile?.size > 2 * 1024 * 1024) return toast("Payment proof must be 2 MB or smaller.");
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(proofFile.type)) return toast("Payment proof must be a JPG, PNG, or WebP image.");
    button.disabled = true;
    if (!await BookingPolicy.confirm(demo)) { button.disabled = false; return; }
    button.textContent = "Submitting...";
    try {
      const latest = await loadSettings();
      if (latest.paymentRevision !== settings.paymentRevision || latest.paymentMode !== settings.paymentMode) {
        toast('Payment details changed. Check the updated recipient and total. If you already paid, contact the shop before paying again.');
        await render();
        return;
      }
      const paymentProof = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Payment proof could not be read."));
        reader.readAsDataURL(proofFile);
      });
      const payload = await api("/appointments", { method: "POST", body: JSON.stringify({ ...booking, partySize, partyMembers, total, bookingFee, durationMinutes: duration, nonRefundableAccepted: true, paymentMethod: state.paymentMethod, paymentProof, paymentMode: settings.paymentMode || 'live', paymentRevision: settings.paymentRevision }) });
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
