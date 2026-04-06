export async function register() {
  // Node.js 25+ exposes `localStorage` as a global via --localstorage-file.
  // When no valid file path is provided the object exists but has no Storage
  // methods, causing `localStorage.getItem is not a function` during SSR.
  // Replace it entirely with a no-op in-memory implementation.
  if (
    typeof globalThis.localStorage !== "undefined" &&
    typeof (globalThis.localStorage as Storage).getItem !== "function"
  ) {
    const store: Record<string, string> = {};
    const noop: Storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).localStorage = noop;
    } catch {
      // If assignment fails (e.g. non-writable), patch methods individually
      Object.assign(globalThis.localStorage, noop);
    }
  }
}
