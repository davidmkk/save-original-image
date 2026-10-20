import { DEFAULTS } from './settings.js';
import { t } from './i18n.js';
import { buildCandidates, findBest, fetchBytes, imageInfo, convertBytes, bytesToDataUrl, baseName, fmtSize, EXT } from './core.js';

const getSettings = () => chrome.storage.sync.get(DEFAULTS);

// ---------------------------------------------------------------- menu
async function buildMenus() {
  const s = await getSettings();
  await new Promise((r) => chrome.contextMenus.removeAll(r));
  // One visible item stays at the top level of the right-click menu.
  const contexts = s.underCursor ? ['image', 'page', 'link', 'frame', 'video'] : ['image'];
  chrome.contextMenus.create({ id: 'original', title: t('menuSave'), contexts });
  if (s.showConvert) {
    chrome.contextMenus.create({ id: 'jpg', title: t('menuJpg'), contexts });
    chrome.contextMenus.create({ id: 'png', title: t('menuPng'), contexts });
  }
}
chrome.runtime.onInstalled.addListener(buildMenus);
chrome.runtime.onStartup.addListener(buildMenus);
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'sync' && (c.underCursor || c.showConvert)) buildMenus();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// ---------------------------------------------------------------- page helpers
async function inPage(tabId, frameId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func, args });
  return r?.result;
}
async function ensurePicker(tabId, frameId) {
  const has = await inPage(tabId, frameId, () => !!globalThis.__sio).catch(() => false);
  if (!has) await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['picker.js'] });
}
const pageFetcher = (tabId, frameId) => (tabId >= 0
  ? (u) => inPage(tabId, frameId, (x) => globalThis.__sio.fetchAsDataUrl(x), [u])
  : null);

// actions: [{ type: 'open' | 'copy', url, label, done }] shown as buttons on the message
function toast(tabId, msg, kind = 'info', actions = []) {
  if (tabId == null || tabId < 0) return;
  inPage(tabId, 0, (m, k, a) => globalThis.__sio?.toast(m, k, a), [msg, kind, actions]).catch(() => {});
}
function badge(text, color, tabId) {
  const opt = tabId >= 0 ? { tabId } : {};
  chrome.action.setBadgeBackgroundColor({ color, ...opt });
  chrome.action.setBadgeText({ text, ...opt });
  setTimeout(() => chrome.action.setBadgeText({ text: '', ...opt }), 6000);
}

// "Downloads/<folder>/<site>/<name>" from the settings; each part made safe for Windows.
const safePart = (s) => s.replace(/[<>:"|?*\x00-\x1f]+/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80);
function targetPath(name, settings, pageUrl) {
  const parts = String(settings.folder || '').split(/[\\/]+/).map(safePart).filter((p) => p && p !== '..');
  if (settings.perSite) {
    try { parts.push(safePart(new URL(pageUrl).hostname.replace(/^www\./, '')) || 'other'); } catch { parts.push('other'); }
  }
  return [...parts, name].join('/');
}

// ---------------------------------------------------------------- entry points
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (['original', 'jpg', 'png'].includes(info.menuItemId)) handle(info, tab, info.menuItemId);
});

// Keyboard shortcut: the image under the mouse pointer, in whichever frame the mouse is.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'save-under-cursor' || !tab?.id) return;
  let frames = [];
  try {
    frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => globalThis.__sio?.pointerAge() ?? null });
  } catch { /* page where extensions can't run */ }
  const fresh = frames.filter((f) => typeof f.result === 'number').sort((a, b) => a.result - b.result)[0];
  handle({ frameId: fresh?.frameId ?? 0, pageUrl: tab.url, usePointer: true }, tab, 'original');
});

