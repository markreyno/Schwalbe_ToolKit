let pendingBatchRequest = null;
let desktopSavedIndices = new Set();
const key = new URLSearchParams(location.search).get('key');
const ACTIVE_SESSION_KEY = 'schwalbe-freight-phone-active';
const el = id => document.getElementById(id);
const uploadQueue = () => window.FreightUploadQueue;
let selected = [], batch = null, busy = false, mode = false, urls = [], activeXhr = null, uploadCanceled = false, finishAbort = null;
let saveTarget = '', uiPhase = 'pick', activeProgressPending = null, uploadSwReady = null, activeUploadChannel = 'page', swProgressListener = null;
let draftWriting = false, nextDraftId = 0, previewVersion = 0, previewQueue = Promise.resolve(), preparingSelection;
const draftIds = new WeakMap();
const portraitPhotos = new WeakMap();
let cardCompany = '', cardDateIso = '';

function pendingBytesApi() {
  const Q = uploadQueue();
  return Q ? { total: Q.pendingByteTotal, done: Q.pendingDoneBytes } : null;
}

/** Progress bar uses 0–100% from bytes uploaded / total bytes (works on Android Chrome). */
function setUploadProgressBytes(doneBytes, totalBytes) {
  const fill = el('upload-progress-fill');
  const track = el('upload-progress-track');
  const total = Math.max(1, Number(totalBytes) || 1);
  let done = Number(doneBytes);
  if (!Number.isFinite(done)) done = 0;
  const pct = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
  if (fill) fill.style.width = pct + '%';
  if (track) {
    track.setAttribute('aria-valuenow', String(pct));
    track.setAttribute('aria-valuetext', pct + '%');
  }
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

function uploadProgressLabel(pending) {
  const Q = uploadQueue();
  if (!Q || !pending) return '';
  const { total, uploaded } = Q.pendingProgress(pending);
  const next = Math.min(uploaded + 1, total);
  return uploaded >= total ? 'Verifying ' + total + ' saved pictures…' : 'Uploading picture ' + next + ' of ' + total + ' · ' + uploaded + ' saved on desktop';
}

function formatDisplayDate(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return Number(parts[1]) + '/' + Number(parts[2]) + '/' + parts[0];
}

function setUploadCardMeta(company, dateIso) {
  cardCompany = company || '';
  cardDateIso = dateIso || '';
  if (el('upload-company')) el('upload-company').textContent = cardCompany;
  if (el('upload-date')) el('upload-date').textContent = formatDisplayDate(cardDateIso);
}

function setUploadStatus(text) {
  if (el('upload-status')) el('upload-status').textContent = text || '';
}

function setUploadError(text) {
  const node = el('upload-error');
  if (!node) return;
  if (text) { node.hidden = false; node.textContent = text; }
  else { node.hidden = true; node.textContent = ''; }
}

function showBackgroundSyncNote() {
  const node = el('background-sync-note');
  if (node) node.hidden = false;
}

function hideBackgroundSyncNote() {
  const node = el('background-sync-note');
  if (node) node.hidden = true;
}

function setPickChromeVisible(visible) {
  if (el('pick-chrome')) el('pick-chrome').hidden = !visible;
}

function refreshUploadSessionChrome() {
  const done = uiPhase === 'done';
  const error = uiPhase === 'error';
  if (el('upload-done-mark')) el('upload-done-mark').hidden = !done;
  if (el('upload-cancel-link')) el('upload-cancel-link').hidden = done;
  if (el('upload-retry')) el('upload-retry').hidden = !error;
  if (el('upload-new-shipment')) el('upload-new-shipment').hidden = !done;
  if (el('upload-progress-fill')) el('upload-progress-fill').classList.toggle('is-done', done);
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
  setUploadCardMeta(company, date);
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
  const session = phase === 'uploading' || phase === 'done' || phase === 'error';
  el('capture-block').hidden = !picking;
  if (!picking) clearPreviews();
  el('upload-session').hidden = !session;
  setPickChromeVisible(picking);
  if (el('new-shipment-nav')) el('new-shipment-nav').hidden = !(picking || phase === 'error');
  el('send').hidden = !picking || busy;
  refreshUploadSessionChrome();
  if (session) message('');
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
  const timeout = AbortSignal.timeout(30000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const r = await fetch(route + keyQuery, { ...options, signal });
  const d = await r.json();
  if (!r.ok) { const error = Error(d.error || 'Upload failed'); error.status = r.status; throw error; }
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
  el('send').disabled = busy || draftWriting || !selected.length || selected.length > 26 || Number(el('pallets').value) !== selected.length || !el('confirm').checked;
}
function clearPreviews() {
  previewVersion++;
  el('previews').replaceChildren();
  urls.forEach(URL.revokeObjectURL);
  urls = [];
}

async function changeDraft(change) {
  draftWriting = true;
  document.querySelectorAll('.capture-actions input, .tile button').forEach(input => { input.disabled = true; });
  el('confirm').checked = false;
  valid();
  try { await change(); }
  catch { message('The browser could not save the draft for reload. You can still upload here.'); }
  finally {
    draftWriting = false;
    document.querySelectorAll('.capture-actions input').forEach(input => { input.disabled = false; });
    render();
  }
}

async function restoreDraft() {
  try {
    const draft = await uploadQueue().getDraft(key);
    if (!draft.length) return;
    selected = draft.map(({ id, file }) => { draftIds.set(file, id); return file; });
    nextDraftId = draft.at(-1).id + 1;
    el('pallets').value = selected.length;
    render();
    message('The page restarted. Your pictures are still here.');
  } catch { /* The picker still works if draft storage is unavailable. */ }
}

function render() {
  clearPreviews();
  const version = previewVersion;
  const jobs = selected.map(file => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    const placeholder = document.createElement('p');
    placeholder.textContent = 'Preview unavailable';
    const name = document.createElement('p');
    name.textContent = file.name;
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.onclick = () => {
      selected = selected.filter(item => item !== file);
      void changeDraft(() => uploadQueue().deleteDraft(key, draftIds.get(file)));
    };
    tile.append(placeholder, name, remove);
    el('previews').append(tile);
    return { file, placeholder };
  });
  previewQueue = previewQueue.then(async () => {
    for (const { file, placeholder } of jobs) {
      if (version !== previewVersion) return;
      try {
        const blob = await scaledJpeg(file, 320, .75);
        if (version !== previewVersion) return;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const image = document.createElement('img');
        image.alt = '';
        image.src = url;
        placeholder.replaceWith(image);
      } catch { /* Unsupported image formats keep their placeholder. */ }
    }
  });
  el('count').textContent = selected.length + ' pictures / ' + selected.length + ' pallets';
  valid();
}

for (const id of ['camera', 'files']) el(id).onchange = e => {
  const incoming = Array.from(e.target.files);
  e.target.value = '';
  if (!incoming.length || busy || draftWriting) return;
  if (selected.length + incoming.length > 26) {
    message('You can select up to 26 pictures per upload. Remove pictures before adding more.');
    return;
  }
  selected.push(...incoming);
  void changeDraft(async () => {
    let failure;
    for (const file of incoming) {
      const id = nextDraftId++;
      draftIds.set(file, id);
      try { await uploadQueue().saveDraft(key, id, file); }
      catch (error) { failure = error; }
    }
    if (failure) throw failure;
  });
};
el('pallets').oninput = valid;
el('confirm').onchange = valid;

// Use the browser's EXIF-aware decoding and ask it for reduced pixels.
async function scaledJpeg(file,limit,quality){
  let portrait=portraitPhotos.get(file);
  if(portrait===undefined){
    const probe=await createImageBitmap(file,{imageOrientation:'from-image',resizeWidth:64,resizeQuality:'low'});
    portrait=probe.height>probe.width;
    probe.close();
    portraitPhotos.set(file,portrait);
  }
  const bitmap=await createImageBitmap(file,{
    imageOrientation:'from-image',
    [portrait?'resizeHeight':'resizeWidth']:limit,
    resizeQuality:limit===320?'low':'high',
  });
  const canvas=document.createElement('canvas');
  try{
    const ratio=Math.min(1,limit/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));
    canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    canvas.getContext('2d',{alpha:false}).drawImage(bitmap,0,0,canvas.width,canvas.height);
    bitmap.close();
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>{
      if(blob)resolve(blob);else reject(Error('Could not resize picture'));
    },'image/jpeg',quality));
  }finally{bitmap.close();canvas.width=0;canvas.height=0}
}


