/* global indexedDB, MediaRecorder, FormData, Blob */
let db;
let deviceToken;
let currentCapture = null;
let uploadQueue = [];
let activeUploadXhr = null;
let activeUploadCaptureId = null;
let uploadProgressPct = 0;
let queueRunnerPromise = null;
let cancelUploadRequested = false;
let stream = null;
let mediaRecorder = null;
let recordedChunks = [];

const UPLOADABLE = new Set(['queued']);
const ACTIVE_STATUSES = new Set(['uploading', 'pending-active']);

const el = (id) => document.getElementById(id);

function message(text, error = false) {
  el('message').textContent = text;
  el('message').className = error ? 'error' : '';
}

function isServerBusyMessage(text) {
  return /being processed|wait for active upload/i.test(text || '');
}

async function fetchUploadIdle() {
  const r = await fetch('/api/health', {
    headers: deviceToken ? { Authorization: 'Bearer ' + deviceToken } : {}
  });
  if (!r.ok) return false;
  const d = await r.json();
  return d.uploadBusy === false;
}

async function waitForServerUploadIdle(maxMs = 65000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      if (await fetchUploadIdle()) return true;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

function dbPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txPromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

async function initDB() {
  const req = indexedDB.open('PalletVision', 1);
  req.onupgradeneeded = (e) => {
    const database = e.target.result;
    if (!database.objectStoreNames.contains('captures')) {
      database.createObjectStore('captures', { keyPath: 'captureId' });
    }
    if (!database.objectStoreNames.contains('queue')) {
      database.createObjectStore('queue', { keyPath: 'captureId' });
    }
  };
  return dbPromise(req);
}

async function pair() {
  if (deviceToken) return;
  try {
    const r = await fetch('/api/pair', { method: 'POST' });
    const d = await r.json();
    deviceToken = d.deviceToken;
    localStorage.setItem('palletvision-device-token', deviceToken);
    message('Device paired successfully.');
  } catch (e) {
    message('Pairing failed: ' + e.message, true);
  }
}

function normalizeQueueItem(item) {
  if (!item || !item.captureId) return null;
  if (item.status === 'uploaded') return null;
  if (!item.status) {
    item.status = 'queued';
  }
  if (!UPLOADABLE.has(item.status) && !ACTIVE_STATUSES.has(item.status)) {
    item.status = 'queued';
  }
  return item;
}

function normalizeQueueOnLoad(rawItems) {
  const byId = new Map();
  for (const raw of rawItems) {
    const item = normalizeQueueItem(raw);
    if (!item) continue;
    const existing = byId.get(item.captureId);
    if (!existing) {
      byId.set(item.captureId, item);
      continue;
    }
    const existingAt = Date.parse(existing.capturedAt || '') || 0;
    const itemAt = Date.parse(item.capturedAt || '') || 0;
    if (itemAt >= existingAt) byId.set(item.captureId, item);
  }

  const list = Array.from(byId.values());
  let sawActive = false;
  for (const item of list) {
    if (ACTIVE_STATUSES.has(item.status) || item.status === 'uploading') {
      item.status = 'queued';
      if (!sawActive) sawActive = true;
    }
  }
  return list;
}

async function persistQueueItem(item) {
  const tx = db.transaction('queue', 'readwrite');
  tx.objectStore('queue').put(item);
  await txPromise(tx);
}

async function removeCaptureFromStorage(captureId) {
  const tx = db.transaction(['captures', 'queue'], 'readwrite');
  tx.objectStore('captures').delete(captureId);
  tx.objectStore('queue').delete(captureId);
  await txPromise(tx);
}

async function loadQueue() {
  const tx = db.transaction('queue', 'readonly');
  const raw = await dbPromise(tx.objectStore('queue').getAll());
  uploadQueue = normalizeQueueOnLoad(raw);
  const staleIds = raw
    .map((item) => item?.captureId)
    .filter((id) => id && !uploadQueue.some((q) => q.captureId === id));
  if (staleIds.length) {
    const cleanTx = db.transaction(['captures', 'queue'], 'readwrite');
    for (const id of staleIds) {
      cleanTx.objectStore('queue').delete(id);
      cleanTx.objectStore('captures').delete(id);
    }
    await txPromise(cleanTx);
  }
  for (const item of uploadQueue) {
    if (ACTIVE_STATUSES.has(item.status)) item.status = 'queued';
    await persistQueueItem(item);
  }
  renderQueue();
  scheduleProcessQueue();
}

function setUploadProgress(pct) {
  uploadProgressPct = pct;
  el('upload-progress-fill').style.width = pct + '%';
  el('upload-progress-label').textContent = pct > 0 ? 'Uploading… ' + pct + '%' : 'Uploading…';
}

function showUploadActive(show) {
  el('upload-active').hidden = !show;
  if (!show) {
    setUploadProgress(0);
    if (!activeUploadXhr) {
      activeUploadCaptureId = null;
    }
  }
}

function hasActiveUpload() {
  return uploadQueue.some((item) => ACTIVE_STATUSES.has(item.status));
}

function nextUploadCandidate() {
  return uploadQueue.find((item) => UPLOADABLE.has(item.status));
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderQueue() {
  const q = el('queue');
  q.innerHTML = '';
  const visible = uploadQueue.filter((item) => item.status !== 'uploaded');
  if (!visible.length) {
    q.innerHTML = '<p style="font-size: 12px; color: #7b8694">No pending uploads.</p>';
    return;
  }
  visible.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'item';
    const status = item.status || 'queued';
    const progress = status === 'uploading' && uploadProgressPct > 0 ? ' · ' + uploadProgressPct + '%' : '';
    const idAttr = escapeHtml(item.captureId).replace(/'/g, '&#39;');
    const actions = [];
    if (status === 'failed' || status === 'canceled') {
      actions.push('<button type="button" class="secondary queue-action" onclick="window.retryUpload(\'' + idAttr + '\')">Retry</button>');
    } else if (status === 'pending') {
      actions.push('<button type="button" class="secondary queue-action" onclick="window.retryUpload(\'' + idAttr + '\')">Upload now</button>');
    }
    actions.push('<button type="button" class="secondary queue-action danger" onclick="window.deleteCapture(\'' + idAttr + '\')">Delete</button>');
    div.innerHTML =
      '<div class="status status-' + escapeHtml(status) + '">' + escapeHtml(status.toUpperCase()) + progress + '</div>' +
      '<div>Capture ' + escapeHtml(item.captureId) + ' · ' + item.heightInches + '"H × ' + item.widthInches + '"W × ' + item.lengthInches + '"L</div>' +
      '<div class="item-actions">' + actions.join('') + '</div>';
    q.appendChild(div);
  });
}

el('cancel-upload').onclick = () => {
  cancelUploadRequested = true;
  if (activeUploadXhr) activeUploadXhr.abort();
};

async function loadPallets() {
  try {
    const r = await fetch('/api/health', {
      headers: deviceToken ? { 'Authorization': 'Bearer ' + deviceToken } : {}
    });
    const d = await r.json();
    message('Connected to desktop. ' + d.palletCount + ' pallets stored.');
  } catch {
    message('Desktop offline. Uploads will queue locally.', true);
  }
}

el('new-pallet').onclick = () => {
  currentCapture = {
    captureId: 'cap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    capturedAt: new Date().toISOString()
  };
  el('home').hidden = true;
  el('record').hidden = false;
};

el('upload-video-btn').onclick = () => {
  el('video-file-input').click();
};

el('video-file-input').onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('video/')) {
    message('Please select a video file.', true);
    return;
  }

  if (file.size > 500 * 1024 * 1024) {
    message('Video file is too large (max 500MB).', true);
    return;
  }

  currentCapture = {
    captureId: 'cap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    capturedAt: new Date().toISOString()
  };

  recordedChunks = [file];

  el('playback').src = URL.createObjectURL(file);
  el('playback').hidden = false;
  el('review-actions').hidden = false;
  el('start-record').hidden = true;

  el('home').hidden = true;
  el('record').hidden = false;

  message('Video loaded. Review and continue to measurements.');
  e.target.value = '';
};

