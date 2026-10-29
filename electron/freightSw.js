/* Freight Pictures service worker — Background Fetch + queued upload drain (HTTPS). */
importScripts('/freightUploadQueue.js');

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

async function finishIfQueueComplete(batchId, key) {
  const Q = self.FreightUploadQueue;
  const pending = await Q.getPending();
  if (!pending || pending.shipmentKey !== key) return;
  const { remaining } = Q.pendingProgress(pending);
  if (remaining > 0) return;
  await fetch('/finish?batch=' + encodeURIComponent(batchId) + '&key=' + encodeURIComponent(key), { method: 'POST' });
  await Q.clearPending();
}

async function markIndicesFromBackgroundFetch(reg) {
  const Q = self.FreightUploadQueue;
  const records = await reg.matchAll();
  let key = null;
  for (const record of records) {
    const url = new URL(record.request.url);
    key = url.searchParams.get('key') || key;
    const index = Number(url.searchParams.get('index'));
    if (Number.isFinite(index)) await Q.markIndexUploaded(index);
  }
  return key;
}

/** Continue queued picture POSTs from IndexedDB when the page is hidden or closed (no Background Fetch). */
function broadcastUploadProgress(pending) {
  const Q = self.FreightUploadQueue;
  const { total, uploaded } = Q.pendingProgress(pending);
  const payload = { type: 'freight-upload-progress', uploaded, total };
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) client.postMessage(payload);
  }).catch(() => {});
}

async function drainRemainingUploadsInSw() {
  const Q = self.FreightUploadQueue;
  const pending = await Q.getPending();
  if (!pending?.files?.length || !pending.batchId) return;
  const key = pending.shipmentKey;
  const batchId = pending.batchId;
  for (let i = 0; i < pending.files.length; i++) {
    const fresh = await Q.getPending();
    if (!fresh || fresh.batchId !== batchId) return;
    if (fresh.uploadedIndices.includes(i)) continue;
    const fileRec = Q.materializeFile(fresh.files[i]);
    const blob = fileRec?.blob;
    if (!(blob instanceof Blob) || blob.size < 1) return;
    const res = await fetch('/file?batch=' + encodeURIComponent(batchId) + '&index=' + i + '&key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: {
        'X-Picture-SHA256': fileRec.hash,
        'X-Freight-Upload-Channel': 'service-worker'
      },
      body: blob
    });
    if (!res.ok) return;
    await Q.markIndexUploaded(i);
    broadcastUploadProgress(await Q.getPending());
  }
  await finishIfQueueComplete(batchId, key);
  broadcastUploadProgress(await Q.getPending());
}

self.addEventListener('message', event => {
  const data = event.data;
  if (!data || data.type !== 'freight-continue-upload') return;
  event.waitUntil(drainRemainingUploadsInSw());
});

self.addEventListener('sync', event => {
  if (event.tag !== 'freight-upload-continue') return;
  event.waitUntil(drainRemainingUploadsInSw());
});

self.addEventListener('backgroundfetchsuccess', event => {
  event.waitUntil((async () => {
    const reg = event.registration;
    const records = await reg.matchAll();
    const firstUrl = records[0]?.request?.url;
    const batchId = firstUrl ? new URL(firstUrl).searchParams.get('batch') : '';
    if (!batchId) return;
    const key = await markIndicesFromBackgroundFetch(reg);
    if (!key) return;
    await finishIfQueueComplete(batchId, key);
  })());
});
