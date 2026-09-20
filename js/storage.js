import { BOARD_SIZE, SIZES } from './config.js';

export function validateRecord(record) {
  if (!record || record.version !== 1 || !(record.bitmap instanceof Blob) || !Array.isArray(record.texts)) {
    throw new Error('This saved board cannot be read.');
  }
  const ids = new Set();
  for (const text of record.texts) {
    if (!text || typeof text.id !== 'string' || ids.has(text.id) || typeof text.text !== 'string' ||
        !SIZES.text.includes(text.size) || !Number.isFinite(text.x) || !Number.isFinite(text.y) ||
        text.x < 0 || text.y < 0 || text.x >= BOARD_SIZE || text.y >= BOARD_SIZE) {
      throw new Error('The saved text is invalid.');
    }
    ids.add(text.id);
  }
  return record;
}

export function openDatabase(name = 'kokuban') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('boards');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Kokuban tabs to open storage.'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

export function readBoard(database, key) {
  return new Promise((resolve, reject) => {
    const request = database.transaction('boards').objectStore('boards').get(key);
    request.onsuccess = () => {
      try { resolve(request.result ? validateRecord(request.result) : null); }
      catch (error) { reject(error); }
    };
    request.onerror = () => reject(request.error);
  });
}

export function writeBoard(database, key, record) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('boards', 'readwrite');
    transaction.objectStore('boards').put(record, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Saving failed.'));
  });
}

export class Autosave {
  constructor(snapshot, write, status) {
    this.snapshot = snapshot;
    this.write = write;
    this.status = status;
    this.revision = 0;
    this.savedRevision = 0;
    this.running = null;
    this.timer = 0;
  }

  get pending() { return this.revision !== this.savedRevision; }

  schedule(delay = 350) {
    this.revision++;
    this.status('saving', 'Saving…');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  flush() {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  async drain() {
    while (this.pending) {
      const revision = this.revision;
      try {
        const record = await this.snapshot();
        await this.write(record);
        this.savedRevision = revision;
      } catch (error) {
        this.status('error', 'Not saved', error.message);
        return;
      }
    }
    this.status('saved', 'Saved locally');
  }
}
