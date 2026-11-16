(() => {
  if (!window.staffModule) {
    location.replace('admin-workspace.html#dashboard');
    return;
  }
  const script = document.createElement('script');
  script.src = 'js/pages/admin-dashboard.js?v=workspace-load-20261117';
  document.body.append(script);
})();
