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
    <div class="workspace-heading"><div><p class="eyebrow">CUSTOMER MESSAGES</p><h1>Contact inbox</h1><p class="muted">Enquiries sent through the public website.</p></div><div class="heading-actions"><button class="button secondary" type="button" data-refresh>${icon('RefreshCw')} Refresh</button></div></div>
    <p class="connection-error" data-error hidden></p>
    <p class="muted contact-inbox-meta" data-meta>Loading messages...</p>
    <section class="contact-inbox-list" data-list aria-live="polite"><div class="staff-empty">Loading contact messages...</div></section>
  </main></section>`;

const list = document.querySelector('[data-list]');
const meta = document.querySelector('[data-meta]');
const errorBox = document.querySelector('[data-error]');
let loading = false;
let showArchived = false;
const archiveToggle = document.createElement('button');
archiveToggle.className = 'button secondary';
archiveToggle.textContent = 'View archived';
archiveToggle.onclick = () => { showArchived = !showArchived; archiveToggle.textContent = showArchived ? 'Back to inbox' : 'View archived'; refresh(); };
document.querySelector('.heading-actions').append(archiveToggle);

function render(contacts) {
  meta.textContent = `${contacts.length} ${contacts.length === 1 ? 'message' : 'messages'}${contacts.length === 100 ? ' · showing latest 100' : ''}`;
  list.innerHTML = contacts.length ? contacts.map((contact) => `
    <article class="contact-inbox-item">
      <header><div><h2>${escapeHtml(contact.name)}</h2><a href="mailto:${encodeURIComponent(contact.email)}">${escapeHtml(contact.email)}</a></div><time datetime="${escapeHtml(contact.createdAt)}">${escapeHtml(dateText(contact.createdAt))}</time></header>
      <p>${escapeHtml(contact.message)}</p>
      ${(contact.replies || []).map((reply) => `<div class="contact-reply"><strong>Staff reply</strong><p>${escapeHtml(reply.message)}</p><small>${escapeHtml(dateText(reply.createdAt))} · ${escapeHtml(reply.status === 'accepted' ? 'Accepted by email provider' : reply.status === 'failed' ? 'Send failed' : 'Processing')}</small></div>`).join('')}
      <details><summary>Reply to customer</summary><form data-reply="${escapeHtml(contact._id)}"><label>Reply<textarea name="message" required minlength="2" maxlength="5000" rows="4"></textarea></label><button class="button primary small" type="submit">${icon('Send')} Send email reply</button><p role="status" data-reply-status></p></form></details>
      <button class="icon-button" type="button" data-archive-contact="${escapeHtml(contact._id)}" title="${showArchived ? 'Restore message' : 'Archive message'}" aria-label="${showArchived ? 'Restore message' : 'Archive message'}">${icon(showArchived ? 'ArchiveRestore' : 'Archive')}</button>
    </article>`).join('') : `<div class="staff-empty">${icon('Mail')}<strong>No messages yet</strong><span>Website enquiries will show up here when customers submit the contact form.</span></div>`;
}

list.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-reply]');
  if (!form) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  const message = form.elements.message.value.trim();
  if (form.dataset.lastMessage !== message) { form.dataset.requestId = crypto.randomUUID(); form.dataset.lastMessage = message; }
  try {
    const result = await api(`/admin/contacts/${form.dataset.reply}/reply`, { method: 'POST', body: JSON.stringify({ message, requestId: form.dataset.requestId }) });
    form.querySelector('[data-reply-status]').textContent = result.message;
    form.elements.message.readOnly = true;
    button.textContent = 'Reply accepted';
  } catch (error) { form.querySelector('[data-reply-status]').textContent = error.message; button.disabled = false; }
});

list.addEventListener('click', async event => {
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
