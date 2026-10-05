const { state, nav, initHeader, adminSidebar, avatar, api, loadSettings, toast, icon, safeText } = BarberCo;

if (!BarberCo.canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

const draft = { gcashQr: "", mayaQr: "" };
const dayNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const defaultHours = {
  monday: { open: "13:00", close: "20:00" }, tuesday: { open: "13:00", close: "20:00" },
  wednesday: { open: "13:00", close: "20:00" }, thursday: { open: "13:00", close: "20:00" },
  friday: { open: "13:00", close: "20:00" }, saturday: { open: "13:00", close: "20:00" },
  sunday: { open: "13:00", close: "20:00" }
};

function scheduleRows(operatingHours = {}) {
  return dayNames.map((day) => {
    const hours = { ...defaultHours[day], ...(operatingHours[day] || {}) };
    return `<div class="schedule-setting-row"><strong>${day[0].toUpperCase()}${day.slice(1)}</strong><label>Opens<input type="time" name="${day}Open" value="${hours.open}"></label><label>Closes<input type="time" name="${day}Close" value="${hours.close}"></label><label class="check-row"><input type="checkbox" name="${day}Closed" ${hours.closed ? "checked" : ""}> Closed</label></div>`;
  }).join("");
}

function readImage(file) {
  if (!file) return Promise.resolve("");
  if (file.size > 2 * 1024 * 1024) return Promise.reject(new Error("QR image must be 2 MB or smaller."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The QR image could not be read."));
    reader.readAsDataURL(file);
  });
}

async function render() {
  let settings;
  try {
    settings = await loadSettings();
  } catch (error) {
    toast(error.message || "Payment settings could not be loaded.");
    settings = state.shopSettings || {};
  }
  const gcash = settings.gcash || { enabled: true, accountName: "", accountNumber: "", qrImage: "" };
  const maya = settings.maya || { enabled: false, accountName: "", accountNumber: "", qrImage: "" };
  const operatingHours = settings.operatingHours || defaultHours;
  draft.gcashQr = draft.gcashQr || gcash.qrImage || "";
  draft.mayaQr = draft.mayaQr || maya.qrImage || "";

  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("profile")}
      <div class="workspace">
        <div class="workspace-heading"><div><p class="eyebrow">ADMINISTRATOR ONLY</p><h1>Shop settings</h1><p class="muted">Payment methods, booking hours, and shop closures.</p></div><span class="count-badge">${icon('LockKeyhole')} Admin access</span></div>
        <div class="settings-layout">
          <div class="panel profile-head settings-account">
            ${avatar(state.user.name || "The Barber Co Admin", state.user.photo || "")}
            <h2>${safeText(state.user.name || "The Barber Co Admin")}</h2>
            <p class="muted">Moderators cannot view or change these payment settings.</p>
            <a class="button secondary" href="printables/walk-in-qr.html" target="_blank" rel="noreferrer">${icon('QrCode')} Shop walk-in QR</a>
          </div>
          <form class="form-card settings-form" data-payment-settings>
            <div class="settings-group schedule-group">
              <h3 class="settings-group-title">Payment mode</h3>
              <label class="check-row"><input type="checkbox" name="demoPayments" ${settings.paymentMode === 'demo' ? 'checked' : ''}> Demo payments (no real money)</label>
              <p class="muted" data-payment-mode-note></p>
              <label class="check-row" data-recipient-confirmation><input type="checkbox" name="paymentDetailsConfirmed" ${settings.paymentDetailsConfirmed ? 'checked' : ''}> I checked the recipient in GCash/Maya and confirmed these details belong to the shop.</label>
            </div>
            <label>Online booking fee<input type="number" min="0" name="bookingFee" value="${Number(settings.bookingFee ?? 100)}" required></label>
            <div class="settings-group" role="group" aria-labelledby="gcash-settings-title">
              <h3 class="settings-group-title" id="gcash-settings-title">GCash</h3>
              <label class="check-row"><input type="checkbox" name="gcashEnabled" ${gcash.enabled !== false ? "checked" : ""}> Accept GCash</label>
              <div class="form-row"><label>Account name<input name="gcashName" value="${safeText(gcash.accountName || "")}"></label><label>Mobile number<input type="tel" inputmode="tel" name="gcashNumber" placeholder="09XXXXXXXXX" value="${safeText(gcash.accountNumber || "")}"></label></div>
              <label class="upload-box">Choose GCash QR image<input type="file" accept="image/jpeg,image/png,image/webp" data-qr="gcash"><small>Use the QR image from the official GCash account. Maximum 2 MB.</small></label>
              <div data-qr-preview="gcash">${draft.gcashQr ? `<img class="qr-preview" src="${safeText(draft.gcashQr)}" alt="Saved GCash QR code">` : `<div class="empty-state">No GCash QR uploaded yet.</div>`}</div>
              <button class="button secondary small" type="button" data-qr-clear="gcash">Remove QR</button>
              <div data-demo-preview><p class="muted">Demo GCash / no money transfer</p><img class="qr-preview" src="images/demo-gcash-qr.png" alt="Non-payable demo GCash QR"></div>
            </div>
            <div class="settings-group" role="group" aria-labelledby="maya-settings-title">
              <h3 class="settings-group-title" id="maya-settings-title">Maya</h3>
              <label class="check-row"><input type="checkbox" name="mayaEnabled" ${maya.enabled ? "checked" : ""}> Accept Maya</label>
              <div class="form-row"><label>Account name<input name="mayaName" value="${safeText(maya.accountName || "")}"></label><label>Mobile number<input type="tel" inputmode="tel" name="mayaNumber" placeholder="09XXXXXXXXX" value="${safeText(maya.accountNumber || "")}"></label></div>
              <label class="upload-box">Choose Maya QR image<input type="file" accept="image/jpeg,image/png,image/webp" data-qr="maya"><small>Use the QR image from the official Maya account. Maximum 2 MB.</small></label>
              <div data-qr-preview="maya">${draft.mayaQr ? `<img class="qr-preview" src="${safeText(draft.mayaQr)}" alt="Saved Maya QR code">` : `<div class="empty-state">No Maya QR uploaded yet.</div>`}</div>
              <button class="button secondary small" type="button" data-qr-clear="maya">Remove QR</button>
              <div data-demo-preview><p class="muted">Demo Maya / no money transfer</p><img class="qr-preview" src="images/demo-maya-qr.png" alt="Non-payable demo Maya QR"></div>
            </div>
            <div class="settings-group schedule-group" role="group" aria-labelledby="schedule-settings-title">
              <h3 class="settings-group-title" id="schedule-settings-title">Booking schedule</h3>
              <p class="muted">Online reservations start at 1:00 PM by default. Customers only receive time slots that fit inside these hours. Mark a day closed to remove it from booking.</p>
              <div class="schedule-settings">${scheduleRows(operatingHours)}</div>
              <label>Holiday and special closure dates<textarea name="closedDates" rows="4" placeholder="2026-12-24, 2026-12-31">${(settings.closedDates || []).join("\n")}</textarea><small>Enter one date per line or separate dates with commas. Fixed Philippine national holidays are blocked automatically.</small></label>
            </div>
            <button class="button primary full" type="submit">${icon('Save')} Save shop settings</button>
          </form>
        </div>
      </div>
    </section>`;

  const updateMode = () => {
    const demo = document.querySelector('[name="demoPayments"]').checked;
    document.querySelector('[data-payment-mode-note]').textContent = demo ? 'GCash and Maya demo options are active. Demo bookings are labeled and excluded from real booking/revenue analytics. Real details below are saved separately.' : 'Real payments: mobile numbers must use Philippine format. Uploaded QRs must be reusable QRPh payment codes. Account ownership is not automatically verified.';
    document.querySelector('[data-recipient-confirmation]').style.display = demo ? 'none' : '';
    document.querySelector('[name="paymentDetailsConfirmed"]').required = !demo;
    document.querySelectorAll('[data-demo-preview]').forEach((element) => { element.style.display = demo ? '' : 'none'; });
  };
  document.querySelector('[name="demoPayments"]').addEventListener('change', updateMode);
  updateMode();
  document.querySelectorAll('[data-qr-clear]').forEach((button) => button.addEventListener('click', () => {
    const method = button.dataset.qrClear;
    draft[`${method}Qr`] = '';
    document.querySelector(`[data-qr="${method}"]`).value = '';
    document.querySelector(`[data-qr-preview="${method}"]`).innerHTML = '<div class="empty-state">No QR image selected.</div>';
  }));

  document.querySelectorAll("[data-qr]").forEach((input) => input.addEventListener("change", async (event) => {
    const saveButton = document.querySelector('[data-payment-settings] [type="submit"]');
    saveButton.disabled = true;
    try {
      const image = await readImage(event.target.files[0]);
      if (!image) return;
      const { validation } = await api('/admin/payment-qr/validate', { method: 'POST', body: JSON.stringify({ qrImage: image }) });
      if (event.target.dataset.qr === "gcash") draft.gcashQr = image;
      else draft.mayaQr = image;
      const preview = document.querySelector(`[data-qr-preview="${event.target.dataset.qr}"]`);
      preview.innerHTML = `<img class="qr-preview" src="${safeText(image)}" alt="Selected payment QR code"><small>${safeText(validation.format)} QR read. Recipient: ${safeText(validation.recipient)}. Confirm this recipient in your wallet app.</small>`;
    } catch (error) { event.target.value = ''; toast(error.message); }
    finally { saveButton.disabled = false; }
  }));

  document.querySelector("[data-payment-settings]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const data = new FormData(event.target);
    button.disabled = true;
    button.textContent = "Saving...";
    try {
      const payload = await api("/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({
          paymentMode: data.has('demoPayments') ? 'demo' : 'live',
          paymentDetailsConfirmed: data.has('paymentDetailsConfirmed'),
          bookingFee: Number(data.get("bookingFee")),
          gcash: { enabled: data.has("gcashEnabled"), accountName: data.get("gcashName"), accountNumber: data.get("gcashNumber"), qrImage: draft.gcashQr },
          maya: { enabled: data.has("mayaEnabled"), accountName: data.get("mayaName"), accountNumber: data.get("mayaNumber"), qrImage: draft.mayaQr },
          operatingHours: Object.fromEntries(dayNames.map((day) => [day, { open: data.get(`${day}Open`), close: data.get(`${day}Close`), closed: data.has(`${day}Closed`) }])),
          closedDates: String(data.get("closedDates") || "").split(/[\s,]+/).filter(Boolean)
        })
      });
      state.shopSettings = payload.settings;
      BarberCo.save();
      toast("Payment settings are live on every device.");
    } catch (error) {
      toast(error.message || "Payment settings could not be saved.");
    } finally {
      button.disabled = false;
      button.textContent = "Save shop settings";
    }
  });
  initHeader("admin");
}

render();
