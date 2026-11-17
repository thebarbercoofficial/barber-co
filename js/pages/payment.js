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
let checkoutTimer;
let validationRunning = false;
let bookingPaymentMethod = 'online';
async function validateSplitCheckout(settings) {
  const result = await api('/checkout/validate', { method: 'POST', body: JSON.stringify({ holdId: booking.holdId, paymentRevision: settings.paymentRevision, bookingPaymentMethod }) });
  if (result.splitPaymentVersion !== 1 || !result.bookingPaymentChoices?.includes('onsite')) {
    const message = 'Updated booking payment options are unavailable. Do not transfer money. Contact the shop if you already paid.';
    invalidateCheckout(message);
    throw new Error(message);
  }
  return result;
}
function mountRecovery() {
  document.querySelector('#app').insertAdjacentHTML('beforeend', '<section class="section"><details class="panel"><summary>Already paid but could not submit?</summary><form data-payment-recovery><label>Wallet transaction reference<input name="reference" required maxlength="120"></label><label>Payment proof<input name="proof" type="file" accept="image/jpeg,image/png,image/webp" required></label><button class="button secondary" type="submit">Send proof to staff</button><p role="status" data-recovery-status></p></form></details></section>');
  document.querySelector('[data-payment-recovery]').onsubmit = async event => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button');
    if (button.disabled) return;
    const file = form.elements.proof.files[0];
    if (!file || file.size > 2 * 1024 * 1024) return toast('Choose a receipt image up to 2 MB.');
    button.disabled = true;
    try {
      const paymentProof = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read receipt.')); reader.readAsDataURL(file); });
      const result = await api('/payments/recovery', { method: 'POST', body: JSON.stringify({ reference: form.elements.reference.value, paymentProof, date: booking.date, time: booking.time }) });
      form.querySelector('[data-recovery-status]').textContent = `${result.message} Case: ${result.reference}`;
    } catch (error) { form.querySelector('[data-recovery-status]').textContent = error.message; button.disabled = false; }
  };
}
function invalidateCheckout(message) {
  clearInterval(checkoutTimer);
  const panel = document.querySelector('.payment-layout .form-card');
  if (panel) { const warning = document.createElement('p'); warning.setAttribute('role', 'alert'); warning.textContent = message; panel.prepend(warning); }
  document.querySelectorAll('[data-online-payment], [data-online-instructions], [data-onsite-payment]').forEach((element) => { element.hidden = true; });
  document.querySelector('[data-online-instructions]')?.replaceChildren();
  const button = document.querySelector('[data-confirm-payment]');
  if (button) { button.disabled = true; button.textContent = 'Checkout unavailable'; }
}
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
  clearInterval(checkoutTimer);
  if (partySize !== 1 || !Array.isArray(partyMembers) || partyMembers.length !== 1) {
    document.querySelector('#app').innerHTML = `${nav('booking')}<section class="section top"><div class="panel"><h2>Start a single-person booking</h2><p>Group bookings are no longer available. Do not send payment for this checkout.</p><a class="button primary" href="booking.html">Start again</a></div></section>`;
    mountRecovery();
    initHeader('booking');
    return;
  }
  let settings;
  try { settings = await loadSettings(); }
  catch (error) {
    document.querySelector('#app').innerHTML = `${nav('booking')}<section class="section top"><div class="panel"><h2>Payment details could not be loaded.</h2><p>Do not transfer money using old details. Retry to get the current recipient and amount.</p><button class="button primary" type="button" data-retry-payment>Retry</button></div></section>`;
    document.querySelector('[data-retry-payment]').addEventListener('click', render);
    initHeader('booking');
    mountRecovery();
    return;
  }
  const paymentSettings = settings.paymentMode === 'demo' ? {} : settings;
  const methods = [
    { id: "GCash", ...(paymentSettings.gcash || {}) },
    { id: "Maya", ...(paymentSettings.maya || {}) }
  ].filter((method) => method.enabled !== false && (method.accountNumber || method.qrImage));
  if (!methods.length) bookingPaymentMethod = 'onsite';
  try {
    await validateSplitCheckout(settings);
  } catch (error) {
    document.querySelector('#app').innerHTML = `${nav('booking')}<section class="section top"><div class="panel"><h2>Checkout unavailable</h2><p data-checkout-error></p><a class="button primary" href="booking.html">Start a new booking</a></div></section>`;
    document.querySelector('[data-checkout-error]').textContent = error.message;
    mountRecovery(); initHeader('booking'); return;
  }
  drawCheckout(settings, methods);
}

