const { state, nav, initHeader, adminSidebar, avatar, api, loadSettings, toast } = BarberCo;

if (!BarberCo.canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

const draft = { gcashQr: "", mayaQr: "" };

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
  draft.gcashQr = draft.gcashQr || gcash.qrImage || "";
  draft.mayaQr = draft.mayaQr || maya.qrImage || "";

  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("profile")}
      <div class="workspace">
        <p class="eyebrow">Admin Settings</p><h1>Shop payments</h1>
        <div class="grid-2">
          <div class="panel profile-head">
            ${avatar(state.user.name || "The Barber Co Admin", state.user.photo || "")}
            <h2>${state.user.name || "The Barber Co Admin"}</h2>
            <p class="muted">Only administrators can change the payment accounts customers see.</p>
            <a class="button secondary" href="printables/walk-in-qr.html" target="_blank" rel="noreferrer">Open printable walk-in QR</a>
          </div>
          <form class="form-card" data-payment-settings>
            <label>Online booking fee<input type="number" min="0" name="bookingFee" value="${Number(settings.bookingFee ?? 100)}" required></label>
            <fieldset class="settings-group">
              <legend>GCash</legend>
              <label class="check-row"><input type="checkbox" name="gcashEnabled" ${gcash.enabled !== false ? "checked" : ""}> Accept GCash</label>
              <div class="form-row"><label>Account name<input name="gcashName" value="${gcash.accountName || ""}"></label><label>Mobile number<input name="gcashNumber" value="${gcash.accountNumber || ""}"></label></div>
              <label class="upload-box">Upload GCash QR image<input type="file" accept="image/jpeg,image/png,image/webp" data-qr="gcash"></label>
              ${draft.gcashQr ? `<img class="qr-preview" src="${draft.gcashQr}" alt="Saved GCash QR code">` : `<div class="empty-state">No GCash QR uploaded yet.</div>`}
            </fieldset>
            <fieldset class="settings-group">
              <legend>Maya</legend>
              <label class="check-row"><input type="checkbox" name="mayaEnabled" ${maya.enabled ? "checked" : ""}> Accept Maya</label>
              <div class="form-row"><label>Account name<input name="mayaName" value="${maya.accountName || ""}"></label><label>Mobile number<input name="mayaNumber" value="${maya.accountNumber || ""}"></label></div>
              <label class="upload-box">Upload Maya QR image<input type="file" accept="image/jpeg,image/png,image/webp" data-qr="maya"></label>
              ${draft.mayaQr ? `<img class="qr-preview" src="${draft.mayaQr}" alt="Saved Maya QR code">` : `<div class="empty-state">No Maya QR uploaded yet.</div>`}
            </fieldset>
            <button class="button primary" type="submit">Save payment settings</button>
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
          maya: { enabled: data.has("mayaEnabled"), accountName: data.get("mayaName"), accountNumber: data.get("mayaNumber"), qrImage: draft.mayaQr }
        })
      });
      state.shopSettings = payload.settings;
      BarberCo.save();
      toast("Payment settings are live on every device.");
    } catch (error) {
      toast(error.message || "Payment settings could not be saved.");
    } finally {
      button.disabled = false;
      button.textContent = "Save payment settings";
    }
  });
  initHeader("admin");
}

render();
