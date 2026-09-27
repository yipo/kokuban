import { BOARD_SIZE, SIZES, COLORS } from './config.js';

export function validateRecord(record) {
  if (!record || record.version !== 1 || !(record.bitmap instanceof Blob) || !Array.isArray(record.texts)) {
    throw new Error('This saved board cannot be read.');
  }
  const ids = new Set();
  for (const text of record.texts) {
    if (!text || typeof text.id !== 'string' || ids.has(text.id) || typeof text.text !== 'string' ||
        (text.color !== undefined && !COLORS.some(color => color.value === text.color)) ||
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
    const request = indexedDB.open(name, 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      const library = database.createObjectStore('library', { keyPath: ['path', 'id'] });
      library.createIndex('path', 'path');
      const state = database.createObjectStore('state', { keyPath: 'path' });
      if (database.objectStoreNames.contains('boards')) {
        const createdAt = Date.now();
        const cursor = request.transaction.objectStore('boards').openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          const id = crypto.randomUUID();
          // Copy even unreadable payloads intact. All writes/deletes share the
          // upgrade transaction, so an aborted migration leaves v1 untouched.
          library.add({ ...entry.value, path: entry.key, id, createdAt });
          state.put({ path: entry.key, activeId: id });
          entry.delete();
          entry.continue();
        };
      }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other Kokuban tabs, then reload to open storage.'));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) { database.close(); return; }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Resolve mutations only after commit, including metadata changes.
function mutate(database, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['library', 'state'], 'readwrite');
    let failure;
    const fail = message => { failure = new Error(message); transaction.abort(); };
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(failure || transaction.error || new Error('Storage update failed.'));
    operation(transaction.objectStore('library'), transaction.objectStore('state'), fail);
  });
}

export async function listBoards(database, path) {
  const records = await result(database.transaction('library').objectStore('library').index('path').getAll(path));
  return records.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export async function readBoard(database, path, id) {
  const record = await result(database.transaction('library').objectStore('library').get([path, id]));
  return record ? validateRecord(record) : null;
}

export async function readActiveBoard(database, path) {
  return (await result(database.transaction('state').objectStore('state').get(path)))?.activeId || null;
}

export function createBoard(database, path, record) {
  validateRecord(record);
  return mutate(database, (library, state) => {
    library.add({ ...record, path });
    state.put({ path, activeId: record.id });
  });
}

export function writeBoard(database, path, id, record) {
  validateRecord(record);
  return mutate(database, (library, state, fail) => {
    const request = library.get([path, id]);
    request.onsuccess = () => {
      if (!request.result) { fail('This board was removed in another tab. Reload to open another board.'); return; }
      library.put({ ...request.result, version: record.version, bitmap: record.bitmap, texts: record.texts });
    };
  });
}

export function rememberBoard(database, path, id) {
  return mutate(database, (library, state, fail) => {
    const request = library.get([path, id]);
    request.onsuccess = () => {
      if (!request.result) { fail('This board no longer exists. Reopen the board library.'); return; }
      state.put({ path, activeId: id });
    };
  });
}

export function removeBoard(database, path, id, nextId, blank = null) {
  if (blank) validateRecord(blank);
  return mutate(database, (library, state, fail) => {
    const remove = () => {
      library.delete([path, id]);
      // A replacement is supplied when removing the board open in this tab.
      if (nextId) state.put({ path, activeId: nextId });
      else {
        const request = state.get(path);
        request.onsuccess = () => {
          if (request.result?.activeId === id) state.delete(path);
        };
      }
    };
    if (blank) {
      library.add({ ...blank, path });
      remove();
    } else if (nextId) {
      const request = library.get([path, nextId]);
      request.onsuccess = () => {
        if (!request.result) { fail('The replacement board no longer exists. Reopen the board library.'); return; }
        remove();
      };
    } else remove();
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
