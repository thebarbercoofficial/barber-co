// Existing modules keep their own DOM and handlers; only the outer workspace scrolls.
(() => {
  if (window === window.parent || !window.frameElement?.hasAttribute('data-staff-section')) return;
  window.staffModule = true;
  document.documentElement.classList.add('staff-module-root');
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'css/staff-workspace.css?v=unified-20261116';
  document.head.append(style);
  const originalInterval = window.setInterval.bind(window);
  window.setInterval = (callback, delay, ...args) => originalInterval(() => {
    if (window.staffModuleVisible && !parent.document.hidden && typeof callback === 'function') callback(...args);
  }, delay);
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add('staff-module'));
})();