const extensions={
  'image/jpeg':'jpg','image/png':'png','image/heic':'heic','image/heif':'heif',
  'image/webp':'webp','image/gif':'gif','image/bmp':'bmp','image/tiff':'tiff','image/avif':'avif',
};
async function inferExtension(file){
  const mime=Object.hasOwn(extensions,file.type)?extensions[file.type]:null;
  if(mime)return mime;
  const bytes=new Uint8Array(await file.slice(0,64).arrayBuffer());
  const ascii=(start,end)=>String.fromCharCode(...bytes.subarray(start,end));
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
  if(bytes[0]===137&&ascii(1,4)==='PNG')return 'png';
  if(/^GIF8[79]a$/.test(ascii(0,6)))return 'gif';
  if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'webp';
  if(ascii(0,2)==='BM')return 'bmp';
  if(ascii(0,4)==='II*\0'||ascii(0,4)==='MM\0*')return 'tiff';
  if(ascii(4,8)==='ftyp'){
    const size=new DataView(bytes.buffer).getUint32(0);
    const brands=[ascii(8,12)];
    for(let i=16;i+4<=Math.min(bytes.length,size);i+=4)brands.push(ascii(i,i+4));
    if(brands.some(brand=>/^(avif|avis)$/.test(brand)))return 'avif';
    if(brands.some(brand=>/^(hei[cxms]|hev[cxms])$/.test(brand)))return 'heic';
    if(brands.some(brand=>/^m[is]f1$/.test(brand)))return 'heif';
  }
  throw Error('Could not identify the format of '+file.name+'.');
}
async function prepareSelection(files) {
  await previewQueue;
  let resized = 0, skipped = 0;
  const attempted = new Set();
  const outgoing = [...files];
  async function resize(i) {
    if (uploadCanceled) throw Error('__canceled__');
    attempted.add(i);
    setUploadStatus('Preparing picture ' + (i + 1) + ' of ' + files.length);
    const file = files[i];
    let jpeg;
    try { jpeg = await scaledJpeg(file, 4000, .9); } catch { skipped++; return; }
    if (jpeg.size >= file.size) { skipped++; return; }
    outgoing[i] = new File([jpeg], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
    resized++;
  }
  for (let i = 0; i < files.length; i++) {
    if (files[i].size > 8 * 1024 * 1024) await resize(i);
  }
  if (outgoing.reduce((size, file) => size + file.size, 0) > 150 * 1024 * 1024) {
    for (let i = 0; i < files.length; i++) {
      if (!attempted.has(i)) await resize(i);
    }
  }
  for (let i = 0; i < outgoing.length; i++) {
    const file = outgoing[i];
    if (!/\.[^./\\]+$/.test(file.name)) {
      const extension = await inferExtension(file);
      outgoing[i] = new File([file], file.name + '.' + extension, { type: file.type, lastModified: file.lastModified });
    }
  }
  const resizeNote = [
    resized === 1 ? '1 large photo was resized for upload.' : resized ? resized + ' large photos were resized for upload.' : '',
    skipped ? 'Some photos could not be reduced and will upload at original quality.' : '',
  ].filter(Boolean).join(' ');
  return { files: outgoing, resizeNote };
}

async function sha256(file){
  const K=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
  const H=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];
  const rotate=(value,bits)=>(value>>>bits)|(value<<(32-bits));
  const words=new Uint32Array(64);
  function compress(view){
    for(let offset=0;offset<view.byteLength;offset+=64){
      for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);
      for(let i=16;i<64;i++){
        const first=words[i-15], second=words[i-2];
        const small0=rotate(first,7)^rotate(first,18)^(first>>>3);
        const small1=rotate(second,17)^rotate(second,19)^(second>>>10);
        words[i]=words[i-16]+small0+words[i-7]+small1;
      }
      let [a,b,c,d,e,f,g,h]=H;
      for(let i=0;i<64;i++){
        const sum1=rotate(e,6)^rotate(e,11)^rotate(e,25);
        const choose=(e&f)^(~e&g);
        const temp1=(h+sum1+choose+K[i]+words[i])>>>0;
        const sum0=rotate(a,2)^rotate(a,13)^rotate(a,22);
        const majority=(a&b)^(a&c)^(b&c);
        const temp2=(sum0+majority)>>>0;
        h=g;g=f;f=e;e=(d+temp1)>>>0;
        d=c;c=b;b=a;a=(temp1+temp2)>>>0;
      }
      const values=[a,b,c,d,e,f,g,h];
      for(let i=0;i<8;i++)H[i]=(H[i]+values[i])>>>0;
    }
  }
  const chunkSize=256*1024;
  for(let offset=0;offset<file.size;offset+=chunkSize){
    const bytes=new Uint8Array(await file.slice(offset,offset+chunkSize).arrayBuffer());
    const aligned=bytes.length-bytes.length%64;
    compress(new DataView(bytes.buffer,0,aligned));
    if(offset+bytes.length===file.size)finish(bytes.subarray(aligned));
  }
  if(!file.size)finish(new Uint8Array());
  function finish(tail){
    const padded=new Uint8Array(tail.length<56?64:128);
    padded.set(tail);padded[tail.length]=128;
    const view=new DataView(padded.buffer);
    view.setUint32(padded.length-8,Math.floor(file.size/536870912));
    view.setUint32(padded.length-4,file.size*8);
    compress(view);
  }
  return H.map(x=>x.toString(16).padStart(8,'0')).join('');
}
function hashPicture(file){
  return new Promise((resolve,reject)=>{
    const source=sha256.toString()+";onmessage=async({data})=>{try{postMessage({hash:await sha256(data)})}catch(e){postMessage({error:e.message})}}";
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    let worker;
    try{worker=new Worker(url)}finally{URL.revokeObjectURL(url)}
    worker.onmessage=({data})=>{
      worker.terminate();
      if(data.error)reject(Error(data.error));else resolve(data.hash);
    };
    worker.onerror=()=>{worker.terminate();reject(Error('Could not calculate the picture checksum.'))};
    try{worker.postMessage(file)}catch(e){worker.terminate();reject(e)}
  });
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
    let lastProgressAt = Date.now(), desktopConfirmed = false, stalled = false;
    const watchdog = setInterval(() => {
      if (uploadCanceled) return;
      desktopConfirmed = desktopSavedIndices.has(index);
      stalled = Date.now() - lastProgressAt > 20000;
      if (desktopConfirmed || stalled) xhr.abort();
    }, 1000);
    const cleanup = () => { clearInterval(watchdog); if (activeXhr === xhr) activeXhr = null; };
    xhr.open('POST', '/file?batch=' + batch.id + '&index=' + index + '&key=' + encodeURIComponent(key));
    xhr.setRequestHeader('X-Picture-SHA256', hash);
    xhr.setRequestHeader('X-Freight-Upload-Channel', 'page');
    xhr.timeout = 180000;
    xhr.upload.onprogress = e => {
      if (uploadCanceled) return;
      lastProgressAt = Date.now();
      if (e.lengthComputable && e.total > 0) {
        syncProgressFromPending(pending, e.loaded);
        setUploadStatus(uploadProgressLabel(pending));
      }
    };
    xhr.onload = () => {
      cleanup();
      if (uploadCanceled) { reject(Error('__canceled__')); return; }
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status === 410 && result.canceled) {
          uploadCanceled = true;
          void uploadQueue()?.clearPending();
          reject(Error('__canceled__'));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) throw Error(result.error || 'Upload failed');
        resolve(result);
      } catch (e) { reject(e); }
    };
    xhr.onabort = () => {
      cleanup();
      if (desktopConfirmed && !uploadCanceled) { resolve({ saved: true }); return; }
      const error = Error(stalled ? 'Upload stalled. Reconnecting…' : '__canceled__');
      error.retryable = stalled;
      reject(error);
    };
    xhr.onerror = () => { cleanup(); reject(uploadCanceled ? Error('__canceled__') : Error('Connection interrupted. Check Wi-Fi and keep the toolkit open.')); };
    xhr.ontimeout = () => { cleanup(); reject(Error('Upload timed out. Retry the upload.')); };
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
  const Q = uploadQueue();
  await preparingSelection?.catch(() => {});
  const pending = Q ? await Q.getPending() : null;
  // A batch request may already have reached the desktop. Wait for its ID before canceling.
  await pendingBatchRequest?.catch(() => {});
  const b = batch;
  await Q?.clearPending();
  if (pending && b?.id) {
    try {
      const reg = await ensureUploadServiceWorker();
      const bf = reg?.backgroundFetch;
      if (bf?.get) {
        const id = backgroundFetchRegistrationId(b.id, pending);
        const item = await bf.get(id);
        await item?.abort?.();
      }
    } catch { /* ignore */ }
  }
  try {
    if (b) await api('/cancel?batch=' + encodeURIComponent(b.id), { method: 'POST' });
    else await api('/cancel-active', { method: 'POST' });
  } catch (e) {
    busy = false;
    throw e;
  }
  batch = null;
  busy = false;
}

