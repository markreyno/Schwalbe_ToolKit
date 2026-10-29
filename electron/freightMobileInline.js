const key = new URLSearchParams(location.search).get('key');
const ACTIVE_SESSION_KEY = 'schwalbe-freight-phone-active';
const LEAVE_PAGE_HINT = 'Installed Connect PWA: pictures can keep uploading with the screen locked. A normal Chrome tab only continues while Android keeps the tab alive — install the PWA for reliable background upload.';
const BACKGROUND_ACTIVE_HINT = 'Upload continues in the background. You can lock your phone or switch apps.';
const TAB_BACKGROUND_LIMIT_HINT = 'Chrome tab: upload may pause when the tab is closed. Install the Connect PWA from the hub for Background Fetch.';
const el = id => document.getElementById(id);
const uploadQueue = () => window.FreightUploadQueue;
let selected = [], batch = null, busy = false, mode = false, urls = [], activeXhr = null, uploadCanceled = false, finishAbort = null;
let saveTarget = '', uiPhase = 'pick', activeProgressPending = null, uploadSwReady = null, activeUploadChannel = 'page', swProgressListener = null;

function pendingBytesApi() {
  const Q = uploadQueue();
  return Q ? { total: Q.pendingByteTotal, done: Q.pendingDoneBytes } : null;
}

/** Progress bar uses 0–100% from bytes uploaded / total bytes (works on Android Chrome). */
function setUploadProgressBytes(doneBytes, totalBytes) {
  const progress = el('progress');
  const total = Math.max(1, Number(totalBytes) || 1);
  let done = Number(doneBytes);
  if (!Number.isFinite(done)) done = 0;
  progress.max = 100;
  progress.value = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

function syncProgressFromPending(pending, extraDoneBytes) {
  activeProgressPending = pending || activeProgressPending;
  const p = pending || activeProgressPending;
  const api = pendingBytesApi();
  if (!p || !api) {
    setUploadProgressBytes(0, 1);
    return;
  }
  setUploadProgressBytes(api.done(p) + (extraDoneBytes || 0), api.total(p));
}

function resetUploadProgress() {
  activeProgressPending = null;
  setUploadProgressBytes(0, 1);
}

function uploadProgressLabel(pending, resuming) {
  const Q = uploadQueue();
  if (!Q || !pending) return '';
  const { total, uploaded } = Q.pendingProgress(pending);
  const next = Math.min(uploaded + 1, total);
  const prefix = resuming && uploaded > 0 ? 'Resuming upload: ' : 'Uploading picture ';
  return prefix + next + ' of ' + total + '…';
}

function isResumeUpload(pending) {
  const Q = uploadQueue();
  return !!Q?.shouldAutoResumeUpload?.(pending);
}

function todayLocalIso() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function setShipmentTitle(company, date) {
  el('title').textContent = company + ' · ' + date;
}

function setSavingTo(label) {
  saveTarget = label || '';
  if (el('saving-to')) el('saving-to').textContent = saveTarget ? 'Saving to: ' + saveTarget : '';
}

function showUploadView() {
  el('shipment-setup').hidden = true;
  el('upload').hidden = false;
  if (window.isSecureContext && 'serviceWorker' in navigator) void registerServiceWorkerForUploads();
}

function showShipmentSetup(prefillCompany, prefillDate) {
  el('new-company').value = prefillCompany || '';
  el('new-date').value = prefillDate || todayLocalIso();
  el('upload').hidden = true;
  el('shipment-setup').hidden = false;
  message('');
}

function setPhase(phase) {
  uiPhase = phase;
  const picking = phase === 'pick';
  const uploading = phase === 'uploading';
  const result = phase === 'done' || phase === 'error';
  el('capture-block').hidden = !picking;
  el('upload-progress-panel').hidden = !uploading;
  el('upload-result').hidden = phase !== 'error';
  el('send').hidden = !picking || busy;
  el('retry-upload').hidden = phase !== 'error';
}

function markActiveShipmentSession() {
  if (!key) return;
  try { sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({ key })); } catch { /* private mode */ }
}

