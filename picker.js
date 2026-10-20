// Content script (the extension's isolated world, every frame).
// 1. Remembers where the last right-click happened, so an image hidden under a
//    transparent overlay (social sites, galleries, shop zoom widgets) can still be found.
// 2. Lists every address the page has for an image: srcset, <picture> sources,
//    zoom / lightbox links, lazy-load and "original file" attributes.
// 3. Alt + right-click keeps a page from cancelling the browser's menu.
(() => {
  if (globalThis.__sio) return;

  let last = null;     // last right-click
  let move = null;     // last mouse position (for the keyboard shortcut)
  let unblock = true;
  try {
    chrome.storage.sync.get({ unblockAlt: true }, (s) => { unblock = !!s.unblockAlt; });
    chrome.storage.onChanged.addListener((c) => { if (c.unblockAlt) unblock = !!c.unblockAlt.newValue; });
  } catch { /* injected into a page where storage isn't reachable */ }

  addEventListener('contextmenu', (e) => {
    last = { x: e.clientX, y: e.clientY };
    // We run first (document_start, capture on window): stopping the event here
    // means the page's own "no right-click" handlers never see it.
    if (unblock && e.altKey) e.stopImmediatePropagation();
  }, true);
  addEventListener('pointermove', (e) => { move = { x: e.clientX, y: e.clientY, t: Date.now() }; }, { capture: true, passive: true });
  // ms since the mouse last moved in this frame (the shortcut picks the freshest frame)
  const pointerAge = () => (move ? Date.now() - move.t : 1e12);

  const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
  const HIRES_ATTRS = [
    'data-orig-file', 'data-large_image', 'data-zoom-image', 'data-zoom', 'data-zoom-src', 'data-zoom-image-url',
    'data-magnify-src', 'data-full', 'data-full-src', 'data-fullsrc', 'data-full-url', 'data-hires', 'data-hi-res',
    'data-highres', 'data-large', 'data-large-src', 'data-large-file', 'data-big', 'data-orig', 'data-original-src',
    'data-pswp-src', 'data-master', 'data-image-large', 'data-src-large',
  ];
  const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-echo', 'data-url'];
  const SRCSET_ATTRS = ['srcset', 'data-srcset', 'data-lazy-srcset'];
  const LIGHTBOX = '[data-fancybox],[data-lightbox],[data-pswp-width],[data-gallery],[rel^=lightbox],.lightbox,.glightbox,.fancybox,.mfp-image,.woocommerce-product-gallery__image a';

  const abs = (u) => {
    if (!u) return null;
    try {
      const v = new URL(String(u).trim(), document.baseURI);
      return /^(https?|data|blob):$/.test(v.protocol) ? v.href : null;
    } catch { return null; }
  };

  // srcset URLs may contain commas (Cloudinary "w_600,c_fill"), so split on the
  // descriptor, not on every comma.
  function parseSrcset(s) {
    const out = [];
    let i = 0;
    s = s || '';
    while (i < s.length) {
      while (i < s.length && /[\s,]/.test(s[i])) i++;
      let j = i;
      while (j < s.length && !/\s/.test(s[j])) j++;
      let url = s.slice(i, j);
      i = j;
      let desc = '';
      if (url.endsWith(',')) url = url.replace(/,+$/, '');
      else {
        let k = i;
        while (k < s.length && s[k] !== ',') k++;
        desc = s.slice(i, k).trim();
        i = k + 1;
      }
      if (url) out.push({ url, desc });
    }
    return out;
  }

  function itemsForImg(img) {
    const items = [];
    const seen = new Set();
    const add = (u, kind, w = 0) => {
      const a = abs(u);
      if (!a || seen.has(a)) return;
      seen.add(a);
      items.push({ url: a, kind, w });
    };
    const nw = img.naturalWidth || img.width || 0;
    const fromSrcset = (attr) => {
      for (const { url, desc } of parseSrcset(attr)) {
        const m = desc.match(/^([\d.]+)([wx])$/);
        add(url, 'srcset', m ? (m[2] === 'w' ? +m[1] : Math.round(+m[1] * (nw || 1000))) : 0);
      }
    };
    add(img.currentSrc || img.src, 'current', nw);
    const a = img.closest('a[href]');
    if (a) {
      const href = a.getAttribute('href');
      if (IMG_EXT.test(href) || a.matches(LIGHTBOX)) add(href, 'link');
      for (const at of HIRES_ATTRS) if (a.hasAttribute(at)) add(a.getAttribute(at), 'hires');
    }
    let el = img;
    for (let d = 0; el && d < 4; d++, el = el.parentElement) {
      for (const at of HIRES_ATTRS) { const v = el.getAttribute?.(at); if (v) add(v, 'hires'); }
      if (d === 0) for (const at of LAZY_ATTRS) { const v = el.getAttribute(at); if (v) add(v, 'src'); }
    }
    for (const at of SRCSET_ATTRS) { const v = img.getAttribute(at); if (v) fromSrcset(v); }
    const pic = img.parentElement?.tagName === 'PICTURE' ? img.parentElement : null;
    if (pic) for (const s of pic.querySelectorAll('source')) fromSrcset(s.getAttribute('srcset') || s.getAttribute('data-srcset'));
    add(img.getAttribute('src'), 'src');
    return items;
  }

  function bgUrl(el) {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') return null;
    const m = bg.match(/url\((['"]?)(.*?)\1\)/);
    return m ? m[2] : null;
  }

  function hitsAt(x, y, root = document, depth = 0) {
    const hits = root.elementsFromPoint(x, y);
    if (depth < 3) {
      for (const el of [...hits]) if (el.shadowRoot) hits.push(...hitsAt(x, y, el.shadowRoot, depth + 1));
    }
    return hits;
  }

  function atPoint(x, y) {
    const hits = hitsAt(x, y);
    for (const el of hits) {                         // topmost real image first
      if (el instanceof HTMLImageElement && (el.currentSrc || el.src)) return { img: el };
      if (el instanceof HTMLVideoElement && el.poster) return { url: el.poster, kind: 'poster' };
      if (el instanceof SVGImageElement && el.href?.baseVal) return { url: el.href.baseVal, kind: 'src' };
    }
    // images with pointer-events:none are skipped by hit-testing: check geometry
    let best = null;
    for (const img of document.images) {
      const r = img.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && (!best || area < best.area)) best = { img, area };
    }
    if (best) return { img: best.img };
    for (const el of hits) {                         // CSS background images last
      if (el === document.documentElement || el === document.body) continue;
      const u = bgUrl(el);
      if (u) return { url: u, kind: 'bg' };
    }
    return null;
  }

  function collect(srcUrl, usePointer = false) {
    const pt = usePointer ? move : last;
    if (srcUrl) {
      const imgs = [...document.images].filter((i) => i.currentSrc === srcUrl || i.src === srcUrl);
      let img = imgs[0];
      if (imgs.length > 1 && pt) {
        img = imgs.find((i) => {
          const r = i.getBoundingClientRect();
          return pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
        }) || img;
      }
      return { primary: srcUrl, items: img ? itemsForImg(img) : [] };
    }
    if (!pt) return { primary: null, items: [], noPoint: true };
    const hit = atPoint(pt.x, pt.y);
    if (!hit) return { primary: null, items: [] };
    if (hit.img) {
      const items = itemsForImg(hit.img);
      return { primary: items[0]?.url || null, items };
    }
    const u = abs(hit.url);
    return { primary: u, items: u ? [{ url: u, kind: hit.kind, w: 0 }] : [] };
  }

  // Fetch from inside the page (its cookies, its Referer, blob: URLs).
  async function fetchAsDataUrl(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const b = await r.blob();
    return await new Promise((ok, no) => {
      const f = new FileReader();
      f.onload = () => ok(f.result);
      f.onerror = () => no(f.error);
      f.readAsDataURL(b);
    });
  }

  // actions: [{ type: 'open' | 'copy', url, label, done }]
  function toast(msg, kind = 'info', actions = []) {
    if (window.top !== window) return;
    document.getElementById('__sio_toast')?.remove();
    const host = document.createElement('div');
    host.id = '__sio_toast';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
    const root = host.attachShadow({ mode: 'open' });
    const bg = { ok: '#14532d', warn: '#7c2d12', err: '#7f1d1d' }[kind] || '#1f2937';
    root.innerHTML = `<style>
      .box{font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:${bg};padding:10px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.35);max-width:380px}
      .row{display:flex;gap:8px;margin-top:8px}
      button{font:inherit;font-size:12px;color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);border-radius:6px;padding:3px 10px;cursor:pointer}
      button:hover{background:rgba(255,255,255,.26)}
    </style><div class="box"><div class="msg"></div><div class="row"></div></div>`;
    root.querySelector('.msg').textContent = msg;
    const row = root.querySelector('.row');
    if (!actions.length) row.remove();
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.addEventListener('click', async () => {
        if (a.type === 'open') window.open(a.url, '_blank', 'noopener');
        if (a.type === 'copy') {
          try { await navigator.clipboard.writeText(a.url); } catch {
            const ta = document.createElement('textarea');
            ta.value = a.url; root.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
          }
          b.textContent = a.done || a.label;
        }
      });
      row.appendChild(b);
    }
    (document.body || document.documentElement).appendChild(host);
    clearTimeout(toast.t);
    const life = kind === 'info' ? 15000 : actions.length ? 9000 : 5000;
    const arm = () => { toast.t = setTimeout(() => host.remove(), life); };
    host.addEventListener('mouseenter', () => clearTimeout(toast.t));   // stays while you hover it
    host.addEventListener('mouseleave', arm);
    arm();
  }

  globalThis.__sio = { collect, fetchAsDataUrl, toast, pointerAge };
})();
