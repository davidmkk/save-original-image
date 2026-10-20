import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strong, weak, stripFormatParams } from '../rules.js';
import { buildCandidates, baseName, imageInfo, sniffType } from '../core.js';

// [shown URL, an address of the original that must be guessed]
const STRONG = [
  ['https://acdn-us.mitiendanube.com/stores/627/117/products/remera1-22a61d2ad5d4b6bdc317823973782905-640-0.webp', 'https://acdn-us.mitiendanube.com/stores/627/117/products/remera1-22a61d2ad5d4b6bdc317823973782905.jpg'],
  ['https://d2r9epyceweg5n.cloudfront.net/stores/001/234/products/foto1-abc-1024-1024.webp', 'https://d2r9epyceweg5n.cloudfront.net/stores/001/234/products/foto1-abc.jpg'],
  ['https://cdn.shopify.com/s/files/1/0001/products/tee_1024x1024.jpg?v=1&width=600&format=webp', 'https://cdn.shopify.com/s/files/1/0001/products/tee.jpg?v=1'],
  ['https://shop.example.com/cdn/shop/files/tee_crop_center.jpg?v=12&width=533', 'https://shop.example.com/cdn/shop/files/tee.jpg?v=12'],
  ['https://example.com/wp-content/uploads/2024/10/photo-scaled-1024x683.webp', 'https://example.com/wp-content/uploads/2024/10/photo.jpg'],
  ['https://example.com/wp-content/uploads/2024/10/photo-e1690000000000-300x200.jpg', 'https://example.com/wp-content/uploads/2024/10/photo.jpg'],
  ['https://example.com/wp-content/webp-express/webp-images/doc-root/wp-content/uploads/2024/a.png.webp', 'https://example.com/wp-content/uploads/2024/a.png'],
  ['https://example.com/wp-content/uploads-webpc/2024/01/a.jpg.webp', 'https://example.com/wp-content/uploads/2024/01/a.jpg'],
  ['https://i0.wp.com/example.com/wp-content/uploads/2024/a-768x512.jpg?resize=600%2C400&ssl=1', 'https://example.com/wp-content/uploads/2024/a.jpg'],
  ['https://static.wixstatic.com/media/abc_123~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,enc_auto/photo.webp', 'https://static.wixstatic.com/media/abc_123~mv2.jpg'],
  ['https://images.squarespace-cdn.com/content/v1/5f/abc/photo.jpg?format=750w', 'https://images.squarespace-cdn.com/content/v1/5f/abc/photo.jpg?format=original'],
  ['https://res.cloudinary.com/demo/image/upload/w_600,c_fill,g_auto/f_auto,q_auto:good/v1612345/folder/sample.webp', 'https://res.cloudinary.com/demo/image/upload/v1612345/folder/sample'],
  ['https://res.cloudinary.com/demo/image/upload/my_folder/pic.jpg', 'https://res.cloudinary.com/demo/image/upload/my_folder/pic'],
  ['https://res.cloudinary.com/demo/image/fetch/w_300,f_auto/https://example.com/a.jpg', 'https://example.com/a.jpg'],
  ['https://images.unsplash.com/photo-1506744038136-46273834b3fb?ixlib=rb-4.0.3&w=600&fm=webp', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb'],
  ['https://cdn.sanity.io/images/p/d/abc-1200x800.jpg?w=600&auto=format', 'https://cdn.sanity.io/images/p/d/abc-1200x800.jpg'],
  ['https://ik.imagekit.io/demo/tr:w-600,f-webp/img/photo.jpg', 'https://ik.imagekit.io/demo/img/photo.jpg'],
  ['https://ucarecdn.com/9b6f6b2a-1111-2222-3333-444455556666/-/resize/600x/-/format/webp/', 'https://ucarecdn.com/9b6f6b2a-1111-2222-3333-444455556666/'],
  ['https://cdn.filestackcontent.com/resize=width:300/output=format:webp/AbCdEf123', 'https://cdn.filestackcontent.com/AbCdEf123'],
  ['https://a.storyblok.com/f/39898/1200x800/abc/photo.jpg/m/600x0/filters:format(webp)', 'https://a.storyblok.com/f/39898/1200x800/abc/photo.jpg'],
  ['https://example.com/cdn-cgi/image/width=600,format=auto/uploads/a.jpg', 'https://example.com/uploads/a.jpg'],
  ['https://example.com/_next/image?url=%2Fimages%2Fhero.png&w=1080&q=75', 'https://example.com/images/hero.png'],
  ['https://example.com/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg&w=640&q=75', 'https://cdn.example.com/a.jpg'],
  ['https://example.com/_image?href=%2F_astro%2Fphoto.Hash123.jpg&w=600&f=webp', 'https://example.com/_astro/photo.Hash123.jpg'],
  ['https://example.com/_ipx/w_600&f_webp/images/a.jpg', 'https://example.com/images/a.jpg'],
  ['https://wsrv.nl/?url=example.com/a.jpg&w=300&output=webp', 'https://example.com/a.jpg'],
  ['https://substackcdn.com/image/fetch/w_1456,c_limit,f_webp,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fabc.png', 'https://substack-post-media.s3.amazonaws.com/public/images/abc.png'],
  ['https://mlxyz.i.optimole.com/w:auto/h:auto/q:mauto/f:best/https://site.com/wp-content/uploads/a-300x200.jpg', 'https://site.com/wp-content/uploads/a.jpg'],
  ['https://imgproxy.example.com/insecure/rs:fit:300/plain/https://example.com/a.jpg@webp', 'https://example.com/a.jpg'],
  ['https://imgproxy.example.com/sig/rs:fit:300/aHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZXMvYS5qcGc.webp', 'https://example.com/images/a.jpg'],
  ['https://thumbor.example.com/unsafe/300x200/smart/filters:format(webp)/example.com/a.jpg', 'https://example.com/a.jpg'],
  ['https://shop.example.com/media/catalog/product/cache/1a2b3c4d5e6f/a/b/abc.jpg', 'https://shop.example.com/media/catalog/product/a/b/abc.jpg'],
  ['https://shop.example.com/img/p/1/2/3/123-large_default.webp', 'https://shop.example.com/img/p/1/2/3/123.jpg'],
  ['https://shop.example.com/123-large_default/blue-shirt.webp', 'https://shop.example.com/123/blue-shirt.jpg'],
  ['https://cdn11.bigcommerce.com/s-abc/images/stencil/500x659/products/1/2/shirt__123.1700000000.jpg?c=2', 'https://cdn11.bigcommerce.com/s-abc/images/stencil/original/products/1/2/shirt__123.1700000000.jpg?c=2'],
  ['https://blog.example.com/content/images/size/w600/format/webp/2024/01/photo.jpg', 'https://blog.example.com/content/images/2024/01/photo.jpg'],
  ['https://example.com/sites/default/files/styles/large/public/2024-01/photo.jpg.webp?itok=abc', 'https://example.com/sites/default/files/2024-01/photo.jpg'],
  ['https://example.com/uploads/_1200x800_crop_center-center_82_line/photo.jpg', 'https://example.com/uploads/photo.jpg'],
  ['https://example.com/posts/a/photo_hu1a2b3c4d_123456_600x0_resize_q75_box.webp', 'https://example.com/posts/a/photo.jpg'],
  ['https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/320px-Example.jpg', 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg'],
  ['https://static.wikia.nocookie.net/w/images/a/ab/File.png/revision/latest/scale-to-width-down/300?cb=2024', 'https://static.wikia.nocookie.net/w/images/a/ab/File.png/revision/latest?cb=2024'],
  ['https://miro.medium.com/v2/resize:fit:720/format:webp/1*AbC.png', 'https://miro.medium.com/v2/1*AbC.png'],
  ['https://mir-s3-cdn-cf.behance.net/project_modules/1400_webp/abc.png', 'https://mir-s3-cdn-cf.behance.net/project_modules/source/abc.png'],
  ['https://cdna.artstation.com/p/assets/images/images/1/2/3/large/x.jpg?1', 'https://cdna.artstation.com/p/assets/images/images/1/2/3/4k/x.jpg?1'],
  ['https://i.pinimg.com/236x/ab/cd/ef/abcdef0123.jpg', 'https://i.pinimg.com/originals/ab/cd/ef/abcdef0123.jpg'],
  ['https://pbs.twimg.com/media/GaBcDeF?format=webp&name=small', 'https://pbs.twimg.com/media/GaBcDeF?format=jpg&name=orig'],
  ['https://pbs.twimg.com/profile_images/123/abc_normal.jpg', 'https://pbs.twimg.com/profile_images/123/abc.jpg'],
  ['https://preview.redd.it/abc123.jpg?width=640&format=pjpg&auto=webp&s=xyz', 'https://i.redd.it/abc123.jpg'],
  ['https://preview.redd.it/my-title-v0-abc123.png?width=640&auto=webp&s=xyz', 'https://i.redd.it/abc123.png'],
  ['https://media.discordapp.net/attachments/1/2/a.png?ex=1&is=2&hm=3&format=webp&width=400', 'https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3'],
  ['https://i.imgur.com/AbCdEfGm.jpg', 'https://i.imgur.com/AbCdEfG.jpg'],
  ['https://live.staticflickr.com/65535/123_abcdef_z.jpg', 'https://live.staticflickr.com/65535/123_abcdef_b.jpg'],
  ['https://blogger.googleusercontent.com/img/b/R29v/AVvX/w640-h400-rw/photo.jpg', 'https://blogger.googleusercontent.com/img/b/R29v/AVvX/s0/photo.jpg'],
  ['https://lh3.googleusercontent.com/abcDEF=w600-h400-rw', 'https://lh3.googleusercontent.com/abcDEF=s0'],
  ['https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/hqdefault.webp', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'],
  ['https://m.media-amazon.com/images/I/71abcXYZ+L._AC_SX679_.jpg', 'https://m.media-amazon.com/images/I/71abcXYZ+L.jpg'],
  ['https://i.ebayimg.com/images/g/abcAAOSw/s-l500.webp', 'https://i.ebayimg.com/images/g/abcAAOSw/s-l1600.jpg'],
  ['https://ae01.alicdn.com/kf/Habc123.jpg_640x640q90.jpg_.webp', 'https://ae01.alicdn.com/kf/Habc123.jpg'],
  ['https://http2.mlstatic.com/D_NQ_NP_2X_906835-MLA74123456789_012024-F.webp', 'https://http2.mlstatic.com/D_NQ_NP_906835-MLA74123456789_012024-O.jpg'],
  ['https://i.etsystatic.com/123/r/il/abc123/456/il_794xN.456_wxyz.jpg', 'https://i.etsystatic.com/123/r/il/abc123/456/il_fullxfull.456_wxyz.jpg'],
  ['https://64.media.tumblr.com/abc/def-12/s640x960/xyz.pnj', 'https://64.media.tumblr.com/abc/def-12/s2048x3072/xyz.png'],
  ['https://i1.sndcdn.com/artworks-abc-t500x500.jpg', 'https://i1.sndcdn.com/artworks-abc-original.jpg'],
  ['https://f4.bcbits.com/img/a1234567890_10.jpg', 'https://f4.bcbits.com/img/a1234567890_0.jpg'],
  ['https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/ef/x/cover.jpg/600x600bb.webp', 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/ef/x/cover.jpg/100000x100000-999.jpg'],
  ['https://lastfm.freetls.fastly.net/i/u/300x300/abc123.jpg', 'https://lastfm.freetls.fastly.net/i/u/ar0/abc123.jpg'],
  ['https://camo.githubusercontent.com/sig/68747470733a2f2f6578616d706c652e636f6d2f612e706e67', 'https://example.com/a.png'],
];

for (const [shown, orig] of STRONG) {
  const u = new URL(shown);
  test(`strong: ${u.hostname}${u.pathname.slice(0, 40)}`, () => {
    const c = strong(shown);
    assert.ok(c.includes(orig), `expected ${orig}\n got:\n  ${c.join('\n  ')}`);
  });
}

test('weak: generic WebP plugin and resize guesses', () => {
  assert.ok(weak('https://x.com/a/photo.jpg.webp').includes('https://x.com/a/photo.jpg'));
  assert.ok(weak('https://x.com/a/photo-300x200.webp').includes('https://x.com/a/photo.jpg'));
  assert.ok(weak('https://x.com/a/photo.webp?v=2').includes('https://x.com/a/photo.png?v=2'));
  assert.ok(weak('https://x.com/a.jpg?w=300&fm=webp&v=3').includes('https://x.com/a.jpg?v=3'));
  assert.equal(stripFormatParams('https://x.com/a.jpg?format=webp&v=1'), 'https://x.com/a.jpg?v=1');
  assert.equal(stripFormatParams('https://x.com/a.jpg?auto=webp&s=sig'), 'https://x.com/a.jpg?s=sig');
});

test('no false positives on ordinary URLs', () => {
  assert.deepEqual(strong('https://example.com/images/photo.jpg'), []);
  assert.deepEqual(strong('https://example.com/my_folder/w_files/pic.png'), []);
  assert.deepEqual(strong('https://example.com/assets/0123456789abcdef0123456789abcdef.png'), []);
});

test('candidate order: platform original first, the clicked URL is still tried', () => {
  const src = 'https://acdn-us.mitiendanube.com/stores/627/117/products/remera1-x-640-0.webp';
  const c = buildCandidates(src, [{ url: src, kind: 'current', w: 640 }]);
  assert.equal(c[0], 'https://acdn-us.mitiendanube.com/stores/627/117/products/remera1-x.jpg');
  assert.ok(c.includes(src));
});

test('candidate order: bigger page copies before guesses, smaller ones after', () => {
  const src = 'https://x.com/a-800.webp';
  const items = [
    { url: src, kind: 'current', w: 800 },
    { url: 'https://x.com/a-1600.jpg', kind: 'srcset', w: 1600 },
    { url: 'https://x.com/a-400.jpg', kind: 'srcset', w: 400 },
    { url: 'https://x.com/full/a.jpg', kind: 'link', w: 0 },
  ];
  const c = buildCandidates(src, items);
  assert.ok(c.indexOf('https://x.com/full/a.jpg') < c.indexOf('https://x.com/a-1600.jpg'));
  assert.ok(c.indexOf('https://x.com/a-1600.jpg') < c.indexOf('https://x.com/a-800.jpg'));
  assert.ok(c.indexOf('https://x.com/a-800.jpg') < c.indexOf('https://x.com/a-400.jpg'));
});

test('file names', () => {
  assert.equal(baseName('https://x.com/a/My%20Photo-1.jpg?v=1'), 'My Photo-1');
  assert.equal(baseName('https://lh3.googleusercontent.com/abcDEF=s0'), 'abcDEF');
  assert.equal(baseName('data:image/png;base64,AAAA'), 'image');
});

test('header parsing', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0x0d, 0xd8, 0, 0, 0x11, 0x4e]);
  assert.equal(sniffType(png), 'image/png');
  assert.deepEqual({ ...imageInfo(png) }, { width: 3544, height: 4430, animated: false });
});