function drawCheckout(settings, methods) {
  clearInterval(checkoutTimer);
  const demo = false;
  const servicePaymentMethod = bookingPaymentMethod === 'onsite' ? 'cash' : 'online';
  if (methods.length && !methods.some((method) => method.id === state.paymentMethod)) state.paymentMethod = methods[0].id;
  const selectedMethod = methods.find((method) => method.id === state.paymentMethod) || methods[0];
  const bookingFee = Math.max(0, Number(booking.bookingFee ?? settings.bookingFee ?? 100));
  const total = Number(booking.total ?? (Number(service.price) + bookingFee));
  const onlineAmount = bookingPaymentMethod === 'onsite' ? 0 : total;
  const cashDue = bookingPaymentMethod === 'onsite' ? total : 0;
  const duration = Number(booking.durationMinutes || Number(booking.unitDurationMinutes ?? booking.serviceDurationMinutes) || unitDuration(service.duration));
  const checkoutUntil = booking.holdExpiresAt ? new Date(booking.holdExpiresAt).toLocaleString() : null;

  document.querySelector("#app").innerHTML = `
    ${nav("booking")}
    <section class="section top"><div class="payment-layout ${bookingPaymentMethod === 'onsite' ? 'onsite-mode' : ''}">
      <div class="form-card"><p class="eyebrow">Booking payment</p><h2>Appointment request summary</h2><p class="field-help">Time is reserved only after staff approval. ${checkoutUntil ? `Checkout details expire ${escapeText(checkoutUntil)}; this does not reserve the time.` : ''}</p><div class="summary-list"><div><span>Service</span><strong>${service.name}</strong></div><div><span>Barber</span><strong>${byId(barbers, booking.barberId).name}</strong></div><div><span>Date and time</span><strong>${booking.date} ${BarberCo.timeLabel(booking.time)}</strong></div><div><span>Customer</span><strong>${escapeText(booking.customer || state.user.name)}</strong></div><div><span>Duration</span><strong>${duration} minutes</strong></div><div><span>Service price</span><strong>${peso(total - bookingFee)}</strong></div><div><span>Booking fee</span><strong>${peso(bookingFee)}</strong></div><div><span>Total</span><strong>${peso(total)}</strong></div><div><span>Pay online now</span><strong>${peso(onlineAmount)}</strong></div><div><span>Due at shop</span><strong>${peso(cashDue)}</strong></div></div>
        <fieldset class="payment-methods"><legend>How would you like to pay?</legend><label><input type="radio" name="booking-payment" value="online" ${bookingPaymentMethod === 'online' ? 'checked' : ''} ${methods.length ? '' : 'disabled'}> Pay online</label><label><input type="radio" name="booking-payment" value="onsite" ${bookingPaymentMethod === 'onsite' ? 'checked' : ''}> Pay at the shop</label></fieldset>
        ${bookingPaymentMethod === 'online' ? `<div data-online-payment><div class="payment-methods">${methods.map((method) => `<button class="method ${state.paymentMethod === method.id ? "active" : ""}" type="button" data-payment="${method.id}">${method.id}</button>`).join("")}</div><label class="upload-box payment-receipt-upload">Upload proof of payment<input type="file" accept="image/jpeg,image/png,image/webp" data-payment-proof required><small>JPG, PNG, or WebP. Maximum 2 MB.</small></label><p class="field-help">Online payment is subject to staff approval.</p></div>` : ''}
        ${bookingPaymentMethod === 'onsite' ? `<p class="field-help" data-onsite-payment>Pay the full ${peso(total)} at the shop after your service. No online transfer or receipt is needed.</p>` : ''}
        ${methods.length ? '' : '<p class="field-help">Online payment is currently unavailable.</p>'}
        <button class="button primary full" type="button" data-confirm-payment>${bookingPaymentMethod === 'onsite' ? 'Submit booking (pay at shop)' : 'Submit online payment for review'}</button></div>
      ${bookingPaymentMethod === 'online' ? `<div class="panel" data-online-instructions><p class="eyebrow">Pay with ${selectedMethod?.id || 'online payment'}</p><h2>Scan or transfer</h2><div class="summary-list"><div><span>Account name</span><strong>${selectedMethod?.accountName || "The Barber Co"}</strong></div><div><span>Number</span><strong>${selectedMethod?.accountNumber || "Not provided"}</strong></div><div><span>Transfer amount</span><strong>${peso(onlineAmount)}</strong></div></div>${selectedMethod?.qrImage ? `<img class="qr-preview" src="${selectedMethod.qrImage}" alt="The Barber Co ${selectedMethod.id} QR code">` : `<div class="empty-state">${methods.length ? 'Use the account number above.' : 'Online payment is not configured.'}</div>`}</div>` : ''}
    </div></section>`;

  document.querySelectorAll('[name="booking-payment"]').forEach(input => input.addEventListener('change', () => {
    bookingPaymentMethod = input.value;
    receiptFile = null;
    drawCheckout(settings, methods);
  }));
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
  document.querySelector('[data-confirm-payment]').insertAdjacentHTML('beforebegin', `<p class="field-help">Check in with staff within ${Number(settings.gracePeriodMinutes ?? 10)} minutes after your appointment. No-shows lose their reserved time without a refund; late customers may join as walk-ins.</p>`);
  policyNotice.className = 'field-help';
  policyNotice.innerHTML = `${bookingPaymentMethod === 'onsite' ? 'Pay-at-shop bookings are not charged if you cancel or do not attend.' : 'Online payments and any booking fee already collected are non-refundable for customer cancellations and no-shows. If the shop rejects a pending paid request, staff must verify the transfer and arrange a manual refund.'} <a class="inline" href="#booking-terms" data-payment-terms>Read our booking terms and policy</a> before submitting.`;
  document.querySelector('.form-card .summary-list').after(policyNotice);
  policyNotice.querySelector('a').onclick = (event) => { event.preventDefault(); BookingPolicy.terms(); };
  if (receiptFile && proofInput) {
    const transfer = new DataTransfer();
    transfer.items.add(receiptFile);
    proofInput.files = transfer.files;
  }
  proofInput?.addEventListener('change', () => { receiptFile = proofInput.files[0] || null; });
  document.querySelectorAll("[data-payment]").forEach((button) => button.addEventListener("click", () => {
    state.paymentMethod = button.dataset.payment;
    save();
    drawCheckout(settings, methods);
  }));
  document.querySelector("[data-confirm-payment]").addEventListener("click", async () => {
    const button = document.querySelector("[data-confirm-payment]");
    if (button.disabled) return;
    if (!(new Date(booking.holdExpiresAt).getTime() > Date.now())) { invalidateCheckout('Checkout expired. Do not transfer money. Start a new booking or send payment recovery below if already paid.'); return; }
    const proofFile = document.querySelector("[data-payment-proof]")?.files[0];
    if (bookingPaymentMethod === 'online' && !proofFile) return toast("Upload your payment proof before submitting.");
    if (proofFile && proofFile.size > 2 * 1024 * 1024) return toast("Payment proof must be 2 MB or smaller.");
    if (proofFile && !['image/jpeg', 'image/png', 'image/webp'].includes(proofFile.type)) return toast("Payment proof must be a JPG, PNG, or WebP image.");
    button.disabled = true;
    let smsConsent = false;
    if (!await BookingPolicy.confirm(demo, bookingPaymentMethod === 'onsite', value => { smsConsent = value; })) { button.disabled = false; return; }
    button.textContent = "Submitting...";
    try {
      const latest = await loadSettings();
      await validateSplitCheckout(settings);
      if (latest.paymentRevision !== settings.paymentRevision || latest.paymentMode !== settings.paymentMode) {
        toast('Payment details changed. Check the updated recipient and total. If you already paid, contact the shop before paying again.');
        await render();
        return;
      }
      const paymentProof = bookingPaymentMethod === 'onsite' ? '' : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Payment proof could not be read."));
        reader.readAsDataURL(proofFile);
      });
      await validateSplitCheckout(settings);
      const payload = await api("/appointments", { method: "POST", body: JSON.stringify({ ...booking, smsConsent, total, bookingFee, bookingPaymentMethod, servicePaymentMethod, durationMinutes: duration, nonRefundableAccepted: true, paymentMethod: bookingPaymentMethod === 'onsite' ? 'On-site' : state.paymentMethod, paymentProof, paymentMode: settings.paymentMode || 'live', paymentRevision: settings.paymentRevision }) });
      toast(`${payload.appointment.status === 'confirmed' ? 'Booking confirmed. Pay at the shop.' : 'Booking submitted for payment verification.'} Queue #${String(payload.appointment.queueNumber).padStart(2, "0")}.`);
      state.booking = null;
      save();
      window.setTimeout(() => { location.href = BarberCo.canAccess('moderator') ? 'admin-schedule.html' : 'user-profile.html#bookings'; }, 900);
    } catch (error) {
      toast(error.message || "The booking could not be submitted.");
      button.disabled = false;
      button.textContent = bookingPaymentMethod === 'onsite' ? 'Submit booking (pay at shop)' : 'Submit online payment for review';
    }
  });
  if (bookingPaymentMethod === 'online') mountRecovery();
  let ticks = 0;
  checkoutTimer = setInterval(async () => {
    if (!(new Date(booking.holdExpiresAt).getTime() > Date.now())) { invalidateCheckout('Checkout expired. Do not transfer money. Start again or submit payment recovery below.'); return; }
    if (++ticks % 30 || validationRunning) return;
    validationRunning = true;
    try { await validateSplitCheckout(settings); }
    catch (error) { invalidateCheckout(error.message); }
    finally { validationRunning = false; }
  }, 1000);
  initHeader("booking");
}

render();
