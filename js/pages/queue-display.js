const { api } = BarberCo;

let lastSignature = "";
let lastServingId = "";

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function ticketCard(item, featured = false, index = 0) {
  return `<article class="tv-ticket ${featured ? "featured" : ""}" style="--ticket-index:${index}" data-ticket-id="${escapeHtml(item.mongoId || item.id || item.queueNumber)}"><span>Queue #${String(item.queueNumber).padStart(2, "0")}</span><strong>${escapeHtml(item.customer)}</strong><p>${escapeHtml(item.cutName || "Service to be assigned")}</p></article>`;
}

function draw(queue) {
  const serving = queue.find((item) => item.status === "serving");
  const waiting = queue.filter((item) => item.status === "waiting").sort((a, b) => a.queueNumber - b.queueNumber);
  const signature = JSON.stringify(queue.map((item) => [item.id, item.customer, item.status]));
  if (signature === lastSignature) {
    const clock = document.querySelector("[data-tv-clock]");
    if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return;
  }
  lastSignature = signature;
  const servingId = serving ? String(serving.mongoId || serving.id || serving.queueNumber) : "";
  const announceServing = Boolean(servingId && servingId !== lastServingId);
  lastServingId = servingId;
  document.querySelector("#app").innerHTML = `
    <main class="tv-board ${announceServing ? "is-announcing" : ""}">
      ${announceServing ? `<div class="tv-call-flash" aria-hidden="true"><span>NOW SERVING</span><strong>${escapeHtml(serving.customer)}</strong><small>Queue #${String(serving.queueNumber).padStart(2, "0")}</small></div>` : ""}
      <header class="tv-header"><div class="tv-brand"><img src="images/logo.png" alt="The Barber Co logo"><div><span>THE BARBER CO</span><strong>LIVE WALK-IN QUEUE</strong></div></div><div class="tv-meta"><span data-tv-clock>${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><button type="button" data-fullscreen>Fullscreen</button></div></header>
      <section class="tv-serving"><p>NOW SERVING</p>${serving ? ticketCard(serving, true) : `<div class="tv-empty"><strong>Waiting for the next customer</strong><span>Please watch this screen for your name.</span></div>`}</section>
      <section class="tv-waiting"><div class="tv-section-title"><h2>Up next</h2><span>${waiting.length} waiting</span></div><div class="tv-ticket-grid">${waiting.slice(0, 8).map((item, index) => ticketCard(item, false, index)).join("") || `<div class="tv-empty"><strong>No customers waiting</strong><span>Scan the shop QR to join the line.</span></div>`}</div></section>
      <footer class="tv-footer"><span>Please listen for your name when called.</span><span>Queue updates automatically.</span></footer>
    </main>`;
  document.querySelector("[data-fullscreen]").addEventListener("click", () => document.documentElement.requestFullscreen?.());
  if (announceServing) window.setTimeout(() => document.querySelector(".tv-call-flash")?.remove(), 3600);
}

async function refresh() {
  try {
    const payload = await api("/queue");
    draw(payload.queue || []);
  } catch {
    document.querySelector("#app").innerHTML = `<main class="tv-board"><div class="tv-empty centered"><strong>Queue temporarily unavailable</strong><span>Trying to reconnect automatically...</span></div></main>`;
  }
}

refresh();
window.setInterval(refresh, 4000);
