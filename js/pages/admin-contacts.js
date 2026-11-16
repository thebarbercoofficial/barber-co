const { nav, adminSidebar, initHeader, api, canAccess, icon } = BarberCo;

if (!canAccess('moderator')) {
  location.replace('login.html');
  throw new Error('Staff access required.');
}

const escapeHtml = (value = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const dateText = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

document.querySelector('#app').innerHTML = `
  ${nav('admin')}
  <section class="app-shell">${adminSidebar('contacts')}<main class="workspace">
    <div class="workspace-heading"><div><p class="eyebrow">CUSTOMER MESSAGES</p><h1>Contact inbox</h1></div><div class="heading-actions"><button class="button secondary" type="button" data-refresh>${icon('RefreshCw')} Refresh</button></div></div>
    <p class="connection-error" data-error hidden></p>
    <p class="muted contact-inbox-meta" data-meta>Loading messages...</p>
    <section class="contact-inbox-list" data-list aria-live="polite"><div class="staff-empty">Loading contact messages...</div></section>
  </main></section>`;

const list = document.querySelector('[data-list]');
const meta = document.querySelector('[data-meta]');
const errorBox = document.querySelector('[data-error]');
let loading = false;
let showArchived = false;
let messages = [];
let selectedId = '';
let search = '';
const drafts = new Map();
const replyStates = new Map();
const archiveToggle = document.createElement('button');
archiveToggle.className = 'button secondary';
archiveToggle.textContent = 'View archived';
archiveToggle.onclick = () => { showArchived = !showArchived; archiveToggle.textContent = showArchived ? 'Back to inbox' : 'View archived'; refresh(); };
document.querySelector('.heading-actions').append(archiveToggle);

function render(contacts) {
  messages = contacts;
  const matches = contacts.filter(contact => `${contact.name} ${contact.email} ${contact.message}`.toLowerCase().includes(search.toLowerCase()));
  if (!matches.some(contact => contact._id === selectedId)) selectedId = matches[0]?._id || '';
  const selected = matches.find(contact => contact._id === selectedId);
  meta.textContent = `${contacts.length} ${contacts.length === 1 ? 'message' : 'messages'}${contacts.length === 100 ? ' · showing latest 100' : ''}`;
  list.innerHTML = `<aside class="inbox-index" aria-label="Messages"><label class="search-field">${icon('Search')}<input type="search" data-inbox-search aria-label="Search messages" placeholder="Find a message" value="${escapeHtml(search)}"></label><div class="inbox-message-list">${matches.map(contact => `<button type="button" class="inbox-message ${contact._id === selectedId ? 'is-selected' : ''}" data-contact-select="${escapeHtml(contact._id)}" aria-pressed="${contact._id === selectedId}"><span><strong>${escapeHtml(contact.name)}</strong><small>${escapeHtml(dateText(contact.createdAt))}</small></span><span class="inbox-email">${escapeHtml(contact.email)}</span><span class="inbox-snippet">${escapeHtml(contact.message)}</span><span class="inbox-reply-count">${(contact.replies || []).length} replies</span></button>`).join('') || '<p class="inbox-no-matches">No matching messages.</p>'}</div></aside><div class="inbox-conversation">${selected ? [selected].map((contact) => `
    <article class="contact-inbox-item">
      <header><div><h2>${escapeHtml(contact.name)}</h2><a href="mailto:${encodeURIComponent(contact.email)}">${escapeHtml(contact.email)}</a></div><time datetime="${escapeHtml(contact.createdAt)}">${escapeHtml(dateText(contact.createdAt))}</time></header>
      <p>${escapeHtml(contact.message)}</p>
      ${contact.hasPaymentProof ? `<button class="button secondary" type="button" data-recovery-proof="${escapeHtml(contact._id)}">View payment proof</button>` : ''}
      ${(contact.replies || []).map((reply) => `<div class="contact-reply"><strong>Staff reply</strong><p>${escapeHtml(reply.message)}</p><small>${escapeHtml(dateText(reply.createdAt))} · ${escapeHtml(reply.status === 'accepted' ? 'Accepted by email provider' : reply.status === 'failed' ? 'Send failed' : 'Processing')}</small></div>`).join('')}
      <form class="inbox-composer" data-reply="${escapeHtml(contact._id)}"><label>Reply to customer<textarea name="message" required minlength="2" maxlength="5000" rows="3">${escapeHtml(drafts.get(contact._id) || '')}</textarea></label><button class="button primary small" type="submit">${icon('Send')} Send email reply</button><p role="status" data-reply-status></p></form>
      <button class="icon-button" type="button" data-archive-contact="${escapeHtml(contact._id)}" title="${showArchived ? 'Restore message' : 'Archive message'}" aria-label="${showArchived ? 'Restore message' : 'Archive message'}">${icon(showArchived ? 'ArchiveRestore' : 'Archive')}</button>
    </article>`).join('') : `<div class="staff-empty">${icon('Mail')}<strong>${contacts.length ? 'No matching messages' : 'No messages yet'}</strong><span>${contacts.length ? 'Try another name, email or message.' : 'Customer enquiries appear here.'}</span></div>`}</div>`;
  const form = list.querySelector('[data-reply]');
  const reply = replyStates.get(selectedId);
  if (form && reply && reply.message === form.elements.message.value.trim()) {
    form.querySelector('button').disabled = reply.status !== 'failed';
    form.elements.message.readOnly = reply.status === 'accepted';
    form.querySelector('[data-reply-status]').textContent = reply.text || '';
    if (reply.status === 'accepted') form.querySelector('button').textContent = 'Reply accepted';
  }
}

list.addEventListener('input', event => {
  if (event.target.matches('[data-inbox-search]')) {
    search = event.target.value;
    render(messages);
    const input = list.querySelector('[data-inbox-search]');
    input.focus();
  }
  const form = event.target.closest('[data-reply]');
  if (form) drafts.set(form.dataset.reply, form.elements.message.value);
});

list.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-reply]');
  if (!form) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  const message = form.elements.message.value.trim();
  const id = form.dataset.reply;
  let reply = replyStates.get(id);
  if (!reply || reply.message !== message) reply = { message, requestId: crypto.randomUUID() };
  reply.status = 'pending';
  replyStates.set(id, reply);
  try {
    const result = await api(`/admin/contacts/${id}/reply`, { method: 'POST', body: JSON.stringify({ message, requestId: reply.requestId }) });
    reply.status = 'accepted';
    reply.text = result.message;
    form.querySelector('[data-reply-status]').textContent = result.message;
    form.elements.message.readOnly = true;
    button.textContent = 'Reply accepted';
  } catch (error) { reply.status = 'failed'; reply.text = error.message; form.querySelector('[data-reply-status]').textContent = error.message; button.disabled = false; }
});

