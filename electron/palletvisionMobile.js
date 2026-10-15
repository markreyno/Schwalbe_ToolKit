/* global indexedDB, MediaRecorder, FormData, Blob */
let db;
let deviceToken;
let currentCapture = null;
let uploadQueue = [];
let stream = null;
let mediaRecorder = null;
let recordedChunks = [];

const el = (id) => document.getElementById(id);

function inBrowserCameraSupported() {
  return Boolean(window.isSecureContext && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
}

window.inBrowserCameraSupported = inBrowserCameraSupported;

function message(text, error = false) {
  el('message').textContent = text;
  el('message').className = error ? 'error' : '';
}

async function initDB() {
  const req = indexedDB.open('PalletVision', 2);
  req.onupgradeneeded = (e) => {
    const database = e.target.result;
    if (!database.objectStoreNames.contains('captures')) {
      database.createObjectStore('captures', { keyPath: 'captureId' });
    }
    if (!database.objectStoreNames.contains('queue')) {
      database.createObjectStore('queue', { keyPath: 'captureId' });
    }
  };
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function logCameraDiagnostic(payload) {
  if (!deviceToken) return;
  try {
    await fetch('/api/diagnostics/client', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + deviceToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'camera', ...payload, captureId: currentCapture?.captureId })
    });
  } catch { /* ignore when desktop offline */ }
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

function recordAttempt(item, attempt) {
  if (!item.attemptHistory) item.attemptHistory = [];
  item.attemptHistory.push(attempt);
  item.lastError = attempt;
}

async function persistQueueItem(item) {
  const tx = db.transaction('queue', 'readwrite');
  tx.objectStore('queue').put(item);
}

async function loadQueue() {
  const tx = db.transaction('queue', 'readonly');
  const store = tx.objectStore('queue');
  const req = store.getAll();
  req.onsuccess = () => {
    uploadQueue = req.result;
    renderQueue();
  };
}

function formatAttempt(attempt) {
  if (!attempt) return '';
  const lines = ['Time: ' + attempt.at];
  if (attempt.networkError) lines.push('Network: ' + attempt.networkError);
  if (attempt.httpStatus) lines.push('HTTP: ' + attempt.httpStatus);
  if (attempt.errorCode) lines.push('Code: ' + attempt.errorCode);
  if (attempt.message) lines.push('Message: ' + attempt.message);
  return lines.join('\n');
}

function renderQueue() {
  const q = el('queue');
  q.innerHTML = '';
  if (!uploadQueue.length) {
    q.innerHTML = '<p style="font-size: 12px; color: #7b8694">No pending uploads.</p>';
    return;
  }
  uploadQueue.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'item';
    const status = item.status || 'pending';
    let html = '<div class="status status-' + status + '">' + status.toUpperCase() + '</div>' +
      '<div>Capture ' + item.captureId + ' · ' + item.heightInches + '"H × ' + item.widthInches + '"W × ' + item.lengthInches + '"L</div>';
    if (status === 'failed' && item.lastError) {
      html += '<div class="last-error">' + (item.lastError.message || item.lastError.networkError || 'Upload failed') + '</div>';
      html += '<button type="button" class="secondary" style="margin-top:8px;width:auto;padding:8px 12px" data-details="' + item.captureId + '">Details</button>';
      html += '<div class="details" id="details-' + item.captureId + '" hidden>' + formatAttempt(item.lastError) + '</div>';
    }
    if (status === 'failed') {
      html += '<button type="button" onclick="window.retryUpload(\'' + item.captureId + '\')">Retry</button>';
    }
    div.innerHTML = html;
    q.appendChild(div);
  });
  q.querySelectorAll('[data-details]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-details');
      const panel = el('details-' + id);
      if (panel) panel.hidden = !panel.hidden;
    };
  });
}

async function parseApiError(r) {
  try {
    const d = await r.json();
    return { httpStatus: r.status, errorCode: d.code || 'UNKNOWN', message: d.message || d.error || r.statusText };
  } catch {
    return { httpStatus: r.status, errorCode: 'UNKNOWN', message: r.statusText };
  }
}

async function loadPallets() {
  try {
    const r = await fetch('/api/health', {
      headers: deviceToken ? { Authorization: 'Bearer ' + deviceToken } : {}
    });
    if (!r.ok) {
      const err = await parseApiError(r);
      message(err.message, true);
      return;
    }
    const d = await r.json();
    message('Connected to desktop. ' + d.palletCount + ' pallets stored.');
  } catch (e) {
    message('Desktop offline. Uploads will queue locally.', true);
  }
}

