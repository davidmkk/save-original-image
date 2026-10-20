// Shared logic, no chrome.* APIs here (so it can be tested in Node or a normal page).
// The original is always saved byte-for-byte; convertBytes() is only used when the
// person asks for a conversion because the site has no JPG/PNG at all.
import { strong, weak, stripFormatParams } from './rules.js';

// Same idea as: curl -H "Accept: image/jpeg,image/png,..." <url>
// Many CDNs (Shopify, Cloudflare, Akamai, imgix...) only send WebP/AVIF when the
// browser says it accepts them, so leaving them out gets the original JPG/PNG.
export const NO_WEBP_ACCEPT = 'image/jpeg,image/png,image/gif,image/svg+xml;q=0.9,*/*;q=0.1';

export const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'image/bmp': 'bmp', 'image/tiff': 'tif', 'image/webp': 'webp', 'image/avif': 'avif',
};
const ORIGINAL = /^image\/(jpeg|png|gif|svg\+xml|bmp|tiff)$/;
const MODERN = /^image\/(webp|avif)$/;

export function baseName(url) {
  let name = 'image';
  try {
    const u = new URL(url);
    if (/^https?:$/.test(u.protocol)) {
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      if (last) name = last;
    }
  } catch { /* data: or blob: */ }
  name = name.replace(/=(?:[swh]\d+|d)[^=]*$/i, '');                  // Google "=s0", "=d"
  name = name.replace(/\.(webp|avif|jpe?g|png|gif|bmp|tiff?|svg)$/i, '');
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/^[ .]+|[ .]+$/g, '');
  return (name || 'image').slice(0, 120);
}

// Trust the file's own magic bytes over the Content-Type header.
export function sniffType(b, headerType) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76) return 'image/avif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return 'image/tiff';
  return (headerType || '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
}

// Width, height and "animated" straight from the file header (no decoding).
export function imageInfo(b) {
  const u16be = (i) => (b[i] << 8) | b[i + 1];
  const u32be = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const u16le = (i) => b[i] | (b[i + 1] << 8);
  const u24le = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const tag = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  try {
    if (b[0] === 0x89 && tag(1, 3) === 'PNG') {
      const head = tag(0, Math.min(b.length, 4096));
      return { width: u32be(16), height: u32be(20), animated: head.includes('acTL') };
    }
    if (tag(0, 3) === 'GIF') return { width: u16le(6), height: u16le(8) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: u16be(i + 7), height: u16be(i + 5) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + u16be(i + 2);
      }
    }
    if (tag(0, 4) === 'RIFF' && tag(8, 4) === 'WEBP') {
      const fmt = tag(12, 4);
      if (fmt === 'VP8X') return { width: 1 + u24le(24), height: 1 + u24le(27), animated: !!(b[20] & 0x02) };
      if (fmt === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
      if (fmt === 'VP8L') {
        const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
        return { width: 1 + (v & 0x3fff), height: 1 + ((v >>> 14) & 0x3fff) };
      }
    }
  } catch { /* truncated header */ }
  return {};
}

export function fmtSize(n) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

// Order: platform originals of the clicked image, then bigger versions the page
// itself lists (zoom links, srcset), then generic guesses, then the clicked URL.
// items: [{ url, kind: 'current'|'link'|'hires'|'srcset'|'src'|'bg'|'poster', w }]
export function buildCandidates(src, items = []) {
  const out = [];
  const add = (x) => { if (x && !out.includes(x)) out.push(x); };
  strong(src).forEach(add);
  const clickedW = items.find((i) => i.url === src)?.w || 0;
  const rank = { link: 0, hires: 1, srcset: 2, current: 3, src: 3, bg: 4, poster: 4 };
  const others = items
    .filter((i) => i.url !== src)
    .sort((a, b) => (rank[a.kind] ?? 5) - (rank[b.kind] ?? 5) || (b.w || 0) - (a.w || 0));
  const big = others.filter((i) => !i.w || !clickedW || i.w >= clickedW);
  const small = others.filter((i) => !big.includes(i));
  for (const i of big) { strong(i.url).forEach(add); add(i.url); }
  weak(src).forEach(add);
  add(stripFormatParams(src));
  add(src);
  for (const i of small) { strong(i.url).forEach(add); add(i.url); }
  for (const i of big.slice(0, 3)) weak(i.url).forEach(add);
  return out.slice(0, 60);
}

