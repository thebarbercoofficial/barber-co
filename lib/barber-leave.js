function onLeave(barber, date) {
  return barber.status === 'on-leave' || Boolean(barber.leaveFrom && barber.leaveTo && date >= barber.leaveFrom && date <= barber.leaveTo);
}

function leaveDates(body) {
  const from = String(body.leaveFrom || '');
  const to = String(body.leaveTo || '');
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if ((from || to) && (!valid(from) || !valid(to) || from > to)) throw Object.assign(new Error('Enter valid leave start and end dates, in order.'), { status: 400 });
  return { leaveFrom: from, leaveTo: to };
}

module.exports = { onLeave, leaveDates };