function clearActiveShipmentSession() {
  try { sessionStorage.removeItem(ACTIVE_SESSION_KEY); } catch { /* ignore */ }
}

async function api(route, options = {}) {
  const keyQuery = key ? (route.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key) : '';
  const r = await fetch(route + keyQuery, options);
  const d = await r.json();
  if (!r.ok) throw Error(d.error || 'Upload failed');
  return d;
}
const post = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

function message(t) { el('message').textContent = t; }

function uploadCountTotal(pending, selectedCount) {
  const fromPending = pending?.files?.length || 0;
  const fromSelection = selectedCount || 0;
  return Math.max(1, fromPending || fromSelection || 1);
}

function validatePendingFiles(pending) {
  if (!pending?.files?.length) throw Error('Select pictures and tap Upload All to start.');
  for (let i = 0; i < pending.files.length; i++) {
    const f = pending.files[i];
    const blob = f.blob;
    if (!(blob instanceof Blob) || blob.size < 1) {
      throw Error('Saved picture data for file ' + (i + 1) + ' was lost. Re-select your pictures and tap Retry upload.');
    }
    if (f.size && blob.size !== f.size) {
      throw Error('Saved picture data looks incomplete. Re-select your pictures and tap Retry upload.');
    }
  }
}
function valid() {
  el('send').disabled = busy || !selected.length || selected.length > 26 || Number(el('pallets').value) !== selected.length || !el('confirm').checked;
}
function render() {
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  el('previews').replaceChildren();
  selected.forEach((f, i) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    const img = document.createElement('img');
    img.alt = f.name;
    const u = URL.createObjectURL(f);
    urls.push(u);
    img.src = u;
    const name = document.createElement('p');
    name.textContent = f.name;
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.onclick = () => { selected.splice(i, 1); el('confirm').checked = false; render(); };
    tile.append(img, name, remove);
    el('previews').append(tile);
  });
  el('count').textContent = selected.length + ' pictures / ' + selected.length + ' pallets';
  valid();
}
for (const id of ['camera', 'files']) el(id).onchange = e => {
  const incoming = Array.from(e.target.files);
  e.target.value = '';
  if (selected.length + incoming.length > 26) {
    message('You can select up to 26 pictures per upload. Remove pictures before adding more.');
    return;
  }
  selected.push(...incoming);
  incoming.forEach(preparePicture);
  el('confirm').checked = false;
  render();
};
el('pallets').oninput = valid;
el('confirm').onchange = valid;