el('start-record').onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    el('camera-preview').srcObject = stream;
    el('camera-preview').style.display = 'block';
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      el('playback').src = URL.createObjectURL(blob);
      el('camera-preview').style.display = 'none';
      el('review-actions').hidden = false;
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    mediaRecorder.start();
    el('start-record').hidden = true;
    el('stop-record').hidden = false;
    message('Recording... Keep the entire pallet visible.');
  } catch (e) {
    message('Camera access denied: ' + e.message, true);
  }
};

el('stop-record').onclick = () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    el('stop-record').hidden = true;
    el('playback').hidden = false;
  }
};

el('retake').onclick = () => {
  el('playback').hidden = true;
  el('review-actions').hidden = true;
  el('start-record').hidden = false;
  recordedChunks = [];
  el('playback').src = '';
};

el('continue').onclick = () => {
  el('record').hidden = true;
  el('measure').hidden = false;
};

el('back').onclick = () => {
  el('measure').hidden = true;
  el('record').hidden = false;
};

el('save').onclick = async () => {
  const h = parseFloat(el('height').value);
  const w = parseFloat(el('width').value);
  const l = parseFloat(el('length').value);
  if (!h || h <= 0 || !w || w <= 0 || !l || l <= 0) {
    message('Enter valid positive dimensions.', true);
    return;
  }
  if (recordedChunks.length === 0) {
    message('No video recorded.', true);
    return;
  }

  const videoBlob = recordedChunks[0] instanceof File
    ? recordedChunks[0]
    : new Blob(recordedChunks, { type: 'video/webm' });

  const capture = {
    ...currentCapture,
    heightInches: h,
    widthInches: w,
    lengthInches: l,
    notes: el('notes').value,
    referenceId: el('reference').value,
    videoBlob: videoBlob,
    status: 'queued'
  };

  const tx = db.transaction(['captures', 'queue'], 'readwrite');
  tx.objectStore('captures').put(capture);
  tx.objectStore('queue').put(capture);
  tx.oncomplete = () => {
    uploadQueue.push(capture);
    message('Pallet saved locally. Queued for upload.');
    el('measure').hidden = true;
    el('home').hidden = false;
    el('height').value = '';
    el('notes').value = '';
    el('reference').value = '';
    renderQueue();
    scheduleProcessQueue();
  };
};

