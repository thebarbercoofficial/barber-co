const { state, barbers, nav, initHeader, byId, api, loadCatalog, serviceOptions, toast } = BarberCo;
const params = new URLSearchParams(location.search);
const savedTicketId = localStorage.getItem("barberCoQueueTicketId");
let alertsEnabled = false;
let lastTicketStatus = "";
let activeTicketId = params.get('ticket') || savedTicketId;
let joinBusy = false;

function updateJoinState(active, message = '') {
  const button = document.querySelector('[data-walkin] [type="submit"]');
  if (button) { button.disabled = active || joinBusy; button.textContent = active ? 'Your ticket is already in the queue' : 'Get queue number'; }
  const notice = document.querySelector('[data-walkin-error]');
  if (notice) notice.textContent = message;
}

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function ringDevice() {
  if (!alertsEnabled) return;
  if ("vibrate" in navigator) navigator.vibrate([650, 180, 650, 180, 900]);
  try {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.start();
    window.setTimeout(() => {
      oscillator.stop();
      audio.close();
    }, 900);
  } catch {
    toast("Your turn is ready.");
  }
}

function paintQueue(queue, unavailable = false) {
  const summary = document.querySelector('[data-live-summary]');
  const rows = document.querySelector('[data-live-rows]');
  if (!summary || !rows) return;
  const current = queue.find((item) => item.status === 'serving');
  const next = queue.find((item) => item.status === 'waiting');
  summary.innerHTML = [['Now serving', current], ['Next in line', next]].map(([label, item]) => `<article><span>${label}</span><strong>${unavailable ? 'Live queue unavailable' : item ? `Queue #${String(item.queueNumber).padStart(2, '0')}` : 'No customer'}</strong><p>${unavailable ? 'Please check with the counter.' : item ? `${escapeHtml(item.customer)} - ${escapeHtml(item.cutName || byId(state.services, item.serviceId).name)}` : 'Waiting for the next customer.'}</p></article>`).join('');
  rows.innerHTML = unavailable ? '<div class="empty-state">The live queue could not be refreshed. Please check with the counter.</div>' : queue.map((item) => `<div class="queue-row"><span>Queue #${String(item.queueNumber).padStart(2, '0')} - ${escapeHtml(item.barberId ? byId(barbers, item.barberId).name : 'Unassigned')}</span><strong>${escapeHtml(item.customer)} - ${escapeHtml(item.cutName || byId(state.services, item.serviceId).name)}</strong><span class="status-pill ${item.status === 'serving' ? 'serving' : 'waiting'}">${item.status === 'serving' ? 'Now serving' : 'Waiting'}</span></div>`).join('') || '<div class="empty-state">No customers are in the queue yet.</div>';
}

async function refreshPublicQueue() {
  try { paintQueue((await api('/queue')).queue || []); }
  catch { paintQueue([], true); }
  window.setTimeout(refreshPublicQueue, 7000);
}

async function render() {
  try { await loadCatalog(); } catch {}
  const ticketId = params.get("ticket") || savedTicketId;

  document.querySelector("#app").innerHTML = `
    ${nav("queue")}
    <section class="section top">
      <div class="section-heading"><p class="eyebrow">Customer Queue</p><h2>Live queue</h2></div>
      <div class="grid-2">
        <form class="form-card" data-walkin>
          <p class="eyebrow">Walk-in QR</p><h2>Join the line</h2>
          <label>Name<input name="customer" required placeholder="Your name"></label>
          <label>Service<select name="serviceId" required>${serviceOptions()}</select></label>
          <label><span data-walkin-email-label>Email for updates (optional)</span><input name="contactEmail" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com"></label>
          <p class="muted" data-walkin-email-help hidden></p>
          <label class="terms-consent"><span><input name="emailConsent" type="checkbox"><span>Email me when staff calls or cancels my ticket.</span></span></label>
          <button class="button primary full" type="submit">Get queue number</button>
          <p role="alert" data-walkin-error></p>
          <button class="button secondary full" type="button" data-enable-alerts>Enable alerts</button>
        </form>
        <div class="panel" data-ticket-panel>
          <p class="eyebrow">Your Status</p>
          <h2>${ticketId ? "Checking your ticket." : "Scan-ready link"}</h2>
          <p class="muted">${location.origin}${location.pathname}?walkin=1</p>
          <img class="qr-code" alt="Walk-in queue QR code" src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`${location.origin}${location.pathname}?walkin=1`)}">
        </div>
      </div>
      <div class="now-next" data-live-summary><article><strong>Checking the live queue...</strong></article></div>
      <div class="panel" data-live-rows></div>
    </section>
  `;

  document.querySelector("[data-walkin]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('[type="submit"]');
    if (button.disabled) return;
    joinBusy = true;
    button.disabled = true;
    document.querySelector('[data-walkin-error]').textContent = '';
    const data = new FormData(event.target);
    try {
      const payload = await api("/queue/walkin", {
        method: "POST",
        body: JSON.stringify({ customer: data.get("customer"), serviceId: data.get("serviceId"), contactEmail: data.get("contactEmail"), emailConsent: data.get("emailConsent") === "on" })
      });
      try {
        localStorage.setItem("barberCoQueueTicketId", payload.ticket.id);
        if (payload.emailUpdatesEnabled) localStorage.setItem(`barberCoQueueEmailUpdates:${payload.ticket.id}`, "true");
      } catch { /* The ticket URL still works when browser storage is full. */ }
      location.href = `queue.html?ticket=${payload.ticket.id}`;
    } catch (error) {
      joinBusy = false;
      toast(error.message || "The queue could not be reached. Please ask the front desk for help.");
      updateJoinState(false, error.message || 'The queue could not be reached. Please ask the front desk for help.');
    }
  });

  const guestEmail = document.querySelector('[data-walkin] [name="contactEmail"]');
  const guestEmailConsent = document.querySelector('[data-walkin] [name="emailConsent"]');
  const guestEmailLabel = document.querySelector('[data-walkin-email-label]');
  const guestEmailHelp = document.querySelector('[data-walkin-email-help]');
  guestEmail.closest('label').before(guestEmailConsent.closest('label'));
  const updateGuestEmailRequirement = () => {
    const enabled = guestEmailConsent.checked;
    guestEmail.required = enabled;
    guestEmail.disabled = !enabled;
    guestEmail.closest('label').hidden = !enabled;
    guestEmail.closest('label').style.display = enabled ? '' : 'none';
    guestEmailLabel.textContent = `Email for updates (${enabled ? 'required' : 'optional'})`;
    guestEmailHelp.textContent = '';
  };
  guestEmailConsent.addEventListener("change", updateGuestEmailRequirement);
  updateGuestEmailRequirement();

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-enable-alerts]")) return;
    alertsEnabled = true;
    toast("Alerts enabled. Keep this page open.");
    ringDevice();
  });

  if (ticketId) { updateJoinState(true, 'Checking your existing ticket before joining again.'); updateTicket(ticketId); }
  refreshPublicQueue();
  initHeader("queue");
}