function sha256(bytes) { const K = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298]; const H = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]; const n = bytes.length, b = new Uint8Array(Math.ceil((n + 9) / 64) * 64); b.set(bytes); b[n] = 128; const v = new DataView(b.buffer); v.setUint32(b.length - 4, n * 8); v.setUint32(b.length - 8, Math.floor(n / 536870912)); const r = (x, n) => (x >>> n) | (x << (32 - n)), w = new Uint32Array(64); for (let o = 0; o < b.length; o += 64) { for (let i = 0; i < 16; i++)w[i] = v.getUint32(o + i * 4); for (let i = 16; i < 64; i++) { const a = w[i - 15], z = w[i - 2]; w[i] = w[i - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + w[i - 7] + (r(z, 17) ^ r(z, 19) ^ (z >>> 10)); } let [a, c, d, e, f, g, h, j] = H; for (let i = 0; i < 64; i++) { const t = (j + (r(f, 6) ^ r(f, 11) ^ r(f, 25)) + ((f & g) ^ (~f & h)) + K[i] + w[i]) >>> 0, u = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & c) ^ (a & d) ^ (c & d))) >>> 0; j = h; h = g; g = f; f = (e + t) >>> 0; e = d; d = c; c = a; a = (t + u) >>> 0; } const vals = [a, c, d, e, f, g, h, j]; for (let i = 0; i < 8; i++)H[i] = (H[i] + vals[i]) >>> 0; } return H.map(x => x.toString(16).padStart(8, '0')).join(''); }
const preparation = new WeakMap();
let hashWorker = null, workerSequence = 0, preparationQueue = Promise.resolve();
const workerRequests = new Map();
function getHashWorker() {
  if (hashWorker) return hashWorker;
  const source = sha256.toString() + ";onmessage=async({data})=>{try{const bytes=await data.file.arrayBuffer();const hash=self.crypto?.subtle?Array.from(new Uint8Array(await self.crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join(''):sha256(new Uint8Array(bytes));postMessage({id:data.id,hash})}catch(e){postMessage({id:data.id,error:e.message})}}";
  const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  hashWorker = new Worker(workerUrl); URL.revokeObjectURL(workerUrl);
  hashWorker.onmessage = ({ data }) => { const resolve = workerRequests.get(data.id); workerRequests.delete(data.id); resolve?.(data); };
  hashWorker.onerror = () => { for (const resolve of workerRequests.values()) resolve({ error: 'Could not prepare the picture. Refresh and try again.' }); workerRequests.clear(); hashWorker.terminate(); hashWorker = null; };
  return hashWorker;
}
function preparePicture(file) {
  if (preparation.has(file)) return preparation.get(file);
  const promise = preparationQueue.then(() => new Promise(resolve => {
    try { const worker = getHashWorker(), id = ++workerSequence; workerRequests.set(id, resolve); worker.postMessage({ id, file }); }
    catch (e) { resolve({ error: e.message }); }
  }));
  preparation.set(file, promise); preparationQueue = promise.then(() => { }); return promise;
}
/** @deprecated file-count progress; prefer setUploadProgressBytes */
function setUploadProgress(completedUnits, total) {
  const api = pendingBytesApi();
  const p = activeProgressPending;
  if (p && api) {
    const fileTotal = Math.max(1, p.files.length);
    const doneBytes = api.done(p);
    const totalBytes = api.total(p);
    const unit = totalBytes / fileTotal;
    setUploadProgressBytes(doneBytes + Math.max(0, completedUnits) * unit, totalBytes);
    return;
  }
  setUploadProgressBytes(completedUnits, total);
}

function uploadPicture(blob, index, hash, pending) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); activeXhr = xhr;
    xhr.open('POST', '/file?batch=' + batch.id + '&index=' + index + '&key=' + encodeURIComponent(key));
    xhr.setRequestHeader('X-Picture-SHA256', hash);
    xhr.setRequestHeader('X-Freight-Upload-Channel', 'page');
    xhr.timeout = 180000;
    xhr.upload.onprogress = e => {
      if (uploadCanceled) return;
      if (e.lengthComputable && e.total > 0) {
        syncProgressFromPending(pending, e.loaded);
        const Q = uploadQueue();
        const total = pending?.files?.length || 1;
        const fraction = e.loaded / e.total;
        message('Uploading picture ' + (index + 1) + ' of ' + total + ' · ' + Math.round(fraction * 100) + '%' + (fraction === 1 ? ' — saving on desktop…' : '') + '\n' + LEAVE_PAGE_HINT);
      }
    };
    xhr.onload = () => {
      if (activeXhr === xhr) activeXhr = null;
      if (uploadCanceled) { reject(Error('__canceled__')); return; }
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) throw Error(result.error || 'Upload failed');
        resolve(result);
      } catch (e) { reject(e); }
    };
    xhr.onabort = () => { if (activeXhr === xhr) activeXhr = null; reject(Error('__canceled__')); };
    xhr.onerror = () => { if (activeXhr === xhr) activeXhr = null; reject(uploadCanceled ? Error('__canceled__') : Error('Connection interrupted. Check Wi-Fi and keep the toolkit open.')); };
    xhr.ontimeout = () => { if (activeXhr === xhr) activeXhr = null; reject(Error('Upload timed out. Retry the upload.')); };
    xhr.send(blob);
  });
}

function setCaptureDisabled(disabled) {
  document.querySelectorAll('#capture-block input, #capture-block .tile button').forEach(e => { e.disabled = disabled; });
}

