window.BookingPolicy = (() => {
  const content = `<h3>Approval and payment</h3><p>Submitting a booking sends it to staff for review. Pending requests and payment drafts do not reserve capacity or block other customers. Staff approval is first-wins: the first staff-approved booking gets the time, not the first request or payment. Competing requests may be rejected. A receipt upload is not payment confirmation. Check My bookings for the latest approval and payment status.</p><h3>Non-refundable bookings</h3><p>Bookings are non-refundable, including the service payment and booking fee. Cancelling does not issue a refund. Check the service, barber, date, time and total before confirming. Contact the shop before paying if anything is unclear.</p><h3>One person per booking</h3><p>Each new booking covers one customer and one service, plus the booking fee. Group bookings are not available.</p><h3>Rescheduling</h3><p>Customer reschedule requests require staff approval. The requested time is not guaranteed or reserved until approved. Your current schedule remains on record during review. If the request is still unresolved when either the original or requested appointment starts, the booking is automatically cancelled without a refund.</p><h3>Updates</h3><p>Check your account for staff decisions. SMS and email delivery can be delayed or fail.</p>`;

  function terms() {
    const dialog = document.createElement('dialog');
    dialog.className = 'registration-policy-dialog';
    dialog.setAttribute('aria-label', 'Booking terms and policy');
    dialog.innerHTML = `<header class="registration-policy-heading"><h2>Booking terms and policy</h2><button type="button" data-close aria-label="Close booking terms">Close</button></header><div class="registration-policy-content">${content}</div>`;
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.querySelector('.registration-policy-content > p').textContent = 'Pay-at-counter bookings confirm immediately after availability is checked and reserve the selected time. Online-payment bookings require staff payment verification before reserving capacity. A receipt upload is not payment confirmation. Check My bookings for the latest status.';
    dialog.querySelector('.registration-policy-content').insertAdjacentHTML('beforeend', '<h3>Arrival and no-shows</h3><p>Check in with staff at the shop by the grace deadline shown in My bookings. The default is 10 minutes after your appointment; the shop may change it for newly approved bookings. No-shows lose their reserved time without a refund. Late arrivals may join the walk-in queue. Customers checked in before the deadline are not marked absent because their barber is delayed.</p>');
    dialog.querySelector('.registration-policy-content').insertAdjacentHTML('beforeend', '<h3>Shop-rejected paid requests</h3><p>The customer-cancellation and no-show forfeiture rule does not apply when the shop rejects a pending paid request. Staff must verify the transfer and arrange a manual refund with you. Uploading a receipt alone does not establish a payment; no automatic wallet refund is sent.</p>');
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  function confirm(demo = false, onsite = false, onSmsPreference = () => {}) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'registration-policy-dialog';
      dialog.setAttribute('aria-labelledby', 'booking-confirm-title');
      dialog.innerHTML = `<header class="registration-policy-heading"><h2 id="booking-confirm-title">Confirm your booking</h2></header><form class="registration-policy-content" method="dialog"><p><strong>This booking is non-refundable.</strong> Cancelling does not refund the service payment or booking fee.</p><p><strong>Submission does not guarantee your time.</strong> Pending requests and payment drafts do not reserve capacity. Staff approval is first-wins; competing requests may be rejected even after payment. Each booking is for one customer and one service.</p>${demo ? '<p>This is a demo booking. No real money is charged.</p>' : ''}<p><a class="inline" href="#booking-terms" data-booking-terms aria-haspopup="dialog">Read our booking terms and policy</a></p><label class="terms-consent"><span><input type="checkbox" required data-accept-booking><span>I understand and accept the non-refundable booking terms.</span></span></label><div class="button-row"><button class="button secondary" type="button" data-back>Go back</button><button class="button primary" type="submit">Confirm and submit</button></div></form>`;
      dialog.querySelector('.terms-consent').insertAdjacentHTML('afterend', '<label class="terms-consent"><span><input type="checkbox" data-booking-sms><span>Send me SMS updates for this booking, including approval and rescheduling.</span></span></label><p class="muted">Optional. Requires a verified mobile number. Network restrictions apply.</p>');
      if (onsite) {
        const paragraphs = dialog.querySelectorAll('form > p');
        paragraphs[0].textContent = 'Pay at the counter when your service is finished. No online payment is collected.';
        paragraphs[1].textContent = 'Your booking is confirmed immediately if the barber and time are still available.';
        dialog.querySelector('.terms-consent span span').textContent = 'I understand and accept the booking terms.';
      }
      dialog.querySelector('[data-booking-terms]').onclick = (event) => { event.preventDefault(); terms(); };
      if (!onsite) dialog.querySelector('form').insertAdjacentHTML('afterbegin', '<p>If the shop rejects a pending paid request, staff must verify the transfer and arrange a manual refund. Customer cancellations and no-shows remain non-refundable.</p>');
      dialog.querySelector('form').insertAdjacentHTML('afterbegin', '<p>Check in with staff before your grace deadline. No-shows lose their reserved time without a refund. Barber delays do not penalize customers who checked in on time.</p>');
      dialog.querySelector('[data-back]').onclick = () => dialog.close();
      dialog.querySelector('form').onsubmit = (event) => {
        event.preventDefault();
        if (event.target.reportValidity()) {
          onSmsPreference(dialog.querySelector('[data-booking-sms]').checked);
          dialog.close('accepted');
        }
      };
      dialog.addEventListener('close', () => {
        const accepted = dialog.returnValue === 'accepted';
        dialog.remove();
        resolve(accepted);
      }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  return { confirm, terms };
})();
