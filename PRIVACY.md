# Privacy policy

*Save Original Image* — last updated October 19, 2026

**The extension collects no data.** It has no analytics, no tracking, no accounts and no servers of its own.

What it does, and only when you ask it to (right-click menu or keyboard shortcut):

- **Reads the page you are on** to find the image under your cursor and the other addresses the page lists for it. Nothing from the page is stored or sent anywhere.
- **Requests image files from the site that hosts them**, the same way your browser loaded the page. These requests go only to that site or its image CDN, with your normal browser cookies, exactly as if you opened the image in a new tab.
- **Saves the file through Chrome's downloads**, into your Downloads folder.
- **Stores your settings** (fallback choice, folder name, toggles) with `chrome.storage.sync`, which Chrome may sync between your own signed-in browsers. Pending choices in the "no original" window are kept in session memory and cleared when you answer or close the browser.

Why it needs each permission:

| Permission | Why |
| --- | --- |
| Read and change data on all websites (`<all_urls>`, content script, `scripting`) | Images can be on any site; the extension must look at the page you right-click and request the original from wherever it is hosted. |
| `contextMenus` | Adds "Save original image" to the right-click menu. |
| `downloads` | Saves the file. |
| `storage` | Remembers your settings. |

Questions: [open an issue](https://github.com/davidmkk/save-original-image/issues).
