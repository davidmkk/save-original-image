// Live check against real sites: what Chrome shows vs. what the extension saves.
// usage: node tests/live.mjs [url ...]
import { buildCandidates, findBest, imageInfo, sniffType, fmtSize } from '../core.js';

const CHROME_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const SAMPLES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://acdn-us.mitiendanube.com/stores/627/117/products/remera1-22a61d2ad5d4b6bdc317823973782905-640-0.webp',
  'https://nextjs.org/_next/image?url=%2Fstatic%2Fimages%2Fshowcases%2Fpreview-wapo.png&w=640&q=75',
  'https://storage.ghost.io/c/2d/17/2d1720de-b48e-4729-8941-6f1d1300a8cc/content/images/size/w1200/2021/10/ghost-resources-2.png',
  'https://wptavern.com/wp-content/uploads/2021/12/cropped-tavern-favicon-180x180.png',
  'https://static.wixstatic.com/media/1a7b30_b095882cc206498084abf1d0d55358d2~mv2.jpg/v1/fill/w_147,h_103,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/Frame%202147238943.jpg',
  'https://images.squarespace-cdn.com/content/v1/5134cbefe4b0c6fb04df8065/1645126177095-6CGC98NYSXDCLOIQ4KBL/C182_H_S_Batch2.6_5_HowtoSellFoodOnline-Primary_Thumbnail-1134x758px.jpg?format=500w',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/320px-Example.jpg',
  'https://res.cloudinary.com/demo/image/upload/w_300,c_fill,f_auto/sample.webp',
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?ixlib=rb-4.0.3&w=600&fm=webp',
  'https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg?auto=compress&cs=tinysrgb&w=600',
  'https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/hqdefault.webp',
];

async function shown(url) {
  const r = await fetch(url, { headers: { Accept: CHROME_ACCEPT } });
  const b = new Uint8Array(await r.arrayBuffer());
  return { type: sniffType(b, r.headers.get('content-type')), size: b.length, ...imageInfo(b) };
}
const desc = (x) => `${x.type?.replace('image/', '').toUpperCase()} ${x.width ? `${x.width}×${x.height}` : '?'}${x.size ? ` ${fmtSize(x.size)}` : ''}`;

for (const url of SAMPLES) {
  const host = new URL(url).hostname;
  try {
    const s = await shown(url);
    const t0 = Date.now();
    const { best, webp } = await findBest(buildCandidates(url), { src: url });
    const pick = best || webp;
    let got = '';
    if (pick) {
      const r = await fetch(pick.url, { headers: { Accept: 'image/jpeg,image/png,image/gif,*/*;q=0.1' } });
      const b = new Uint8Array(await r.arrayBuffer());
      got = desc({ type: sniffType(b, r.headers.get('content-type')), size: b.length, ...imageInfo(b) });
    }
    console.log(`${best ? 'ORIGINAL' : webp ? 'WEBP-ONLY' : 'FAILED'}  ${host}\n  Chrome gets: ${desc(s)}\n  extension:   ${got || '-'}  (${Date.now() - t0} ms)\n  from: ${pick?.url || '-'}\n`);
  } catch (e) {
    console.log(`ERROR ${host}: ${e.message}\n`);
  }
}