async function abortActiveBatch() {
  uploadCanceled = true;
  activeXhr?.abort();
  finishAbort?.abort();
  const b = batch;
  batch = null;
  if (b) await api('/cancel?batch=' + b.id, { method: 'POST' }).catch(() => { });
  else await api('/cancel-active', { method: 'POST' }).catch(() => { });
  await uploadQueue()?.clearPending();
  uploadCanceled = false;
  busy = false;
}

function resetSendButton() {
  el('send').textContent = mode ? 'Reupload All' : 'Upload All';
}

function goToPickStep() {
  setCaptureDisabled(false);
  setPhase('pick');
  resetSendButton();
  valid();
  message('');
}

async function returnToPickFromUpload() {
  await abortActiveBatch();
  resetUploadProgress();
  goToPickStep();
  message('Returned to picture selection. Your pictures are still selected.');
}

async function resetAfterCancel() {
  await returnToPickFromUpload();
  message('Upload canceled');
}

el('back-to-photos-upload').onclick = () => { void returnToPickFromUpload(); };
el('cancel-upload').onclick = () => { void resetAfterCancel(); };

el('retry-upload').onclick = () => { if (busy) return; void runUpload(); };

el('new-shipment-nav').onclick = () => showShipmentSetup('', todayLocalIso());
el('new-shipment-form').onsubmit = async e => {
  e.preventDefault();
  const button = e.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const r = await api('/shipment/new', post({ company: el('new-company').value, date: el('new-date').value }));
    location.href = '/?key=' + encodeURIComponent(r.key);
  } catch (err) {
    message(err.message);
    button.disabled = false;
  }
};

el('send').onclick = () => { if (busy) return; void runUpload(); };

async function ensureBatchOnServer(pending, uploadChannel) {
  const files = pending.files.map(f => ({ name: f.name, size: f.size, hash: f.hash }));
  const body = {
    pallets: pending.pallets,
    files,
    batchId: pending.batchId || undefined,
    uploadChannel: uploadChannel || activeUploadChannel || 'page'
  };
  const created = await api('/batch', post(body));
  batch = created;
  if (created.id && created.id !== pending.batchId) await uploadQueue().setBatchId(created.id);
  if (created.uploadFolder) setSavingTo(created.uploadFolder);
  return created;
}

async function reportUploadChannel(channel) {
  activeUploadChannel = channel;
  if (!batch?.id) return;
  try {
    await api('/batch', post({ batchId: batch.id, uploadChannel: channel }));
  } catch { /* channel reporting is best-effort */ }
}

function notifyServiceWorkerToContinueUploads() {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage({ type: 'freight-continue-upload' });
  }).catch(() => { });
}

function isInstalledPwa() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || navigator.standalone === true;
}

/** Snapshot why Background Fetch may be unavailable (for support / desktop debugging). */
async function probeBackgroundUploadSupport() {
  const probe = {
    secureContext: !!window.isSecureContext,
    serviceWorker: 'serviceWorker' in navigator,
    controller: !!navigator.serviceWorker?.controller,
    installedPwa: isInstalledPwa(),
    backgroundFetchApi: false,
    backgroundFetchPermission: 'unknown',
    reason: ''
  };
  if (!probe.secureContext) {
    probe.reason = 'not-secure-context';
    return probe;
  }
  if (!probe.serviceWorker) {
    probe.reason = 'no-service-worker';
    return probe;
  }
  try {
    const reg = await ensureUploadServiceWorker();
    probe.controller = !!navigator.serviceWorker.controller;
    probe.backgroundFetchApi = !!(reg?.backgroundFetch && typeof reg.backgroundFetch.fetch === 'function');
    if (!probe.backgroundFetchApi) {
      probe.reason = probe.installedPwa ? 'background-fetch-api-missing' : 'background-fetch-needs-installed-pwa';
      return probe;
    }
    try {
      const perm = await navigator.permissions.query({ name: 'background-fetch' });
      probe.backgroundFetchPermission = perm.state;
      if (perm.state === 'denied') probe.reason = 'background-fetch-denied';
    } catch {
      probe.backgroundFetchPermission = 'unsupported';
    }
  } catch (e) {
    probe.reason = 'service-worker-register-failed';
  }
  return probe;
}

