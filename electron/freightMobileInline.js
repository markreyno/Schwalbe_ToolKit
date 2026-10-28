const key = new URLSearchParams(location.search).get('key');
const ACTIVE_SESSION_KEY = 'schwalbe-freight-phone-active';
const LEAVE_PAGE_HINT = 'You can leave this page. Uploads continue when you come back to Freight Pictures.';
const el = id => document.getElementById(id);
const uploadQueue = () => window.FreightUploadQueue;
let selected = [], batch = null, busy = false, mode = false, urls = [], activeXhr = null, uploadCanceled = false, finishAbort = null;
let saveTarget = '', uiPhase = 'pick';

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
  const confirm = phase === 'confirm';
  const uploading = phase === 'uploading';
  const result = phase === 'done' || phase === 'error';
  el('capture-block').hidden = !picking;
  el('confirm-step').hidden = !confirm;
  el('upload-progress-panel').hidden = !uploading;
  el('upload-result').hidden = !result;
  el('send').hidden = !picking || busy;
  el('upload-more').hidden = phase !== 'done' && phase !== 'error';
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
function uploadPicture(blob, index, hash) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); activeXhr = xhr;
    xhr.open('POST', '/file?batch=' + batch.id + '&index=' + index + '&key=' + encodeURIComponent(key));
    xhr.setRequestHeader('X-Picture-SHA256', hash); xhr.timeout = 180000;
    xhr.upload.onprogress = e => {
      if (uploadCanceled) return;
      if (e.lengthComputable) {
        const fraction = e.loaded / e.total;
        const total = Number(el('progress').max) || selected.length || 1;
        el('progress').value = (index + fraction) / total;
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

async function applyShipmentKey(nextKey, result) {
  if (nextKey !== key) {
    location.href = '/?key=' + encodeURIComponent(nextKey);
    return;
  }
  if (result?.company && result?.date) {
    setShipmentTitle(result.company, result.date);
    el('edit-company').value = result.company;
    el('edit-date').value = result.date;
  }
  el('shipment-edit').hidden = true;
  if (result?.strategy === 'created_new') {
    message('This shipment already had saved pictures, so a new shipment was created on the desktop. The previous shipment is unchanged.');
  } else if (result?.strategy === 'renamed_folder') {
    message('Shipment renamed on the desktop.');
  }
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
  el('progress').value = 0;
  goToPickStep();
  message('Returned to picture selection. Your pictures are still selected.');
}

async function resetAfterCancel() {
  await returnToPickFromUpload();
  message('Upload canceled');
}

function goToConfirmStep() {
  el('confirm-summary').textContent = selected.length + ' pictures to ' + (saveTarget || 'the desktop folder chosen on the PC') + '.';
  setPhase('confirm');
  message('');
}

el('back-to-photos').onclick = () => { goToPickStep(); };
el('back-to-photos-upload').onclick = () => { void returnToPickFromUpload(); };
el('cancel-upload').onclick = () => { void resetAfterCancel(); };
el('upload-more').onclick = () => {
  batch = null;
  el('progress').value = 0;
  goToPickStep();
  message(uiPhase === 'done' ? 'Shipment complete on the desktop. Ask for a reupload link to add more pictures.' : '');
};

el('retry-upload').onclick = () => { if (busy) return; void runUpload(); };

el('new-shipment-nav').onclick = () => showShipmentSetup('', todayLocalIso());
el('cancel-new-shipment').onclick = () => { showUploadView(); message(''); };
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

el('edit-shipment').onclick = () => {
  const parts = el('title').textContent.split(' · ');
  el('edit-company').value = parts[0] || '';
  el('edit-date').value = parts[1] || todayLocalIso();
  el('shipment-edit').hidden = false;
};
el('cancel-edit-shipment').onclick = () => { el('shipment-edit').hidden = true; };
el('save-shipment').onclick = async () => {
  try {
    const r = await api('/shipment/update', post({ company: el('edit-company').value, date: el('edit-date').value }));
    await applyShipmentKey(r.key, r);
  } catch (err) { message(err.message); }
};

el('send').onclick = () => { if (busy) return; goToConfirmStep(); };
el('confirm-upload').onclick = () => { if (busy) return; void runUpload(); };

async function ensureBatchOnServer(pending) {
  const files = pending.files.map(f => ({ name: f.name, size: f.size, hash: f.hash }));
  const body = {
    pallets: pending.pallets,
    files,
    batchId: pending.batchId || undefined
  };
  const created = await api('/batch', post(body));
  batch = created;
  if (created.id && created.id !== pending.batchId) await uploadQueue().setBatchId(created.id);
  if (created.uploadFolder) setSavingTo(created.uploadFolder);
  return created;
}

async function drainUploadQueue(resuming) {
  const Q = uploadQueue();
  if (!Q) throw Error('Upload queue is unavailable. Refresh and try again.');
  const pending = await Q.getPending();
  if (!pending) throw Error('No pictures are queued for upload.');
  if (pending.shipmentKey !== key) {
    location.href = '/?key=' + encodeURIComponent(pending.shipmentKey);
    return;
  }
  const { total, uploaded } = Q.pendingProgress(pending);
  el('progress').max = total;
  el('progress').value = uploaded / total;
  if (!batch) await ensureBatchOnServer(pending);
  if (window.isSecureContext && 'serviceWorker' in navigator && pending.uploadedIndices.length === 0) {
    try {
      await navigator.serviceWorker.register('/freight-sw.js', { scope: '/' });
      const reg = await navigator.serviceWorker.ready;
      if (reg.backgroundFetch) {
        const requests = pending.files.map((f, i) => new Request('/file?batch=' + batch.id + '&index=' + i + '&key=' + encodeURIComponent(key), {
          method: 'POST',
          headers: { 'X-Picture-SHA256': f.hash },
          body: f.blob
        }));
        const bg = await reg.backgroundFetch.fetch('freight-' + batch.id, requests, {
          title: 'Freight picture upload',
          downloadTotal: pending.files.reduce((n, f) => n + (f.size || 0), 0)
        });
        await new Promise((resolve, reject) => {
          const onSuccess = () => { cleanup(); resolve(); };
          const onFail = () => { cleanup(); reject(new Error('Background upload failed. Retry with the screen on.')); };
          const cleanup = () => {
            bg.removeEventListener('backgroundfetchsuccess', onSuccess);
            bg.removeEventListener('backgroundfetchfail', onFail);
          };
          bg.addEventListener('backgroundfetchsuccess', onSuccess);
          bg.addEventListener('backgroundfetchfail', onFail);
        });
        for (let i = 0; i < pending.files.length; i++) await Q.markIndexUploaded(i);
        batch = null;
        await Q.clearPending();
        setPhase('done');
        message('Complete: ' + total + ' pallet pictures verified and saved on the desktop. This shipment link is now closed.');
        return;
      }
    } catch { /* foreground upload */ }
  }
  for (let i = 0; i < pending.files.length; i++) {
    if (uploadCanceled) break;
    if (pending.uploadedIndices.includes(i)) continue;
    const fileRec = pending.files[i];
    message((resuming ? 'Resuming upload: ' : 'Uploading picture ') + (i + 1) + ' of ' + total + '…\n' + LEAVE_PAGE_HINT);
    await uploadPicture(fileRec.blob, i, fileRec.hash);
    if (uploadCanceled) break;
    await Q.markIndexUploaded(i);
    el('progress').value = (i + 1) / total;
  }
  if (uploadCanceled) return;
  message('Verifying every picture on the desktop…');
  finishAbort = new AbortController();
  await api('/finish?batch=' + batch.id, { method: 'POST', signal: finishAbort.signal });
  finishAbort = null;
  batch = null;
  await Q.clearPending();
  setPhase('done');
  message('Complete: ' + total + ' pallet pictures verified and saved on the desktop. This shipment link is now closed.');
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

async function maybeRedirectForPendingQueue() {
  const Q = uploadQueue();
  if (!Q) return false;
  const pending = await Q.getPending();
  if (!pending?.shipmentKey) return false;
  if (!key || key !== pending.shipmentKey) {
    location.href = '/?key=' + encodeURIComponent(pending.shipmentKey);
    return true;
  }
  return false;
}

async function resumePendingUploadIfAny(state) {
  const Q = uploadQueue();
  if (!Q || busy) return false;
  const pending = await Q.getPending();
  if (!pending || pending.shipmentKey !== key) return false;
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
  message('Resuming upload: ' + Math.min(uploaded + 1, total) + ' of ' + total + ' pictures\n' + LEAVE_PAGE_HINT);
  await runUpload(true);
  return true;
}

function tryResumeWhenIdle() {
  if (busy || !key) return;
  const Q = uploadQueue();
  if (!Q) return;
  void Q.getPending().then(pending => {
    if (!pending || pending.shipmentKey !== key) return;
    const { uploaded, total } = Q.pendingProgress(pending);
    if (uploaded >= total) return;
    void api('/state')
      .then(s => resumePendingUploadIfAny(s))
      .catch(() => { });
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tryResumeWhenIdle();
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
  if (await maybeRedirectForPendingQueue()) return;
  if (s.hubEntry || !key) {
    if (await resumePendingUploadIfAny(s)) return;
    clearActiveShipmentSession();
    showShipmentSetup('', todayLocalIso());
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
