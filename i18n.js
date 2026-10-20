// t('toastFound', a, b, c) -> message from _locales/<language>/messages.json with {1}, {2}... filled in.
export const t = (key, ...args) => (chrome.i18n.getMessage(key) || key).replace(/\{(\d)\}/g, (_, i) => args[i - 1] ?? '');

// Fills every element that has data-i18n="key" (and data-i18n-placeholder) on extension pages.
export function localizePage() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  const title = document.querySelector('title[data-i18n]');
  if (title) document.title = title.textContent;
}