async function ensureUploadServiceWorker() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return null;
  if (!uploadSwReady) {
    uploadSwReady = (async () => {
      try {
        await navigator.serviceWorker.register('/freight-sw.js', { scope: '/' });
        const reg = await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller && reg.active) reg.active.postMessage({ type: 'freight-sw-activate' });
        return reg;
      } catch {
        uploadSwReady = null;
        return null;
      }
    })();
  }
  return uploadSwReady;
}

function attachServiceWorkerProgressListener() {
  if (swProgressListener || !('serviceWorker' in navigator)) return;
  swProgressListener = event => {
    const data = event.data;
    if (!data || data.type !== 'freight-upload-progress') return;
    void syncUploadProgressFromQueue();
  };
  navigator.serviceWorker.addEventListener('message', swProgressListener);
}

async function registerServiceWorkerForUploads() {
  attachServiceWorkerProgressListener();
  return ensureUploadServiceWorker();
}

async function cleanupOrphanBackgroundFetches() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  try {
    const reg = await ensureUploadServiceWorker();
    const bf = reg?.backgroundFetch;
    if (!bf?.getIds) return;
    const ids = await bf.getIds();
    for (const id of ids) {
      if (String(id).startsWith('freight-')) {
        const item = await bf.get(id);
        await item?.abort?.();
      }
    }
  } catch { /* ignore */ }
}

async function prepareUploadQueueOnLoad() {
  const Q = uploadQueue();
  if (!Q?.repairAndLoadPending) return { pending: null, notice: '' };
  await cleanupOrphanBackgroundFetches();
  return Q.repairAndLoadPending();
}

async function syncUploadProgressFromQueue() {
  const Q = uploadQueue();
  if (!Q) return;
  const pending = await Q.getPending();
  if (!pending || pending.shipmentKey !== key) return;
  syncProgressFromPending(pending, 0);
  const { total, uploaded } = Q.pendingProgress(pending);
  if (uploaded > 0 && uploaded < total && isResumeUpload(pending)) {
    message(uploadProgressLabel(pending, true) + '\n' + LEAVE_PAGE_HINT);
  }
}

function backgroundFetchRegistrationId(batchId, pending) {
  const remaining = uploadQueue()?.remainingIndices(pending) || [];
  return 'freight-' + batchId + (remaining.length ? '-' + remaining.join('.') : '');
}

async function tryUploadRemainingViaBackgroundFetch(pending, batchId, resuming) {
  const Q = uploadQueue();
  const remaining = Q.remainingIndices(pending);
  if (!remaining.length) return false;
  try {
    const reg = await registerServiceWorkerForUploads();
    const bf = reg?.backgroundFetch;
    if (!bf || typeof bf.fetch !== 'function') return false;
    const requests = remaining.map(i => {
      const fileRec = Q.materializeFile(pending.files[i]);
      return new Request('/file?batch=' + batchId + '&index=' + i + '&key=' + encodeURIComponent(key), {
        method: 'POST',
        headers: {
          'X-Picture-SHA256': fileRec.hash,
          'X-Freight-Upload-Channel': 'background-fetch'
        },
        body: fileRec.blob
      });
    });
    const downloadTotal = remaining.reduce((n, i) => n + (pending.files[i].size || 0), 0);
    await reportUploadChannel('background-fetch');
    const bg = await bf.fetch(backgroundFetchRegistrationId(batchId, pending), requests, {
      title: 'Freight picture upload',
      downloadTotal
    });
    const resumeLabel = resuming && isResumeUpload(pending);
    message((resumeLabel ? uploadProgressLabel(pending, true) : uploadProgressLabel(pending, false)) + '\n' + BACKGROUND_ACTIVE_HINT + '\n' + LEAVE_PAGE_HINT);
    const onProgress = () => {
      if (uploadCanceled) return;
      const bytesTotal = Math.max(1, bg.downloadTotal || downloadTotal);
      const byteFraction = Math.min(1, (bg.uploaded || 0) / bytesTotal);
      const remainingBytes = remaining.reduce((n, i) => n + (pending.files[i].size || 0), 0);
      syncProgressFromPending(pending, Math.round(remainingBytes * byteFraction));
    };
    bg.addEventListener('backgroundfetchprogress', onProgress);
    onProgress();
    await new Promise((resolve, reject) => {
      const onSuccess = () => { cleanup(); resolve(); };
      const onFail = () => { cleanup(); reject(new Error('Background upload failed. Retry with the screen on.')); };
      const cleanup = () => {
        bg.removeEventListener('backgroundfetchsuccess', onSuccess);
        bg.removeEventListener('backgroundfetchfail', onFail);
        bg.removeEventListener('backgroundfetchprogress', onProgress);
      };
      bg.addEventListener('backgroundfetchsuccess', onSuccess);
      bg.addEventListener('backgroundfetchfail', onFail);
    });
    for (const i of remaining) await Q.markIndexUploaded(i);
    return true;
  } catch {
    return false;
  }
}

