// Where sites keep the untouched original behind a resized / WebP copy.
//   strong(url): addresses of the original on known platforms and image proxies
//   weak(url):   generic guesses (another extension, no resize parameters)
// Every candidate is only a guess: the caller requests it and keeps it only if
// the server really answers with a JPG/PNG/GIF. A wrong guess costs one 404.

const IMG_EXTS = ['jpg', 'jpeg', 'png'];
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|heic|svg)$/i;

// Query parameters that only resize / re-encode (imgix, Fastly, Akamai, Bunny,
// Sirv, Gumlet, Netlify, ExactDN, Shopify, WordPress.com ...).
export const RESIZE_KEYS = new Set([
  'w', 'width', 'h', 'height', 'q', 'quality', 'fit', 'crop', 'resize', 'auto', 'fm', 'format',
  'output', 'dpr', 'sz', 'size', 'imwidth', 'imheight', 'impolicy', 'tr', 'twic', 'nf_resize',
  'strip', 'lossy', 'sharp', 'blur', 'scale', 'mode', 'rmode', 'anchor', 'bgcolor', 'compress',
  'optimize', 'fl', 'pad_color', 'cs', 'dl', 'ssl', 'zoom', 'maxwidth', 'maxheight', 'downsize',
]);

// Drop query params that force WebP/AVIF (?format=webp, &fm=webp, &output=avif ...).
export function stripFormatParams(url) {
  const u = parse(url);
  if (!u) return url;
  for (const k of [...u.searchParams.keys()]) {
    if (/^(format|fm|output|ext|type|f)$/i.test(k) && /^(webp|avif|auto|pjpg)$/i.test(u.searchParams.get(k))) {
      u.searchParams.delete(k);
    }
    if (/^auto$/i.test(k) && /webp|avif|format/i.test(u.searchParams.get(k))) u.searchParams.delete(k);
  }
  return u.href;
}

function parse(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch { return null; }
}
function setPath(u, path, keepQuery = true) {
  const v = new URL(u.href);
  v.pathname = path;
  if (!keepQuery) v.search = '';
  v.hash = '';
  return v.href;
}
function noQuery(u) { const v = new URL(u.href); v.search = ''; v.hash = ''; return v.href; }
function collector() {
  const out = [];
  return [out, (x) => { if (x && !out.includes(x)) out.push(x); }];
}
const exts = (u, stem, add, keepQuery = false, list = IMG_EXTS) => { for (const e of list) add(setPath(u, `${stem}.${e}`, keepQuery)); };