async function updateTicket(ticketId) {
  try {
    const data = await api(`/queue/ticket/${ticketId}`);
    const panel = document.querySelector("[data-ticket-panel]");
    if (!panel) return;
    const status = data.ticket.status;
    if (activeTicketId === ticketId) updateJoinState(['waiting', 'serving'].includes(status));
    const position = status === 'serving' ? 'Now serving' : status === 'waiting' ? `#${data.position} in line` : status === 'done' ? 'Completed' : status === 'cancelled' ? 'Cancelled' : 'Not in line';
    const emailUpdates = localStorage.getItem(`barberCoQueueEmailUpdates:${ticketId}`) === "true";
    panel.innerHTML = `<p class="eyebrow">Your Status</p><h2>Queue #${String(data.ticket.queueNumber).padStart(2, "0")}</h2><div class="summary-list"><div><span>Status</span><strong>${escapeHtml(status === 'done' ? 'Completed' : status)}</strong></div><div><span>Position</span><strong>${position}</strong></div><div><span>People ahead</span><strong>${status === 'waiting' ? data.waitingAhead : '-'}</strong></div></div>${emailUpdates ? '<p class="muted">Email queue updates are enabled.</p>' : ''}${['waiting', 'serving'].includes(status) ? '<button class="button secondary full" type="button" data-enable-alerts>Enable alerts</button>' : ''}`;
    if (lastTicketStatus && lastTicketStatus !== "serving" && data.ticket.status === "serving") ringDevice();
    lastTicketStatus = data.ticket.status;
  } catch (error) {
    if (error.status === 404 && activeTicketId === ticketId) { activeTicketId = null; updateJoinState(false); }
    const panel = document.querySelector("[data-ticket-panel]");
    if (panel) panel.innerHTML = '<p class="eyebrow">Your Status</p><h2>Ticket status unavailable</h2><p>Please check with the counter. Retrying automatically.</p>';
  }
  window.setTimeout(() => updateTicket(ticketId), 7000);
}

render();