async function waitForServiceWorkerQueueDrain(pending, actuallyResuming) {
  const Q = uploadQueue();
  let stalledAt = Date.now();
  let lastUploaded = Q.pendingProgress(pending).uploaded;
  notifyServiceWorkerToContinueUploads();
  while (!uploadCanceled) {
    pending = await Q.getPending();
    if (!pending || pending.shipmentKey !== key) throw Error('Upload queue was cleared.');
    syncProgressFromPending(pending, 0);
    const { uploaded, remaining } = Q.pendingProgress(pending);
    if (remaining === 0) return pending;
    message((actuallyResuming ? uploadProgressLabel(pending, true) : uploadProgressLabel(pending, false)) + '\n' + LEAVE_PAGE_HINT);
    if (uploaded > lastUploaded) {
      lastUploaded = uploaded;
      stalledAt = Date.now();
    } else if (Date.now() - stalledAt > 12000) {
      notifyServiceWorkerToContinueUploads();
      stalledAt = Date.now();
    } else if (Date.now() - stalledAt > 45000) {
      break;
    }
    await new Promise(r => setTimeout(r, 450));
  }
  return Q.getPending();
}

async function uploadRemainingViaPageXHR(pending, actuallyResuming) {
  const Q = uploadQueue();
  await reportUploadChannel('page');
  for (let i = 0; i < pending.files.length; i++) {
    if (uploadCanceled) break;
    pending = await Q.getPending();
    if (pending.uploadedIndices.includes(i)) continue;
    const fileRec = Q.materializeFile(pending.files[i]);
    message((actuallyResuming ? uploadProgressLabel(pending, true) : uploadProgressLabel(pending, false)) + '\n' + LEAVE_PAGE_HINT);
    await uploadPicture(fileRec.blob, i, fileRec.hash, pending);
    if (uploadCanceled) break;
    await Q.markIndexUploaded(i);
    pending = await Q.getPending();
    syncProgressFromPending(pending, 0);
  }
}

async function finalizeVerifiedUpload(pending) {
  message('Verifying every picture on the desktop…');
  finishAbort = new AbortController();
  await api('/finish?batch=' + batch.id, { method: 'POST', signal: finishAbort.signal });
  finishAbort = null;
  batch = null;
  await uploadQueue().clearPending();
  const bytesApi = pendingBytesApi();
  if (pending && bytesApi) setUploadProgressBytes(bytesApi.total(pending), bytesApi.total(pending));
  setPhase('done');
  const total = pending?.files?.length || 0;
  message('Complete: ' + total + ' pallet pictures verified and saved on the desktop. This shipment link is now closed.');
}

