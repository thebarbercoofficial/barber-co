const { state, nav, initHeader, avatar, toast, api, setSession, isAuthenticated, loadCatalog, byId, peso } = BarberCo;

if (!isAuthenticated()) {
  location.replace("login.html");
  throw new Error("Login required.");
}

function escapeValue(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

let myAppointments = [];

function bookingStatus(status, demo = false) {
  if (demo) return status === 'confirmed' ? 'Demo booking accepted' : status === 'completed' ? 'Demo completed' : status === 'cancelled' ? 'Demo cancelled' : 'Demo awaiting staff approval';
  return status === "confirmed" ? "Accepted and payment verified" : status === "completed" ? "Completed" : status === "cancelled" ? "Cancelled" : "Waiting for staff approval";
}

function bookingRows() {
  if (!myAppointments.length) return `<div class="empty-state">You have no online bookings yet.</div>`;
  return myAppointments.map((item) => `<div class="appointment-row"><span>${item.demoPayment ? 'DEMO / ' : ''}Queue #${String(item.queueNumber || 0).padStart(2, "0")}<br><small class="muted">${escapeValue(item.date)} at ${escapeValue(item.time)}</small></span><strong>${escapeValue(item.customer)}<br><small class="muted">${escapeValue(byId(state.services, item.serviceId).name)} - ${peso(item.total || 0)}${item.demoPayment ? ' (not charged)' : ''}</small></strong><span class="status-pill ${escapeValue(item.status)}">${bookingStatus(item.status, item.demoPayment)}</span></div>`).join("");
}

async function refreshBookings({ quiet = false } = {}) {
  try {
    const payload = await api("/appointments/mine");
    myAppointments = payload.appointments || [];
    const target = document.querySelector("[data-my-bookings]");
    if (target) target.innerHTML = bookingRows();
  } catch (error) { if (!quiet) toast(error.message || "Bookings could not be loaded."); }
}

function draw() {
  const user = state.user;
  document.querySelector("#app").innerHTML = `${nav("login")}<section class="section top"><div class="grid-2"><div class="panel profile-head">${avatar(user.name || user.email, user.photo || "")}<div><h2>${escapeValue(user.name || "Customer")}</h2><p class="muted">${escapeValue(user.location || "Profile details")}</p></div><label class="upload-box">Change display photo<input type="file" accept="image/jpeg,image/png,image/webp" data-photo></label></div><form class="form-card" data-profile><p class="eyebrow">User Profile</p><h2>Manage account</h2><label>Name<input name="name" required value="${escapeValue(user.name)}"></label><label>Email<input type="email" value="${escapeValue(user.email)}" readonly></label><label>Username<input name="username" value="${escapeValue(user.username)}"></label><label>Phone<input name="phone" value="${escapeValue(user.phone)}"></label><label>Location<input name="location" value="${escapeValue(user.location)}"></label><label>Bio<textarea name="bio" rows="4">${escapeValue(user.bio)}</textarea></label><button class="button primary full" type="submit">Save changes</button></form></div><div class="section" id="bookings"><div class="section-heading"><p class="eyebrow">Booking updates</p><h2>My bookings</h2><p class="muted">This list updates automatically when staff accepts, completes, or cancels a booking.</p></div><div class="panel" data-my-bookings>${bookingRows()}</div></div></section>`;

  document.querySelector("[data-profile]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const payload = await api("/me", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      setSession(payload);
      toast("Profile saved.");
      draw();
    } catch (error) { toast(error.message || "Profile could not be saved."); button.disabled = false; }
  });

  document.querySelector('[data-profile] [name="phone"]').closest('label').insertAdjacentHTML('afterend', `<label>Date of birth<input type="date" name="birthDate" value="${escapeValue(user.birthDate || '')}" max="${new Date().toLocaleDateString('en-CA')}"></label>`);
  document.querySelector('[data-profile]').insertAdjacentHTML('beforeend', `<p>${user.emailVerified ? 'Email verified' : 'Email not yet verified'}</p>${user.emailVerified ? '' : '<button class="button secondary" type="button" data-verify-email>Verify email</button>'}<p>${user.phoneVerified ? 'Mobile number verified' : 'Mobile number not verified'}</p><button class="button secondary" type="button" data-phone-code>Send SMS verification</button><label>SMS code<input data-phone-code-value inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label><label class="check-row"><input type="checkbox" data-sms-consent ${user.smsConsent ? 'checked' : ''}> Send appointment and queue updates to my verified number</label><button class="button secondary" type="button" data-verify-phone>Verify number and save SMS preference</button>`);
  document.querySelector('[data-verify-email]')?.addEventListener('click', async () => {
    try { await api('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: user.email }) }); location.href = `register.html?verify=${encodeURIComponent(user.email)}`; }
    catch (error) { toast(error.message); }
  });
  document.querySelector('[data-phone-code]').addEventListener('click', async () => {
    try { const payload = await api('/me/phone/send-code', { method: 'POST', body: '{}' }); toast(payload.message); } catch (error) { toast(error.message); }
  });
  document.querySelector('[data-verify-phone]').addEventListener('click', async () => {
    try { const payload = await api('/me/phone/verify', { method: 'POST', body: JSON.stringify({ code: document.querySelector('[data-phone-code-value]').value, smsConsent: document.querySelector('[data-sms-consent]').checked }) }); setSession(payload); toast('Mobile number verified.'); draw(); } catch (error) { toast(error.message); }
  });
  document.querySelector('[data-my-bookings]').insertAdjacentHTML('afterend', '<section><h3>Account notifications</h3><div data-account-notifications role="status">Loading updates...</div></section>');
  refreshNotifications();

  document.querySelector("[data-photo]").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast("Profile photo must be 2 MB or smaller.");
    const reader = new FileReader();
    reader.addEventListener("load", async () => {
      try {
        const payload = await api("/me", { method: "PATCH", body: JSON.stringify({ photo: reader.result }) });
        setSession(payload);
        toast("Display photo saved.");
        draw();
      } catch (error) { toast(error.message || "Display photo could not be saved."); }
    });
    reader.readAsDataURL(file);
  });
  initHeader("login");
}

Promise.all([api("/me"), loadCatalog()]).then(async ([payload]) => { setSession(payload); await refreshBookings({ quiet: true }); draw(); refreshBookings({ quiet: true }); }).catch((error) => {
  toast(error.message || "Profile could not be loaded.");
  if (/login|required|token/i.test(error.message)) location.replace("login.html");
});

window.setInterval(() => {
  if (!document.hidden) { refreshBookings({ quiet: true }); refreshNotifications(); }
}, 10000);

async function refreshNotifications() {
  try {
    const payload = await api('/notifications/mine');
    const target = document.querySelector('[data-account-notifications]');
    if (target) target.innerHTML = payload.notifications.map((item) => `<p>${escapeValue(item.message)}<br><small>${escapeValue(new Date(item.createdAt).toLocaleString())}</small></p>`).join('') || '<p>No account notifications yet.</p>';
  } catch { const target = document.querySelector('[data-account-notifications]'); if (target) target.textContent = 'Notifications could not be loaded. Retrying automatically.'; }
}
