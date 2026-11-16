const { state, barbers, nav, initHeader, adminSidebar, byId, peso, toast, api, loadCatalog, icon, safeText } = BarberCo;

if (!BarberCo.canAccess("moderator")) {
  location.replace("login.html");
  throw new Error("Staff access required.");
}

let lastSnapshot = "";
let refreshInProgress = false;
let statusFilter = 'all';
let latestConnectionError = '';
let appointments = [];
let reservations = [];
let paymentReady = true;
let demoMode = false;
let mutationVersion = 0;
let activeMutations = 0;
const pendingAppointmentIds = new Set();

function appointmentView(item) {
  return { ...item, paymentProof: item.paymentProof || (item.hasPaymentProof ? `#receipt-${item.mongoId || item.id}` : ''), id: item.mongoId || item.id, time: item.time || 'Next available', status: item.status || 'pending' };
}

async function saveAppointment(path, body, confirmedUpdate) {
  const pendingId = path.split('/')[3];
  if (pendingAppointmentIds.has(pendingId)) throw new Error('This booking is already being saved.');
  pendingAppointmentIds.add(pendingId);
  activeMutations++;
  mutationVersion++;
  updatePanel(latestConnectionError, true);
  try {
    const data = await api(path, { method: 'PATCH', body: JSON.stringify(body) });
    if (!data.appointment && data.ok && confirmedUpdate) data.appointment = confirmedUpdate;
    if (!data.appointment) throw new Error('The saved appointment could not be confirmed. Refresh before trying again.');
    const id = String(data.appointment.mongoId || data.appointment.id);
    const previous = appointments.find(item => String(item.id) === id) || {};
    const updated = appointmentView({ ...previous, ...data.appointment });
    if (updated.status !== 'confirmed') updated.attendanceStatus = updated.status;
    else if (Object.keys(updated.arrivals || {}).length && updated.attendanceStatus !== 'serving') updated.attendanceStatus = 'in-queue';
    else if (updated.attendanceStatus !== 'serving') updated.attendanceStatus = 'confirmed';
    appointments = appointments.map(item => String(item.id) === id ? updated : item);
    mutationVersion++;
    updatePanel('', true);
    window.dispatchEvent(new CustomEvent('barberco:appointment-saved', { detail: updated }));
    const stamp = document.querySelector('[data-last-updated]');
    if (stamp) stamp.textContent = 'Saved just now';
    return data;
  } finally {
    activeMutations--;
    pendingAppointmentIds.delete(pendingId);
    updatePanel(latestConnectionError, true);
  }
}

function pendingReschedule(item) {
  return ['pending', 'confirmed'].includes(item.status) && item.rescheduleRequest?.status === 'pending';
}

function visibleAppointments(query) {
  return appointments.filter(item => matchesAppointmentFilter(item, statusFilter) && (!query || `${item.customer} ${(item.partyMembers || []).join(' ')} ${item.queueNumber} ${item.date} ${item.request || ''} ${item.rescheduleRequest?.date || ''}`.toLowerCase().includes(query)));
}

function groupDetails(item) {
  if (item.bookingPaymentMethod === 'onsite') return `<small>Payment: Pay at shop / no advance payment received</small><small>Cash due: ${peso(item.servicePaid ? 0 : item.cashDue || item.total)}</small>`;
  if (item.servicePaymentMethod) return `<small>Service: ${item.servicePaymentMethod === 'cash' ? 'Cash at shop' : 'Online'} / Reservation fee: ${item.bookingFeePaid ? 'verified' : 'awaiting verification'}</small><small>Online transfer: ${peso(item.onlineAmount)} / Cash balance: ${peso(item.servicePaid ? 0 : item.cashDue)}</small>`;
  if (!(item.partySize > 1)) return '';
  return `<small><strong>Group of ${safeText(item.partySize)}:</strong> ${(item.partyMembers || []).map(safeText).join(', ')}</small><small>Served consecutively by one barber${item.durationMinutes ? ` / ${safeText(item.durationMinutes)} minutes total` : ''}. Approval and changes apply to the whole group.</small>`;
}

