const { state, barbers, nav, initHeader, byId, api, loadCatalog, serviceOptions, toast } = BarberCo;
const params = new URLSearchParams(location.search);
const savedTicketId = localStorage.getItem("barberCoQueueTicketId");
let alertsEnabled = false;
let lastTicketStatus = "";

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
      <div class="section-heading"><p class="eyebrow">Customer Queue</p><h2>Live appointment status.</h2><p class="muted">Walk-ins can scan the shop QR, join the line, and keep this page open for sound or vibration alerts.</p></div>
      <div class="grid-2">
        <form class="form-card" data-walkin>
          <p class="eyebrow">Walk-in QR</p><h2>Join the line</h2>
          <label>Name<input name="customer" required placeholder="Your name"></label>
          <label>Service<select name="serviceId" required>${serviceOptions()}</select></label>
          <p class="muted">For customers already at the shop. No account needed. Choose a cut, get a number, and wait for your name to be called.</p>
          <button class="button primary full" type="submit">Get queue number</button>
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
    const data = new FormData(event.target);
    try {
      const payload = await api("/queue/walkin", {
        method: "POST",
        body: JSON.stringify({ customer: data.get("customer"), serviceId: data.get("serviceId") })
      });
      localStorage.setItem("barberCoQueueTicketId", payload.ticket.id);
      location.href = `queue.html?ticket=${payload.ticket.id}`;
    } catch (error) {
      toast(error.message || "The queue could not be reached. Please ask the front desk for help.");
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-enable-alerts]")) return;
    alertsEnabled = true;
    toast("Alerts enabled. Keep this page open.");
    ringDevice();
  });

  if (ticketId) updateTicket(ticketId);
  refreshPublicQueue();
  initHeader("queue");
}

async function updateTicket(ticketId) {
  try {
    const data = await api(`/queue/ticket/${ticketId}`);
    const panel = document.querySelector("[data-ticket-panel]");
    if (!panel) return;
    const status = data.ticket.status;
    const position = status === 'serving' ? 'Now serving' : status === 'waiting' ? `#${data.position} in line` : status === 'done' ? 'Completed' : status === 'cancelled' ? 'Cancelled' : 'Not in line';
    panel.innerHTML = `<p class="eyebrow">Your Status</p><h2>Queue #${String(data.ticket.queueNumber).padStart(2, "0")}</h2><div class="summary-list"><div><span>Status</span><strong>${escapeHtml(status === 'done' ? 'Completed' : status)}</strong></div><div><span>Position</span><strong>${position}</strong></div><div><span>People ahead</span><strong>${status === 'waiting' ? data.waitingAhead : '-'}</strong></div></div>${['waiting', 'serving'].includes(status) ? '<button class="button secondary full" type="button" data-enable-alerts>Enable alerts</button>' : ''}`;
    if (lastTicketStatus && lastTicketStatus !== "serving" && data.ticket.status === "serving") ringDevice();
    lastTicketStatus = data.ticket.status;
  } catch {
    const panel = document.querySelector("[data-ticket-panel]");
    if (panel) panel.innerHTML = '<p class="eyebrow">Your Status</p><h2>Ticket status unavailable</h2><p>Please check with the counter. Retrying automatically.</p>';
  }
  window.setTimeout(() => updateTicket(ticketId), 7000);
}

render();
