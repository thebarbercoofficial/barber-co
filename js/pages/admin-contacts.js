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

function render(contacts) {
  meta.textContent = `${contacts.length} ${contacts.length === 1 ? 'message' : 'messages'}${contacts.length === 100 ? ' · showing latest 100' : ''}`;
  list.innerHTML = contacts.length ? contacts.map((contact) => `
    <article class="contact-inbox-item">
      <header><div><h2>${escapeHtml(contact.name)}</h2><a href="mailto:${encodeURIComponent(contact.email)}">${escapeHtml(contact.email)}</a></div><time datetime="${escapeHtml(contact.createdAt)}">${escapeHtml(dateText(contact.createdAt))}</time></header>
      <p>${escapeHtml(contact.message)}</p>
      <a class="button secondary small" href="mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent('Re: The Barber Co enquiry')}">${icon('Reply')} Reply by email</a>
    </article>`).join('') : `<div class="staff-empty">${icon('Mail')}<strong>No messages yet</strong><span>Website enquiries will show up here when customers submit the contact form.</span></div>`;
}

async function refresh() {
  if (loading) return;
  loading = true;
  document.querySelector('[data-refresh]').disabled = true;
  errorBox.hidden = true;
  try {
    const result = await api('/admin/contacts');
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