function attendanceDetails(item) {
  if (item.cancelledBy === 'no-show') return '<small><strong>No-show / no refund.</strong> Reserved time released.</small>';
  if (item.status !== 'confirmed') return '';
  const names = item.partyMembers || [item.customer];
  const opensAt = new Date(`${item.date}T${item.time}:00+08:00`).getTime() - 30 * 60000;
  if (Date.now() < opensAt) return `<small>Arrival opens ${safeText(new Date(opensAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }))}</small>`;
  return names.map((name, index) => `<small class="appointment-arrival">${names.length > 1 ? `${safeText(name)}: ` : ''}${item.arrivals?.[index] ? '<a class="text-action" href="admin-logbook.html">View in queue</a>' : item.attendanceClosedAt || (item.graceDeadline && Date.now() >= new Date(item.graceDeadline).getTime()) ? 'Arrival window closed' : `<button class="button secondary small" type="button" data-check-in="${safeText(item.id)}" data-member-index="${index}" title="Confirm the customer has arrived at the shop">Customer arrived</button>`}</small>`).join('');
}

function rescheduleDetails(item) {
  const request = item.rescheduleRequest;
  if (!request) return '';
  if (request.initiatedBy === 'staff') return `<small><strong>Shop proposal:</strong> ${safeText(request.date)} at ${safeText(BarberCo.timeLabel(request.time))} / ${safeText(request.status)}</small><small>${safeText(request.reason || '')}</small><small>Customer approval is required. Until accepted, the original schedule remains. An unanswered proposal expires without cancelling the original booking.</small>`;
  const deadline = new Date(request.expiresAt);
  const originalLabel = request.originalDate || request.status === 'pending' ? 'Original' : 'Current schedule';
  const deadlineText = Number.isNaN(deadline.getTime()) ? 'Unavailable; refresh before reviewing' : `${deadline.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })} (Asia/Manila)`;
  return `<small><strong>${originalLabel}:</strong> ${safeText(request.originalDate || item.date)} at ${safeText(request.originalTime || item.time)}</small><small><strong>Requested:</strong> ${safeText(request.date)} at ${safeText(BarberCo.timeLabel(request.time))}</small><small><strong>Reschedule status:</strong> ${safeText(request.status)}</small>${request.reason ? `<small>Reason: ${safeText(request.reason)}</small>` : ''}<small><strong>Review deadline:</strong> ${safeText(deadlineText)}</small>${pendingReschedule(item) ? '<small>Unresolved requests automatically cancel the booking at the earlier of the original and requested start. No refund will be issued, including any booking fee.</small>' : ''}`;
}

function matchesAppointmentFilter(item, filter) {
  if (['no-show', 'in-queue', 'serving', 'completed', 'cancelled'].includes(filter)) return !item.archived && (item.attendanceStatus || item.status) === filter;
  return (filter === 'archived' ? item.archived === true : item.archived !== true) &&
    (['all', 'archived'].includes(filter) || (filter === 'reschedule-review' ? pendingReschedule(item) : filter === 'history' ? ['completed', 'cancelled', 'disapproved'].includes(item.status) : item.status === filter));
}

async function loadAppointments(refreshCatalog = false) {
  const version = mutationVersion;
  try {
    if (refreshCatalog) loadCatalog().then(() => updatePanel(latestConnectionError, true)).catch(() => {});
    const data = await api("/admin/appointments");
    if (version !== mutationVersion || activeMutations) return null;
    appointments = (data.appointments || []).filter(item => !item.demoPayment).map(appointmentView);
    reservations = (data.reservations || []).filter(item => !item.demoPayment);
    paymentReady = data.paymentConfigured !== false;
    demoMode = false;
    return "";
  } catch (error) {
    if (version !== mutationVersion || activeMutations) return null;
    if (error.status === 401 || error.status === 403) {
      BarberCo.clearSession();
      location.replace("login.html");
      return "Your staff session has expired.";
    }
    return error.message || "The appointment service is unavailable.";
  }
}