// ---------------------------------------------------------------- image proxies
// The original's address written inside the proxy URL: Next.js /_next/image?url=,
// Astro ?href=, Netlify, Vercel, wsrv.nl, Cloudinary /fetch/, Substack, Optimole,
// ShortPixel, imgproxy (plain or base64), Cloudflare, Notion, Bing ?mediaurl= ...
const URL_PARAMS = new Set(['url', 'src', 'image', 'img', 'imgurl', 'image_url', 'imageurl', 'mediaurl', 'href', 'u', 'source', 'file']);
const looksImagePath = (s) => IMG_EXT_RE.test(s.split(/[?#]/)[0]);

function embedded(u) {
  const out = [];
  for (const [k, v0] of u.searchParams) {
    if (!URL_PARAMS.has(k.toLowerCase())) continue;
    const v = v0.trim();
    if (/^https?:\/\//i.test(v)) out.push(v);
    else if (v.startsWith('//')) out.push('https:' + v);
    else if (v.startsWith('/')) out.push(new URL(v, u.origin).href);
    else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(v) && looksImagePath(v)) out.push('https://' + v);
  }
  // URL-encoded inside the path: the inner query is encoded too, so stop at the outer "?"
  const enc = u.pathname.match(/\/(https?)%3A%2F%2F(.+)$/i);
  if (enc) {
    try { out.push(decodeURIComponent(`${enc[1]}%3A%2F%2F${enc[2]}`).replace(/@(webp|avif|jpe?g|png|gif)$/i, '')); } catch { /* bad escape */ }
  } else {
    // written raw: the inner query string is the outer one
    const raw = u.href.slice(u.origin.length).match(/\/(https?):\/\/?(.+)$/i);
    if (raw) out.push(`${raw[1].toLowerCase()}://${raw[2]}`.replace(/@(webp|avif|jpe?g|png|gif)$/i, ''));
  }
  // base64url path segment (imgproxy, Statamic Glide)
  for (const seg of u.pathname.split('/')) {
    const s = seg.replace(/\.[a-z0-9]{3,4}$/i, '');
    if (s.length < 16 || !/^[A-Za-z0-9_-]+={0,2}$/.test(s)) continue;
    let dec;
    try { dec = atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch { continue; }
    if (/^https?:\/\/[\x21-\x7e]+$/.test(dec)) out.push(dec);
    else if (/^[\x21-\x7e]+$/.test(dec) && looksImagePath(dec) && !dec.includes('://')) {
      out.push(new URL('/' + dec.replace(/^[^/:]+::/, '').replace(/^\/+/, ''), u.origin).href);
    }
  }
  return out.filter((x) => parse(x) && x !== u.href);
}

// ---------------------------------------------------------------- platforms
const CLOUDINARY_TX = new Set('a ac af ar b bo br c co cs d dl dn dpr du e eo f fl fn fps g h if ki l o p pg q r so sp t u vc vs w x y z'.split(' '));

function wordpress(u, add) {
  let p = u.pathname
    .replace(/\/wp-content\/webp-express\/webp-images\/doc-root\//, '/')        // WebP Express
    .replace(/\/wp-content\/webp-express\/webp-images\/uploads\//, '/wp-content/uploads/')
    .replace(/\/wp-content\/uploads-webpc\//, '/wp-content/uploads/');            // WebP Converter for Media
  const isWp = /\/wp-content\/|\/files\/\d{4}\/\d{2}\//.test(p) || /(^|\.)files\.wordpress\.com$/.test(u.hostname);
  if (!isWp) return;
  let m = p.match(/^(.*\.(?:jpe?g|png|gif))\.(?:webp|avif)$/i);                   // photo.jpg.webp
  if (m) p = m[1];
  m = p.match(/^(.*\/)([^/]+?)\.(webp|avif|jpe?g|png|gif)$/i);
  if (!m) return;
  const [, dir, name, ext] = m;
  const keep = /webp|avif/i.test(ext) ? [] : [ext];
  const noSize = name.replace(/-\d+x\d+(@\dx)?$/i, '');                          // -1024x683 thumbnails
  const pristine = noSize.replace(/-(scaled|rotated)$/i, '').replace(/-e\d{12,14}$/i, ''); // big-image / edited copies
  for (const stem of [...new Set([pristine, noSize, name])]) {
    for (const e of [...keep, ...IMG_EXTS]) add(setPath(u, `${dir}${stem}.${e}`, false));
  }
}

const RULES = [
  // Tiendanube / Nuvemshop: name-640-0.webp -> name.jpg (the untouched upload)
  (u, add) => {
    if (!/(mitiendanube|tiendanube|nuvemshop)\.com(\.br)?$/.test(u.hostname) && !/\/stores\/\d+\/\d+\/products\//.test(u.pathname)) return;
    const m = u.pathname.match(/^(.*?)(-\d+-\d+)?\.(webp|avif|jpe?g|png|gif)$/i);
    if (!m) return;
    exts(u, m[1], add, true);
    if (m[2]) add(setPath(u, `${m[1]}${m[2]}.jpg`));
  },
  // Shopify: drop ?width=/&crop= and _1024x1024 / _crop_center / @2x name suffixes
  (u, add) => {
    if (!((/(^|\.)shopify\.com$/.test(u.hostname) && u.pathname.includes('/files/')) || /^\/cdn\/shop\//.test(u.pathname))) return;
    const v = new URL(u.href);
    for (const k of ['width', 'height', 'crop', 'pad_color', 'format', 'quality']) v.searchParams.delete(k);
    v.pathname = v.pathname
      .replace(/(\.(?:jpe?g|png|gif))\.(?:webp|avif)$/i, '$1')
      .replace(/_(?:\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(?:_crop_[a-z]+)?(?:@\dx)?(?=\.[a-z]+$)/i, '')
      .replace(/_crop_[a-z]+(?=\.[a-z]+$)/i, '');
    add(v.href);
  },
  // WordPress / WooCommerce (+ WebP Express, WebP Converter, Jetpack Photon, WordPress.com)
  (u, add) => {
    const m = /^i[0-3]\.wp\.com$/.test(u.hostname) && u.pathname.match(/^\/([^/]+\.[^/]+)(\/.+)$/);
    if (m) {
      const orig = parse(`https://${m[1]}${m[2]}`);
      if (orig) { wordpress(orig, add); add(orig.href); }
      add(noQuery(u));
    }
    if (/(^|\.)files\.wordpress\.com$/.test(u.hostname) && u.search) add(noQuery(u));
    wordpress(u, add);
  },
  // Wix (and DeviantArt's wixmp): /media/<file>/v1/fill/... -> /media/<file>
  (u, add) => {
    if (!/(wixstatic|wixmp)\.com$/.test(u.hostname)) return;
    const i = u.pathname.indexOf('/v1/');
    if (i > 0) add(setPath(u, u.pathname.slice(0, i), /wixmp/.test(u.hostname)));
  },
  // Squarespace: ?format=750w -> ?format=original
  (u, add) => {
    if (!/squarespace(-cdn)?\.com$/.test(u.hostname)) return;
    const v = new URL(u.href); v.searchParams.set('format', 'original'); add(v.href);
  },
  // Cloudinary (also custom domains): drop transformation segments; no extension = original format
  (u, add) => {
    const m = u.pathname.match(/^(.*?\/(?:image|video)\/(?:upload|private|authenticated)\/)(.*)$/);
    if (!m || !(/cloudinary\.com$/.test(u.hostname) || /\/image\/upload\//.test(u.pathname))) return;
    const segs = m[2].split('/');
    const isTx = (s) => !/^v\d+$/.test(s) && s.split(',').every((part) => {
      const k = part.match(/^([a-z]{1,3})_./); return !!k && CLOUDINARY_TX.has(k[1]);
    });
    while (segs.length > 1 && isTx(segs[0])) segs.shift();
    const stem = segs.join('/').replace(/\.[a-z0-9]+$/i, '');
    add(setPath(u, m[1] + stem, false));
    exts(u, m[1] + stem, add);
  },
  // imgix-style CDNs: the bare URL with no parameters is the original
  (u, add) => {
    if (!u.search) return;
    if (/(imgix\.net|images\.unsplash\.com|plus\.unsplash\.com|cdn\.sanity\.io|images\.ctfassets\.net|images\.prismic\.io|datocms-assets\.com|images\.pexels\.com|cdn\.dribbble\.com|cdn\.buttercms\.com|cdn\.builder\.io|exactdn\.com|kxcdn\.com|b-cdn\.net|sirv\.com|gumlet\.io)$/.test(u.hostname)
      || u.searchParams.has('ixlib')) add(noQuery(u));
  },
  // ImageKit: /tr:w-600,f-webp/ segment or ?tr=
  (u, add) => {
    if (!/imagekit\.io$/.test(u.hostname) && !/\/tr:/.test(u.pathname) && !u.searchParams.has('tr')) return;
    const v = new URL(u.href);
    v.pathname = v.pathname.replace(/\/tr:[^/]+/g, '');
    v.searchParams.delete('tr');
    add(v.href);
  },
  // Uploadcare: /<uuid>/-/resize/600x/-/format/webp/ -> /<uuid>/
  (u, add) => {
    if (!/(ucarecdn\.com|ucarecd\.net|uploadcare\.com)$/.test(u.hostname)) return;
    const i = u.pathname.indexOf('/-/');
    if (i > 0) add(setPath(u, u.pathname.slice(0, i + 1), false));
  },
  // Filestack / Hygraph: /resize=width:300/output=format:webp/<handle> -> /<handle>
  (u, add) => {
    if (!/(filestackcontent\.com|graphassets\.com)$/.test(u.hostname)) return;
    const segs = u.pathname.split('/').filter((s) => s && !s.includes('='));
    if (segs.length) add(setPath(u, '/' + segs.join('/'), false));
  },
  // Storyblok: .../photo.jpg/m/600x0/filters:format(webp) -> .../photo.jpg
  (u, add) => {
    if (!/storyblok\.com$/.test(u.hostname)) return;
    const i = u.pathname.indexOf('/m/');
    if (i > 0) add(setPath(u, u.pathname.slice(0, i), false));
    const m = u.pathname.match(/\/(f\/\d+\/.+?)(?:\/m\/.*)?$/);
    if (m && !/^a\./.test(u.hostname)) add(`https://a.storyblok.com/${m[1]}`);
  },
  // Cloudflare Image Resizing: /cdn-cgi/image/<options>/<path>
  (u, add) => {
    const m = u.pathname.match(/^\/cdn-cgi\/image\/[^/]+\/(.+)$/);
    if (m && !/^https?:/i.test(m[1])) add(setPath(u, '/' + m[1]));
  },
  // Nuxt Image (IPX): /_ipx/<modifiers>/<path>
  (u, add) => {
    const m = u.pathname.match(/^\/_ipx\/[^/]+\/(.+)$/);
    if (m && !/^https?(:|%3A)/i.test(m[1])) add(setPath(u, '/' + m[1], false));
  },
  // Thumbor: /unsafe/300x200/smart/filters:format(webp)/<image>
  (u, add) => {
    const m = u.pathname.match(/^\/(?:unsafe|[A-Za-z0-9_-]{27}=)\/(.+)$/);
    if (!m) return;
    const segs = m[1].split('/');
    const opt = /^(trim(:.*)?|meta|fit-in|adaptive-fit-in|full-fit-in|smart|-?\d+x-?\d+|-?\d+x-?\d+:-?\d+x-?\d+|left|right|center|top|middle|bottom|filters:.*)$/;
    while (segs.length > 1 && opt.test(segs[0])) segs.shift();
    let rest = segs.join('/');
    try { rest = decodeURIComponent(rest); } catch { /* keep as is */ }
    if (/^https?:\/\//i.test(rest)) add(rest);
    else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(rest)) add('https://' + rest);
    else add(setPath(u, '/' + segs.join('/'), false));
  },
  // Magento: /media/catalog/product/cache/<hash>/a/b/photo.jpg -> /media/catalog/product/a/b/photo.jpg
  (u, add) => {
    const m = u.pathname.match(/^(.*\/media\/catalog\/product)\/cache\/.*?(\/[^/]\/[^/]\/[^/]+)$/);
    if (!m) return;
    const file = m[2].replace(/(\.(?:jpe?g|png|gif))\.(?:webp|avif)$/i, '$1');
    add(setPath(u, m[1] + file, false));
    const s = file.match(/^(.*)\.(webp|avif)$/i);
    if (s) exts(u, m[1] + s[1], add);
  },
  // PrestaShop: /img/p/1/2/12-large_default.webp, /12-large_default/slug.webp
  (u, add) => {
    let m = u.pathname.match(/^(.*\/img\/p\/(?:\d\/)+)(\d+)-[a-z0-9_]+?_default(?:-\dx)?\.(webp|avif|jpe?g|png)$/i);
    if (m) { exts(u, m[1] + m[2], add); return; }
    m = u.pathname.match(/^(.*\/)(\d+)-[a-z0-9_]+?_default(?:-\dx)?\/([^/]+)\.(webp|avif|jpe?g|png)$/i);
    if (m) exts(u, `${m[1]}${m[2]}/${m[3]}`, add);
  },
  // BigCommerce: /images/stencil/500x659/... -> /images/stencil/original/...
  (u, add) => {
    if (!/\/images\/stencil\/[^/]+\//.test(u.pathname) || /\/stencil\/original\//.test(u.pathname)) return;
    const p = u.pathname.replace(/\/images\/stencil\/[^/]+\//, '/images/stencil/original/');
    add(setPath(u, p));
    const m = p.match(/^(.*)\.(webp|avif)$/i);
    if (m) exts(u, m[1], add, true);
  },
  // Ghost: /content/images/size/w600/format/webp/2024/01/photo.jpg -> /content/images/2024/01/photo.jpg
  (u, add) => {
    const m = u.pathname.match(/^(.*\/content\/images)\/size\/[^/]+\/(?:format\/[^/]+\/)?(.+)$/);
    if (m) add(setPath(u, `${m[1]}/${m[2]}`, false));
  },
  // Drupal image styles: /sites/default/files/styles/large/public/photo.jpg.webp?itok= -> /sites/default/files/photo.jpg
  (u, add) => {
    const m = u.pathname.match(/^(.*\/(?:sites\/[^/]+\/files|system\/files))\/styles\/[^/]+\/(?:public|private)\/(.+?)(?:\.(?:webp|avif))?$/);
    if (m) add(setPath(u, `${m[1]}/${m[2]}`, false));
  },
  // Craft CMS transforms: /uploads/_1200x800_crop_center-center_82_line/photo.jpg -> /uploads/photo.jpg
  (u, add) => {
    const m = u.pathname.match(/^(.*\/)_[^/]*(?:\d+x\d+|AUTOx\d+|\d+xAUTO)[^/]*\/([^/]+)$/i);
    if (!m) return;
    add(setPath(u, m[1] + m[2]));
    const s = m[2].match(/^(.*)\.(webp|avif)$/i);
    if (s) exts(u, m[1] + s[1], add);
  },
  // Hugo: photo_hu1a2b3c..._600x0_resize_q75_box.webp -> photo.jpg
  (u, add) => {
    const m = u.pathname.match(/^(.*\/[^/]+?)_hu_?[0-9a-f]{6,}[^/]*\.(webp|avif|jpe?g|png|gif)$/i);
    if (m) exts(u, m[1], add);
  },
  // Wikimedia: /wikipedia/commons/thumb/a/a9/File.jpg/640px-File.jpg -> /wikipedia/commons/a/a9/File.jpg
  (u, add) => {
    if (u.hostname !== 'upload.wikimedia.org') return;
    const m = u.pathname.match(/^(\/[^/]+\/[^/]+)\/thumb\/([0-9a-f]\/[0-9a-f]{2}\/[^/]+)\/[^/]+$/);
    if (m) add(setPath(u, `${m[1]}/${m[2]}`, false));
  },
  // Fandom: /images/a/ab/File.png/revision/latest/scale-to-width-down/300 -> /revision/latest
  (u, add) => {
    if (!/wikia\.nocookie\.net$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(.*\/revision\/latest)\/.+$/);
    const v = new URL(u.href);
    if (m) v.pathname = m[1];
    v.searchParams.delete('format');
    if (v.href !== u.href) add(v.href);
  },
  // Medium: /v2/resize:fit:720/format:webp/1*abc.png
  (u, add) => {
    if (!/(miro\.medium\.com|cdn-images-\d\.medium\.com)$/.test(u.hostname)) return;
    const id = u.pathname.match(/\/(\d\*[^/]+|[0-9a-f]{20,}[^/]*)$/i)?.[1];
    if (!id) return;
    add(`https://miro.medium.com/v2/${id}`);
    add(`https://miro.medium.com/v2/resize:fit:4800/${id}`);
  },
  // Behance: /project_modules/1400_webp/abc.png -> /project_modules/source/abc.png
  (u, add) => {
    if (!/behance\.net$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(.*\/project_modules)\/[^/]+\/([^/]+)$/);
    if (m) for (const s of ['source', 'max_3840', 'fs', 'max_1200', '1400']) add(setPath(u, `${m[1]}/${s}/${m[2]}`, false));
  },
  // ArtStation: /large/ or /medium/ -> /4k/
  (u, add) => {
    if (!/artstation\.com$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(.*\/)(?:smaller_square|small_square|micro_square|small|medium|large|4k)\/(.+)$/);
    if (m) { add(setPath(u, `${m[1]}4k/${m[2]}`)); add(setPath(u, `${m[1]}large/${m[2]}`)); }
  },
  // Pinterest: /236x/ab/cd/ef/hash.jpg -> /originals/ab/cd/ef/hash.jpg
  (u, add) => {
    if (!/pinimg\.com$/.test(u.hostname) || u.pathname.startsWith('/originals/')) return;
    const m = u.pathname.match(/^\/[^/]+\/(.+?)\.\w+$/);
    if (m) for (const e of ['jpg', 'png', 'gif']) add(setPath(u, `/originals/${m[1]}.${e}`, false));
  },
  // Twitter / X: /media/ID?format=webp&name=small -> ?format=jpg&name=orig; profile pics without _normal
  (u, add) => {
    if (!/twimg\.com$/.test(u.hostname)) return;
    let m = u.pathname.match(/^(\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/[^.:]+?)(?:\.(\w+))?(?::\w+)?$/);
    if (m) {
      const fmt = (m[2] || u.searchParams.get('format') || 'jpg').toLowerCase();
      for (const e of [...new Set([fmt === 'webp' ? 'jpg' : fmt, 'jpg', 'png'])]) add(`https://pbs.twimg.com${m[1]}?format=${e}&name=orig`);
    }
    m = u.pathname.match(/^(\/profile_(?:images|banners)\/.+?)_(?:normal|bigger|mini|reasonably_small|\d+x\d+)(\.\w+)?$/);
    if (m) add(setPath(u, m[1] + (m[2] || ''), false));
  },
  // Reddit: preview.redd.it/<name>?width=640&auto=webp&s=... -> i.redd.it/<name>
  (u, add) => {
    if (u.hostname !== 'preview.redd.it') return;
    const name = u.pathname.slice(1);
    const m = name.match(/-v0-([a-z0-9]+\.\w+)$/i);
    add(`https://i.redd.it/${m ? m[1] : name}`);
  },
  // Discord: media.discordapp.net (resized) -> cdn.discordapp.com (original, keeps the signature)
  (u, add) => {
    if (u.hostname !== 'media.discordapp.net') return;
    const v = new URL(u.href);
    v.hostname = 'cdn.discordapp.com';
    for (const k of ['format', 'width', 'height', 'quality']) v.searchParams.delete(k);
    add(v.href);
  },
  // Imgur: abcdefgm.jpg (thumbnail suffix s/b/t/m/l/h) -> abcdefg.jpg
  (u, add) => {
    if (u.hostname !== 'i.imgur.com') return;
    const m = u.pathname.match(/^\/([A-Za-z0-9]{7}|[A-Za-z0-9]{5})([sbtmlh]?)\.(\w+)$/);
    if (m) for (const e of ['jpg', 'png', 'gif']) add(`https://i.imgur.com/${m[1]}.${e}`);
  },
  // Flickr: _n/_m/_z sizes -> _b (largest size that shares the same secret)
  (u, add) => {
    if (!/staticflickr\.com$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(.*\/\d+_[0-9a-f]+)(?:_[a-z])?\.(\w+)$/);
    if (m) add(setPath(u, `${m[1]}_b.jpg`, false));
  },
  // Google (Blogger, Photos, Play, YouTube avatars): =w600-h400-rw or /s640/ -> original
  (u, add) => {
    if (!/(googleusercontent\.com|ggpht\.com|blogspot\.com|blogger\.com)$/.test(u.hostname)) return;
    const p = u.pathname;
    if (/=[^/]*$/.test(p)) { add(setPath(u, p.replace(/=[^/]*$/, '=d'), false)); add(setPath(u, p.replace(/=[^/]*$/, '=s0'), false)); }
    else if (/googleusercontent/.test(u.hostname) && !/\/[swh]\d+[^/]*\/[^/]+$/.test(p)) add(setPath(u, p + '=s0', false));
    const v = p.replace(/\/(?:s\d+|w\d+(?:-h\d+)?|h\d+)(?:-[a-z0-9-]+)?\/([^/]+)$/i, '/s0/$1');
    if (v !== p) add(setPath(u, v, false));
  },
  // YouTube thumbnails: vi_webp/ID/hqdefault.webp -> vi/ID/maxresdefault.jpg
  (u, add) => {
    if (!/ytimg\.com$/.test(u.hostname)) return;
    const m = u.pathname.match(/^\/(?:vi|vi_webp|an_webp)\/([^/]+)\//);
    if (m) for (const n of ['maxresdefault', 'sddefault', 'hqdefault']) add(`https://i.ytimg.com/vi/${m[1]}/${n}.jpg`);
  },
  // Amazon: /images/I/71abc._AC_SX679_.jpg -> /images/I/71abc.jpg
  (u, add) => {
    if (!/(media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com)$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(.*\/images\/[A-Z]\/[^/.]+)\.[^/]*\.(\w+)$/);
    if (m) for (const e of [...new Set([m[2] === 'webp' ? 'jpg' : m[2], 'jpg', 'png'])]) add(setPath(u, `${m[1]}.${e}`, false));
  },
  // eBay: s-l500.webp -> s-l1600.jpg; old $_12.JPG -> $_57.JPG
  (u, add) => {
    if (!/ebayimg\.com$/.test(u.hostname)) return;
    let m = u.pathname.match(/^(.*\/)s-l\d+\.\w+$/);
    if (m) for (const n of ['s-l1600.jpg', 's-l1600.png']) add(setPath(u, m[1] + n, false));
    m = u.pathname.match(/^(.*\/)\$_\d+\.\w+$/);
    if (m) add(setPath(u, m[1] + '$_57.JPG', false));
  },
  // AliExpress / Alibaba: Habc.jpg_640x640q90.jpg_.webp -> Habc.jpg
  (u, add) => {
    if (!/alicdn\.com$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(.*?\.(?:jpe?g|png|gif))_[^/]*$/i);
    if (m) add(setPath(u, m[1], false));
  },
  // MercadoLibre: D_NQ_NP_2X_123-MLA456_012024-F.webp -> D_NQ_NP_123-MLA456_012024-O.jpg (original size)
  (u, add) => {
    if (!/mlstatic\.com$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(.*\/)D_(?:[A-Z0-9]+_)*?(\d+-ML[A-Z]\d+_\d+)-[A-Z]\.(\w+)$/);
    if (!m) return;
    for (const pre of ['D_NQ_NP_', 'D_NQ_NP_2X_', 'D_']) add(setPath(u, `${m[1]}${pre}${m[2]}-O.jpg`, false));
    add(setPath(u, `${m[1]}D_NQ_NP_2X_${m[2]}-F.jpg`, false));
  },
  // Etsy: il_794xN.123_abc.jpg -> il_fullxfull.123_abc.jpg
  (u, add) => {
    if (!/etsystatic\.com$/.test(u.hostname)) return;
    const p = u.pathname.replace(/\/c\/\d+\/\d+\/\d+\/\d+\/il\//, '/r/il/').replace(/\/il_[0-9]+x[0-9N]+\./, '/il_fullxfull.');
    if (p !== u.pathname) add(setPath(u, p.replace(/\.(webp|avif)$/i, '.jpg'), false));
  },
  // Tumblr: /s640x960/abc.pnj -> /s2048x3072/abc.png
  (u, add) => {
    if (!/media\.tumblr\.com$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(.*\/)s\d+x\d+(?:_c\d+)?\/([^/]+?)\.(\w+)$/);
    if (m) for (const e of [m[3] === 'pnj' ? 'png' : m[3] === 'gifv' ? 'gif' : 'jpg', 'png', 'jpg']) add(setPath(u, `${m[1]}s2048x3072/${m[2]}.${e}`, false));
  },
  // SoundCloud artwork: -t500x500.jpg -> -original.jpg
  (u, add) => {
    if (!/sndcdn\.com$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(.*)-(?:t\d+x\d+|large|crop|badge|small|tiny|mini)\.(\w+)$/);
    if (m) for (const e of ['jpg', 'png']) add(setPath(u, `${m[1]}-original.${e}`, false));
  },
  // Bandcamp: a1234567890_10.jpg -> a1234567890_0.jpg (original upload)
  (u, add) => {
    if (!/bcbits\.com$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(.*\/[a-z]?\d+)_\d+\.(\w+)$/);
    if (m) add(setPath(u, `${m[1]}_0.${m[2] === 'webp' ? 'jpg' : m[2]}`, false));
  },
  // Apple Music / App Store artwork: .../600x600bb.webp -> biggest JPG
  (u, add) => {
    if (!/mzstatic\.com$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(\/image\/thumb\/.+\/)[^/]+$/);
    if (m) for (const n of ['100000x100000-999.jpg', '3000x3000bb.jpg', '3000x3000bb.png']) add(setPath(u, m[1] + n, false));
  },
  // Last.fm: /i/u/300x300/hash.jpg -> /i/u/ar0/hash.jpg (original)
  (u, add) => {
    if (!/lastfm\.freetls\.fastly\.net$|lastfm-img\d*\.akamaized\.net$/.test(u.hostname)) return;
    const m = u.pathname.match(/^(\/i\/u\/)[^/]+\/([^/]+?)(?:\.\w+)?$/);
    if (m) for (const e of ['jpg', 'png']) add(setPath(u, `${m[1]}ar0/${m[2]}.${e}`, false));
  },
  // GitHub camo proxy: hex-encoded original URL
  (u, add) => {
    if (u.hostname !== 'camo.githubusercontent.com') return;
    const last = u.pathname.split('/').pop();
    if (!/^[0-9a-f]+$/i.test(last) || last.length % 2) return;
    const s = last.match(/../g).map((x) => String.fromCharCode(parseInt(x, 16))).join('');
    if (/^https?:\/\//.test(s)) add(s);
  },
];

export function strong(url, depth = 0) {
  const u = parse(url);
  if (!u) return [];
  const [out, add] = collector();
  for (const e of embedded(u)) {
    if (depth < 2) strong(e, depth + 1).forEach(add);
    add(e);
  }
  for (const rule of RULES) {
    try { rule(u, add); } catch { /* a rule must never break the others */ }
  }
  return out.filter((x) => x !== u.href);
}

export function weak(url) {
  const u = parse(url);
  if (!u) return [];
  const [out, add] = collector();
  const p = u.pathname;
  // photo.jpg.webp (EWWW, Imagify, ShortPixel, any "add .webp" optimiser)
  let m = p.match(/^(.*\.(?:jpe?g|png|gif))\.(webp|avif)$/i);
  if (m) add(setPath(u, m[1]));
  // resized copies: photo-300x200.webp, photo_300x200.jpg, photo@2x.webp
  m = p.match(/^(.*?)(?:[-_]\d+x\d+|@\dx)+\.(webp|avif|jpe?g|png)$/i);
  if (m) exts(u, m[1], add);
  // same name, other extension
  m = p.match(/^(.*)\.(webp|avif)$/i);
  if (m && !/\.(jpe?g|png|gif)$/i.test(m[1])) { exts(u, m[1], add, true); exts(u, m[1], add); }
  // no resize / format parameters
  const v = new URL(u.href);
  for (const k of [...v.searchParams.keys()]) if (RESIZE_KEYS.has(k.toLowerCase())) v.searchParams.delete(k);
  if (v.href !== u.href) add(v.href);
  add(stripFormatParams(url));
  return out.filter((x) => x !== u.href);
}
