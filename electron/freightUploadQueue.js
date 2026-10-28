/**
 * Persistent freight picture upload queue (IndexedDB). Works on plain HTTP.
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

  async function getPending() {
    try {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get('active');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async function savePending(record) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...record, id: 'active' });
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

  async function blobFromFile(file) {
    return file instanceof Blob ? file : new Blob([file]);
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
        blob: await blobFromFile(file)
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
    return record;
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
    const total = pending?.files?.length || 0;
    const uploaded = pending?.uploadedIndices?.length || 0;
    return { total, uploaded, remaining: total - uploaded };
  }

  global.FreightUploadQueue = {
    getPending,
    savePending,
    clearPending,
    createFromSelection,
    markIndexUploaded,
    setBatchId,
    pendingProgress
  };
})(typeof window !== 'undefined' ? window : globalThis);