function appointmentRows(connectionError = "") {
  if (connectionError) return `<div class="connection-error" role="alert">${safeText(connectionError)} <button class="button secondary small" type="button" data-retry>Try again</button></div>`;
  const query = document.querySelector('[data-appointment-search]')?.value.toLowerCase().trim() || '';
  if (statusFilter === 'awaiting-payment') {
    return reservations.filter((item) => !query || `${item.customer} ${item.date} ${item.request || ''}`.toLowerCase().includes(query)).map((item) => `<div class="appointment-row appointment-record"><div class="appointment-date"><strong>${safeText(item.date)}</strong><small>${safeText(BarberCo.timeLabel(item.time))}</small></div><div class="row-main"><strong>${safeText(item.customer)}</strong>${item.demoPayment ? '<small class="text-action">DEMO / no real payment</small>' : ''}<small>${safeText(byId(state.services, item.serviceId).name)} / ${safeText(item.barberId ? byId(barbers, item.barberId).name : 'Unassigned barber')}</small>${item.request ? `<small class="appointment-request"><strong>Customer request:</strong> ${safeText(item.request)}</small>` : ''}</div><div><strong>${peso(item.total || 0)}</strong><small class="muted">Not yet submitted</small></div><span class="status-pill pending">Awaiting payment</span><small class="muted">Hold ends ${safeText(new Date(item.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</small></div>`).join('') || `<div class="staff-empty">${icon('Clock')}<strong>No active payment holds</strong></div>`;
  }
  const items = visibleAppointments(query);
  return items.map((item) => `<div class="appointment-row appointment-record"><div class="appointment-date"><strong>${safeText(item.date || 'Unscheduled')}</strong><small>${safeText(BarberCo.timeLabel(item.time))} / #${String(item.queueNumber || '').padStart(2, '0')}</small></div><div class="row-main"><strong>${safeText(item.customer)}</strong>${item.demoPayment ? '<small class="text-action">DEMO / no real payment</small>' : ''}<small>${safeText(byId(state.services, item.serviceId).name)} / ${safeText(item.barberId ? byId(barbers, item.barberId).name : 'Unassigned barber')}</small>${item.bookingPaymentMethod === 'onsite' ? '<small>Pay at shop / no advance payment received</small>' : ''}${item.request ? `<small class="appointment-request"><strong>Customer request:</strong> ${safeText(item.request)}</small>` : ''}${item.paymentProof ? `<a class="text-action" href="${item.paymentProof}" target="_blank" rel="noreferrer">${icon('Image')} Payment proof</a>` : ''}</div><div><strong>${peso(item.total || 0)}</strong><small class="muted">${item.demoPayment ? 'Demo total' : item.bookingPaymentMethod === 'onsite' ? `Due at shop: ${peso(item.servicePaid ? 0 : item.cashDue || item.total)}` : 'Booking total'}</small></div><span class="status-pill ${item.status}">${item.status === 'pending' ? 'Needs review' : item.status === 'confirmed' ? 'Accepted' : item.status}</span><span class="button-row">${item.status === 'pending' ? `<button class="button primary small" type="button" data-status="${item.mongoId || item.id}:confirmed">${icon('Check')} ${'Verify'}</button>` : ''}${item.status === 'confirmed' ? `<button class="button secondary small" type="button" data-status="${item.mongoId || item.id}:completed">Complete</button>` : ''}${!['completed', 'cancelled', 'disapproved'].includes(item.status) ? `<button class="icon-button danger-icon" type="button" data-status="${item.mongoId || item.id}:cancelled" aria-label="Cancel appointment" title="Cancel appointment">${icon('X')}</button>` : ''}</span></div>`).join('') || `<div class="staff-empty">${icon('CalendarDays')}<strong>No ${statusFilter === 'pending' ? 'pending ' : ''}appointments${query ? ' match your search' : ' here'}</strong><span>Submitted bookings appear here for payment verification.</span></div>`;
}