async function drainUploadQueue(resuming) {
  const Q = uploadQueue();
  if (!Q) throw Error('Upload queue is unavailable. Refresh and try again.');
  let pending = await Q.getPending();
  if (!pending) throw Error('No pictures are queued for upload.');
  if (pending.shipmentKey !== key) {
    throw Error('Upload queue belongs to another shipment. Open that shipment to resume.');
  }
  validatePendingFiles(pending);
  activeProgressPending = pending;
  const actuallyResuming = !!resuming && isResumeUpload(pending);
  syncProgressFromPending(pending, 0);
  try {
    await registerServiceWorkerForUploads();
  } catch { /* page upload works without a controlling service worker */ }
  const probe = await probeBackgroundUploadSupport();
  try { sessionStorage.setItem('schwalbe-freight-upload-probe', JSON.stringify(probe)); } catch { /* ignore */ }
  if (!batch) await ensureBatchOnServer(pending, 'page');
  pending = await Q.getPending();
  if (await tryUploadRemainingViaBackgroundFetch(pending, batch.id, actuallyResuming)) {
    if (uploadCanceled) return;
    pending = await Q.getPending();
    await finalizeVerifiedUpload(pending);
    return;
  }
  const preferServiceWorkerDrain = probe.backgroundFetchApi || probe.installedPwa;
  if (preferServiceWorkerDrain) {
    await reportUploadChannel('service-worker');
    try {
      const reg = await ensureUploadServiceWorker();
      if (reg?.sync?.register) await reg.sync.register('freight-upload-continue');
    } catch { /* Background Sync is optional */ }
    notifyServiceWorkerToContinueUploads();
    pending = await waitForServiceWorkerQueueDrain(pending, actuallyResuming);
    if (uploadCanceled) return;
  }
  if (Q.pendingProgress(pending).remaining > 0) {
    if (!preferServiceWorkerDrain) await reportUploadChannel('page');
    else if (!isInstalledPwa()) message(TAB_BACKGROUND_LIMIT_HINT + '\n' + LEAVE_PAGE_HINT);
    await uploadRemainingViaPageXHR(pending, actuallyResuming);
  }
  if (uploadCanceled) return;
  pending = await Q.getPending();
  if (Q.pendingProgress(pending).remaining === 0) {
    await finalizeVerifiedUpload(pending);
  }
}

async function runUpload(resuming) {
  uploadCanceled = false;
  busy = true;
  valid();
  setPhase('uploading');
  setCaptureDisabled(true);
  try {
    const Q = uploadQueue();
    if (!Q) throw Error('Upload queue is unavailable. Refresh and try again.');
    if (!resuming) {
      message('Saving pictures on this device before upload…\n' + LEAVE_PAGE_HINT);
      const hashFile = async file => {
        const prepared = await preparePicture(file);
        if (prepared.error) throw Error(prepared.error);
        return prepared.hash;
      };
      await Q.createFromSelection({
        shipmentKey: key,
        pallets: Number(el('pallets').value),
        files: selected,
        hashFile
      });
      syncProgressFromPending(await Q.getPending(), 0);
    }
    await drainUploadQueue(!!resuming);
  } catch (e) {
    if (uploadCanceled || e.name === 'AbortError' || e.message === '__canceled__') {
      setPhase('pick');
      resetSendButton();
      valid();
      message('Upload canceled');
      return;
    }
    setPhase('error');
    message(e.message + ' Your pictures stay saved on this device. Reopen Freight Pictures or tap Retry upload.\n' + LEAVE_PAGE_HINT);
    el('send').textContent = 'Retry Upload';
    if (/expired|not a valid image/.test(e.message)) batch = null;
  } finally {
    finishAbort = null;
    busy = false;
    if (!batch && uiPhase !== 'done') setCaptureDisabled(false);
    if (uiPhase === 'pick') valid();
  }
}

async function resumePendingUploadIfAny(state) {
  const Q = uploadQueue();
  if (!Q || busy || !key) return false;
  const pending = await Q.getPending();
  if (!pending || pending.shipmentKey !== key) return false;
  if (!Q.shouldAutoResumeUpload(pending)) return false;
  const { total, uploaded } = Q.pendingProgress(pending);
  if (uploaded >= total && total > 0) {
    await Q.clearPending();
    return false;
  }
  showUploadView();
  markActiveShipmentSession();
  if (state?.shipment) {
    setShipmentTitle(state.shipment.company, state.shipment.date);
    mode = state.shipment.reupload;
    setSavingTo(state.shipment.saveTarget);
    el('mode').textContent = mode ? 'Reupload: new pictures will be added; existing pictures are preserved.' : 'Collect your pictures, then confirm the pallet amount.';
    el('send').textContent = mode ? 'Reupload All' : 'Upload All';
  }
  el('pallets').value = String(pending.pallets);
  message(uploadProgressLabel(pending, true) + '\n' + LEAVE_PAGE_HINT);
  await runUpload(true);
  return true;
}

