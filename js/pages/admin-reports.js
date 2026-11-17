const { nav, initHeader, adminSidebar, peso, api, icon, safeText } = BarberCo;
const ledgerStyles = document.createElement('link');
ledgerStyles.rel = 'stylesheet';
ledgerStyles.href = 'css/collections-ledger.css?v=report-selection-20261117';
document.head.append(ledgerStyles);

if (!BarberCo.canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

async function render() {
  document.querySelector('#app').innerHTML = `${nav('admin')}<section class="app-shell">${adminSidebar('reports')}<div class="workspace"><div class="workspace-heading"><h1>Reports</h1></div><p role="status" aria-live="polite">Loading reports...</p></div></section>`;
  const loadReports = () => api('/admin/analytics');
  let analytics;
  let connectionError = '';
  try {
    analytics = await loadReports();
  } catch (error) {
    if (error.message.includes("Admin")) location.href = "login.html";
    connectionError = error.message || 'Reports could not be loaded.';
    analytics = { totals: {}, services: [], barberPerformance: [] };
  }
  const maxBookings = Math.max(1, ...analytics.services.map((item) => item.bookings || 0));
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("reports")}
      <div class="workspace">
        <div class="workspace-heading"><div><p class="eyebrow">SHOP PERFORMANCE</p><h1>Reports</h1><p class="muted">All-time bookings and verified payments.</p></div><span class="count-badge">${icon('ChartNoAxesCombined')} All time</span></div>
        ${connectionError ? `<div class="connection-error" role="alert">${safeText(connectionError)}</div>` : ''}
        <div class="grid-4 metric-grid">${[['CalendarDays','Bookings',analytics.totals.bookings,'All appointments'],['Users','Customers',analytics.totals.customers,'Registered accounts'],['ListOrdered','Waiting',analytics.totals.waiting,'Live walk-in queue'],['Wallet','Revenue',peso(analytics.totals.revenue || 0),'Verified payments']].map(([symbol,label,value,detail]) => `<article class="metric"><div class="metric-label">${label}${icon(symbol)}</div><strong>${connectionError ? '--' : value}</strong><small class="muted">${detail}</small></article>`).join('')}</div>
        ${BarberAnalytics.markup({ rawOpen: true, defaultDays: 1 })}
        <section class="panel" aria-labelledby="barber-performance-title">
          <div class="panel-heading"><div><h3 id="barber-performance-title">Barber performance</h3><p class="muted">All time. Collected amounts include booking fees and paid walk-ins.</p></div><button class="icon-button" type="button" data-barber-export aria-label="Export barber performance CSV" title="Export barber performance CSV" ${connectionError ? 'disabled' : ''}>${icon('Download')}</button></div>
          <div class="list-toolbar"><label class="search-field">${icon('Search')}<input type="search" data-barber-search placeholder="Find a barber" aria-label="Search barber performance"></label><select data-barber-sort aria-label="Sort barber performance"><option value="completed">Completed cuts</option><option value="revenue">Collected amount</option><option value="bookings">Online bookings</option><option value="walkins">Walk-ins</option><option value="name">Name</option></select></div>
          <div class="data-table-scroll barber-performance-table" tabindex="0" role="region" aria-label="Barber performance data"><table><thead><tr><th scope="col">Barber</th><th scope="col">Online</th><th scope="col">Walk-ins</th><th scope="col">Completed</th><th scope="col">Cancelled</th><th scope="col">Collected (PHP)</th></tr></thead><tbody data-barber-rows></tbody><tfoot data-barber-totals></tfoot></table></div>
        </section>
        <div class="grid-2"><section class="panel"><div class="panel-heading"><h3>Bookings by service</h3>${icon('ChartBar')}</div><div class="report-bars">${analytics.services.map((service) => `<div class="bar"><span><b>${safeText(service.name)}</b><b>${service.bookings || 0}</b></span><i style="width:${Math.min(100, (service.bookings || 0) / maxBookings * 100)}%"></i></div>`).join('') || '<div class="empty-state">No service data available.</div>'}</div></section><section class="panel"><div class="panel-heading"><h3>Service breakdown</h3>${icon('Scissors')}</div><div class="summary-list">${analytics.services.map((service) => `<div><span>${safeText(service.name)}</span><strong>${service.bookings || 0} bookings</strong></div>`).join('') || '<div class="empty-state">No bookings recorded.</div>'}</div></section></div>
      </div>
    </section>
  `;
  initHeader("admin");
  const printButton = document.createElement('button');
  printButton.type = 'button';
  printButton.className = 'button primary';
  printButton.dataset.printReport = '';
  printButton.innerHTML = `${icon('Printer')} Print report`;
  printButton.disabled = Boolean(connectionError || !analytics.daily?.length);
  document.querySelector('.workspace-heading > .count-badge').replaceWith(printButton);
  printButton.addEventListener('click', () => BarberReport.open(analytics, { days: Number(document.querySelector('[data-chart-range]').value), barbers: filteredRows(), query: document.querySelector('[data-barber-search]').value.trim() }));
  document.querySelector('.workspace-heading .muted').textContent = 'Daily activity, recorded collections and team performance.';
  const duplicateBreakdown = document.querySelector('.workspace > .grid-2');
  duplicateBreakdown.lastElementChild.remove();
  duplicateBreakdown.className = 'report-services';
  BarberAnalytics.mount(analytics);
  const ledger = document.createElement('section');
  ledger.className = 'panel collections-ledger';
  ledger.setAttribute('aria-label', 'Recorded collections audit');
  document.querySelector('.workspace').append(ledger);
  const selectedRecords = new Set();
  const pageSize = 10;
  let ledgerPage = 0;
  let clearingRecords = false;
  let ledgerRevision = 0;
  let ledgerMessage = '';
  const canClearRecords = BarberCo.currentRole() === 'admin';
  function updateLedger() {
    const audit = analytics.collections;
    if (!audit) { ledger.hidden = true; return; }
    ledger.hidden = false;
    const ids = new Set(audit.records.map(item => item.id));
    for (const id of selectedRecords) if (!ids.has(id)) selectedRecords.delete(id);
    const lastPage = Math.max(0, Math.ceil(audit.records.length / pageSize) - 1);
    ledgerPage = Math.min(ledgerPage, lastPage);
    const start = ledgerPage * pageSize;
    const rows = audit.records.slice(start, start + pageSize);
    ledger.innerHTML = `<div class="panel-heading"><h3>All-time collection records</h3><span>${peso(audit.bookings ?? audit.online)} bookings / ${peso(audit.walkins)} walk-ins</span></div><div class="ledger-toolbar">${canClearRecords ? `<button type="button" class="button secondary" data-ledger-delete ${clearingRecords || !selectedRecords.size ? 'disabled' : ''}>${icon('Trash2')} Delete${selectedRecords.size ? ` (${selectedRecords.size})` : ''}</button><button type="button" class="button secondary" data-ledger-clear ${clearingRecords || !audit.records.length ? 'disabled' : ''}>${icon('ListX')} Clear all</button>` : ''}<span role="status" aria-live="polite">${safeText(ledgerMessage)}</span></div><div class="data-table-scroll"><table><thead><tr>${canClearRecords ? '<th class="ledger-select"><input type="checkbox" data-ledger-select-page aria-label="Select this page" /></th>' : ''}<th>Customer / reference</th><th>Source / component / tender</th><th>Payment date</th><th>Amount</th></tr></thead><tbody>${rows.map(item => `<tr>${canClearRecords ? `<td class="ledger-select"><input type="checkbox" data-ledger-select="${safeText(item.id)}" aria-label="Select ${safeText(item.customer)} payment ${safeText(item.id)}" ${selectedRecords.has(item.id) ? 'checked' : ''} ${clearingRecords ? 'disabled' : ''} /></td>` : ''}<th scope="row">${safeText(item.customer)}<small class="ledger-reference">${safeText(item.id)}</small></th><td>${['booking', 'online'].includes(item.source) ? 'Booking' : 'Walk-in'} / ${safeText(item.component || 'legacy')} / ${safeText(item.tender || 'unrecorded')}</td><td>${item.paidAt ? safeText(new Date(item.paidAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })) : 'Payment date unknown'}</td><td>${peso(item.amount)}</td></tr>`).join('') || `<tr><td colspan="${canClearRecords ? 5 : 4}">No recorded collections.</td></tr>`}</tbody><tfoot><tr><th colspan="${canClearRecords ? 4 : 3}">All-time revenue</th><td>${peso(analytics.totals.revenue)}</td></tr></tfoot></table></div><div class="ledger-pagination"><span>Rows per page: <strong>10</strong></span><span data-ledger-range>${audit.records.length ? start + 1 : 0}&ndash;${Math.min(start + pageSize, audit.records.length)} of ${audit.records.length}</span>${[['first', 'ChevronsLeft', 'First page', 0], ['previous', 'ChevronLeft', 'Previous page', ledgerPage - 1], ['next', 'ChevronRight', 'Next page', ledgerPage + 1], ['last', 'ChevronsRight', 'Last page', lastPage]].map(([action, symbol, label, target]) => `<button type="button" class="icon-button" data-ledger-page="${target}" aria-label="${label}" title="${label}" ${clearingRecords || (['first', 'previous'].includes(action) ? ledgerPage === 0 : ledgerPage === lastPage) ? 'disabled' : ''}>${icon(symbol)}</button>`).join('')}</div>`;
    const selectPage = ledger.querySelector('[data-ledger-select-page]');
    if (selectPage) {
      selectPage.checked = rows.length > 0 && rows.every(item => selectedRecords.has(item.id));
      selectPage.indeterminate = !selectPage.checked && rows.some(item => selectedRecords.has(item.id));
      selectPage.disabled = clearingRecords || !rows.length;
    }
  }
  ledger.addEventListener('change', event => {
    if (!canClearRecords || clearingRecords) return;
    if (event.target.matches('[data-ledger-select]')) {
      const id = event.target.dataset.ledgerSelect;
      if (event.target.checked) selectedRecords.add(id); else selectedRecords.delete(id);
    } else if (event.target.matches('[data-ledger-select-page]')) {
      for (const item of analytics.collections.records.slice(ledgerPage * pageSize, (ledgerPage + 1) * pageSize)) {
        if (event.target.checked) selectedRecords.add(item.id); else selectedRecords.delete(item.id);
      }
    } else return;
    updateLedger();
  });
  ledger.addEventListener('click', async event => {
    const pageButton = event.target.closest('[data-ledger-page]');
    if (pageButton && !pageButton.disabled) { ledgerPage = Number(pageButton.dataset.ledgerPage); updateLedger(); return; }
    const button = event.target.closest('[data-ledger-delete], [data-ledger-clear]');
    if (!canClearRecords || !button || button.disabled || clearingRecords) return;
    const ids = button.hasAttribute('data-ledger-clear') ? analytics.collections.records.map(item => item.id) : [...selectedRecords];
    clearingRecords = true;
    ledgerRevision += 1;
    ledgerMessage = 'Removing records...';
    updateLedger();
    try {
      for (let offset = 0; offset < ids.length; offset += 1000) {
        const batch = ids.slice(offset, offset + 1000);
        await api('/admin/collection-records/clear', { method: 'POST', body: JSON.stringify({ ids: batch }) });
        const removed = new Set(batch);
        analytics.collections.records = analytics.collections.records.filter(item => !removed.has(item.id));
        batch.forEach(id => selectedRecords.delete(id));
      }
      ledgerMessage = 'Records removed.';
    } catch (error) { ledgerMessage = error.message || 'Could not remove records. Try again.'; }
    finally { clearingRecords = false; updateLedger(); }
  });
  updateLedger();
  const reportLayout = document.createElement('div');
  reportLayout.className = 'reports-layout';
  const performancePanel = document.querySelector('[aria-labelledby="barber-performance-title"]');
  performancePanel.before(reportLayout);
  const breakdowns = document.createElement('div');
  breakdowns.className = 'report-breakdowns';
  breakdowns.append(performancePanel, duplicateBreakdown);
  reportLayout.append(document.querySelector('[data-analytics]'), breakdowns);
  let performance = analytics.barberPerformance || [];
  const metricKeys = ['bookings', 'customers', 'waiting', 'revenue'];
  document.querySelectorAll('.metric-grid .metric').forEach((node, index) => { node.dataset.metric = metricKeys[index]; });
  document.querySelector('[data-metric="revenue"] small').textContent = 'All-time recorded collections / not the selected-day total';
  document.querySelector('[data-metric="waiting"] small').textContent = 'Waiting walk-ins / excludes now serving';
  document.querySelector('[data-metric="customers"] small').textContent = 'Customer accounts / excludes staff';
  const countNote = () => {
    document.querySelector('[data-metric="bookings"] small').textContent = `Recorded appointments`;
  };
  countNote();
  const metrics = ['bookings', 'walkins', 'completed', 'cancelled', 'revenue'];
  function filteredRows() {
    const query = document.querySelector('[data-barber-search]').value.trim().toLowerCase();
    const sort = document.querySelector('[data-barber-sort]').value;
    return performance.filter((item) => item.name.toLowerCase().includes(query)).sort((a, b) => (sort === 'name' ? 0 : b[sort] - a[sort]) || a.name.localeCompare(b.name));
  }
  function updatePerformance() {
    const rows = filteredRows();
    document.querySelector('[data-barber-rows]').innerHTML = rows.map((item) => `<tr><th scope="row">${safeText(item.name)}<small class="muted">${safeText(item.status)}</small></th>${metrics.map((metric) => `<td>${metric === 'revenue' ? Number(item[metric]).toLocaleString('en-PH', { minimumFractionDigits: 2 }) : item[metric]}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="6">${connectionError ? 'Barber performance could not be loaded.' : performance.length ? 'No barbers match your search.' : 'No barber records yet.'}</td></tr>`;
    const totals = rows.reduce((sum, item) => { metrics.forEach((metric) => { sum[metric] += item[metric]; }); return sum; }, Object.fromEntries(metrics.map((metric) => [metric, 0])));
    document.querySelector('[data-barber-totals]').innerHTML = rows.length ? `<tr><th scope="row">${rows.length} barber groups</th>${metrics.map((metric) => `<td>${metric === 'revenue' ? totals[metric].toLocaleString('en-PH', { minimumFractionDigits: 2 }) : totals[metric]}</td>`).join('')}</tr>` : '';
  }
  document.querySelector('[data-barber-search]').addEventListener('input', updatePerformance);
  document.querySelector('[data-barber-sort]').addEventListener('change', updatePerformance);
  document.querySelector('[data-barber-export]').addEventListener('click', () => {
    const csvCell = (value) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
    const csv = [['Barber', 'Status', 'Online bookings', 'Walk-ins', 'Completed cuts', 'Cancelled', 'Collected (PHP)'], ...filteredRows().map((item) => [item.name, item.status, ...metrics.map((metric) => metric === 'revenue' ? item[metric].toFixed(2) : item[metric])])].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'barber-co-barber-performance-all-time.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  updatePerformance();
  const sync = document.createElement('small');
  sync.setAttribute('role', 'status');
  sync.textContent = connectionError ? 'Reports unavailable; retrying automatically' : 'Live reports connected';
  document.querySelector('.workspace-heading').append(sync);
  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.className = 'button secondary';
  retryButton.innerHTML = `${icon('RefreshCw')} Refresh reports`;
  retryButton.addEventListener('click', refreshReports);
  document.querySelector('.workspace-heading').append(retryButton);
  let busy = false;
  async function refreshReports() {
    if (busy || clearingRecords || document.hidden) return;
    busy = true;
    const revision = ledgerRevision;
    retryButton.disabled = true;
    sync.textContent = 'Loading reports...';
    try {
      const updatedAnalytics = await loadReports();
      if (clearingRecords || revision !== ledgerRevision) return;
      analytics = updatedAnalytics;
      connectionError = '';
      document.querySelector('.connection-error')?.remove();
      metricKeys.forEach((key) => {
        document.querySelector(`[data-metric="${key}"] strong`).textContent = key === 'revenue' ? peso(analytics.totals[key]) : analytics.totals[key];
      });
      countNote();
      performance = analytics.barberPerformance || [];
      updateLedger();
      updatePerformance();
      document.querySelector('[data-barber-export]').disabled = false;
      printButton.disabled = !analytics.daily?.length;
      const maximum = Math.max(1, ...analytics.services.map((item) => item.bookings || 0));
      document.querySelector('.report-bars').innerHTML = analytics.services.map((item) => `<div class="bar"><span><b>${safeText(item.name)}</b><b>${item.bookings || 0}</b></span><i style="width:${Math.min(100, (item.bookings || 0) / maximum * 100)}%"></i></div>`).join('');
      BarberAnalytics.refresh(analytics);
      sync.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      if ([401, 403].includes(error.status)) location.replace('login.html');
      sync.textContent = analytics.daily?.length ? 'Connection interrupted; showing last update' : 'Reports unavailable. Try refreshing again.';
    } finally { busy = false; retryButton.disabled = false; }
  }
  setInterval(refreshReports, 15000);
  window.addEventListener('focus', refreshReports);
  document.addEventListener('visibilitychange', refreshReports);
}

render();
