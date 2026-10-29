/**
 * Persistent freight picture upload queue (IndexedDB). Requires HTTPS for Background Fetch; queue resume works over HTTPS.
 * Exposes window.FreightUploadQueue.
 */
(function (global) {
  const DB_NAME = 'schwalbe-freight-uploads-v1';
  const STORE = 'queue';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function mimeForName(name) {
    const lower = (name || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'application/octet-stream';
  }

  function materializeFile(entry) {
    if (!entry) return entry;
    if (entry.blob instanceof Blob && entry.blob.size > 0) return entry;
    if (entry.data) {
      const blob = new Blob([entry.data], { type: entry.mimeType || mimeForName(entry.name) });
      return { ...entry, blob };
    }
    if (entry.blob instanceof Blob) return entry;
    return { ...entry, blob: null };
  }

  async function getPending() {
    try {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get('active');
        req.onsuccess = () => {
          const record = req.result || null;
          if (record?.files) record.files = record.files.map(materializeFile);
          resolve(record);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async function savePending(record) {
    const files = [];
    for (const f of record.files || []) {
      const copy = {
        index: f.index,
        name: f.name,
        size: f.size,
        hash: f.hash,
        mimeType: f.mimeType || mimeForName(f.name)
      };
      if (f.data instanceof ArrayBuffer) copy.data = f.data;
      else if (f.data && ArrayBuffer.isView(f.data)) copy.data = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
      else if (f.blob instanceof Blob) copy.data = await f.blob.arrayBuffer();
      files.push(copy);
    }
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...record, files, id: 'active' });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearPending() {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete('active');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch { /* ignore */ }
  }

  /**
   * @param {object} input
   * @param {string} input.shipmentKey
   * @param {number} input.pallets
   * @param {File[]} input.files
   * @param {() => Promise<string>} input.hashFile
   */
  async function createFromSelection(input) {
    const files = [];
    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i];
      const hash = await input.hashFile(file);
      const data = await file.arrayBuffer();
      files.push({
        index: i,
        name: file.name,
        size: file.size,
        hash,
        mimeType: file.type || mimeForName(file.name),
        data,
        blob: new Blob([data], { type: file.type || mimeForName(file.name) })
      });
    }
    const record = {
      id: 'active',
      shipmentKey: input.shipmentKey,
      pallets: input.pallets,
      batchId: null,
      files,
      uploadedIndices: [],
      createdAt: Date.now()
    };
    await savePending(record);
    return materializeRecord(record);
  }

  function materializeRecord(record) {
    if (!record) return record;
    return { ...record, files: (record.files || []).map(materializeFile) };
  }

  async function markIndexUploaded(index) {
    const pending = await getPending();
    if (!pending) return;
    if (!pending.uploadedIndices.includes(index)) pending.uploadedIndices.push(index);
    await savePending(pending);
  }

  async function setBatchId(batchId) {
    const pending = await getPending();
    if (!pending) return;
    pending.batchId = batchId;
    await savePending(pending);
  }

  function pendingProgress(pending) {
    const total = Math.max(0, pending?.files?.length || 0);
    const uploaded = Math.min(total, pending?.uploadedIndices?.length || 0);
    return { total, uploaded, remaining: Math.max(0, total - uploaded) };
  }

  function remainingIndices(pending) {
    const out = [];
    const total = pending?.files?.length || 0;
    const done = pending?.uploadedIndices || [];
    for (let i = 0; i < total; i++) {
      if (!done.includes(i)) out.push(i);
    }
    return out;
  }

  global.FreightUploadQueue = {
    getPending,
    savePending,
    clearPending,
    createFromSelection,
    markIndexUploaded,
    setBatchId,
    pendingProgress,
    remainingIndices,
    materializeFile
  };
})(typeof window !== 'undefined' ? window : globalThis);
