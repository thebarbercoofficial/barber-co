const { state, barbers, nav, initHeader, byId, api, loadCatalog, serviceOptions, toast } = BarberCo;
const params = new URLSearchParams(location.search);
const queueStorageKey = key => state.user?.id ? `${key}:${state.user.id}` : key;
const savedTicketId = localStorage.getItem(queueStorageKey('barberCoQueueTicketId')) || '';
let cancelTicketId = localStorage.getItem(queueStorageKey('barberCoQueueCancelTicketId')) || '';
let cancelToken = localStorage.getItem(queueStorageKey('barberCoQueueCancelToken')) || '';
let alertsEnabled = false;
let lastTicketStatus = "";
let activeTicketId = params.get('ticket') || savedTicketId;
let joinBusy = false;
let cancelBusy = false;
const walkinToken = params.get('walkinToken') || '';
let walkinAccess = false;
let walkinAccessExpiresAt = 0;

function updateJoinState(active, message = '') {
  const button = document.querySelector('[data-walkin] [type="submit"]');
  if (button) { button.disabled = active || joinBusy || !walkinAccess; button.textContent = active ? 'Your ticket is already in the queue' : 'Get queue number'; }
  const notice = document.querySelector('[data-walkin-error]');
  if (notice) notice.textContent = message;
  const fields = document.querySelector('[data-walkin-fields]');
  if (fields) fields.hidden = active || !walkinAccess;
  const title = document.querySelector('[data-walkin-title]');
  if (title) title.textContent = active ? 'Your walk-in ticket' : 'Join the line';
  const existing = document.querySelector('[data-existing-ticket]');
  if (existing) existing.hidden = !active;
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
  if (walkinToken) {
    try {
      const access = await api(`/queue/walkin-access?token=${encodeURIComponent(walkinToken)}`, { cache: 'no-store' });
      walkinAccessExpiresAt = new Date(access.expiresAt).getTime();
      walkinAccess = walkinAccessExpiresAt > Date.now();
    } catch { walkinAccess = false; }
  }

  document.querySelector("#app").innerHTML = `
    ${nav("queue")}
    <section class="section top queue-workspace">
      <div class="section-heading"><p class="eyebrow">Customer Queue</p><h2>Live queue</h2></div>
      <div class="${!walkinAccess && !ticketId ? 'walkin-view-only' : 'grid-2'} walkin-grid">
        <form class="form-card" data-walkin autocomplete="off" ${!walkinAccess && !ticketId ? 'hidden' : ''}>
          <p class="eyebrow">Walk-in</p><h2 data-walkin-title>Join the line</h2>
          <p data-existing-ticket hidden>Your ticket is active. <a href="#walkin-ticket">View your queue status</a></p>
          <div data-walkin-fields>
          <label>Name<input name="customer" autocomplete="off" required placeholder="Your name"></label>
          <label>Service<select name="serviceId" required>${serviceOptions()}</select></label>
          </div>
          <button class="button primary full" type="submit">Get queue number</button>
          <p role="alert" data-walkin-error></p>
          <button class="button secondary full" type="button" data-enable-alerts>Enable alerts</button>
        </form>
        <div class="panel" id="walkin-ticket" data-ticket-panel>
          <p class="eyebrow">Your Status</p>
          <h2>${ticketId ? "Checking your ticket." : "No active ticket"}</h2>
          <p>${walkinToken && !walkinAccess ? 'This QR has expired. Scan the current QR at the shop.' : 'To join as a walk-in, scan the QR displayed inside the shop using your phone camera.'}</p>
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
    if (!walkinAccess || Date.now() >= walkinAccessExpiresAt) {
      walkinAccess = false;
      updateJoinState(false, 'This QR has expired. Scan the current QR at the shop.');
      return;
    }
    joinBusy = true;
    button.disabled = true;
    document.querySelector('[data-walkin-error]').textContent = '';
    const data = new FormData(event.target);
    try {
      const payload = await api("/queue/walkin", {
        method: "POST",
        body: JSON.stringify({ customer: data.get("customer"), serviceId: data.get("serviceId"), walkinToken })
      });
      try {
        localStorage.setItem(queueStorageKey('barberCoQueueTicketId'), payload.ticket.id);
        localStorage.setItem(queueStorageKey('barberCoQueueCancelTicketId'), payload.ticket.id);
        localStorage.setItem(queueStorageKey('barberCoQueueCancelToken'), payload.cancelToken);
        cancelTicketId = payload.ticket.id;
        cancelToken = payload.cancelToken;
      } catch { /* The ticket URL still works when browser storage is full. */ }
      location.href = `queue.html?ticket=${payload.ticket.id}`;
    } catch (error) {
      joinBusy = false;
      toast(error.message || "The queue could not be reached. Please ask the front desk for help.");
      updateJoinState(false, error.message || 'The queue could not be reached. Please ask the front desk for help.');
    }
  });

  updateJoinState(false);

  document.querySelector('[data-ticket-panel]').addEventListener('click', async event => {
    const button = event.target.closest('[data-cancel-ticket]');
    if (!button || cancelBusy || !cancelToken || cancelTicketId !== button.dataset.cancelTicket) return;
    if (!window.confirm('Cancel your place in the walk-in queue? You will lose your current position.')) return;
    cancelBusy = true;
    button.disabled = true;
    button.textContent = 'Cancelling...';
    try {
      await api(`/queue/ticket/${encodeURIComponent(cancelTicketId)}/cancel`, {
        method: 'PATCH',
        body: JSON.stringify({ cancelToken })
      });
      cancelToken = '';
      cancelTicketId = '';
      try {
        localStorage.removeItem(queueStorageKey('barberCoQueueCancelToken'));
        localStorage.removeItem(queueStorageKey('barberCoQueueCancelTicketId'));
      } catch { /* The server has already invalidated this ticket's one-time token. */ }
      lastTicketStatus = '';
      await updateTicket(button.dataset.cancelTicket, false);
    } catch (error) {
      const notice = document.querySelector('[data-cancel-error]');
      if (notice) notice.textContent = error.message || 'Your ticket could not be cancelled. Ask the counter for help.';
      button.disabled = false;
      button.textContent = 'Cancel my place';
    } finally {
      cancelBusy = false;
    }
  });

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

async function updateTicket(ticketId, scheduleNext = true) {
  try {
    const data = await api(`/queue/ticket/${ticketId}`);
    const panel = document.querySelector("[data-ticket-panel]");
    if (!panel) return;
    const status = data.ticket.status;
    if (activeTicketId === ticketId) updateJoinState(['waiting', 'serving'].includes(status));
    const position = status === 'serving' ? 'Now serving' : status === 'waiting' ? `#${data.position} in line` : status === 'done' ? 'Completed' : status === 'cancelled' ? 'Cancelled' : 'Not in line';
    const canCancel = status === 'waiting' && data.ticket.source === 'shop-qr' && cancelTicketId === ticketId && Boolean(cancelToken);
    panel.innerHTML = `<p class="eyebrow">Your Status</p><h2>Queue #${String(data.ticket.queueNumber).padStart(2, "0")}</h2><div class="summary-list"><div><span>Status</span><strong>${escapeHtml(status === 'done' ? 'Completed' : status)}</strong></div><div><span>Position</span><strong>${position}</strong></div><div><span>People ahead</span><strong>${status === 'waiting' ? data.waitingAhead : '-'}</strong></div></div>${['waiting', 'serving'].includes(status) ? '<button class="button secondary full" type="button" data-enable-alerts>Enable alerts</button>' : ''}${canCancel ? '<button class="button secondary full" type="button" data-cancel-ticket="' + escapeHtml(ticketId) + '">Cancel my place</button><p role="alert" data-cancel-error></p>' : ''}`;
    if (lastTicketStatus && lastTicketStatus !== "serving" && data.ticket.status === "serving") ringDevice();
    lastTicketStatus = data.ticket.status;
  } catch (error) {
    if (error.status === 404 && activeTicketId === ticketId) { activeTicketId = null; updateJoinState(false); }
    const panel = document.querySelector("[data-ticket-panel]");
    if (panel) panel.innerHTML = '<p class="eyebrow">Your Status</p><h2>Ticket status unavailable</h2><p>Please check with the counter. Retrying automatically.</p>';
  }
  if (scheduleNext) window.setTimeout(() => updateTicket(ticketId), 7000);
}

render();
