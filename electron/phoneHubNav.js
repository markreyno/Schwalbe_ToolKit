(function () {
  const HUB_PORT = 48734;
  function hubUrl() {
    const host = location.hostname;
    return 'https://' + host + ':' + HUB_PORT + '/';
  }
  function goHome() {
    const hook = window.phoneHubNavOnBeforeLeave;
    if (typeof hook === 'function') {
      const result = hook();
      if (result === false) return;
      if (result && typeof result.then === 'function') {
        void result.then(ok => { if (ok !== false) location.href = hubUrl(); });
        return;
      }
    }
    location.href = hubUrl();
  }
  const style = document.createElement('style');
  style.textContent =
    '.brand-bar.phone-hub-nav-host{display:flex;align-items:center;gap:12px}' +
    '.phone-hub-nav-fallback{display:flex;align-items:center;padding:12px 16px 0;max-width:668px;margin:0 auto}' +
    '.phone-home-link{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:36px;height:36px;border-radius:10px;background:#fff;border:1px solid #dfe6ef;color:#080a0b;text-decoration:none;box-shadow:0 1px 2px rgba(8,10,11,.06)}' +
    '.phone-home-link:hover{background:#f5f8fa}' +
    '.phone-home-link:focus-visible{outline:3px solid #39738f;outline-offset:2px}' +
    '.phone-home-link svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.brand-bar.phone-hub-nav-host .brand{flex:1;min-width:0}';
  document.head.appendChild(style);
  const link = document.createElement('a');
  link.className = 'phone-home-link';
  link.href = hubUrl();
  link.setAttribute('aria-label', 'Home');
  link.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>';
  link.addEventListener('click', e => {
    e.preventDefault();
    goHome();
  });
  const bar = document.querySelector('.brand-bar');
  if (bar) {
    bar.classList.add('phone-hub-nav-host');
    bar.insertBefore(link, bar.firstChild);
  } else {
    const row = document.createElement('div');
    row.className = 'phone-hub-nav-fallback';
    row.appendChild(link);
    document.body.insertBefore(row, document.body.firstChild);
  }
  window.phoneHubNavSetBeforeLeave = fn => {
    window.phoneHubNavOnBeforeLeave = fn;
  };
})();
