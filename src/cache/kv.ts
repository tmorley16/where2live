import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';

/** A tiny key–value store: IndexedDB in the browser, memory in tests or where IndexedDB is blocked. */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryKV implements KV {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined;
  }
  async set(key: string, value: unknown) {
    this.data.set(key, value);
  }
  async del(key: string) {
    this.data.delete(key);
  }
  async keys() {
    return [...this.data.keys()];
  }
}

class IdbKV implements KV {
  private store: UseStore;
  constructor(db: string) {
    this.store = createStore(db, 'kv');
  }
  get<T>(key: string) {
    return get<T>(key, this.store);
  }
  set(key: string, value: unknown) {
    return set(key, value, this.store);
  }
  del(key: string) {
    return del(key, this.store);
  }
  async keys() {
    return (await keys(this.store)).map(String);
  }
}

/**
 * One IndexedDB database per store (idb-keyval's createStore opens a database with a single object store).
 * Names start with `w2l`: on GitHub Pages the origin is shared with the user's other sites.
 */
export function openKV(name: string): KV {
  if (typeof indexedDB === 'undefined') return new MemoryKV();
  return new IdbKV(`w2l-${name}`);
}
