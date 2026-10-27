const INSTALLED_KEY = 'schwalbe-connect-pwa-installed';

function isStandalone() {
  if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  if (!window.matchMedia) return false;
  return ['fullscreen', 'standalone', 'minimal-ui'].some(mode =>
    window.matchMedia(`(display-mode: ${mode})`).matches
  );
}

function isIos() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function markInstalled() {
  try { localStorage.setItem(INSTALLED_KEY, '1'); } catch { /* private mode */ }
}

async function detectInstalled() {
  try {
    if (localStorage.getItem(INSTALLED_KEY) === '1') return true;
  } catch { /* ignore */ }
  if (navigator.getInstalledRelatedApps) {
    try {
      const apps = await navigator.getInstalledRelatedApps();
      if (apps && apps.length > 0) return true;
    } catch { /* unsupported */ }
  }
  return false;
}

function showInstalledPanel({ ios }) {
  document.getElementById('install-panel').hidden = true;
  const panel = document.getElementById('installed-panel');
  panel.hidden = false;
  const msg = document.getElementById('installed-message');
  const openBtn = document.getElementById('open-hub');
  const openLink = document.getElementById('open-hub-link');
  if (ios) {
    document.getElementById('installed-heading').textContent = 'Already installed';
    msg.textContent = 'Already installed? Open Schwalbe ToolKit from your home screen. Safari cannot open scanned links directly in the installed app on iOS.';
    openBtn.hidden = true;
    openLink.hidden = true;
  } else {
    document.getElementById('installed-heading').textContent = 'App installed';
    msg.textContent = 'Schwalbe ToolKit is on this device. Open the warehouse tools hub.';
    openBtn.hidden = false;
    openLink.hidden = false;
    openBtn.onclick = () => { window.location.href = '/'; };
  }
}

function showInstallPanel() {
  document.getElementById('installed-panel').hidden = true;
  document.getElementById('install-panel').hidden = false;
  const ios = isIos();
  document.getElementById('ios-install').hidden = !ios;
  document.getElementById('android-install').hidden = ios;
  document.getElementById('generic-install').hidden = ios;
  if (!ios) document.getElementById('generic-install').hidden = false;
  const httpNote = document.getElementById('http-install-note');
  if (httpNote) httpNote.hidden = window.isSecureContext;
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('android-install-button');
  btn.hidden = false;
});

document.getElementById('android-install-button')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('android-install-button').hidden = true;
});

window.addEventListener('appinstalled', () => {
  markInstalled();
  void refreshUi();
});

async function refreshUi() {
  if (isStandalone()) {
    window.location.replace('/');
    return;
  }
  const installed = await detectInstalled();
  if (installed) showInstalledPanel({ ios: isIos() });
  else showInstallPanel();
}

if (window.isSecureContext && navigator.serviceWorker) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

void refreshUi();
