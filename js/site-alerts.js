(() => {
  const { api, state, currentRole, isAuthenticated, safeText, icon } = BarberCo;
  const account = String(state.user?.id || '');
  const staff = ['admin', 'moderator'].includes(currentRole());
  const key = `barberCoAlerts:${account}:${staff ? 'staff' : 'customer'}`;
  const read = () => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
  let data = read();
  let busy = false;
  let audio;
  let popupTimer;
  let connectionError = '';
  let open = false;
  const active = () => isAuthenticated() && String(state.user?.id) === account;
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* Storage may be disabled. */ } };
  const items = () => data.items || [];
  const label = item => item.cancelledBy === 'no-show' ? 'No-show / cancelled' : item.rescheduleRequest?.status === 'pending' ? 'Reschedule awaiting approval' : ({ pending: 'Awaiting staff approval', confirmed: 'Accepted', completed: 'Completed', cancelled: 'Cancelled' }[item.status] || item.status || 'Updated');
  const id = item => String(item.mongoId || item.id || item._id || '');
  const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  function soundButton() {
    return `<button type="button" class="alert-icon" data-alert-sound aria-label="${data.muted ? 'Enable notification sound' : 'Mute notification sound'}" title="${data.muted ? 'Enable notification sound' : 'Mute notification sound'}" aria-pressed="${!data.muted}">${icon(data.muted ? 'VolumeX' : 'Volume2')}</button>`;
  }
  function render() {
    const count = items().filter(item => !item.read).length;
    const bell = document.querySelector('[data-alert-bell]');
    if (!bell) return;
    bell.setAttribute('aria-label', `Notifications${count ? `, ${count} unread` : ''}`);
    bell.setAttribute('aria-expanded', String(open));
    bell.innerHTML = `${icon('Bell')}<span class="alert-badge" ${count ? '' : 'hidden'}>${count > 99 ? '99+' : count}</span>`;
    const panel = document.querySelector('[data-alert-panel]');
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    const focusAction = focused && ['data-alert-sound', 'data-alert-read', 'data-alert-close', 'data-alert-item'].find(name => focused.hasAttribute(name));
    const focusValue = focusAction && focused.getAttribute(focusAction);
    const scroll = panel.querySelector('.alert-list')?.scrollTop || 0;
    panel.hidden = !open;
    panel.innerHTML = `<div class="alert-panel-heading"><strong id="alert-heading">Notifications</strong><div>${soundButton()}<button type="button" class="alert-icon" data-alert-close aria-label="Close notifications" title="Close notifications">${icon('X')}</button></div></div><div class="alert-panel-tools"><button type="button" data-alert-read>Mark all read</button><span role="status">${safeText(connectionError)}</span></div><div class="alert-list">${items().length ? items().map(item => `<a class="alert-entry ${item.read ? '' : 'unread'}" href="${item.href}" data-alert-item="${safeText(item.key)}"><strong>${safeText(item.title)}</strong><span>${safeText(item.message)}</span><time>${safeText(date(item.at))} (PH)</time></a>`).join('') : '<p class="alert-empty">No notifications yet.</p>'}</div>`;
    panel.querySelector('.alert-list').scrollTop = scroll;
    if (open && focusAction) Array.from(panel.querySelectorAll(`[${focusAction}]`)).find(node => node.getAttribute(focusAction) === focusValue)?.focus({ preventScroll: true });
  }
  async function unlock() {
    if (data.muted || !active()) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      audio ||= new Context();
      if (audio.state === 'suspended') await audio.resume();
    } catch { /* Visual notifications remain available when audio is blocked. */ }
  }
  function chime() {
    if (data.muted || audio?.state !== 'running' || !document.hasFocus()) return;
    try {
      [660, 880].forEach((frequency, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = audio.currentTime + index * .14;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.08, start + .015);
        gain.gain.exponentialRampToValueAtTime(.001, start + .22);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + .24);
      });
    } catch { /* Sound is optional. */ }
  }
  function announce(events) {
    const item = events[0];
    const popup = document.querySelector('[data-alert-popup]');
    popup.innerHTML = `<div><strong>${safeText(events.length > 1 ? `${events.length} new updates` : item.title)}</strong><p>${safeText(item.message)}</p><a href="${item.href}" data-alert-item="${safeText(item.key)}">View ${staff ? 'activity' : 'booking'}</a></div><button type="button" class="alert-icon" data-alert-dismiss aria-label="Dismiss notification" title="Dismiss notification">${icon('X')}</button>`;
    popup.hidden = false;
    clearTimeout(popupTimer);
    popupTimer = setTimeout(() => { popup.hidden = true; }, 10000);
    chime();
  }
  function ingest(source, records) {
    data = { ...data, ...read() };
    data.fingerprints ||= {};
    data.baselines ||= {};
    const first = !data.baselines[source];
    const events = [];
    for (const record of records) {
      const identity = `${source}:${record.id}`;
      if (data.fingerprints[identity] === record.version) continue;
      data.fingerprints[identity] = record.version;
      const event = { ...record, key: `${identity}:${record.version}`, read: first, at: first ? record.at : new Date().toISOString() };
      data.items = [event, ...items().filter(item => item.key !== event.key)];
      if (!first) events.push(event);
    }
    data.baselines[source] = true;
    data.items = items().sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, 40);
    // Bound local history and comparison state without storing receipt/customer contact data.
    data.fingerprints = Object.fromEntries(Object.entries(data.fingerprints).slice(-2000));
    persist();
    render();
    return events;
  }
  function bookingRecords(records) {
    return records.map(item => ({
      id: id(item), version: JSON.stringify([item.status, item.date, item.time, item.rescheduleRequest?.status, item.rescheduleRequest?.requestedAt, item.staffNote, item.cancelledBy]),
      title: `${staff ? `${item.customer || 'Customer'} / ` : 'Booking / '}${label(item)}`,
      message: `${item.date || ''} at ${item.time || ''}${item.partySize > 1 ? ` / ${item.partySize} people` : ''}${item.staffNote ? ` / ${item.staffNote}` : ''}`,
      at: item.updatedAt || item.createdAt, href: staff ? 'admin-schedule.html' : 'user-profile.html'
    })).filter(item => item.id);
  }
  async function refresh() {
    if (busy || document.hidden || !active()) return;
    busy = true;
    let failed = false;
    const events = [];
    try {
      try {
        const result = await api(staff ? '/admin/appointments' : '/appointments/mine', { cache: 'no-store' });
        if (!active()) return;
        events.push(...ingest('bookings', bookingRecords(result.appointments || [])));
      } catch (error) { if ([401, 403].includes(error.status)) return; failed = true; }
      try {
        const result = await api(staff ? '/admin/contacts' : '/notifications/mine', { cache: 'no-store' });
        if (!active()) return;
        if (staff) events.push(...ingest('contacts', (result.contacts || []).map(item => ({ id: id(item), version: String(item.createdAt), title: 'New contact message', message: item.name || 'Website visitor', at: item.createdAt, href: 'admin-contacts.html' }))));
        else events.push(...ingest('queue', (result.notifications || []).filter(item => /your turn|queue #/i.test(item.message || '')).map(item => ({ id: id(item), version: id(item), title: 'Queue update', message: item.message, at: item.createdAt, href: 'queue.html' }))));
      } catch { failed = true; }
      connectionError = failed ? 'Some updates unavailable. Retrying.' : '';
      render();
      if (events.length) announce(events);
    } finally { busy = false; }
  }
  function mount() {
    if (!active() || !document.querySelector('[data-header]') || document.querySelector('[data-alert-bell]')) return;
    const header = document.querySelector('[data-header]');
    const bell = document.createElement('button');
    bell.type = 'button';
    bell.className = 'alert-icon alert-bell';
    bell.dataset.alertBell = '';
    bell.title = 'Notifications';
    bell.setAttribute('aria-controls', 'site-alert-panel');
    bell.setAttribute('aria-expanded', 'false');
    const actions = header.querySelector('.staff-header-actions');
    if (actions) actions.prepend(bell);
    else header.insertBefore(bell, header.querySelector('[data-nav-toggle]'));
    document.querySelector('[data-alert-panel]')?.remove();
    document.querySelector('[data-alert-popup]')?.remove();
    document.body.insertAdjacentHTML('beforeend', '<section class="site-alert-panel" id="site-alert-panel" data-alert-panel aria-labelledby="alert-heading" hidden></section><aside class="site-alert-popup" data-alert-popup role="status" aria-live="polite" hidden></aside>');
    positionPanel();
    render();
    bell.addEventListener('click', event => { event.stopPropagation(); open = !open; render(); if (open) document.querySelector('[data-alert-close]')?.focus(); });
    void refresh();
  }
  function positionPanel() {
    const panel = document.querySelector('[data-alert-panel]');
    const bottom = document.querySelector('[data-header]')?.offsetHeight || 64;
    if (panel) { panel.style.top = `${bottom + 8}px`; panel.style.maxHeight = `calc(100dvh - ${bottom + 24}px)`; }
  }
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = 'css/site-alerts.css?v=20261115'; document.head.append(css);
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  document.addEventListener('click', event => {
    const inside = Boolean(event.target.closest('[data-alert-panel], [data-alert-bell]'));
    const close = Boolean(event.target.closest('[data-alert-close]'));
    if (event.target.closest('[data-alert-sound]')) { data.muted = !data.muted; persist(); void unlock(); render(); document.querySelector('[data-alert-sound]')?.focus(); }
    if (event.target.closest('[data-alert-read]')) { data.items = items().map(item => ({ ...item, read: true })); persist(); render(); document.querySelector('[data-alert-read]')?.focus(); }
    const entry = event.target.closest('[data-alert-item]');
    if (entry) { data.items = items().map(item => item.key === entry.dataset.alertItem ? { ...item, read: true } : item); persist(); }
    if (event.target.closest('[data-alert-dismiss]')) document.querySelector('[data-alert-popup]').hidden = true;
    if (close || (open && !inside)) { open = false; render(); if (close) document.querySelector('[data-alert-bell]')?.focus(); }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && open) { open = false; render(); document.querySelector('[data-alert-bell]')?.focus(); } });
  window.addEventListener('storage', event => { if (event.key === key) { data = read(); render(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('focus', () => void refresh());
  window.addEventListener('resize', positionPanel);
  window.BarberCoAlerts = { mount, refresh };
  setInterval(refresh, 15000);
  if (!window.lucide) {
    const script = document.createElement('script'); script.src = 'assets/lucide.min.js'; script.onload = mount; document.head.append(script);
  } else mount();
})();
