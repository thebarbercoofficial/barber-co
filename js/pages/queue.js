const { state, barbers, nav, initHeader, byId, api, loadCatalog, toast } = BarberCo;
const params = new URLSearchParams(location.search);
const savedTicketId = localStorage.getItem("barberCoQueueTicketId");
let alertsEnabled = false;
let lastTicketStatus = "";

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

function fallbackQueueRows() {
  const current = state.appointments.find((item) => item.status === "Ongoing") || state.appointments[0];
  const next = state.appointments.find((item) => item.status === "Next") || state.appointments[1] || current;
  return {
    top: [current, next],
    rows: state.appointments.map((item) => ({ ...item, queueNumber: item.id, status: item.status.toLowerCase() }))
  };
}

async function render() {
  try { await loadCatalog(); } catch {}
  let liveQueue = [];
  try {
    liveQueue = (await api("/queue")).queue || [];
  } catch {
    liveQueue = fallbackQueueRows().rows;
  }
  const current = liveQueue.find((item) => item.status === "serving") || liveQueue[0] || fallbackQueueRows().top[0];
  const next = liveQueue.find((item) => item.status === "waiting" && item.id !== current?.id) || liveQueue[1] || fallbackQueueRows().top[1] || current;
  const ticketId = params.get("ticket") || savedTicketId;

  document.querySelector("#app").innerHTML = `
    ${nav("queue")}
    <section class="section top">
      <div class="section-heading"><p class="eyebrow">Customer Queue</p><h2>Live appointment status.</h2><p class="muted">Walk-ins can scan the shop QR, join the line, and keep this page open for sound or vibration alerts.</p></div>
      <div class="grid-2">
        <form class="form-card" data-walkin>
          <p class="eyebrow">Walk-in QR</p><h2>Join the line</h2>
          <label>Name<input name="customer" required placeholder="Your name"></label>
          <label>Phone<input name="phone" placeholder="+63"></label>
          <label>Service<select name="serviceId">${state.services.map((service) => `<option value="${service.id}">${service.name}</option>`).join("")}</select></label>
          <label>Barber<select name="barberId">${barbers.filter((barber) => barber.status !== "fired").map((barber) => `<option value="${barber.id}">${barber.name}</option>`).join("")}</select></label>
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
      <div class="now-next">
        ${[["Now serving", current], ["Next serving", next]].map(([label, item]) => `<article><span>${label}</span><strong>Queue #${String(item?.queueNumber || item?.id || 0).padStart(2, "0")}</strong><p>${item?.customer || "Waiting"} - ${byId(state.services, item?.serviceId).name}</p></article>`).join("")}
      </div>
      <div class="panel">
        ${liveQueue.map((item) => `<div class="queue-row"><span>Queue #${String(item.queueNumber || item.id).padStart(2, "0")} - ${byId(barbers, item.barberId).name}</span><strong>${item.customer} - ${byId(state.services, item.serviceId).name}</strong><span class="status-pill ${String(item.status).toLowerCase()}">${item.status}</span></div>`).join("")}
      </div>
    </section>
  `;

  document.querySelector("[data-walkin]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      const payload = await api("/queue/walkin", {
        method: "POST",
        body: JSON.stringify({ customer: data.get("customer"), phone: data.get("phone"), serviceId: data.get("serviceId"), barberId: data.get("barberId") })
      });
      localStorage.setItem("barberCoQueueTicketId", payload.ticket.id);
      location.href = `queue.html?ticket=${payload.ticket.id}`;
    } catch (error) {
      toast(error.message || "Queue backend is not online yet.");
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-enable-alerts]")) return;
    alertsEnabled = true;
    toast("Alerts enabled. Keep this page open.");
    ringDevice();
  }, { once: true });

  if (ticketId) updateTicket(ticketId);
  initHeader("queue");
}

async function updateTicket(ticketId) {
  try {
    const data = await api(`/queue/ticket/${ticketId}`);
    const panel = document.querySelector("[data-ticket-panel]");
    if (!panel) return;
    panel.innerHTML = `<p class="eyebrow">Your Status</p><h2>Queue #${String(data.ticket.queueNumber).padStart(2, "0")}</h2><div class="summary-list"><div><span>Status</span><strong>${data.ticket.status}</strong></div><div><span>Position</span><strong>${data.position === 0 ? "Now serving" : `#${data.position} in line`}</strong></div><div><span>People ahead</span><strong>${data.waitingAhead}</strong></div></div><button class="button secondary full" type="button" data-enable-alerts>Enable alerts</button>`;
    if (lastTicketStatus && lastTicketStatus !== "serving" && data.ticket.status === "serving") ringDevice();
    lastTicketStatus = data.ticket.status;
  } catch {}
  window.setTimeout(() => updateTicket(ticketId), 7000);
}

render();
