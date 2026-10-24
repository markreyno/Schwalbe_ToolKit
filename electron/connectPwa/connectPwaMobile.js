const FREIGHT_PORT = 48731;
const PALLETVISION_PORT = 48732;

const ICONS = {
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>'
};

function hostBase() {
  const { protocol, hostname } = location;
  return `${protocol}//${hostname}`;
}

function tileMarkup({ href, title, category, desc, icon }) {
  return `<a class="tool-tile" href="${href}">
    <div class="tool-tile-top">
      <span class="tool-icon">${ICONS[icon]}</span>
      <span class="badge green">Available</span>
    </div>
    <p class="card-category">${category}</p>
    <h3>${title}</h3>
    <p class="card-description">${desc}</p>
    <div class="card-bottom"><span>Open tool</span>${ICONS.arrow}</div>
  </a>`;
}

function renderTiles(reachable) {
  const base = hostBase();
  const tiles = document.getElementById('tiles');
  tiles.innerHTML = [
    tileMarkup({
      href: `${base}:${FREIGHT_PORT}/`,
      title: 'Freight Pictures',
      category: 'SHIPPING & WAREHOUSE',
      desc: 'Collect pallet photos. Use the master or shipment link from the desktop if prompted for a key.',
      icon: 'camera'
    }),
    tileMarkup({
      href: `${base}:${PALLETVISION_PORT}/`,
      title: 'PalletVision Data Collector',
      category: 'DATA COLLECTION',
      desc: 'Record pallet videos and enter measured dimensions.',
      icon: 'video'
    })
  ].join('');
  if (!reachable) {
    tiles.querySelectorAll('.tool-tile').forEach(a => {
      a.addEventListener('click', e => {
        if (!confirm('Desktop tools may be unreachable right now. Open anyway?')) e.preventDefault();
      });
    });
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
