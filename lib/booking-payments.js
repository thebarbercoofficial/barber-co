function paymentChoice(value = 'online') {
  if (!['online', 'cash'].includes(value)) throw Object.assign(new Error('Choose online or cash payment for the service.'), { status: 400 });
  return value;
}

function bookingPaymentChoice(value = 'online') {
  if (!['online', 'onsite'].includes(value)) throw Object.assign(new Error('Choose online payment or payment at the shop.'), { status: 400 });
  return value;
}

function cashBalance(item) {
  if (item.demoPayment || item.servicePaid) return 0;
  if (item.bookingPaymentMethod === 'onsite') return Math.round(Math.max(0, Number(item.total) || 0) * 100) / 100;
  return item.servicePaymentMethod === 'cash' ? Math.round(Math.max(0, Number(item.total) - Number(item.bookingFee)) * 100) / 100 : 0;
}

function requireCashCollection(item, confirmation = {}) {
  const amount = cashBalance(item);
  if (amount > 0 && (confirmation.cashCollected !== true || typeof confirmation.cashAmount !== 'number' || !Number.isFinite(confirmation.cashAmount) || confirmation.cashAmount !== amount)) {
    throw Object.assign(new Error(`Confirm cash collection of PHP ${amount.toFixed(2)} with the exact amount before completing this service.`), { status: 400 });
  }
}

function paymentNotice(item) {
  if (!item.servicePaymentMethod || item.demoPayment) return '';
  if (item.bookingPaymentMethod === 'onsite') return ` Payment method: pay at the shop. Amount due: PHP ${cashBalance(item).toFixed(2)}${item.servicePaid ? '; cash collection confirmed' : '; no online payment has been recorded'}.`;
  return ` Reservation fee: PHP ${Number(item.bookingFee).toFixed(2)} ${item.bookingFeePaid ? 'verified online' : 'awaiting online verification'}. Service payment: ${item.servicePaymentMethod === 'cash' ? 'cash at shop' : 'online'}. Cash balance: PHP ${cashBalance(item).toFixed(2)}.${item.servicePaymentMethod === 'cash' && item.servicePaid ? ' Cash collection confirmed.' : ''}`;
}

function paymentUpdate(item, status, now = new Date(), confirmation = {}) {
  if (item.demoPayment || !['confirmed', 'completed'].includes(status)) return {};
  if (item.bookingPaymentMethod === 'onsite') {
    if (status !== 'completed') return {};
    requireCashCollection(item, confirmation);
    return { bookingFeePaid: true, bookingFeePaidAt: item.bookingFeePaidAt || now, servicePaid: true, servicePaidAt: item.servicePaidAt || now, paid: true, paidAt: item.paidAt || now };
  }
  if (!item.servicePaymentMethod) return { paid: true, ...(!item.paid ? { paidAt: now } : {}) };
  if (status === 'completed') requireCashCollection(item, confirmation);
  const servicePaid = item.servicePaid === true || item.servicePaymentMethod === 'online' || status === 'completed';
  return {
    bookingFeePaid: true, bookingFeePaidAt: item.bookingFeePaidAt || now,
    servicePaid, ...(servicePaid ? { servicePaidAt: item.servicePaidAt || now } : {}),
    paid: servicePaid, ...(servicePaid ? { paidAt: item.paidAt || now } : {})
  };
}

function paymentCollections(item, total) {
  if (item.demoPayment) return [];
  if (item.bookingPaymentMethod === 'onsite') return item.servicePaid ? [{ component: 'booking-total', tender: 'cash', amount: total, paidAt: item.paidAt || item.servicePaidAt }] : [];
  if (!item.servicePaymentMethod) return item.paid ? [{ component: 'legacy', tender: 'online', amount: total, paidAt: item.paidAt }] : [];
  const fee = Math.min(total, Math.max(0, Number(item.bookingFee) || 0));
  return [
    ...(item.bookingFeePaid === true ? [{ component: 'reservation-fee', tender: 'online', amount: fee, paidAt: item.bookingFeePaidAt }] : []),
    ...(item.servicePaid === true ? [{ component: 'service', tender: item.servicePaymentMethod, amount: total - fee, paidAt: item.servicePaidAt }] : [])
  ];
}

module.exports = { paymentChoice, bookingPaymentChoice, paymentUpdate, paymentCollections, cashBalance, requireCashCollection, paymentNotice };
