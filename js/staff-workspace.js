(() => {
  const { nav, adminSidebar, initHeader, canAccess, currentRole, safeText, icon } = BarberCo;
  if (!canAccess('moderator')) { location.replace('login.html'); return; }
  const all = [
    ['dashboard', 'Dashboard'], ['logbook', 'Staff Logbook'], ['contacts', 'Contact Inbox'],
    ['schedule', 'Appointments'], ['users', 'Users & Permissions'], ['profile', 'Shop Settings'],
    ['services', 'Services'], ['barbers', 'Barbers'], ['reports', 'Reports']
  ];
  const sections = currentRole() === 'admin' ? all : all.filter(([key]) => ['logbook', 'contacts', 'schedule'].includes(key));
  const permitted = new Set(sections.map(([key]) => key));
  const initial = permitted.has(location.hash.slice(1)) ? location.hash.slice(1) : sections[0][0];
  const rail = currentRole() === 'admin'
    ? `
      <aside class="workspace-rail" data-workspace-rail aria-label="Live operations">
        <div class="workspace-rail-heading"><p>WORKSPACE</p><h2>Needs attention</h2><small data-rail-updated role="status">Connecting to live data...</small></div>
        <section class="workspace-rail-section"><h3>Appointments</h3>
          <a class="workspace-rail-link" href="admin-workspace.html#schedule"><span>${icon('CalendarClock')}<span><strong>Bookings to review</strong><small>Awaiting staff approval</small></span></span><b data-rail-review>--</b></a>
          <div class="workspace-rail-link is-static"><span>${icon('Wallet')}<span><strong>Payment drafts</strong><small>No time held until approved</small></span></span><b data-rail-drafts>--</b></div>
        </section>
        <section class="workspace-rail-section"><h3>Walk-in queue</h3>
          <a class="workspace-rail-link" href="admin-workspace.html#logbook"><span>${icon('ListOrdered')}<span><strong>Waiting</strong><small>Customers in line</small></span></span><b data-rail-waiting>--</b></a>
          <div class="workspace-rail-link is-static"><span>${icon('Scissors')}<span><strong>Now serving</strong><small>Currently in the chair</small></span></span><b data-rail-serving>--</b></div>
        </section>
        <section class="workspace-rail-section"><h3>Quick access</h3>
          <a class="workspace-rail-shortcut" href="admin-workspace.html#contacts">${icon('Mail')} Contact inbox ${icon('ArrowUpRight')}</a>
          <a class="workspace-rail-shortcut" href="admin-workspace.html#reports">${icon('ChartNoAxesCombined')} Reports ${icon('ArrowUpRight')}</a>
        </section>
      </aside>`
    : `
      <aside class="workspace-rail" data-workspace-rail aria-label="Staff shortcuts">
        <div class="workspace-rail-heading"><p>STAFF WORKSPACE</p><h2>Quick access</h2><small>Front desk tools</small></div>
        <section class="workspace-rail-section"><h3>Daily operations</h3>
          <a class="workspace-rail-shortcut" href="admin-workspace.html#logbook">${icon('ListOrdered')} Staff Logbook ${icon('ArrowUpRight')}</a>
          <a class="workspace-rail-shortcut" href="admin-workspace.html#schedule">${icon('CalendarDays')} Appointments ${icon('ArrowUpRight')}</a>
          <a class="workspace-rail-shortcut" href="admin-workspace.html#contacts">${icon('Mail')} Contact inbox ${icon('ArrowUpRight')}</a>
        </section>
      </aside>`;
  history.scrollRestoration = 'manual';
  document.querySelector('#app').innerHTML = `
    ${nav('admin')}
    <div class="app-shell">
      ${adminSidebar(initial)}
      <main class="workspace workspace-stream" aria-label="Staff workspace">
        ${sections.map(([key, label]) => `<section class="staff-stream-section" id="${key}" aria-label="${safeText(label)}"><h2>${safeText(label)}</h2><iframe title="${safeText(label)}" data-staff-section="${key}" data-src="admin-${key}.html" scrolling="no"></iframe></section>`).join('')}
      </main>
      ${rail}
    </div>`;
  initHeader('admin');
  let active = initial;
  let pendingTarget = initial;
  let anchorTimer;
  let scheduled = false;
  const frames = [...document.querySelectorAll('[data-staff-section]')];
  const cleanups = [];
  const railSnapshot = { queue: null, bookings: null };

  function updateRail(event) {
    const dashboard = frames.find(frame => frame.dataset.staffSection === 'dashboard');
    if (!dashboard || event.origin !== location.origin || event.source !== dashboard.contentWindow || event.data?.type !== 'barberco-workspace-snapshot') return;
    if (event.data.queue) railSnapshot.queue = event.data.queue;
    if (event.data.bookings) railSnapshot.bookings = event.data.bookings;
    const show = (selector, value) => { document.querySelector(selector).textContent = Number.isFinite(value) ? String(value) : '--'; };
    show('[data-rail-review]', railSnapshot.bookings?.review);
    show('[data-rail-drafts]', railSnapshot.bookings?.drafts);
    show('[data-rail-waiting]', railSnapshot.queue?.waiting);
    show('[data-rail-serving]', railSnapshot.queue?.serving);
    const updated = new Date(event.data.updatedAt || Date.now());
    document.querySelector('[data-rail-updated]').textContent = `Updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  window.addEventListener('message', updateRail);

  function settleAnchor() {
    if (!pendingTarget) return;
    const target = document.getElementById(pendingTarget);
    target.scrollIntoView({ behavior: 'instant', block: 'start' });
    clearTimeout(anchorTimer);
    if (target.hasAttribute('data-loaded')) anchorTimer = setTimeout(() => { pendingTarget = null; requestUpdate(); }, 250);
  }
  function navigate(key, behavior = 'instant', push = true) {
    if (!permitted.has(key)) return;
    pendingTarget = key;
    load(document.getElementById(key).querySelector('iframe'));
    if (push) history.pushState(null, '', `#${key}`);
    document.getElementById(key).scrollIntoView({ behavior, block: 'start' });
    settleAnchor();
    document.body.classList.remove('staff-menu-open');
    document.querySelector('[data-staff-toggle]')?.setAttribute('aria-expanded', String(innerWidth > 960 && !document.body.classList.contains('staff-sidebar-compact')));
    update();
  }
  function intercept(event) {
    const link = event.target.closest('a[href]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank') return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    const match = url.pathname.match(/admin-([a-z]+)\.html$/);
    const key = match?.[1] === 'workspace' ? url.hash.slice(1) : match?.[1];
    if (permitted.has(key)) { event.preventDefault(); navigate(key); }
    else if (event.view && event.view !== window && !link.hasAttribute('download') && url.protocol !== 'blob:') {
      event.preventDefault(); location.href = url.href;
    }
  }
  document.addEventListener('click', intercept);

  function load(frame) {
    if (frame.hasAttribute('src')) return;
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      if (/\/login\.html$/.test(frame.contentWindow.location.pathname)) { location.replace('login.html'); return; }
      doc.addEventListener('click', intercept);
      const measure = () => {
        const app = doc.querySelector('#app');
        const content = doc.querySelector('[data-session-recovery]') || app;
        if (!content || (!doc.querySelector('[data-session-recovery]') && !app?.querySelector('.workspace'))) return;
        frame.parentElement.dataset.loaded = '';
        const height = Math.ceil(content.getBoundingClientRect().height) + 2;
        if (Math.abs(frame.offsetHeight - height) > 2) frame.style.height = `${Math.max(160, height)}px`;
        settleAnchor();
        positionDialogs(frame);
        requestUpdate();
      };
      const resize = new ResizeObserver(measure);
      resize.observe(doc.querySelector('#app') || doc.body);
      const changes = new MutationObserver(() => { measure(); });
      changes.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
      cleanups.push(() => { resize.disconnect(); changes.disconnect(); });
      measure();
      frame.contentWindow.staffModuleVisible = true;
      update();
    });
    frame.src = `${frame.dataset.src}?workspace=1`;
  }
  function positionDialogs(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    const top = Math.max(0, 80 - frame.getBoundingClientRect().top);
    doc.documentElement.style.setProperty('--module-dialog-top', `${top + 16}px`);
    doc.documentElement.style.setProperty('--module-dialog-height', `${Math.max(160, innerHeight - 120)}px`);
    const toast = doc.querySelector('[data-toast]');
    if (toast?.classList.contains('show')) {
      BarberCo.toast(toast.textContent);
      toast.classList.remove('show');
    }
  }
  function update() {
    scheduled = false;
    let next = sections[0][0];
    for (const frame of frames) {
      const rect = frame.parentElement.getBoundingClientRect();
      if (rect.top <= 150) next = frame.dataset.staffSection;
      const visible = rect.bottom > 72 && rect.top < innerHeight;
      if (frame.contentWindow && frame.hasAttribute('src')) {
        const wasVisible = frame.contentWindow.staffModuleVisible;
        frame.contentWindow.staffModuleVisible = visible;
        if (visible && !wasVisible) frame.contentWindow.dispatchEvent(new Event('focus'));
        if (visible) positionDialogs(frame);
      }
    }
    active = pendingTarget || next;
    if (location.hash !== `#${active}`) history.replaceState(null, '', `#${active}`);
    document.querySelectorAll('.sidebar-group a').forEach(link => {
      const selected = new URL(link.href).hash === `#${active}`;
      link.classList.toggle('active', selected);
      if (selected) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    });
  }
  function requestUpdate() { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } }
  const lazy = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) load(entry.target); }), { rootMargin: '500px' });
  frames.forEach(frame => lazy.observe(frame));
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  const cancelAnchor = () => { pendingTarget = null; clearTimeout(anchorTimer); requestUpdate(); };
  window.addEventListener('wheel', cancelAnchor, { passive: true });
  window.addEventListener('touchstart', cancelAnchor, { passive: true });
  window.addEventListener('popstate', () => navigate(permitted.has(location.hash.slice(1)) ? location.hash.slice(1) : sections[0][0], 'instant', false));
  window.addEventListener('pagehide', () => { lazy.disconnect(); cleanups.forEach(cleanup => cleanup()); window.removeEventListener('message', updateRail); });
  load(document.getElementById(initial).querySelector('iframe'));
  requestAnimationFrame(settleAnchor);
})();
