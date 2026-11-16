(() => {
  const pages = new Set(['dashboard', 'logbook', 'contacts', 'schedule', 'users', 'profile', 'services', 'barbers', 'reports']);
  const requested = location.hash.slice(1).toLowerCase();
  const page = pages.has(requested) ? requested : 'dashboard';
  location.replace(`admin-${page}.html`);
})();
