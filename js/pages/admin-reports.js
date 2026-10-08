const { nav, initHeader, adminSidebar, peso, api, icon, safeText } = BarberCo;

if (!BarberCo.canAccess("admin")) {
  location.replace("login.html");
  throw new Error("Admin access required.");
}

async function render() {
  let analytics;
  let connectionError = '';
  try {
    analytics = await api("/admin/analytics");
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
        ${BarberAnalytics.markup({ rawOpen: true })}
        <section class="panel" aria-labelledby="barber-performance-title">
          <div class="panel-heading"><div><h3 id="barber-performance-title">Barber performance</h3><p class="muted">All time. Shop collections include booking fees. Demo bookings are counted separately.</p></div><button class="icon-button" type="button" data-barber-export aria-label="Export barber performance CSV" title="Export barber performance CSV" ${connectionError ? 'disabled' : ''}>${icon('Download')}</button></div>
          <div class="list-toolbar"><label class="search-field">${icon('Search')}<input type="search" data-barber-search placeholder="Find a barber" aria-label="Search barber performance"></label><select data-barber-sort aria-label="Sort barber performance"><option value="completed">Completed cuts</option><option value="revenue">Collected amount</option><option value="bookings">Online bookings</option><option value="walkins">Walk-ins</option><option value="name">Name</option></select></div>
          <div class="data-table-scroll barber-performance-table" tabindex="0" role="region" aria-label="Barber performance data"><table><thead><tr><th scope="col">Barber</th><th scope="col">Online</th><th scope="col">Walk-ins</th><th scope="col">Completed</th><th scope="col">Cancelled</th><th scope="col">Collected (PHP)</th><th scope="col">Demo bookings</th></tr></thead><tbody data-barber-rows></tbody><tfoot data-barber-totals></tfoot></table></div>
        </section>
        <div class="grid-2"><section class="panel"><div class="panel-heading"><h3>Bookings by service</h3>${icon('ChartBar')}</div><div class="report-bars">${analytics.services.map((service) => `<div class="bar"><span><b>${safeText(service.name)}</b><b>${service.bookings || 0}</b></span><i style="width:${Math.min(100, (service.bookings || 0) / maxBookings * 100)}%"></i></div>`).join('') || '<div class="empty-state">No service data available.</div>'}</div></section><section class="panel"><div class="panel-heading"><h3>Service breakdown</h3>${icon('Scissors')}</div><div class="summary-list">${analytics.services.map((service) => `<div><span>${safeText(service.name)}</span><strong>${service.bookings || 0} bookings</strong></div>`).join('') || '<div class="empty-state">No bookings recorded.</div>'}</div></section></div>
      </div>
    </section>
  `;
  initHeader("admin");
  BarberAnalytics.mount(analytics);
  const performance = analytics.barberPerformance || [];
  const metrics = ['bookings', 'walkins', 'completed', 'cancelled', 'revenue', 'demoBookings'];
  function filteredRows() {
    const query = document.querySelector('[data-barber-search]').value.trim().toLowerCase();
    const sort = document.querySelector('[data-barber-sort]').value;
    return performance.filter((item) => item.name.toLowerCase().includes(query)).sort((a, b) => (sort === 'name' ? 0 : b[sort] - a[sort]) || a.name.localeCompare(b.name));
  }
  function updatePerformance() {
    const rows = filteredRows();
    document.querySelector('[data-barber-rows]').innerHTML = rows.map((item) => `<tr><th scope="row">${safeText(item.name)}<small class="muted">${safeText(item.status)}</small></th>${metrics.map((metric) => `<td>${metric === 'revenue' ? Number(item[metric]).toLocaleString('en-PH', { minimumFractionDigits: 2 }) : item[metric]}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="7">${connectionError ? 'Barber performance could not be loaded.' : performance.length ? 'No barbers match your search.' : 'No barber records yet.'}</td></tr>`;
    const totals = rows.reduce((sum, item) => { metrics.forEach((metric) => { sum[metric] += item[metric]; }); return sum; }, Object.fromEntries(metrics.map((metric) => [metric, 0])));
    document.querySelector('[data-barber-totals]').innerHTML = rows.length ? `<tr><th scope="row">${rows.length} barber groups</th>${metrics.map((metric) => `<td>${metric === 'revenue' ? totals[metric].toLocaleString('en-PH', { minimumFractionDigits: 2 }) : totals[metric]}</td>`).join('')}</tr>` : '';
  }
  document.querySelector('[data-barber-search]').addEventListener('input', updatePerformance);
  document.querySelector('[data-barber-sort]').addEventListener('change', updatePerformance);
  document.querySelector('[data-barber-export]').addEventListener('click', () => {
    const csvCell = (value) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
    const csv = [['Barber', 'Status', 'Online bookings', 'Walk-ins', 'Completed cuts', 'Cancelled', 'Collected (PHP)', 'Demo bookings'], ...filteredRows().map((item) => [item.name, item.status, ...metrics.map((metric) => metric === 'revenue' ? item[metric].toFixed(2) : item[metric])])].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'barber-co-barber-performance-all-time.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  updatePerformance();
}

render();