function snapshot(connectionError = "") {
  return JSON.stringify({ connectionError, statusFilter, appointments, reservations, paymentReady, demoMode });
}

function updatePanel(connectionError = "", force = false) {
  latestConnectionError = connectionError;
  const nextSnapshot = snapshot(connectionError);
  if (!force && nextSnapshot === lastSnapshot) return;
  lastSnapshot = nextSnapshot;
  const panel = document.querySelector("[data-appointment-panel]");
  const focused = panel?.contains(document.activeElement) ? document.activeElement : null;
  const focusAction = focused ? ['data-status', 'data-reschedule', 'data-reschedule-review', 'data-archive-appointment'].find(name => focused.hasAttribute(name)) : null;
  const focusValue = focusAction ? focused.getAttribute(focusAction) : null;
  const focusDecision = focused?.dataset.decision;
  if (panel) panel.innerHTML = appointmentRows(connectionError);
  const query = document.querySelector('[data-appointment-search]')?.value.toLowerCase().trim() || '';
  if (statusFilter !== 'awaiting-payment') panel?.querySelectorAll('.appointment-record').forEach((row, index) => {
    row.dataset.appointmentId = String(visibleAppointments(query)[index].id);
  });
  else panel?.querySelectorAll('.appointment-record').forEach((row, index) => {
    const drafts = reservations.filter(item => !query || `${item.customer} ${item.date} ${item.request || ''}`.toLowerCase().includes(query));
    row.querySelector('.row-main')?.insertAdjacentHTML('beforeend', groupDetails(drafts[index]));
    const expiry = row.lastElementChild;
    if (expiry) expiry.textContent = `Checkout expires ${new Date(drafts[index].expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}; time is not reserved`;
  });
  const visibleHistory = appointments.filter(item => ['completed', 'cancelled', 'disapproved'].includes(item.status) && (statusFilter === 'archived' ? item.archived === true : item.archived !== true));
  panel?.querySelectorAll('.appointment-record').forEach(row => {
    const entry = appointments.find(item => String(item.id) === row.dataset.appointmentId);
    if (entry) {
      const cancel = row.querySelector('[data-status$=":cancelled"]');
      if (entry.status === 'pending' && cancel) {
        cancel.dataset.status = `${entry.mongoId || entry.id}:disapproved`;
        cancel.title = 'Disapprove booking request';
        cancel.setAttribute('aria-label', 'Disapprove booking request');
      }
      const badge = row.querySelector('.status-pill');
      if (badge) badge.textContent = ({ 'in-queue': 'In queue', serving: 'Now serving', 'no-show': 'No-show', disapproved: 'Disapproved', pending: 'Pending / needs review', completed: 'Completed', cancelled: 'Cancelled', confirmed: 'Accepted' })[entry.attendanceStatus || entry.status] || entry.status;
      if (entry.refundStatus === 'review-required') row.querySelector('.row-main')?.insertAdjacentHTML('beforeend', '<small><strong>Payment / refund review required.</strong> Verify the transfer and contact the customer to arrange a manual refund. No automatic refund has been sent.</small>');
    }
    const item = visibleHistory.find(entry => String(entry.id) === row.dataset.appointmentId);
    if (item) row.querySelector('.button-row')?.insertAdjacentHTML('beforeend', `<button class="icon-button" type="button" data-archive-appointment="${item.id}" title="${item.archived ? 'Restore appointment' : 'Archive appointment'}" aria-label="${item.archived ? 'Restore appointment' : 'Archive appointment'}">${icon(item.archived ? 'ArchiveRestore' : 'Archive')}</button>`);
  });
  panel?.querySelectorAll('.appointment-record').forEach((row) => {
    const id = row.querySelector('[data-status]')?.dataset.status.split(':')[0];
    const item = appointments.find(entry => String(entry.id) === id);
    if (!item) return;
    if (pendingReschedule(item)) {
      row.querySelectorAll('[data-status]').forEach(button => {
        if (!button.dataset.status.endsWith(':cancelled') && !button.dataset.status.endsWith(':disapproved')) button.remove();
      });
      row.querySelector('.status-pill').textContent = item.rescheduleRequest.initiatedBy === 'staff' ? 'Waiting for customer approval' : 'Reschedule needs review';
      if (item.rescheduleRequest.initiatedBy !== 'staff')
      row.querySelector('.button-row')?.insertAdjacentHTML('afterbegin', `<button class="button primary small" type="button" data-reschedule-review="${safeText(id)}" data-decision="approve">${icon('Check')} Approve reschedule</button><button class="button secondary small" type="button" data-reschedule-review="${safeText(id)}" data-decision="reject">${icon('X')} Reject reschedule</button>`);
    } else {
      row.querySelector('.button-row')?.insertAdjacentHTML('afterbegin', `<button class="icon-button" type="button" data-reschedule="${safeText(id)}" title="Reschedule appointment" aria-label="Reschedule appointment">${icon('CalendarClock')}</button>`);
    }
  });
  panel?.querySelectorAll('.appointment-record').forEach(row => {
    const item = appointments.find(entry => String(entry.id) === row.dataset.appointmentId);
    if (item) {
      row.querySelector('.row-main')?.insertAdjacentHTML('beforeend', groupDetails(item) + attendanceDetails(item) + rescheduleDetails(item));
      if (item.servicePaymentMethod) row.querySelector('.muted').textContent = 'Booking total';
      const complete = row.querySelector('[data-status$=":completed"]');
      if (complete) {
        complete.textContent = 'Finish';
        complete.disabled = item.attendanceStatus !== 'serving';
        complete.title = complete.disabled ? 'Serve the customer from the staff logbook first' : 'Finish service and confirm any remaining payment';
      }
      row.querySelectorAll('[data-status$=":confirmed"], [data-status$=":completed"]').forEach(button => button.classList.add('appointment-action'));
      if (pendingAppointmentIds.has(String(item.id))) {
        row.setAttribute('aria-busy', 'true');
        row.querySelectorAll('button').forEach(button => { button.disabled = true; });
        row.querySelectorAll('.appointment-action').forEach(button => { button.textContent = 'Saving...'; });
      }
    }
  });
  if (focusAction) Array.from(panel.querySelectorAll(`[${focusAction}]`)).find(button => button.getAttribute(focusAction) === focusValue && button.dataset.decision === focusDecision)?.focus();
  document.querySelectorAll('[data-filter-count]').forEach((target) => {
    const filter = target.dataset.filterCount;
    target.textContent = filter === 'awaiting-payment' ? reservations.length : appointments.filter(item => matchesAppointmentFilter(item, filter)).length;
  });
  const warning = document.querySelector('[data-payment-warning]');
  if (warning) {
    warning.hidden = (paymentReady && !demoMode) || Boolean(connectionError);
    warning.style.display = warning.hidden ? 'none' : '';
    warning.innerHTML = `${demoMode ? 'Demo payments are active. Test bookings do not represent real payments and are excluded from real analytics.' : 'Online booking is unavailable: no payment number or QR code is configured.'} ${BarberCo.canAccess('admin') ? '<a class="text-action" href="admin-profile.html">Shop settings</a>' : 'Payment mode is managed by the administrator.'}`;
  }
}