function uploadCapture(item) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('captureId', item.captureId);
    formData.append('heightInches', item.heightInches);
    formData.append('widthInches', item.widthInches);
    formData.append('lengthInches', item.lengthInches);
    if (item.notes) formData.append('notes', item.notes);
    if (item.referenceId) formData.append('referenceId', item.referenceId);
    formData.append('capturedAt', item.capturedAt);

    const videoExt = item.videoBlob.type === 'video/mp4' ? 'mp4' : 'webm';
    formData.append('video', item.videoBlob, 'video.' + videoExt);

    const xhr = new XMLHttpRequest();
    activeUploadXhr = xhr;
    activeUploadCaptureId = item.captureId;
    xhr.open('POST', '/api/pallets/upload');
    xhr.setRequestHeader('Authorization', 'Bearer ' + deviceToken);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && activeUploadXhr === xhr) {
        const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
        setUploadProgress(pct);
        renderQueue();
      }
    };
    const clearActiveXhr = () => {
      if (activeUploadXhr === xhr) {
        activeUploadXhr = null;
        activeUploadCaptureId = null;
      }
    };
    xhr.onload = () => {
      clearActiveXhr();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err);
        }
      } else {
        let detail = xhr.statusText;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body.error) detail = body.error;
        } catch { /* ignore */ }
        reject(new Error('Upload failed: ' + detail));
      }
    };
    xhr.onerror = () => {
      clearActiveXhr();
      reject(new Error('Upload failed: network error'));
    };
    xhr.onabort = () => {
      clearActiveXhr();
      reject(new DOMException('Upload canceled', 'AbortError'));
    };
    if (cancelUploadRequested) {
      clearActiveXhr();
      reject(new DOMException('Upload canceled', 'AbortError'));
      return;
    }
    xhr.send(formData);
  });
}

