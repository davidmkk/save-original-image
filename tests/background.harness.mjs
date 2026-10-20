// Runs background.js in Node with a fake `chrome` API and real network requests:
// right-click -> search -> download, the shortcut, folders, and the "no original" window.
// usage (from the extension folder):
//   python -m http.server 8766        (serves tests/img/only.webp, a WebP with no JPG/PNG twin)
//   node tests/background.harness.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const EN = JSON.parse(readFileSync(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));
const listeners = {};
const on = (name) => ({ addListener: (f) => { listeners[name] = f; } });
const downloads = [];
const windows = [];
const toasts = [];
const collectCalls = [];
let pageResult = null;
let pointerFrames = [];
const store = { sync: {}, session: {} };
const area = (k) => ({
  get: async (q) => {
    if (typeof q === 'string') return { [q]: store[k][q] };
    const out = { ...q };
    for (const key of Object.keys(q)) if (key in store[k]) out[key] = store[k][key];
    return out;
  },
  set: async (o) => { Object.assign(store[k], o); },
  remove: async (key) => { delete store[k][key]; },
});

globalThis.chrome = {
  i18n: { getMessage: (k) => EN[k]?.message || '', getUILanguage: () => 'en' },
  contextMenus: { removeAll: (cb) => cb(), create: () => {}, onClicked: on('menu') },
  commands: { onCommand: on('command') },
  runtime: { onInstalled: on('installed'), onStartup: on('startup'), onMessage: on('message'), openOptionsPage: () => {} },
  storage: { sync: area('sync'), session: area('session'), onChanged: on('storage') },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, onClicked: on('action') },
  downloads: { download: async (o) => { downloads.push(o); return downloads.length; } },
  windows: { create: async (o) => { windows.push(o); } },
  scripting: {
    executeScript: async ({ target, func, args }) => {
      const src = String(func);
      if (target.allFrames) return pointerFrames;
      if (src.includes('!!globalThis.__sio')) return [{ result: true }];
      if (src.includes('collect')) {
        collectCalls.push({ frameId: target.frameIds[0], args });
        return [{ result: pageResult ?? { primary: args[0], items: [] } }];
      }
      if (src.includes('toast')) toasts.push({ msg: args[0], kind: args[1], actions: args[2] });
      return [{ result: undefined }];
    },
  },
};

await import('../background.js');
const waitForResult = async () => {
  const n = downloads.length, w = windows.length;
  for (let i = 0; i < 300 && downloads.length === n && windows.length === w; i++) await new Promise((r) => setTimeout(r, 100));
};
const click = async (srcUrl, menuItemId = 'original') => {
  listeners.menu({ menuItemId, srcUrl, frameId: 0, pageUrl: 'https://www.rednose.com.ar/productos/x/' }, { id: 7 });
  await waitForResult();
};
const kind = (d) => d.url.slice(5, d.url.indexOf(';'));
const TN = 'https://acdn-us.mitiendanube.com/stores/627/117/products/remera1-22a61d2ad5d4b6bdc317823973782905-640-0.webp';

// 1. Tiendanube: the original JPG, untouched, with Open / Copy link buttons
await click(TN);
let d = downloads.at(-1);
assert.equal(d.filename, 'remera1-22a61d2ad5d4b6bdc317823973782905.jpg');
assert.equal(kind(d), 'image/jpeg');
assert.equal(Buffer.from(d.url.split(',')[1], 'base64').length, 7345738);
assert.equal(d.saveAs, true);
assert.equal(d.conflictAction, 'uniquify');
const okToast = toasts.findLast((x) => x.kind === 'ok');
assert.match(okToast.msg, /^Found the original: 3544×4430 JPG \(7\.0 MB\), untouched\.$/);
assert.deepEqual(okToast.actions.map((a) => a.type), ['open', 'copy']);
console.log('ok  Tiendanube original saved byte-for-byte:', d.filename, '|', okToast.msg);

// 2. Folder + one subfolder per site
store.sync.folder = 'Original images/../Shirts';
store.sync.perSite = true;
await click(TN);
assert.equal(downloads.at(-1).filename, 'Original images/Shirts/rednose.com.ar/remera1-22a61d2ad5d4b6bdc317823973782905.jpg');
console.log('ok  folder setting:', downloads.at(-1).filename);
delete store.sync.folder; delete store.sync.perSite;

// 3. Image found under an overlay (no srcUrl, page scanner supplies it)
pageResult = { primary: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400&fm=webp', items: [{ url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400&fm=webp', kind: 'current', w: 400 }] };
await click(undefined);
d = downloads.at(-1);
assert.equal(kind(d), 'image/jpeg');
console.log('ok  under-cursor image saved:', d.filename, `${(Buffer.from(d.url.split(',')[1], 'base64').length / 1048576).toFixed(1)} MB`);

// 4. Keyboard shortcut: uses the frame where the mouse moved last, and the pointer position
pointerFrames = [{ frameId: 0, result: 5000 }, { frameId: 3, result: 40 }];
listeners.command('save-under-cursor', { id: 7, url: 'https://example.com/' });
await waitForResult();
assert.deepEqual(collectCalls.at(-1), { frameId: 3, args: [null, true] });
console.log('ok  shortcut picks the frame under the mouse (frame 3) and saves:', downloads.at(-1).filename);
pageResult = null;

// 5. Only WebP exists: default setting opens the "ask" window, nothing downloaded yet
const webpOnly = 'http://127.0.0.1:8766/tests/img/only.webp';
const before = downloads.length;
await click(webpOnly);
assert.equal(downloads.length, before);
assert.match(windows.at(-1)?.url || '', /^ask\.html\?id=/);
const id = new URLSearchParams(windows.at(-1).url.split('?')[1]).get('id');
console.log('ok  WebP-only image opens the choice window');

// 6. Choosing "Keep the WebP" in that window saves the WebP untouched
const reply = await new Promise((res) => listeners.message({ type: 'ask-choice', id, choice: 'webp', remember: false }, {}, res));
assert.equal(reply.ok, true);
d = downloads.at(-1);
assert.equal(kind(d), 'image/webp');
assert.equal(d.filename, 'only.webp');
console.log('ok  "Keep the WebP" saves it untouched:', d.filename);

// 7. Setting "keep WebP" skips the window
store.sync.fallback = 'webp';
await click(webpOnly);
assert.equal(kind(downloads.at(-1)), 'image/webp');
console.log('ok  fallback=webp saves without asking');
console.log('\nall background checks passed');
process.exit(0);
