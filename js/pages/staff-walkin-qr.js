(() => {
  const image = document.querySelector('[data-shop-qr]');
  const status = document.querySelector('[data-qr-status]');
  const retry = document.querySelector('[data-qr-retry]');
  let expires = 0;
  let refreshAt = 0;
  let pending = false;
  let stopped = false;
  async function refresh() {
    if (pending || stopped) return;
    pending = true;
    retry.hidden = true;
    try {
      const data = await BarberCo.api('/admin/queue/qr');
      expires = Date.parse(data.expiresAt);
      if (!Number.isFinite(expires) || expires <= Date.now() || !data.qrImage?.startsWith('data:image/png;base64,')) throw new Error('Invalid QR response.');
      image.src = data.qrImage;
      image.hidden = false;
      refreshAt = expires - 20000;
      status.textContent = 'Scan to join the walk-in queue.';
    } catch (error) {
      image.hidden = true;
      image.removeAttribute('src');
      expires = 0;
      stopped = error.status === 401 || error.status === 403;
      status.textContent = stopped ? 'Staff login required. Open the staff workspace and sign in.' : 'QR unavailable. Reconnecting...';
      retry.hidden = stopped;
      refreshAt = Date.now() + 5000;
    } finally { pending = false; }
  }
  retry.addEventListener('click', refresh);
  const timer = setInterval(() => {
    if (Date.now() >= expires) { image.hidden = true; image.removeAttribute('src'); }
    if (Date.now() >= refreshAt) refresh();
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pagehide', () => clearInterval(timer));
  refresh();
})();