// Ask for one candidate but read only its first bytes: enough to know what it is.
export async function probe(url, timeoutMs = 12000) {
  if (!/^(https?|data):/i.test(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', headers: { Accept: NO_WEBP_ACCEPT }, signal: ctrl.signal });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    let head = new Uint8Array(0);
    while (head.length < 64) {
      const { value, done } = await reader.read();
      if (done) break;
      const n = new Uint8Array(head.length + value.length);
      n.set(head); n.set(value, head.length);
      head = n;
    }
    reader.cancel().catch(() => {});
    const type = sniffType(head, res.headers.get('content-type'));
    const length = Number(res.headers.get('content-length')) || 0;
    const info = imageInfo(head);
    return { url, type, length, ...info };
  } catch { return null; } finally { clearTimeout(timer); }
}

// Placeholders some CDNs answer with instead of a 404 (1x1 GIFs, "no image" icons).
const isPlaceholder = (r, src) => r.url !== src && ((r.length && r.length < 1500) || (r.width && r.width < 32 && r.height < 32));

// First candidate that really is a JPG/PNG/GIF wins (6 requests at a time, order kept).
// Also remembers the first WebP/AVIF in case the site has nothing else.
export async function findBest(cands, { src, pageFetch, batch = 6 } = {}) {
  let webp = null;
  for (let i = 0; i < cands.length; i += batch) {
    const res = await Promise.all(cands.slice(i, i + batch).map((u) => probe(u)));
    for (const r of res) {
      if (!r || isPlaceholder(r, src)) continue;
      if (ORIGINAL.test(r.type)) return { best: r, webp };
      if (MODERN.test(r.type) && !webp) webp = r;
    }
  }
  if (!webp && pageFetch && src) {               // blob: URLs, or sites that refuse the extension
    try {
      const { type, ...info } = await bytesViaPage(src, pageFetch);
      const r = { url: src, type, viaPage: true, ...info };
      if (ORIGINAL.test(type)) return { best: r, webp: null };
      if (MODERN.test(type)) webp = r;
    } catch { /* nothing else to try */ }
  }
  return { best: null, webp };
}

async function bytesViaPage(url, pageFetch) {
  const dataUrl = await pageFetch(url);
  const res = await fetch(dataUrl);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, type: sniffType(bytes, res.headers.get('content-type')), ...imageInfo(bytes) };
}

export async function fetchBytes(url, pageFetch) {
  if (/^(https?|data):/i.test(url)) {
    try {
      const res = await fetch(url, { credentials: 'include', cache: 'no-store', headers: { Accept: NO_WEBP_ACCEPT } });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { bytes, type: sniffType(bytes, res.headers.get('content-type')) };
      }
    } catch { /* try through the page */ }
  }
  if (!pageFetch) throw new Error('could not download the image');
  const { bytes, type } = await bytesViaPage(url, pageFetch);
  return { bytes, type };
}

export function bytesToDataUrl(bytes, type) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

// Only on request: re-encode (JPG goes on white, it has no transparency).
// Animated WebP/AVIF keep only their first frame.
export async function convertBytes(bytes, fromType, toType) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: fromType }));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  if (toType === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, bmp.width, bmp.height); }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const out = await canvas.convertToBlob(toType === 'image/jpeg' ? { type: toType, quality: 0.95 } : { type: toType });
  return new Uint8Array(await out.arrayBuffer());
}
