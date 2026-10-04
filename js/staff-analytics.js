const BarberAnalytics = (() => {
  const { icon, safeText, peso } = BarberCo;
  let currentChart;
  const series = {
    revenue: { label: 'Collected revenue', color: '#b77b2c', money: true },
    bookings: { label: 'Online bookings', color: '#a7562f' },
    walkins: { label: 'Walk-ins', color: '#315b4c' }
  };
  const dateLabel = (date) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(`${date}T00:00:00+08:00`));

  function markup({ rawOpen = false } = {}) {
    return `<section class="analytics-section" data-analytics>
      <div class="panel-heading"><div><h3>Activity over time</h3><p class="muted">Philippine time / verified revenue includes booking fees and paid walk-ins.</p></div><label class="analytics-range">Period<select data-chart-range aria-label="Analytics period"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 365 days</option></select></label></div>
      <div class="analytics-toolbar"><div class="chart-tabs" role="group" aria-label="Chart metric">${Object.entries(series).map(([key, item]) => `<button type="button" data-chart-metric="${key}" class="${key === 'revenue' ? 'active' : ''}" aria-pressed="${key === 'revenue'}"><i style="background:${item.color}"></i>${key === 'revenue' ? 'Revenue' : key === 'bookings' ? 'Bookings' : 'Walk-ins'}</button>`).join('')}</div><div class="period-totals" data-period-totals></div></div>
      <div class="chart-frame"><canvas data-trend-chart role="img" aria-label="Daily activity chart; exact values are available in the daily data table"></canvas><p class="chart-message" data-chart-message hidden></p></div>
      <div class="chart-inspector"><output data-chart-readout aria-live="polite"></output><input type="range" data-chart-day min="0" max="29" value="29" aria-label="Inspect a day in the chart"></div>
      <p class="analytics-note" data-analytics-note hidden></p>
      <details class="raw-data" ${rawOpen ? 'open' : ''}><summary>Daily data <span>${icon('Table2')} Exact numbers</span></summary><div class="raw-data-heading"><span data-data-period></span><button class="icon-button" type="button" data-chart-export title="Download daily data as CSV" aria-label="Download daily data as CSV">${icon('Download')}</button></div><div class="data-table-scroll"><table><caption class="sr-only">Daily online bookings, walk-ins, and collected revenue</caption><thead><tr><th scope="col">Date</th><th scope="col">Bookings</th><th scope="col">Walk-ins</th><th scope="col">Revenue (PHP)</th></tr></thead><tbody data-chart-rows></tbody><tfoot data-chart-footer></tfoot></table></div></details>
    </section>`;
  }

  function mount(analytics) {
    currentChart?.destroy();
    currentChart = null;
    const root = document.querySelector('[data-analytics]');
    if (!root) return;
    const message = root.querySelector('[data-chart-message]');
    const daily = analytics.daily;
    if (!Array.isArray(daily) || !daily.length || !window.Chart) {
      message.hidden = false;
      message.textContent = 'Daily analytics could not be loaded.';
      root.querySelectorAll('button, input, select').forEach((control) => { control.disabled = true; });
      return;
    }
    const canvas = root.querySelector('canvas');
    const slider = root.querySelector('[data-chart-day]');
    let metric = 'revenue';
    let days = [];
    let chart;
    const inspect = (index) => {
      const day = days[index];
      if (!day) return;
      slider.value = index;
      slider.setAttribute('aria-valuetext', `${dateLabel(day.date)}: ${day.bookings} bookings, ${day.walkins} walk-ins, ${peso(day.revenue)}`);
      root.querySelector('[data-chart-readout]').textContent = `${dateLabel(day.date)} / ${day.bookings} bookings / ${day.walkins} walk-ins / ${peso(day.revenue)}`;
    };
    function update() {
      days = daily.slice(-Number(root.querySelector('[data-chart-range]').value));
      const selected = series[metric];
      const totals = days.reduce((sum, day) => ({ bookings: sum.bookings + day.bookings, walkins: sum.walkins + day.walkins, revenue: sum.revenue + day.revenue }), { bookings: 0, walkins: 0, revenue: 0 });
      root.querySelector('[data-period-totals]').innerHTML = `<span><b>${totals.bookings}</b> bookings</span><span><b>${totals.walkins}</b> walk-ins</span><span><b>${peso(totals.revenue)}</b> collected</span>`;
      root.querySelector('[data-chart-rows]').innerHTML = [...days].reverse().map((day) => `<tr><th scope="row">${safeText(dateLabel(day.date))}</th><td>${day.bookings}</td><td>${day.walkins}</td><td>${Number(day.revenue).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td></tr>`).join('');
      root.querySelector('[data-chart-footer]').innerHTML = `<tr><th scope="row">Period total</th><td>${totals.bookings}</td><td>${totals.walkins}</td><td>${totals.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td></tr>`;
      root.querySelector('[data-data-period]').textContent = `${dateLabel(days[0].date)} - ${dateLabel(days.at(-1).date)}`;
      slider.max = days.length - 1;
      inspect(days.length - 1);
      const data = { labels: days.map((day) => dateLabel(day.date)), datasets: [{ label: selected.label, data: days.map((day) => day[metric]), borderColor: selected.color, backgroundColor: `${selected.color}14`, borderWidth: 2, fill: true, tension: 0.15, pointRadius: days.length <= 7 ? 3 : 0, pointHoverRadius: 5, pointHitRadius: 15 }] };
      if (chart) { chart.data = data; chart.options.scales.y.ticks.precision = selected.money ? 2 : 0; chart.update(); }
      else chart = currentChart = new Chart(canvas, {
        type: 'line', data,
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 250 },
          interaction: { mode: 'index', intersect: false },
          onHover: (_event, points) => { if (points[0]) inspect(points[0].index); },
          onClick: (_event, points) => { if (points[0]) inspect(points[0].index); },
          plugins: { legend: { display: false }, tooltip: { displayColors: false, backgroundColor: '#241a13', titleColor: '#fffaf1', bodyColor: '#eee2d0', padding: 12, callbacks: { label: (context) => `${series[metric].label}: ${series[metric].money ? peso(context.parsed.y) : context.parsed.y}` } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#796b5e', maxTicksLimit: 7, maxRotation: 0, font: { size: 10 } }, border: { color: '#dfd2bf' } },
            y: { beginAtZero: true, grid: { color: '#ede4d6' }, border: { display: false }, ticks: { color: '#796b5e', precision: selected.money ? 2 : 0, font: { size: 10 } } }
          }
        }
      });
      canvas.setAttribute('aria-label', `${selected.label}, ${days.length} days. Exact values are in the daily data table.`);
      message.hidden = days.some((day) => day[metric] > 0);
      message.textContent = 'No activity in this period';
    }
    root.querySelector('[data-chart-range]').addEventListener('change', update);
    root.querySelectorAll('[data-chart-metric]').forEach((button) => button.addEventListener('click', () => {
      metric = button.dataset.chartMetric;
      root.querySelectorAll('[data-chart-metric]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
      update();
    }));
    slider.addEventListener('input', () => {
      const index = Number(slider.value);
      inspect(index);
      chart.setActiveElements([{ datasetIndex: 0, index }]);
      chart.update('none');
    });
    root.querySelector('[data-chart-export]').addEventListener('click', () => {
      const csv = ['Date,Online bookings,Walk-ins,Collected revenue (PHP)', ...days.map((day) => `${day.date},${day.bookings},${day.walkins},${Number(day.revenue).toFixed(2)}`)].join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `barber-co-daily-${days[0].date}-to-${days.at(-1).date}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    if (analytics.legacyPayments) {
      const note = root.querySelector('[data-analytics-note]');
      note.hidden = false;
      note.textContent = `${analytics.legacyPayments} older payment records use their last recorded update date.`;
    }
    update();
  }

  return { markup, mount };
})();
