(function () {
  const HUB_PORT = 48734;
  function hubUrl() {
    return 'https://' + location.hostname + ':' + HUB_PORT + '/';
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
    '.phone-home-link{position:fixed;top:max(10px,env(safe-area-inset-top));left:max(10px,env(safe-area-inset-left));z-index:2000;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,.92);border:1px solid #dfe6ef;color:#080a0b;text-decoration:none;box-shadow:0 1px 3px rgba(8,10,11,.08)}' +
    '.phone-home-link:hover{background:#fff}' +
    '.phone-home-link:focus-visible{outline:3px solid #39738f;outline-offset:2px}' +
    '.phone-home-link svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}';
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
  document.body.appendChild(link);
  window.phoneHubNavSetBeforeLeave = fn => {
    window.phoneHubNavOnBeforeLeave = fn;
  };
})();