function tryResumeWhenIdle() {
  if (busy || !key) return;
  const Q = uploadQueue();
  if (!Q) return;
  void Q.getPending().then(pending => {
    if (!pending || pending.shipmentKey !== key) return;
    if (!Q.shouldAutoResumeUpload(pending)) return;
    const { uploaded, total } = Q.pendingProgress(pending);
    if (uploaded >= total) return;
    void api('/state')
      .then(s => resumePendingUploadIfAny(s))
      .catch(() => { });
  });
}

async function reconcileUploadAfterForegroundReturn() {
  if (!key) return;
  const Q = uploadQueue();
  if (!Q) return;
  const pending = await Q.getPending();
  if (pending && pending.shipmentKey === key) {
    await syncUploadProgressFromQueue();
    return;
  }
  if (!busy) return;
  try {
    const s = await api('/state');
    if (s.shipment?.closed) {
      batch = null;
      busy = false;
      setCaptureDisabled(false);
      setPhase('done');
      message('Complete: shipment verified and saved on the desktop. This shipment link is now closed.');
    }
  } catch { /* ignore */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (busy && batch) {
      activeXhr?.abort();
      notifyServiceWorkerToContinueUploads();
    }
    return;
  }
  void reconcileUploadAfterForegroundReturn();
  tryResumeWhenIdle();
});
window.addEventListener('online', tryResumeWhenIdle);

el('create').onsubmit = async e => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    const s = await api('/create', post({ company: el('company').value, date: el('date').value }));
    location.href = '/?key=' + s.key;
  } catch (e) { message(e.message); button.disabled = false; }
};

async function refreshSaveTarget() {
  try {
    const s = await api('/state');
    if (s.shipment?.saveTarget) setSavingTo(s.shipment.saveTarget);
  } catch { /* ignore */ }
}

api('/state').then(async s => {
  if (s.appVersion && el('app-version')) el('app-version').textContent = 'v' + s.appVersion;
  if (!s.configured) { message('Choose the storage folder in the desktop toolkit first.'); return; }
  const queuePrep = await prepareUploadQueueOnLoad();
  if (s.hubEntry || !key) {
    clearActiveShipmentSession();
    showShipmentSetup('', todayLocalIso());
    if (queuePrep.pending) {
      notifyServiceWorkerToContinueUploads();
      message('A saved picture upload is finishing in the background.');
    } else if (queuePrep.notice) {
      message(queuePrep.notice);
    }
    return;
  }
  if (s.master) {
    el('master').hidden = false;
    for (const f of s.shipments) {
      const option = document.createElement('option');
      option.textContent = f.company + ' · ' + f.date;
      option.value = f.key;
      el('shipment-select').append(option);
    }
    el('shipment-select').onchange = () => { el('open-shipment').disabled = !el('shipment-select').value; };
    el('open-shipment').onclick = () => { location.href = '/?key=' + encodeURIComponent(el('shipment-select').value); };
    if (!s.shipments.length) { el('shipment-empty').hidden = false; el('shipment-select').disabled = true; }
  } else if (s.shipment.closed) {
    message('This shipment is complete. Select Reupload on the desktop to add pictures.');
  } else {
    if (await resumePendingUploadIfAny(s)) return;
    showUploadView();
    markActiveShipmentSession();
    setShipmentTitle(s.shipment.company, s.shipment.date);
    mode = s.shipment.reupload;
    setSavingTo(s.shipment.saveTarget);
    el('mode').textContent = mode ? 'Reupload: new pictures will be added; existing pictures are preserved.' : 'Collect your pictures, then confirm the pallet amount.';
    el('send').textContent = mode ? 'Reupload All' : 'Upload All';
    setPhase('pick');
    setInterval(() => { void refreshSaveTarget(); }, 5000);
  }
}).catch(e => message(e.message));
