/**
 * Persistent freight picture upload queue (IndexedDB). Requires HTTPS for Background Fetch; queue resume works over HTTPS.
 * Exposes window.FreightUploadQueue.
 */
(function (global) {
  const DB_NAME = 'schwalbe-freight-uploads-v1';
  const STORE = 'queue';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        db.createObjectStore('files');
        db.createObjectStore('drafts');
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

  async function transaction(stores, mode, operation) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error || Error('Upload queue update failed'));
        try { operation(tx, value => { result = value; }); }
        catch (error) { tx.abort(); reject(error); }
      });
    } finally { db.close(); }
  }

  const fileRange = id => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

  async function getPending() {
    try {
      return await transaction([STORE, 'files'], 'readonly', (tx, result) => {
        const request = tx.objectStore(STORE).get('active');
        request.onsuccess = () => {
          const record = request.result;
          if (!record?.fileSet) { result(materializeRecord(record) || null); return; }
          const files = tx.objectStore('files').getAll(fileRange(record.fileSet));
          files.onsuccess = () => {
            const byIndex = new Map(files.result.map(file => [file.index, file]));
            result({ ...record, files: record.files.map(file => byIndex.get(file.index) || file) });
          };
        };
      });
    } catch { return null; }
  }

  async function savePending(record) {
    // Store one Blob at a time and commit the manifest with its files.
    const fileSet = Date.now() + '-' + Math.random();
    await transaction([STORE, 'files'], 'readwrite', tx => {
      const queue = tx.objectStore(STORE);
      const blobs = tx.objectStore('files');
      const entries = record.files || [];
      const files = [];
      const previous = queue.get('active');
      previous.onsuccess = () => {
        if (previous.result?.fileSet) blobs.delete(fileRange(previous.result.fileSet));
        function writeNext() {
          if (files.length === entries.length) {
            queue.put({ ...record, files, fileSet, id: 'active' });
            return;
          }
          const { index, name, size, hash, mimeType, blob } = materializeFile(entries[files.length]);
          const metadata = { index, name, size, hash, mimeType: mimeType || mimeForName(name) };
          files.push(metadata);
          blobs.put({ ...metadata, blob }, [fileSet, index]).onsuccess = writeNext;
        }
        writeNext();
      };
    });
  }

  async function clearPending() {
    await transaction([STORE, 'files'], 'readwrite', tx => {
      const queue = tx.objectStore(STORE);
      const previous = queue.get('active');
      previous.onsuccess = () => {
        if (previous.result?.fileSet) tx.objectStore('files').delete(fileRange(previous.result.fileSet));
        queue.delete('active');
      };
    }).catch(() => {});
  }

  function saveDraft(key, id, file) {
    return transaction(['drafts'], 'readwrite', tx => tx.objectStore('drafts').put({ id, file }, [key, id]));
  }

  function deleteDraft(key, id) {
    return transaction(['drafts'], 'readwrite', tx => tx.objectStore('drafts').delete(id === undefined ? fileRange(key) : [key, id]));
  }

  function getDraft(key) {
    return transaction(['drafts'], 'readonly', (tx, result) => {
      const request = tx.objectStore('drafts').getAll(fileRange(key));
      request.onsuccess = () => result(request.result);
    });
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
      files.push({
        index: i,
        name: file.name,
        size: file.size,
        hash,
        mimeType: file.type || mimeForName(file.name),
        blob: file
      });
    }
    const record = {
      id: 'active',
      shipmentKey: input.shipmentKey,
      pallets: input.pallets,
      resizeNote: input.resizeNote,
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

  // Serialize metadata updates inside one transaction. Keep image bytes unchanged.
  async function updateMetadata(update, expectedBatchId) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.get('active');
        req.onsuccess = () => {
          const record = req.result;
          if (!record || (expectedBatchId && record.batchId !== expectedBatchId)) return;
          if (update(record) !== false) store.put(record);
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error || Error('Upload queue update failed'));
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    } finally { db.close(); }
  }

  async function markIndexUploaded(index, expectedBatchId) {
    await mergeUploadedIndices([index], expectedBatchId);
  }

  async function mergeUploadedIndices(indices, expectedBatchId) {
    await updateMetadata(record => {
      const next = [...new Set([...(record.uploadedIndices || []), ...indices])]
        .filter(i => Number.isInteger(i) && i >= 0 && i < record.files.length).sort((a, b) => a - b);
      if (JSON.stringify(next) === JSON.stringify(record.uploadedIndices)) return false;
      record.uploadedIndices = next;
    }, expectedBatchId);
  }

  async function setBatchId(batchId) {
    await updateMetadata(record => { record.batchId = batchId; });
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
    // All bytes sent still needs desktop verification; retain the batch to finish on refresh.
    if (!shouldAutoResumeUpload(record)) {
      await clearPending();
      return { pending: null, notice: 'Cleared an unfinished upload draft.' };
    }
    return { pending: materializeRecord(record), notice: '' };
  }

  global.FreightUploadQueue = {
    getPending,
    saveDraft,
    getDraft,
    deleteDraft,
    savePending,
    clearPending,
    createFromSelection,
    markIndexUploaded,
    mergeUploadedIndices,
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
