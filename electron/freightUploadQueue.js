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

  function hasUsableFiles(pending) {
    return (pending?.files || []).map(materializeFile).some(f => f?.blob instanceof Blob && f.blob.size > 0);
  }

  function shouldAutoResumeUpload(pending) {
    if (!pending?.shipmentKey || !hasUsableFiles(pending)) return false;
    if ((pending.uploadedIndices?.length || 0) > 0) return true;
    if (pending.batchId) return true;
    return false;
  }

  function pendingByteTotal(pending) {
    return (pending?.files || []).reduce((n, f) => {
      const file = materializeFile(f);
      return n + Math.max(0, file?.size || file?.blob?.size || 0);
    }, 0);
  }

  function pendingDoneBytes(pending) {
    let done = 0;
    for (const i of pending?.uploadedIndices || []) {
      const file = materializeFile(pending.files[i]);
      if (file) done += Math.max(0, file.size || file.blob?.size || 0);
    }
    return done;
  }

  /** Drop stale v1.6.7 leftovers and empty shells; return a usable pending record or null. */
  async function repairAndLoadPending() {
    let record = await getPending();
    if (!record) return { pending: null, notice: '' };
    if (!record.shipmentKey) {
      await clearPending();
      return { pending: null, notice: '' };
    }
    if (!Array.isArray(record.uploadedIndices)) record.uploadedIndices = [];
    if (!Array.isArray(record.files)) record.files = [];
    const materialized = record.files.map(materializeFile);
    const usable = materialized.filter(f => f?.blob instanceof Blob && f.blob.size > 0);
    if (!usable.length) {
      await clearPending();
      return { pending: null, notice: '' };
    }
    if (usable.length !== materialized.length) {
      record.files = usable.map((f, idx) => ({ ...f, index: idx }));
      record.uploadedIndices = record.uploadedIndices.filter(i => i < usable.length);
      await savePending(record);
    }
    const { remaining } = pendingProgress(record);
    if (remaining <= 0) {
      await clearPending();
      return { pending: null, notice: '' };
    }
    if (!shouldAutoResumeUpload(record)) {
      await clearPending();
      return { pending: null, notice: 'Cleared an unfinished upload draft.' };
    }
    return { pending: materializeRecord(record), notice: '' };
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
    materializeFile,
    hasUsableFiles,
    shouldAutoResumeUpload,
    pendingByteTotal,
    pendingDoneBytes,
    repairAndLoadPending
  };
})(typeof window !== 'undefined' ? window : globalThis);
