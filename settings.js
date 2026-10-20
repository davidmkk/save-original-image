export const DEFAULTS = {
  fallback: 'ask',      // no JPG/PNG original: 'ask' | 'webp' (keep as is) | 'jpg' | 'png'
  saveAs: true,         // show Chrome's "Save as" dialog
  folder: '',           // subfolder inside Downloads ('' = Downloads itself)
  perSite: false,       // one subfolder per website
  underCursor: true,    // also offer the menu where no image is detected (overlays)
  unblockAlt: true,     // Alt + right-click beats "right-click disabled" pages
  showConvert: false,   // extra "Convert and save as JPG/PNG" items (makes a submenu)
};
