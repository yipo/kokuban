import { BOARD_SIZE } from './config.js';
import { toPNG } from './drawing.js';
import { Autosave, openDatabase, listBoards, readBoard, readActiveBoard, createBoard, writeBoard, rememberBoard, removeBoard } from './storage.js';

export async function blankBoard() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = BOARD_SIZE;
  const record = { id: crypto.randomUUID(), createdAt: Date.now(), version: 1, texts: [] };
  record.bitmap = await toPNG(canvas);
  return record;
}

// The app locks input around these operations. Prepare must finish decoding
// before any storage or visible-board change; apply is synchronous.
export class BoardSession {
  constructor(path, { snapshot, prepare, apply, status }, database = null) {
    this.path = path;
    this.database = database;
    this.active = null;
    this.prepare = prepare;
    this.apply = apply;
    this.saver = new Autosave(async () => {
      const id = this.active?.id;
      if (!id) throw new Error('Open or create a board before saving.');
      return { id, record: await snapshot() };
    }, async ({ id, record }) => {
      await writeBoard(this.database, this.path, id, record);
    }, status);
  }

  async connect() { this.database ||= await openDatabase(); }
  async list() { await this.connect(); return listBoards(this.database, this.path); }

  async flush() {
    await this.saver.flush();
    if (this.saver.pending) throw new Error('Your changes could not be saved. Free browser storage if needed, then try again.');
  }

  activate(record, prepared) {
    this.apply(record, prepared);
    this.active = record;
  }

  async start() {
    await this.connect();
    const remembered = await readActiveBoard(this.database, this.path);
    const records = await this.list();
    const record = records.find(item => item.id === remembered) || records[0];
    if (record) await this.load(record.id);
    else await this.create();
  }

  async create() {
    await this.flush();
    await this.connect();
    const record = await blankBoard();
    const prepared = await this.prepare(record);
    await createBoard(this.database, this.path, record);
    this.activate(record, prepared);
  }

  async load(id) {
    await this.flush();
    await this.connect();
    const record = await readBoard(this.database, this.path, id);
    if (!record) throw new Error('This board no longer exists. Reopen the board library.');
    if (id === this.active?.id) return;
    const prepared = await this.prepare(record);
    await rememberBoard(this.database, this.path, id);
    this.activate(record, prepared);
  }

  async remove(id) {
    await this.flush();
    await this.connect();
    if (id !== this.active?.id) {
      await removeBoard(this.database, this.path, id);
      return;
    }
    const remaining = (await this.list()).filter(record => record.id !== id);
    const record = remaining[0] ? await readBoard(this.database, this.path, remaining[0].id) : await blankBoard();
    if (!record) throw new Error('The replacement board no longer exists. Reopen the board library.');
    const prepared = await this.prepare(record);
    await removeBoard(this.database, this.path, id, record.id, remaining.length ? null : record);
    this.activate(record, prepared);
  }
}
