const DAY_MS = 24 * 60 * 60 * 1000;
const PH_OFFSET = 8 * 60 * 60 * 1000;

function dayKey(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() + PH_OFFSET).toISOString().slice(0, 10);
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
}

function appointmentAmount(item, services) {
  if (item.total != null && Number.isFinite(Number(item.total))) return money(item.total);
  const service = services.find((candidate) => String(candidate._id) === item.serviceId || candidate.slug === item.serviceId);
  return money(money(service?.price) + money(item.bookingFee));
}

function buildAnalytics(appointments, queue, customers, services, now = new Date()) {
  appointments = appointments.filter((item) => !item.demoPayment);
  const end = Date.parse(`${dayKey(now)}T00:00:00Z`);
  const daily = Array.from({ length: 365 }, (_, index) => ({
    date: new Date(end - (364 - index) * DAY_MS).toISOString().slice(0, 10),
    bookings: 0, walkins: 0, revenue: 0
  }));
  const days = new Map(daily.map((day) => [day.date, day]));
  let revenue = 0;
  let legacyPayments = 0;
  const createdAt = (item) => item.createdAt || item._id?.getTimestamp?.();
  const record = (item, metric) => {
    const day = days.get(dayKey(createdAt(item)));
    if (day) day[metric] += 1;
  };
  const paid = (item, amount) => {
    if (!item.paid) return;
    revenue += amount;
    if (!item.paidAt) legacyPayments += 1;
    // Existing records predate payment timestamps; keep their last recorded date visible.
    const day = days.get(dayKey(item.paidAt || item.updatedAt || createdAt(item)));
    if (day) day.revenue = money(day.revenue + amount);
  };
  appointments.forEach((item) => { record(item, 'bookings'); paid(item, appointmentAmount(item, services)); });
  queue.forEach((item) => { record(item, 'walkins'); paid(item, money(item.price)); });
  return {
    totals: { customers, bookings: appointments.length, walkins: queue.length, revenue: money(revenue), waiting: queue.filter((item) => item.status === 'waiting').length },
    daily, legacyPayments, timeZone: 'Asia/Manila'
  };
}

module.exports = { buildAnalytics };