// ---------------------------------------------------------------- main flow
async function handle(info, tab, mode) {
  const tabId = tab?.id ?? -1;
  const frameId = info.frameId ?? 0;
  badge('…', '#555', tabId);
  try {
    let page = null;
    if (tabId >= 0) {
      try {
        await ensurePicker(tabId, frameId);
        page = await inPage(tabId, frameId, (s, p) => globalThis.__sio.collect(s, p), [info.srcUrl || null, !!info.usePointer]);
      } catch { /* chrome:// pages, PDFs, the Web Store */ }
    }
    const src = info.srcUrl || page?.primary;
    if (!src) {
      toast(tabId, page?.noPoint ? t(info.usePointer ? 'toastNoPointer' : 'toastReload') : t('toastNoImage'), 'warn');
      badge('NONE', '#555', tabId);
      return;
    }
    toast(tabId, t('toastLooking'));
    const ctx = { tabId, frameId, pageUrl: info.pageUrl || tab?.url, settings: await getSettings(), pageFetch: pageFetcher(tabId, frameId) };
    const { best, webp } = await findBest(buildCandidates(src, page?.items), { src, pageFetch: ctx.pageFetch });

    if (mode === 'original') {
      if (best) return await save(best, null, ctx);
      if (!webp) throw new Error(t('errDownload'));
      const fb = ctx.settings.fallback;
      if (fb === 'jpg' || fb === 'png') return await save(webp, fb, ctx);
      if (fb === 'webp') return await save(webp, null, ctx);
      return await ask(webp, ctx);
    }
    const hit = best || webp;
    if (!hit) throw new Error(t('errDownload'));
    return await save(hit, mode, ctx);
  } catch (e) {
    console.error('Save original image failed:', e);
    toast(tabId, t('toastError', e.message), 'err');
    badge('ERR', '#c62828', tabId);
  }
}

// convertTo: null (save the bytes untouched) | 'jpg' | 'png'
async function save(hit, convertTo, ctx) {
  let { bytes, type } = await fetchBytes(hit.url, ctx.pageFetch);
  const info = imageInfo(bytes);
  const dims = info.width ? `${info.width}×${info.height} ` : '';
  const kindOf = (ty) => EXT[ty]?.toUpperCase() || 'IMG';
  const want = convertTo === 'jpg' ? 'image/jpeg' : convertTo === 'png' ? 'image/png' : null;
  let msg, kind;
  if (want && want !== type) {
    const from = kindOf(type);
    bytes = await convertBytes(bytes, type, want);
    msg = t('toastConverted', dims, from, convertTo.toUpperCase(), fmtSize(bytes.length)) + (info.animated ? t('toastAnimated') : '');
    kind = 'warn';
    type = want;
  } else if (/webp|avif/.test(type)) {
    msg = t('toastWebpOnly', dims, kindOf(type), fmtSize(bytes.length));
    kind = 'warn';
  } else {
    msg = t('toastFound', dims, kindOf(type), fmtSize(bytes.length));
    kind = 'ok';
  }
  const actions = /^https?:/i.test(hit.url) ? [
    { type: 'open', url: hit.url, label: t('actionOpen') },
    { type: 'copy', url: hit.url, label: t('actionCopy'), done: t('actionCopied') },
  ] : [];
  toast(ctx.tabId, msg, kind, actions);
  badge(kind === 'ok' ? 'OK' : kindOf(type).slice(0, 4), kind === 'ok' ? '#2e7d32' : '#e65100', ctx.tabId);
  await chrome.downloads.download({
    url: bytesToDataUrl(bytes, type),
    filename: targetPath(`${baseName(hit.url)}.${EXT[type] || 'img'}`, ctx.settings, ctx.pageUrl),
    saveAs: ctx.settings.saveAs,
    conflictAction: 'uniquify',
  });
}

// ---------------------------------------------------------------- "no original" window
async function ask(hit, ctx) {
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ ['ask:' + id]: { url: hit.url, type: hit.type, width: hit.width, height: hit.height, tabId: ctx.tabId, frameId: ctx.frameId, pageUrl: ctx.pageUrl } });
  toast(ctx.tabId, t('toastAsk'), 'warn');
  badge('?', '#e65100', ctx.tabId);
  await chrome.windows.create({ url: `ask.html?id=${id}`, type: 'popup', width: 460, height: 470, focused: true });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'ask-choice') return;
  (async () => {
    const key = 'ask:' + msg.id;
    const p = (await chrome.storage.session.get(key))[key];
    if (!p) return reply({ ok: false, error: t('askExpired') });
    await chrome.storage.session.remove(key);
    if (msg.remember) await chrome.storage.sync.set({ fallback: msg.choice });
    const ctx = { tabId: p.tabId, frameId: p.frameId, pageUrl: p.pageUrl, settings: await getSettings(), pageFetch: pageFetcher(p.tabId, p.frameId) };
    await save({ url: p.url }, msg.choice === 'webp' ? null : msg.choice, ctx);
    reply({ ok: true });
  })().catch((e) => reply({ ok: false, error: e.message }));
  return true;
});