async function refreshAppointments({ force = false, refreshCatalog = false } = {}) {
  if (refreshInProgress || activeMutations) return;
  refreshInProgress = true;
  const connectionError = await loadAppointments(refreshCatalog);
  if (connectionError !== null) updatePanel(connectionError, force);
  const updated = document.querySelector("[data-last-updated]");
  if (updated && !connectionError) updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  refreshInProgress = false;
}

async function render() {
  const connectionError = await loadAppointments(true);
  document.querySelector("#app").innerHTML = `
    ${nav("admin")}
    <section class="app-shell">
      ${adminSidebar("schedule")}
      <div class="workspace">
        <div class="workspace-heading"><div><p class="eyebrow">RESERVATIONS</p><h1>Appointments</h1><p class="muted">Review payment proof and manage incoming bookings.</p></div><small class="sync-indicator" data-last-updated>Live updates on</small></div>
        <div class="connection-error" data-payment-warning hidden role="status"></div>
        <div class="list-toolbar appointment-toolbar"><div class="filter-tabs" role="group" aria-label="Appointment status">${[['all', 'All bookings'], ['pending', 'Needs review'], ['confirmed', 'Accepted'], ['awaiting-payment', 'Awaiting payment'], ['history', 'History']].map(([key, label]) => `<button type="button" data-filter="${key}" aria-pressed="${key === 'all'}" class="${key === 'all' ? 'active' : ''}">${label}<span data-filter-count="${key}">0</span></button>`).join('')}</div><label class="search-field">${icon('Search')}<input type="search" data-appointment-search placeholder="Find a booking" aria-label="Search appointments"></label></div>
        <div class="record-list" data-appointment-panel>${appointmentRows(connectionError)}</div>
      </div>
    </section>
  `;
  lastSnapshot = snapshot(connectionError);
  document.querySelector('.filter-tabs').insertAdjacentHTML('beforeend', '<button type="button" data-filter="archived" aria-pressed="false">Archived<span data-filter-count="archived">0</span></button>');
  document.querySelector('.filter-tabs').insertAdjacentHTML('beforeend', '<button type="button" data-filter="reschedule-review" aria-pressed="false">Reschedule review<span data-filter-count="reschedule-review">0</span></button>');
  for (const [status, label] of Object.entries({ 'in-queue': 'In queue', serving: 'Now serving', 'no-show': 'No-show', disapproved: 'Disapproved', completed: 'Completed', cancelled: 'Cancelled' })) {
    document.querySelector('.filter-tabs').insertAdjacentHTML('beforeend', `<button type="button" data-filter="${status}" aria-pressed="false">${label}<span data-filter-count="${status}">0</span></button>`);
  }
  updatePanel(connectionError, true);
  document.querySelector('[data-appointment-search]').addEventListener('input', () => updatePanel(latestConnectionError, true));
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    statusFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((tab) => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); });
    updatePanel(latestConnectionError, true);
  }));
  document.querySelector("[data-appointment-panel]").addEventListener("click", async (event) => {
    const arrival = event.target.closest('[data-check-in]');
    if (arrival) {
      arrival.disabled = true;
      try {
        await saveAppointment(`/admin/appointments/${arrival.dataset.checkIn}/check-in`, { memberIndices: [Number(arrival.dataset.memberIndex)] });
        toast('Customer checked in and added to the staff queue.');
      } catch (error) { toast(error.message); }
      finally { arrival.disabled = false; }
      return;
    }
    const review = event.target.closest('[data-reschedule-review]');
    if (review) {
      const item = appointments.find(entry => String(entry.id) === review.dataset.rescheduleReview);
      if (!item || !pendingReschedule(item)) return;
      const decision = review.dataset.decision;
      const modal = document.createElement('dialog');
      modal.className = 'receipt-dialog';
      modal.setAttribute('aria-labelledby', 'reschedule-review-title');
      modal.innerHTML = `<form><h3 id="reschedule-review-title">${decision === 'approve' ? 'Approve' : 'Reject'} reschedule?</h3>${rescheduleDetails(item)}<p>${decision === 'approve' ? 'Approval moves the booking to the requested date and time.' : 'Rejection keeps the original booking date and time.'}</p><label>Reason / message to customer (optional)<textarea name="reason" maxlength="500"></textarea></label><p role="alert" data-review-error></p><div class="button-row"><button class="button secondary" type="button" data-close autofocus>Go back</button><button class="button primary" type="submit">Confirm ${decision === 'approve' ? 'approval' : 'rejection'}</button></div></form>`;
      modal.querySelector('[data-close]').onclick = () => modal.close();
      modal.addEventListener('close', () => modal.remove());
      modal.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        const button = modal.querySelector('[type="submit"]');
        if (button.disabled) return;
        button.disabled = true;
        try {
          await saveAppointment(`/admin/appointments/${item.id}/reschedule-review`, { decision, requestedAt: item.rescheduleRequest.requestedAt, reason: modal.querySelector('[name="reason"]').value.trim() });
          modal.close();
          toast(decision === 'approve' ? 'Reschedule approved.' : 'Reschedule rejected. Original schedule retained.');
        } catch (error) { modal.querySelector('[data-review-error]').textContent = error.message; button.disabled = false; }
      };
      document.body.append(modal);
      modal.showModal();
      return;
    }
    const archive = event.target.closest('[data-archive-appointment]');
    if (archive) {
      const item = appointments.find(entry => entry.id === archive.dataset.archiveAppointment);
      if (archive.disabled || !item || !window.confirm(item.archived ? 'Restore this appointment to the list?' : 'Archive this appointment? Booking and payment history stay intact. You can restore it from Archived.')) return;
      archive.disabled = true;
      try { await saveAppointment(`/admin/appointments/${item.id}/archive`, { archived: !item.archived }, { id: item.id, archived: !item.archived }); }
      catch (error) { toast(error.message); archive.disabled = false; }
      return;
    }
    const reschedule = event.target.closest('[data-reschedule]');
    if (reschedule) {
      const item = appointments.find((entry) => entry.id === reschedule.dataset.reschedule);
      if (!item || pendingReschedule(item)) return;
      const modal = document.createElement('dialog');
      modal.className = 'receipt-dialog';
      modal.setAttribute('aria-label', 'Reschedule appointment');
      modal.innerHTML = `<form data-reschedule-form><h3>Reschedule appointment</h3><label>Date<input type="date" name="date" required value="${safeText(item.date)}"></label><label>Time<input type="time" name="time" step="1800" required value="${safeText(item.time)}"></label><p data-reschedule-error role="alert"></p><div class="button-row"><button class="button secondary" type="button" data-close>Cancel</button><button class="button primary" type="submit">Save schedule</button></div></form>`;
      window.mountRescheduleTimes(modal.querySelector('form'), item);
      const reasonLabel = document.createElement('label');
      reasonLabel.textContent = 'Reason / message to customer';
      const reasonInput = document.createElement('textarea');
      reasonInput.name = 'reason';
      reasonInput.required = true;
      reasonInput.maxLength = 500;
      reasonInput.placeholder = 'Explain why the appointment needs to change';
      reasonLabel.append(reasonInput);
      modal.querySelector('[data-reschedule-error]').before(reasonLabel);
      modal.querySelector('[type="submit"]').textContent = 'Send reschedule request';
      modal.querySelector('[data-close]').onclick = () => modal.close();
      modal.addEventListener('close', () => modal.remove());
      modal.querySelector('form').onsubmit = async (submit) => {
        submit.preventDefault();
        if (submit.submitter.disabled) return;
        const values = Object.fromEntries(new FormData(submit.target));
        if (!window.confirm(`Propose moving ${item.customer} from ${item.date} at ${BarberCo.timeLabel(item.time)} to ${values.date} at ${BarberCo.timeLabel(values.time)} (Asia/Manila)?\nReason: ${values.reason}\nCustomer approval is required. The original schedule stays unchanged until accepted.`)) return;
        submit.submitter.disabled = true;
        try { await saveAppointment(`/admin/appointments/${item.id}/reschedule`, Object.fromEntries(new FormData(submit.target))); modal.close(); toast('Request sent. Waiting for customer approval.'); }
        catch (error) { modal.querySelector('[data-reschedule-error]').textContent = error.message; submit.submitter.disabled = false; }
      };
      document.body.append(modal);
      modal.showModal();
      return;
    }
    const proofLink = event.target.closest('a.text-action');
    if (proofLink && proofLink.textContent.includes('Payment proof')) {
      event.preventDefault();
      const row = proofLink.closest('.appointment-record');
      const id = row.querySelector('[data-status]')?.dataset.status.split(':')[0];
      const item = appointments.find((candidate) => candidate.id === id || candidate.paymentProof === proofLink.getAttribute('href'));
      try {
        const payload = item?.paymentProof?.startsWith('data:') ? item : await api(`/admin/appointments/${item?.id || id}/proof`);
        const proof = payload.paymentProof;
        if (!/^data:image\/(png|jpeg|webp);base64,/.test(proof || '')) throw new Error('No readable receipt was saved for this booking.');
        const modal = document.createElement('dialog');
        modal.className = 'receipt-dialog';
        modal.innerHTML = '<form method="dialog"><button class="button secondary" autofocus>Close receipt</button></form><img alt="Customer payment receipt"><a class="button secondary" download="payment-receipt">Download receipt</a>';
        modal.querySelector('img').src = proof;
        const response = await fetch(proof);
        const url = URL.createObjectURL(await response.blob());
        modal.querySelector('a').href = url;
        modal.addEventListener('close', () => { URL.revokeObjectURL(url); modal.remove(); });
        document.body.append(modal);
        modal.showModal();
      } catch (error) { toast(error.message); }
      return;
    }
    const retry = event.target.closest("[data-retry]");
    if (retry) return refreshAppointments({ force: true, refreshCatalog: true });
    const button = event.target.closest("[data-status]");
    if (!button || button.disabled) return;
    const [id, status] = button.dataset.status.split(":");
    let collection = {};
    const paymentItem = appointments.find(item => String(item.id || item.mongoId || item._id) === id);
    if (status === 'completed' && (paymentItem?.bookingPaymentMethod === 'onsite' || paymentItem?.servicePaymentMethod === 'cash') && !paymentItem.servicePaid && !paymentItem.demoPayment) {
      const due = paymentItem.bookingPaymentMethod === 'onsite' ? Number(paymentItem.total) : Number(paymentItem.total) - Number(paymentItem.bookingFee);
      const amount = window.prompt(`Collect ${peso(due)} cash. Enter the exact cash amount collected to complete this service:`, '');
      if (amount === null) return;
      if (!amount.trim() || Number(amount) !== due) return toast('Enter the exact outstanding cash amount.');
      collection = { cashCollected: true, cashAmount: Number(amount) };
    }
    if (!['cancelled', 'disapproved'].includes(status) && pendingReschedule(appointments.find(item => String(item.id) === id) || {})) return;
    let reason = '';
    if (['cancelled', 'disapproved'].includes(status)) {
      const message = window.prompt(status === 'disapproved' ? 'Disapprove this booking request? Enter the reason. Any submitted payment needs manual review; no automatic refund is sent.' : 'Cancel this accepted appointment? Enter the reason to share with the customer.');
      if (message === null) return;
      reason = message.trim().slice(0, 500);
      if (!reason) return toast('Enter a cancellation reason for the customer.');
    }
    button.disabled = true;
    try {
      await saveAppointment(`/admin/appointments/${id}`, { status, reason, ...collection });
      toast(status === 'confirmed' ? 'Booking verified.' : status === 'completed' ? 'Service finished.' : 'Booking updated.');
    } catch (error) {
      toast(error.message || "Status could not be updated.");
      button.disabled = false;
    }
  });
  initHeader("admin");
}

render().then(() => {
  window.setInterval(() => {
    if (!document.hidden) refreshAppointments();
  }, 3000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAppointments({ force: true });
  });
});
