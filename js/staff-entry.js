(() => {
  if (!window.staffModule) {
    location.replace('admin-workspace.html#dashboard');
    return;
  }
  const script = document.createElement('script');
  script.src = 'js/pages/admin-dashboard.js?v=followup-20261116';
  document.body.append(script);
})();