function queueItemStillPresent(captureId) {
  return uploadQueue.some((item) => item.captureId === captureId);
}

async function processQueue() {
  if (queueRunnerPromise) return queueRunnerPromise;

  queueRunnerPromise = (async () => {
    while (true) {
      if (hasActiveUpload()) break;
      const item = nextUploadCandidate();
      if (!item) break;

      item.status = 'pending-active';
      await persistQueueItem(item);
      showUploadActive(true);
      renderQueue();

      if (cancelUploadRequested) {
        cancelUploadRequested = false;
        item.status = 'pending';
        await persistQueueItem(item);
        showUploadActive(false);
        renderQueue();
        message('Upload canceled.');
        continue;
      }

      item.status = 'uploading';
      renderQueue();

      const captureId = item.captureId;
      try {
        const d = await uploadCapture(item);
        if (!queueItemStillPresent(captureId)) continue;
        uploadQueue = uploadQueue.filter((q) => q.captureId !== captureId);
        await removeCaptureFromStorage(captureId);
        showUploadActive(false);
        renderQueue();
        message('Pallet uploaded successfully! Pallet ID: ' + (d.palletId || ''));
      } catch (e) {
        if (!queueItemStillPresent(captureId)) {
          showUploadActive(false);
          continue;
        }
        showUploadActive(false);
        if (e.name === 'AbortError') {
          cancelUploadRequested = false;
          const current = uploadQueue.find((q) => q.captureId === captureId);
          if (current) {
            current.status = 'pending';
            await persistQueueItem(current);
            renderQueue();
            message('Upload canceled.');
          }
          continue;
        }
        const current = uploadQueue.find((q) => q.captureId === captureId);
        if (current) {
          if (isServerBusyMessage(e.message)) {
            current.status = 'queued';
            await persistQueueItem(current);
            renderQueue();
            message('Desktop was busy. Waiting to retry upload…');
            if (await waitForServerUploadIdle()) {
              scheduleProcessQueue();
            } else {
              message('Desktop is still busy. Will retry automatically.', true);
              scheduleProcessQueue();
            }
            continue;
          }
          current.status = 'failed';
          await persistQueueItem(current);
          renderQueue();
          message('Upload failed: ' + e.message, true);
        }
        continue;
      }
    }
  })().finally(() => {
    queueRunnerPromise = null;
  });

  return queueRunnerPromise;
}

function scheduleProcessQueue() {
  void processQueue();
}

async function retryUploadCapture(captureId) {
  const item = uploadQueue.find((i) => i.captureId === captureId);
  if (!item) return;
  item.status = 'queued';
  await persistQueueItem(item);
  renderQueue();
  scheduleProcessQueue();
}

async function deleteCaptureRecord(captureId) {
  if (!confirm('Delete this capture permanently? This cannot be undone.')) return;
  const item = uploadQueue.find((i) => i.captureId === captureId);
  const wasActive = item && (item.status === 'uploading' || item.status === 'pending-active');
  if (wasActive && activeUploadXhr && activeUploadCaptureId === captureId) {
    activeUploadXhr.abort();
  }
  uploadQueue = uploadQueue.filter((i) => i.captureId !== captureId);
  await removeCaptureFromStorage(captureId);
  showUploadActive(false);
  renderQueue();
  message('Capture deleted.');
  scheduleProcessQueue();
}

window.retryUpload = (captureId) => {
  void retryUploadCapture(captureId);
};

window.deleteCapture = (captureId) => {
  void deleteCaptureRecord(captureId);
};

(async () => {
  db = await initDB();
  deviceToken = localStorage.getItem('palletvision-device-token');
  if (!deviceToken) await pair();
  await loadQueue();
  await loadPallets();
  setInterval(() => scheduleProcessQueue(), 30000);
})();