function loadVideoFileIntoReview(file) {
  recordedChunks = [file];
  el('playback').src = URL.createObjectURL(file);
  el('playback').hidden = false;
  el('review-actions').hidden = false;
  el('start-record').hidden = true;
  el('stop-record').hidden = true;
  message('Video ready. Review and continue to measurements.');
}

function openNativeCameraCapture(reason) {
  const secure = window.isSecureContext;
  const hint = secure
    ? 'Could not use live preview. Opening your phone camera app instead.'
    : 'Live preview requires HTTPS. This page uses HTTP, so opening your phone camera app instead.';
  message(hint + (reason ? ' (' + reason + ')' : ''), false);
  el('camera-capture-input').click();
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
  if (!currentCapture) {
    currentCapture = {
      captureId: 'cap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      capturedAt: new Date().toISOString()
    };
  }
  loadVideoFileIntoReview(file);
  el('home').hidden = true;
  el('record').hidden = false;
  e.target.value = '';
};

el('camera-capture-input').onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!currentCapture) {
    currentCapture = {
      captureId: 'cap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      capturedAt: new Date().toISOString()
    };
  }
  loadVideoFileIntoReview(file);
  e.target.value = '';
};

el('start-record').onclick = async () => {
  if (!inBrowserCameraSupported()) {
    await logCameraDiagnostic({
      reason: 'media_devices_unavailable',
      message: 'navigator.mediaDevices or getUserMedia unavailable (non-secure HTTP origin)',
      secureContext: window.isSecureContext,
      hasMediaDevices: Boolean(navigator.mediaDevices)
    });
    openNativeCameraCapture('camera API unavailable');
    return;
  }
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
    await logCameraDiagnostic({
      reason: 'permission_denied',
      message: e.message,
      secureContext: window.isSecureContext,
      hasMediaDevices: Boolean(navigator.mediaDevices)
    });
    openNativeCameraCapture(e.message || 'permission denied');
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
    status: 'pending',
    attemptHistory: []
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
    processQueue();
  };
};

async function processQueue() {
  for (const item of uploadQueue) {
    if (item.status === 'uploaded' || item.status === 'uploading') continue;
    item.status = 'uploading';
    renderQueue();
    const attempt = { at: new Date().toISOString() };
    try {
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      const r = await fetch('/api/pallets/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + deviceToken },
        body: formData,
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!r.ok) {
        const err = await parseApiError(r);
        attempt.httpStatus = err.httpStatus;
        attempt.errorCode = err.errorCode;
        attempt.message = err.message;
        throw new Error(err.message);
      }
      const d = await r.json();
      item.status = 'uploaded';
      item.palletId = d.palletId;
      item.lastError = null;
      await persistQueueItem(item);
      renderQueue();
      message('Pallet uploaded successfully!');
    } catch (e) {
      if (e.name === 'AbortError') {
        attempt.networkError = 'timeout';
        attempt.message = 'Upload timed out after 2 minutes.';
      } else if (e.message && !attempt.message) {
        attempt.networkError = 'unreachable';
        attempt.message = e.message;
      }
      recordAttempt(item, attempt);
      item.status = 'failed';
      await persistQueueItem(item);
      renderQueue();
      message(item.lastError?.message || 'Upload failed.', true);
      break;
    }
  }
}

el('test-connection').onclick = async () => {
  const resultEl = el('connection-test-result');
  resultEl.hidden = false;
  resultEl.textContent = 'Testing connection...';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const r = await fetch('/api/health', {
      headers: deviceToken ? { Authorization: 'Bearer ' + deviceToken } : {},
      signal: controller.signal
    });
    clearTimeout(timer);
    if (r.ok) {
      const d = await r.json();
      resultEl.textContent = d.auth === 'ok'
        ? 'Reachable — auth OK. ' + d.palletCount + ' pallets on desktop.'
        : 'Reachable but auth status unknown.';
      return;
    }
    const err = await parseApiError(r);
    if (err.errorCode === 'AUTH_MISSING' || err.errorCode === 'AUTH_INVALID' || err.errorCode === 'AUTH_EXPIRED') {
      resultEl.textContent = 'Reachable — auth failed: ' + err.message;
      return;
    }
    resultEl.textContent = 'Reachable — error: ' + err.message;
  } catch (e) {
    resultEl.textContent = e.name === 'AbortError'
      ? 'Unreachable — connection timed out.'
      : 'Unreachable — ' + (e.message || 'network error');
  }
};

window.retryUpload = (captureId) => {
  const item = uploadQueue.find((i) => i.captureId === captureId);
  if (item) {
    item.status = 'pending';
    processQueue();
  }
};

(async () => {
  db = await initDB();
  deviceToken = localStorage.getItem('palletvision-device-token');
  if (!deviceToken) await pair();
  await loadQueue();
  await loadPallets();
  setInterval(processQueue, 30000);
})();