list.addEventListener('click', async event => {
  const proof = event.target.closest('[data-recovery-proof]');
  if (proof) {
    try {
      const result = await api(`/admin/contacts/${proof.dataset.recoveryProof}/payment-proof`);
      const dialog = document.createElement('dialog');
      const image = document.createElement('img');
      image.src = result.paymentProof; image.alt = 'Customer payment recovery receipt'; image.style.cssText = 'max-width:100%;max-height:75vh;object-fit:contain';
      const close = document.createElement('button'); close.textContent = 'Close'; close.className = 'button secondary'; close.onclick = () => dialog.close();
      dialog.append(image, close); document.body.append(dialog); dialog.onclose = () => dialog.remove(); dialog.showModal();
    } catch (error) { errorBox.hidden = false; errorBox.textContent = error.message; }
    return;
  }
  const selection = event.target.closest('[data-contact-select]');
  if (selection) { selectedId = selection.dataset.contactSelect; render(messages); return; }
  const button = event.target.closest('[data-archive-contact]');
  if (!button || button.disabled || !window.confirm(showArchived ? 'Restore this message to the inbox?' : 'Archive this message? It can be restored from View archived.')) return;
  button.disabled = true;
  try { await api(`/admin/contacts/${button.dataset.archiveContact}/archive`, { method: 'PATCH', body: JSON.stringify({ archived: !showArchived }) }); await refresh(); }
  catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; button.disabled = false; }
});

async function refresh() {
  if (loading) return;
  loading = true;
  document.querySelector('[data-refresh]').disabled = true;
  errorBox.hidden = true;
  try {
    const result = await api(`/admin/contacts?archived=${showArchived}`);
    render(result.contacts || []);
  } catch (error) {
    errorBox.textContent = error.message || 'Could not load the staff inbox.';
    errorBox.hidden = false;
    meta.textContent = 'Inbox unavailable';
    list.innerHTML = `<div class="staff-empty">${icon('TriangleAlert')}<strong>Messages could not be loaded</strong><span>Check your staff access and connection, then refresh.</span></div>`;
  } finally {
    loading = false;
    document.querySelector('[data-refresh]').disabled = false;
  }
}

document.querySelector('[data-refresh]').addEventListener('click', refresh);
initHeader('admin');
refresh();
