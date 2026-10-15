/* global indexedDB, MediaRecorder, FormData, Blob */
let db;
let deviceToken;
let currentCapture = null;
let uploadQueue = [];
let stream = null;
let mediaRecorder = null;
let recordedChunks = [];

const el = (id) => document.getElementById(id);

function message(text, error = false) {
  el('message').textContent = text;
  el('message').className = error ? 'error' : '';
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
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

async function loadQueue() {
  const tx = db.transaction('queue', 'readonly');
  const store = tx.objectStore('queue');
  const req = store.getAll();
  req.onsuccess = () => {
    uploadQueue = req.result;
    renderQueue();
  };
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
    div.innerHTML = '<div class="status status-' + status + '">' + status.toUpperCase() + '</div>' +
      '<div>Capture ' + item.captureId + ' · ' + item.heightInches + '"H × ' + item.widthInches + '"W × ' + item.lengthInches + '"L</div>' +
      (status === 'failed' ? '<button onclick="window.retryUpload(\'' + item.captureId + '\')">Retry</button>' : '');
    q.appendChild(div);
  });
}

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
    status: 'pending'
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
      formData.append('video', item.videoBlob, `video.${videoExt}`);
      
      const r = await fetch('/api/pallets/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + deviceToken },
        body: formData
      });
      
      if (!r.ok) throw new Error('Upload failed: ' + r.statusText);
      const d = await r.json();
      item.status = 'uploaded';
      item.palletId = d.palletId;
      const tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').put(item);
      renderQueue();
      message('Pallet uploaded successfully!');
    } catch (e) {
      item.status = 'failed';
      const tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').put(item);
      renderQueue();
      message('Upload failed: ' + e.message, true);
      break;
    }
  }
}

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
