/* Freight Pictures service worker — Background Fetch completion on HTTPS. */
self.addEventListener('backgroundfetchsuccess', event => {
  event.waitUntil((async () => {
    const reg = event.registration;
    const batchId = String(reg.id || '').replace(/^freight-/, '');
    if (!batchId) return;
    const records = await reg.matchAll();
    const firstUrl = records[0]?.request?.url;
    if (!firstUrl) return;
    const key = new URL(firstUrl).searchParams.get('key');
    if (!key) return;
    await fetch('/finish?batch=' + encodeURIComponent(batchId) + '&key=' + encodeURIComponent(key), { method: 'POST' });
  })());
});
