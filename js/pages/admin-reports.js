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
    analytics = { totals: {}, services: [] };
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
        <div class="grid-2"><section class="panel"><div class="panel-heading"><h3>Bookings by service</h3>${icon('ChartBar')}</div><div class="report-bars">${analytics.services.map((service) => `<div class="bar"><span><b>${safeText(service.name)}</b><b>${service.bookings || 0}</b></span><i style="width:${Math.min(100, (service.bookings || 0) / maxBookings * 100)}%"></i></div>`).join('') || '<div class="empty-state">No service data available.</div>'}</div></section><section class="panel"><div class="panel-heading"><h3>Service breakdown</h3>${icon('Scissors')}</div><div class="summary-list">${analytics.services.map((service) => `<div><span>${safeText(service.name)}</span><strong>${service.bookings || 0} bookings</strong></div>`).join('') || '<div class="empty-state">No bookings recorded.</div>'}</div></section></div>
      </div>
    </section>
  `;
  initHeader("admin");
}

render();
