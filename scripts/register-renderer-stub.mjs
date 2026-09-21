/**
 * Registers the asset stub loader *and* the minimum browser surface the
 * renderer touches at module scope, so a test can import the capability engine
 * and the Realtime tool bridge — the real production modules — under Node.
 *
 * Deliberately separate from `register-asset-stub.mjs`: suites that only read
 * registries must keep failing loudly if they reach for `window`, because that
 * would mean they had stopped being pure. Only the voice-path test, which has
 * to load the engine, opts into this.
 *
 * `__TAURI_INTERNALS__.invoke` rejects rather than returning data. Nothing here
 * may reach the real machine, and a capability that tries must fail visibly as
 * a transport error instead of quietly looking like a successful call.
 */
import { register } from "node:module";

register("./asset-stub-loader.mjs", import.meta.url);

const store = new Map();
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const noop = () => {};
globalThis.window = globalThis;
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.dispatchEvent = () => true;
globalThis.matchMedia = () => ({
  matches: false,
  addEventListener: noop,
  removeEventListener: noop,
});
globalThis.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  invoke: async (cmd) => {
    throw new Error(`no native backend in this harness (invoke "${cmd}")`);
  },
  transformCallback: () => 0,
  convertFileSrc: (p) => p,
};
