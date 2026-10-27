const ICONS = {
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>'
};

const TOOL_META = {
  'freight-pictures': { icon: 'camera', desc: 'Collect pallet photos for the active shipment on the desktop.' },
  'palletvision-collector': { icon: 'video', desc: 'Upload pallet videos and enter measured dimensions.' }
};

let desktopReachable = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function pickerWaterUiEnabled() {
  return !!(window.connectPwaInstall && window.connectPwaInstall.isInstalledPwa());
}

function syncPickerWaterPanelVisibility() {
  const panel = document.getElementById('picker-water-notifications');
  if (!panel) return false;
  const enabled = pickerWaterUiEnabled();
  panel.hidden = !enabled;
  panel.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  if (!enabled) {
    const pushBtn = document.getElementById('picker-water-push-enable');
    const pushStatus = document.getElementById('picker-water-push-status');
    if (pushBtn) pushBtn.hidden = true;
    if (pushStatus) pushStatus.hidden = true;
  }
  return enabled;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

async function refreshPickerWaterNotifications() {
  if (!syncPickerWaterPanelVisibility()) return;
  const list = document.getElementById('picker-water-list');
  const badge = document.getElementById('picker-water-badge');
  if (!list || !badge) return;
  try {
    const r = await fetch('/api/picker-water/notifications', { cache: 'no-store' });
    const data = await r.json();
    const count = data.count || 0;
    const items = data.items || [];
    badge.textContent = String(count);
    badge.hidden = count < 1;
    if (!items.length) {
      list.innerHTML = '<li><span>No pickers need water right now.</span></li>';
      return;
    }
    list.innerHTML = items.map(item => `<li class="severity-${escapeHtml(item.severity)}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span></li>`).join('');
  } catch {
    list.innerHTML = '<li><span>Could not load watering alerts from the desktop.</span></li>';
    badge.hidden = true;
  }
}

async function maybeBindPushButton() {
  if (!pickerWaterUiEnabled()) return;
  const button = document.getElementById('picker-water-push-enable');
  const status = document.getElementById('picker-water-push-status');
  if (!button || !status) return;
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    button.hidden = true;
    if (!window.isSecureContext && status) {
      status.hidden = false;
      status.textContent = 'Push alerts need HTTPS. Turn on “Use HTTPS for phone tools” on the desktop Connect PWA page, or use the hub in the browser without push.';
    }
    return;
  }
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const existing = reg ? await reg.pushManager.getSubscription() : null;
  if (existing) {
    button.hidden = true;
    status.hidden = false;
    status.textContent = 'Push alerts are enabled for this installed app.';
    return;
  }
  button.hidden = false;
  status.hidden = true;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const keyRes = await fetch('/api/push/vapid-public-key', { cache: 'no-store' });
      const { publicKey } = await keyRes.json();
      if (!publicKey) throw new Error('Push is not configured on the desktop.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      button.hidden = true;
      status.hidden = false;
      status.textContent = 'Push alerts are enabled for this installed app.';
    } catch (e) {
      status.hidden = false;
      status.textContent = e.message || 'Could not enable push alerts.';
      button.disabled = false;
    }
  };
}

function tileShell({ title, category, body, footer, tag }) {
  return `<div class="tool-tile-top">
      <span class="tool-icon">${ICONS[tag.icon]}</span>
      <span class="badge ${tag.ready ? 'green' : 'muted'}">${tag.ready ? 'Ready' : 'Setup needed'}</span>
    </div>
    <p class="card-category">${escapeHtml(category)}</p>
    <h3>${escapeHtml(title)}</h3>
    ${body}
    ${footer || ''}`;
}

function renderToolTiles(tools) {
  const tiles = document.getElementById('tiles');
  tiles.innerHTML = tools.map(tool => {
    const meta = TOOL_META[tool.id] || { icon: 'camera', desc: '' };
    if (tool.ready && tool.url) {
      const body = `<p class="card-description">${escapeHtml(meta.desc)}</p>`;
      const footer = `<div class="card-bottom"><span>Open tool</span>${ICONS.arrow}</div>`;
      return `<a class="tool-tile" href="${escapeHtml(tool.url)}" target="_self">${tileShell({ title: tool.title, category: tool.category, body, footer, tag: { icon: meta.icon, ready: true } })}</a>`;
    }
    const body = `<p class="card-description tool-notice">${escapeHtml(tool.message || 'This tool is not ready on the desktop yet.')}</p>`;
    return `<div class="tool-tile tool-tile--blocked" aria-disabled="true">${tileShell({ title: tool.title, category: tool.category, body, footer: '', tag: { icon: meta.icon, ready: false } })}</div>`;
  }).join('');

  if (!desktopReachable) {
    tiles.querySelectorAll('a.tool-tile').forEach(link => {
      link.addEventListener('click', e => {
        if (!confirm('Desktop tools may be unreachable right now. Open anyway?')) e.preventDefault();
      });
    });
  }
}

async function loadTools() {
  const host = location.hostname;
  const r = await fetch(`/api/tools?host=${encodeURIComponent(host)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Could not load tool links.');
  const data = await r.json();
  renderToolTiles(data.tools || []);
}

async function refreshStatus() {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    const data = await r.json();
    desktopReachable = data.desktopReachable;
    const ok = data.desktopReachable;
    dot.className = 'status-dot ' + (ok ? 'ok' : 'warn');
    const parts = [];
    parts.push(ok ? 'Desktop toolkit is reachable on this network.' : 'Cannot reach desktop tools from this phone yet.');
    if (data.freightReachable) parts.push('Freight server up.');
    else parts.push('Freight server not responding.');
    if (data.palletvisionReachable) parts.push('PalletVision server up.');
    else parts.push('PalletVision server not responding.');
    text.textContent = parts.join(' ');
    await loadTools();
    if (pickerWaterUiEnabled()) {
      await refreshPickerWaterNotifications();
      await maybeBindPushButton();
    } else {
      syncPickerWaterPanelVisibility();
    }
  } catch {
    dot.className = 'status-dot warn';
    text.textContent = 'Could not check desktop status.';
    desktopReachable = false;
    const tiles = document.getElementById('tiles');
    tiles.innerHTML = '<p class="tool-notice">Tool links are unavailable right now.</p>';
    syncPickerWaterPanelVisibility();
  }
}

if (window.connectPwaInstall) window.connectPwaInstall.bindInstallUiVisibility();
syncPickerWaterPanelVisibility();
['standalone', 'fullscreen', 'minimal-ui'].forEach(mode => {
  const mq = window.matchMedia('(display-mode: ' + mode + ')');
  const onChange = () => {
    if (window.connectPwaInstall) window.connectPwaInstall.bindInstallUiVisibility();
    syncPickerWaterPanelVisibility();
    if (pickerWaterUiEnabled()) {
      void refreshPickerWaterNotifications();
      void maybeBindPushButton();
    }
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
});

let swReloading = false;
if (window.isSecureContext && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SW_UPDATED' && !swReloading) {
      swReloading = true;
      location.reload();
    }
  });
  navigator.serviceWorker.register('/sw.js').then(reg => {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          worker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
  }).catch(() => {});
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}

void refreshStatus();
setInterval(refreshStatus, 15000);