function resetSendButton() {
  el('send').textContent = mode ? 'Reupload All' : 'Upload All';
}

function goToPickStep() {
  setCaptureDisabled(false);
  setUploadError('');
  setPhase('pick');
  resetSendButton();
  render();
  message('');
}

async function returnToPickFromUpload() {
  await abortActiveBatch();
  resetUploadProgress();
  goToPickStep();
  message('Returned to picture selection. Your pictures are still selected.');
}

async function resetAfterCancel() {
  try {
    await returnToPickFromUpload();
    message('Upload canceled');
    return true;
  } catch (e) {
    setPhase('error');
    setUploadError('Desktop cleanup could not be confirmed. Check the connection and tap Cancel upload again. ' + e.message);
    if (el('upload-retry')) el('upload-retry').hidden = true;
    message('Cancel upload failed. Desktop files may remain.');
    return false;
  }
}

el('upload-cancel-link').onclick = () => { void resetAfterCancel(); };

el('upload-retry').onclick = () => { if (busy) return; setUploadError(''); void uploadQueue().getPending().then(pending => runUpload(pending?.shipmentKey === key)); };

el('upload-new-shipment').onclick = () => showShipmentSetup('', todayLocalIso());

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
  if (uploadCanceled) throw Error('__canceled__');
  pendingBatchRequest = api('/batch', post(body));
  let created;
  try { created = await pendingBatchRequest; } finally { pendingBatchRequest = null; }
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

