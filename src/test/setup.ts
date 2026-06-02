import '@testing-library/jest-dom/vitest';

/**
 * Minimal in-memory Web Storage, used only to repair the test environment below.
 */
class MemoryStorage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

// Node ≥22 ships native Web Storage globals; on Node 25 they're enabled by default and replace jsdom's
// `localStorage`/`sessionStorage` — but the native objects lack `.clear`, breaking tests that clear
// storage between cases. When that's detected, swap in a clean in-memory Storage. A no-op on the
// project's target Node 22, where jsdom supplies a fully-featured Storage and this branch never runs.
// See `test.environment: 'jsdom'` in vite.config.ts.
for (const key of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[key]?.clear !== 'function') {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: new MemoryStorage() as unknown as Storage,
    });
  }
}
