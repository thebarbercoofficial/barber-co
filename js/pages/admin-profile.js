const { state, nav, initHeader, adminSidebar, avatar, api, loadSettings, toast } = BarberCo;

if (!BarberCo.canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

const draft = { gcashQr: "", mayaQr: "" };
const dayNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const defaultHours = {
  monday: { open: "10:00", close: "20:00" }, tuesday: { open: "10:00", close: "20:00" },
  wednesday: { open: "10:00", close: "20:00" }, thursday: { open: "10:00", close: "20:00" },
  friday: { open: "10:00", close: "20:00" }, saturday: { open: "09:00", close: "20:00" },
  sunday: { open: "09:00", close: "20:00" }
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
        <p class="eyebrow">Admin only</p><h1>Shop settings</h1>
        <p class="muted workspace-intro">Manage the payment accounts, booking hours, weekly closures, holidays, and special shop closure dates used on every device.</p>
        <div class="grid-2">
          <div class="panel profile-head">
            ${avatar(state.user.name || "The Barber Co Admin", state.user.photo || "")}
            <h2>${state.user.name || "The Barber Co Admin"}</h2>
            <p class="muted">Moderators cannot view or change these payment settings.</p>
            <a class="button secondary" href="printables/walk-in-qr.html" target="_blank" rel="noreferrer">Open printable walk-in QR</a>
          </div>
          <form class="form-card" data-payment-settings>
            <label>Online booking fee<input type="number" min="0" name="bookingFee" value="${Number(settings.bookingFee ?? 100)}" required></label>
            <fieldset class="settings-group">
              <legend>GCash</legend>
              <label class="check-row"><input type="checkbox" name="gcashEnabled" ${gcash.enabled !== false ? "checked" : ""}> Accept GCash</label>
              <div class="form-row"><label>Account name<input name="gcashName" value="${gcash.accountName || ""}"></label><label>Mobile number<input name="gcashNumber" value="${gcash.accountNumber || ""}"></label></div>
              <label class="upload-box">Choose GCash QR image<input type="file" accept="image/jpeg,image/png,image/webp" data-qr="gcash"><small>Use the QR image from the official GCash account. Maximum 2 MB.</small></label>
              ${draft.gcashQr ? `<img class="qr-preview" src="${draft.gcashQr}" alt="Saved GCash QR code">` : `<div class="empty-state">No GCash QR uploaded yet.</div>`}
            </fieldset>
            <fieldset class="settings-group">
              <legend>Maya</legend>
              <label class="check-row"><input type="checkbox" name="mayaEnabled" ${maya.enabled ? "checked" : ""}> Accept Maya</label>
              <div class="form-row"><label>Account name<input name="mayaName" value="${maya.accountName || ""}"></label><label>Mobile number<input name="mayaNumber" value="${maya.accountNumber || ""}"></label></div>
              <label class="upload-box">Choose Maya QR image<input type="file" accept="image/jpeg,image/png,image/webp" data-qr="maya"><small>Use the QR image from the official Maya account. Maximum 2 MB.</small></label>
              ${draft.mayaQr ? `<img class="qr-preview" src="${draft.mayaQr}" alt="Saved Maya QR code">` : `<div class="empty-state">No Maya QR uploaded yet.</div>`}
            </fieldset>
            <fieldset class="settings-group">
              <legend>Booking schedule</legend>
              <p class="muted">Customers only receive time slots that fit inside these hours. Mark a day closed to remove it from booking.</p>
              <div class="schedule-settings">${scheduleRows(operatingHours)}</div>
              <label>Holiday and special closure dates<textarea name="closedDates" rows="4" placeholder="2026-12-24, 2026-12-31">${(settings.closedDates || []).join("\n")}</textarea><small>Enter one date per line or separate dates with commas. Fixed Philippine national holidays are blocked automatically.</small></label>
            </fieldset>
            <button class="button primary full" type="submit">Save shop settings</button>
          </form>
        </div>
      </div>
    </section>`;

  document.querySelectorAll("[data-qr]").forEach((input) => input.addEventListener("change", async (event) => {
    try {
      const image = await readImage(event.target.files[0]);
      if (event.target.dataset.qr === "gcash") draft.gcashQr = image;
      else draft.mayaQr = image;
      render();
    } catch (error) { toast(error.message); }
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
