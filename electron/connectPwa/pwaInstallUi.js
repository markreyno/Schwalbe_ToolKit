(function (global) {
  function isInstalledPwa() {
    if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
    if (!global.matchMedia) return false;
    return ['fullscreen', 'standalone', 'minimal-ui'].some(mode =>
      global.matchMedia('(display-mode: ' + mode + ')').matches
    );
  }

  function removeLegacyInstallUi() {
    ['#install-banner', '#install-button', '#install-heading', '[data-pwa-install]', '.pwa-install-ui'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.remove());
    });
    document.querySelectorAll('section.panel').forEach(section => {
      const heading = section.querySelector('h2');
      if (heading && /add to home screen/i.test(heading.textContent || '')) section.remove();
    });
  }

  function bindInstallUiVisibility() {
    const apply = () => {
      removeLegacyInstallUi();
      if (isInstalledPwa()) document.documentElement.classList.add('pwa-installed');
      else document.documentElement.classList.remove('pwa-installed');
    };
    apply();
    global.addEventListener('appinstalled', apply);
    ['standalone', 'fullscreen', 'minimal-ui'].forEach(mode => {
      const mq = global.matchMedia('(display-mode: ' + mode + ')');
      if (mq.addEventListener) mq.addEventListener('change', apply);
      else if (mq.addListener) mq.addListener(apply);
    });
  }

  global.connectPwaInstall = { isInstalledPwa, removeLegacyInstallUi, bindInstallUiVisibility };
})(window);
