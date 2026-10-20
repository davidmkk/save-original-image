import { fetchBytes, imageInfo, fmtSize, EXT } from './core.js';
import { t, localizePage } from './i18n.js';

localizePage();
const id = new URLSearchParams(location.search).get('id');
const $ = (s) => document.getElementById(s);

(async () => {
  const p = (await chrome.storage.session.get('ask:' + id))['ask:' + id];
  if (!p) { $('err').textContent = t('askExpired'); return; }
  const kind = (EXT[p.type] || 'webp').toUpperCase();
  const meta = (detail) => { $('meta').textContent = t('askMeta', kind, detail ? ` (${detail})` : ''); };
  meta(p.width ? `${p.width}×${p.height}` : '');
  $('webp').textContent = t('askKeep', kind);
  try {
    const { bytes, type } = await fetchBytes(p.url);
    const info = imageInfo(bytes);
    $('img').src = URL.createObjectURL(new Blob([bytes], { type }));
    meta(`${info.width ? `${info.width}×${info.height}, ` : ''}${fmtSize(bytes.length)}`);
    if (info.animated) { $('anim').textContent = t('askAnim', kind); $('anim').hidden = false; }
  } catch { /* no preview (blob: image or the site refused); the buttons still work */ }
})();

for (const choice of ['webp', 'jpg', 'png']) {
  $(choice).addEventListener('click', async () => {
    document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const r = await chrome.runtime.sendMessage({ type: 'ask-choice', id, choice, remember: $('remember').checked });
    if (r?.ok) window.close();
    else {
      $('err').textContent = r?.error || t('askError');
      document.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  });
}
