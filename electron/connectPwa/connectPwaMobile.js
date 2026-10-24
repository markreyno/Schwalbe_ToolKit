const FREIGHT_PORT = 48731;
const PALLETVISION_PORT = 48732;

function hostBase() {
  const { protocol, hostname } = location;
  return `${protocol}//${hostname}`;
}

function renderTiles(reachable) {
  const base = hostBase();
  const tiles = document.getElementById('tiles');
  tiles.innerHTML = '';
  const items = [
    { href: `${base}:${FREIGHT_PORT}/`, title: 'Freight Pictures', desc: 'Collect pallet photos. Use the master or shipment link from the desktop if prompted for a key.' },
    { href: `${base}:${PALLETVISION_PORT}/`, title: 'PalletVision Data Collector', desc: 'Record pallet videos and enter measured dimensions.' }
  ];
  for (const item of items) {
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = item.href;
    a.innerHTML = `<strong>${item.title}</strong><span>${item.desc}</span>`;
    if (!reachable) a.addEventListener('click', e => { if (!confirm('Desktop tools may be unreachable right now. Open anyway?')) e.preventDefault(); });
    tiles.appendChild(a);
  }
}

async function refreshStatus() {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    const data = await r.json();
    const ok = data.desktopReachable;
    dot.className = 'status-dot ' + (ok ? 'ok' : 'warn');
    const parts = [];
    parts.push(ok ? 'Desktop toolkit is reachable on this network.' : 'Cannot reach desktop tools from this phone yet.');
    if (data.freightReachable) parts.push('Freight server up.');
    else parts.push('Freight server not responding.');
    if (data.palletvisionReachable) parts.push('PalletVision server up.');
    else parts.push('PalletVision server not responding.');
    text.textContent = parts.join(' ');
    renderTiles(ok);
  } catch {
    dot.className = 'status-dot warn';
    text.textContent = 'Could not check desktop status.';
    renderTiles(false);
  }
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('install-banner').style.display = 'block';
});

document.getElementById('install-button')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('install-banner').style.display = 'none';
});

if (window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
} else {
  const note = document.getElementById('secure-note');
  if (note) note.textContent = 'You are on plain HTTP. iOS Add to Home Screen works as a web clip, but service worker offline caching is disabled until you use HTTPS (optional Tailscale certificate on the desktop).';
}

renderTiles(false);
void refreshStatus();
setInterval(refreshStatus, 15000);