async function reattachOrCleanupBackgroundFetches(pending) {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await ensureUploadServiceWorker();
    const bf = reg?.backgroundFetch;
    if (!bf?.getIds) return null;
    const ids = await bf.getIds();
    for (const id of ids) {
      if (String(id).startsWith('freight-')) {
        const item = await bf.get(id);
        if (!item) continue;
        const expectedId = pending ? backgroundFetchRegistrationId(pending.batchId, pending) : null;
        if (expectedId && id === expectedId) {
          return item;
        }
        await item.abort?.();
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function prepareUploadQueueOnLoad() {
  const Q = uploadQueue();
  if (!Q?.repairAndLoadPending) return { pending: null, notice: '', backgroundFetch: null };
  const result = await Q.repairAndLoadPending();
  const backgroundFetch = result.pending ? await reattachOrCleanupBackgroundFetches(result.pending) : null;
  return { ...result, backgroundFetch };
}

function showCompletedUpload(shipment, total) {
  showUploadView();
  if (shipment) { setShipmentTitle(shipment.company, shipment.date); setSavingTo(shipment.saveTarget); }
  batch = null;
  setUploadError('');
  setPhase('done');
  setUploadProgressBytes(1, 1);
  setUploadStatus('Done, ' + (total || shipment?.pictures || 0) + ' pictures uploaded');
  selected = [];
  void uploadQueue()?.deleteDraft(key).catch(() => {});
}

async function reconcilePendingWithDesktop(pending, state) {
  if (uploadCanceled || (pending && pending.shipmentKey !== key)) return pending;
  const s = state || await api('/state');
  if (uploadCanceled) return null;
  if (s.shipment?.closed) {
    await uploadQueue().clearPending();
    showCompletedUpload(s.shipment, pending?.files?.length || activeProgressPending?.files?.length);
    return null;
  }
  if (!pending) return null;
  const saved = s.shipment?.uploadBatch;
  if (saved && saved.id === pending.batchId) {
    batch = { id: saved.id };
    desktopSavedIndices = new Set(saved.savedIndices);
    await uploadQueue().mergeUploadedIndices(saved.savedIndices, saved.id);
    pending = await uploadQueue().getPending();
  }
  return pending;
}

async function syncUploadProgressFromQueue() {
  if (uploadCanceled || uiPhase === 'done') return;
  const Q = uploadQueue();
  if (!Q) return;
  let pending = await Q.getPending();
  if (pending && pending.shipmentKey !== key) return;
  pending = await reconcilePendingWithDesktop(pending);
  if (!pending || uploadCanceled) return;
  syncProgressFromPending(pending, 0);
  setUploadStatus(uploadProgressLabel(pending));
}

// Background Fetch completion is delivered to the service worker, not reliably to
// a page registration. Poll desktop acknowledgments so missing events cannot hang UI.
async function waitForBackgroundUpload(bg, pending) {
  let changedAt = Date.now(), previous = -1;
  while (!uploadCanceled) {
    pending = await reconcilePendingWithDesktop(await uploadQueue().getPending());
    if (!pending) { if (uiPhase === 'done' || uploadCanceled) return true; throw Error('Upload queue unavailable. Retry to check desktop completion.'); }
    const { uploaded, remaining } = uploadQueue().pendingProgress(pending);
    syncProgressFromPending(pending, 0);
    setUploadStatus(uploadProgressLabel(pending));
    if (!remaining) return true;
    if (uploaded !== previous) { previous = uploaded; changedAt = Date.now(); }
    if (Date.now() - changedAt > 15000) { await bg.abort?.(); return false; }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

function backgroundFetchRegistrationId(batchId, pending) {
  const remaining = uploadQueue()?.remainingIndices(pending) || [];
  return 'freight-' + batchId + (remaining.length ? '-' + remaining.join('.') : '');
}

async function ensureServiceWorkerController() {
  if (!('serviceWorker' in navigator)) return false;
  if (navigator.serviceWorker.controller) return true;
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(false), 5000);
    const onControllerChange = () => {
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      resolve(true);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  });
}

async function tryUploadRemainingViaBackgroundFetch(pending, batchId, resuming) {
  const Q = uploadQueue();
  const remaining = Q.remainingIndices(pending);
  if (!remaining.length) return { success: false, reason: 'no-remaining-files' };
  const probe = await probeBackgroundUploadSupport();
  try {
    if (probe.backgroundFetchPermission !== 'granted') {
      const error = 'Background Fetch permission not granted';
      await reportBackgroundFetchDiagnostics({ ...probe, error, channel: 'none' });
      return { success: false, reason: 'permission-not-granted', error, probe };
    }
    if (!probe.controller && !(await ensureServiceWorkerController())) {
      const error = 'Service worker is not controlling the page';
      await reportBackgroundFetchDiagnostics({ ...probe, error, channel: 'none' });
      return { success: false, reason: 'no-controller', error, probe };
    }
    const reg = await registerServiceWorkerForUploads();
    const bf = reg?.backgroundFetch;
    if (!bf || typeof bf.fetch !== 'function') {
      const error = 'Background Fetch API is not available';
      await reportBackgroundFetchDiagnostics({ ...probe, error, channel: 'none' });
      return { success: false, reason: 'no-api', error, probe };
    }
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
    await reportBackgroundFetchDiagnostics({ ...probe, error: null, channel: 'background-fetch' });
    activeBackgroundFetch = bg;
    const resumeLabel = resuming && isResumeUpload(pending);
    setUploadStatus(resumeLabel ? uploadProgressLabel(pending) : uploadProgressLabel(pending));
    const onProgress = () => {
      if (uploadCanceled) return;
      const bytesTotal = Math.max(1, bg.downloadTotal || downloadTotal);
      const byteFraction = Math.min(1, (bg.uploaded || 0) / bytesTotal);
      const remainingBytes = remaining.reduce((n, i) => n + (pending.files[i].size || 0), 0);
      syncProgressFromPending(pending, Math.round(remainingBytes * byteFraction));
    };
    bg.addEventListener('backgroundfetchprogress', onProgress);
    onProgress();
    let completed;
    try { completed = await waitForBackgroundUpload(bg, pending); }
    finally { bg.removeEventListener('backgroundfetchprogress', onProgress); activeBackgroundFetch = null; }
    return { success: completed, reason: completed ? 'saved' : 'stalled' };
  } catch (e) {
    const error = e.message || 'Unknown error';
    await reportBackgroundFetchDiagnostics({ ...probe, error, channel: 'none' });
    return { success: false, reason: 'exception', error, probe };
  }
}

async function reportBackgroundFetchDiagnostics(data) {
  if (!batch?.id) return;
  try {
    await api('/batch', post({ batchId: batch.id, backgroundFetchDiagnostics: data }));
  } catch { /* diagnostics reporting is best-effort */ }
}

async function waitForServiceWorkerQueueDrain(pending, actuallyResuming) {
  const Q = uploadQueue();
  let stalledAt = Date.now(), lastNudgeAt = 0;
  let lastUploaded = Q.pendingProgress(pending).uploaded;
  notifyServiceWorkerToContinueUploads();
  while (!uploadCanceled) {
    pending = await reconcilePendingWithDesktop(await Q.getPending());
    if (!pending && uiPhase === 'done') return null;
    if (!pending || pending.shipmentKey !== key) throw Error('Upload queue was cleared.');
    syncProgressFromPending(pending, 0);
    const { uploaded, remaining } = Q.pendingProgress(pending);
    if (remaining === 0) return pending;
    setUploadStatus(actuallyResuming ? uploadProgressLabel(pending) : uploadProgressLabel(pending));
    if (uploaded > lastUploaded) {
      lastUploaded = uploaded;
      stalledAt = Date.now();
    } else if (Date.now() - stalledAt > 15000) {
      break;
    } else if (Date.now() - lastNudgeAt > 5000) {
      notifyServiceWorkerToContinueUploads();
      lastNudgeAt = Date.now();
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return Q.getPending();
}

async function uploadRemainingViaPageXHR(pending, actuallyResuming) {
  const Q = uploadQueue();
  await reportUploadChannel('page');
  for (let i = 0; i < pending.files.length; i++) {
    if (uploadCanceled || uiPhase === 'done') return;
    pending = await Q.getPending();
    if (!pending) return;
    if (pending.uploadedIndices.includes(i)) continue;
    const fileRec = Q.materializeFile(pending.files[i]);
    setUploadStatus(uploadProgressLabel(pending));
    for (let attempt = 0; ; attempt++) {
      try { await uploadPicture(fileRec.blob, i, fileRec.hash, pending); break; }
      catch (e) {
        if (!e.retryable || uploadCanceled || attempt >= 2) throw e;
        pending = await reconcilePendingWithDesktop(await Q.getPending());
        if (!pending || uploadCanceled) return;
        if (pending.uploadedIndices.includes(i)) break;
      }
    }
    if (uploadCanceled) break;
    await Q.markIndexUploaded(i, pending.batchId);
    pending = await Q.getPending();
    syncProgressFromPending(pending, 0);
  }
}

async function finalizeVerifiedUpload(pending) {
  if (uploadCanceled || uiPhase === 'done') return;
  pending = await reconcilePendingWithDesktop(pending);
  if (!pending || uploadCanceled) return;
  setUploadStatus('Verifying pictures…');
  finishAbort = new AbortController();
  try {
    await api('/finish?batch=' + batch.id, { method: 'POST', signal: finishAbort.signal });
  } catch (e) {
    if (e.status === 410 || (e.message && e.message.includes('canceled'))) {
      uploadCanceled = true;
      await uploadQueue()?.clearPending();
      throw Error('__canceled__');
    }
    throw e;
  }
  finishAbort = null;
  batch = null;
  await uploadQueue().clearPending();
  const bytesApi = pendingBytesApi();
  if (pending && bytesApi) setUploadProgressBytes(bytesApi.total(pending), bytesApi.total(pending));
  const total = pending?.files?.length || 0;
  setUploadError('');
  setPhase('done');
  setUploadStatus('Done, ' + total + ' pictures uploaded');
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
  if (probe.backgroundFetchPermission === 'denied' || probe.backgroundFetchPermission === 'prompt') {
    showBackgroundSyncNote();
  }
  if (uploadCanceled) return;
  pending = await reconcilePendingWithDesktop(pending);
  if (!pending || uploadCanceled) return;
  if (!batch) await ensureBatchOnServer(pending, 'page');
  if (uploadCanceled) return;
  pending = await Q.getPending();
  const bgFetchResult = await tryUploadRemainingViaBackgroundFetch(pending, batch.id, actuallyResuming);
  if (bgFetchResult.success) {
    if (uploadCanceled || uiPhase === 'done') return;
    pending = await Q.getPending();
    await finalizeVerifiedUpload(pending);
    return;
  }
  const preferServiceWorkerDrain = probe.installedPwa;
  if (preferServiceWorkerDrain) {
    await reportUploadChannel('service-worker');
    try {
      const reg = await ensureUploadServiceWorker();
      if (reg?.sync?.register) await reg.sync.register('freight-upload-continue');
    } catch { /* Background Sync is optional */ }
    notifyServiceWorkerToContinueUploads();
    pending = await waitForServiceWorkerQueueDrain(pending, actuallyResuming);
    if (uploadCanceled || uiPhase === 'done') return;
  }
  if (Q.pendingProgress(pending).remaining > 0) {
    if (!preferServiceWorkerDrain) await reportUploadChannel('page');
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
  desktopSavedIndices = new Set();
  busy = true;
  valid();
  setPhase('uploading');
  setCaptureDisabled(true);
  setUploadError('');
  hideBackgroundSyncNote();
  if (!resuming) el('resize-note').textContent = '';
  try {
    const Q = uploadQueue();
    if (!Q) throw Error('Upload queue is unavailable. Refresh and try again.');
    if (!resuming) {
      preparingSelection = (async () => {
        const { files, resizeNote } = await prepareSelection(selected);
        if (uploadCanceled) throw Error('__canceled__');
        el('resize-note').textContent = resizeNote;
        await Q.createFromSelection({
          shipmentKey: key,
          pallets: Number(el('pallets').value),
          files,
          resizeNote,
          hashFile: file => {
            if (uploadCanceled) throw Error('__canceled__');
            return hashPicture(file);
          }
        });
      })();
      try { await preparingSelection; } finally { preparingSelection = null; }
      const pending = await Q.getPending();
      syncProgressFromPending(pending, 0);
      setUploadStatus(uploadProgressLabel(pending));
    } else {
      const pending = await Q.getPending();
      syncProgressFromPending(pending, 0);
      setUploadStatus(uploadProgressLabel(pending));
    }
    if (uploadCanceled) { await Q.clearPending(); return; }
    await drainUploadQueue(!!resuming);
  } catch (e) {
    if (uploadCanceled || uiPhase === 'done') return; // The cancel handler owns cleanup confirmation and UI.
    if (e.name === 'AbortError' || e.message === '__canceled__') {
      setPhase('pick');
      resetSendButton();
      valid();
      message('Upload canceled');
      return;
    }
    setPhase('error');
    const Q = uploadQueue();
    const pending = Q ? await Q.getPending().catch(() => null) : null;
    setUploadError(e.message);
    setUploadStatus(pending ? uploadProgressLabel(pending) : 'Upload failed');
    if (/expired|not a valid image/.test(e.message)) batch = null;
  } finally {
    finishAbort = null;
    busy = false;
    if (!batch && uiPhase !== 'done') setCaptureDisabled(false);
    if (uiPhase === 'pick') valid();
  }
}

async function reattachBackgroundFetchProgress(bg, pending) {
  activeBackgroundFetch = bg;
  busy = true;
  setPhase('uploading');
  try {
    await waitForBackgroundUpload(bg, pending);
    if (uploadCanceled || uiPhase === 'done') return;
    pending = await uploadQueue().getPending();
    if (uploadQueue().pendingProgress(pending).remaining) await uploadRemainingViaPageXHR(pending, true);
    await finalizeVerifiedUpload(await uploadQueue().getPending());
  } catch (e) { if (!uploadCanceled) { setPhase('error'); setUploadError(e.message); } }
  finally { activeBackgroundFetch = null; busy = false; }
}

async function resumePendingUploadIfAny(state, backgroundFetch) {
  const Q = uploadQueue();
  if (!Q || busy || !key) return false;
  const pending = await Q.getPending();
  if (!pending || pending.shipmentKey !== key) return false;
  if (!Q.shouldAutoResumeUpload(pending)) return false;
  const { total, uploaded } = Q.pendingProgress(pending);
  // A full queue still needs /finish verification, including after a refresh.
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
  el('resize-note').textContent = pending.resizeNote || '';
  setUploadStatus(uploadProgressLabel(pending));
  if (backgroundFetch) {
    busy = true;
    await reattachBackgroundFetchProgress(backgroundFetch, pending);
    return true;
  }
  await runUpload(true);
  return true;
}

function tryResumeWhenIdle() {
  if (busy || !key) return;
  const Q = uploadQueue();
  if (!Q) return;
  void Q.getPending().then(async pending => {
    if (!pending || pending.shipmentKey !== key) return;
    if (!Q.shouldAutoResumeUpload(pending)) return;
    const { uploaded, total } = Q.pendingProgress(pending);

    const backgroundFetch = await reattachOrCleanupBackgroundFetches(pending);
    void api('/state')
      .then(s => resumePendingUploadIfAny(s, backgroundFetch))
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
      setUploadStatus('Done, shipment pictures uploaded');
    }
  } catch { /* ignore */ }
}

let activeBackgroundFetch = null;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (busy && batch) {
      if (activeBackgroundFetch) {
        activeXhr?.abort();
      }
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
    if (queuePrep.pending?.shipmentKey === key) await uploadQueue().clearPending();
    showCompletedUpload(s.shipment);
  } else {
    if (await resumePendingUploadIfAny(s, queuePrep.backgroundFetch)) return;
    showUploadView();
    markActiveShipmentSession();
    setShipmentTitle(s.shipment.company, s.shipment.date);
    mode = s.shipment.reupload;
    setSavingTo(s.shipment.saveTarget);
    el('mode').textContent = mode ? 'Reupload: new pictures will be added; existing pictures are preserved.' : 'Collect your pictures, then confirm the pallet amount.';
    el('send').textContent = mode ? 'Reupload All' : 'Upload All';
    setPhase('pick');
    await restoreDraft();
    setInterval(() => { void refreshSaveTarget(); }, 5000);
  }
}).catch(e => message(e.message));

let progressPollBusy = false;
setInterval(async () => {
  if (!busy || uploadCanceled || document.visibilityState === 'hidden' || progressPollBusy) return;
  progressPollBusy = true;
  try { await syncUploadProgressFromQueue(); } catch { /* retry next poll */ }
  finally { progressPollBusy = false; }
}, 2000);
