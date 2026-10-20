import { DEFAULTS } from './settings.js';
import { t, localizePage } from './i18n.js';

localizePage();
const BOOLS = ['underCursor', 'unblockAlt', 'showConvert', 'saveAs', 'perSite'];
const $ = (id) => document.getElementById(id);
let timer;
const flash = () => { $('saved').textContent = t('optSaved'); clearTimeout(timer); timer = setTimeout(() => { $('saved').textContent = ''; }, 1500); };

const s = await chrome.storage.sync.get(DEFAULTS);
document.querySelector(`input[name=fallback][value=${s.fallback}]`).checked = true;
for (const k of BOOLS) $(k).checked = !!s[k];
$('folder').value = s.folder;

$('fallback').addEventListener('change', (e) => chrome.storage.sync.set({ fallback: e.target.value }).then(flash));
for (const k of BOOLS) $(k).addEventListener('change', (e) => chrome.storage.sync.set({ [k]: e.target.checked }).then(flash));
$('folder').addEventListener('change', (e) => chrome.storage.sync.set({ folder: e.target.value.trim() }).then(flash));

const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'save-under-cursor');
$('shortcut').textContent = cmd?.shortcut ? t('optShortcut', cmd.shortcut) : t('optShortcutNone');
$('changeShortcut').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
