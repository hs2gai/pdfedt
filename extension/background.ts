/**
 * Background of the Chrome extension (MV3 service worker).
 *
 * Redirects PDFs opened in the browser to the pdfedt viewer page (index.html#src=<original URL>).
 * There is no API to disable Chrome's built-in PDF viewer, so three paths get there first:
 *   1. http(s) URLs ending in .pdf   -> declarativeNetRequest redirects the request itself (the built-in viewer never starts)
 *   2. other http(s) URLs            -> webRequest.onHeadersReceived checks Content-Type and replaces the tab
 *   3. local PDFs on file://         -> webNavigation.onBeforeNavigate replaces the tab
 * PDFs can also be opened manually from the toolbar icon and the context menu on PDF links.
 * The viewer page fetches the original URL itself (the only URL it requests is the one the user tried to open).
 */
const VIEWER = chrome.runtime.getURL('index.html');
const viewerUrl = (src: string) => `${VIEWER}#src=${src}`;

const PDF_URL = String.raw`^https?://[^?#]+\.pdf(\?.*)?$`;
const RULE_ID = 1;

/** Path 1: automatic redirect on/off (storage.local). Manual opening stays available when off */
const AUTO_KEY = 'autoOpen';
async function isAutoOpen(): Promise<boolean> {
  const { [AUTO_KEY]: v } = await chrome.storage.local.get(AUTO_KEY);
  return v !== false;
}

async function applyRedirectRule(enabled: boolean) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules: enabled
      ? [
          {
            id: RULE_ID,
            priority: 1,
            // \0 is the whole regexFilter match (= the original URL)
            action: { type: 'redirect', redirect: { regexSubstitution: viewerUrl(String.raw`\0`) } },
            condition: { regexFilter: PDF_URL, isUrlFilterCaseSensitive: false, resourceTypes: ['main_frame'] },
          },
        ]
      : [],
  });
}

async function setup() {
  await applyRedirectRule(await isAutoOpen());
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'open-link', title: 'リンク先の PDF を pdfedt で開く', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'open-page', title: 'このページを pdfedt で開く', contexts: ['page'] });
    chrome.contextMenus.create({
      id: 'auto-open',
      title: 'PDFを自動でpdfedtで開く',
      contexts: ['action'],
      type: 'checkbox',
    });
    void isAutoOpen().then((v) => chrome.contextMenus.update('auto-open', { checked: v }));
  });
}
chrome.runtime.onInstalled.addListener(() => void setup());
chrome.runtime.onStartup.addListener(() => void setup());

/** Replaces the tab with the viewer when automatic redirect is on */
async function redirectTab(tabId: number, src: string) {
  if (await isAutoOpen()) await chrome.tabs.update(tabId, { url: viewerUrl(src) });
}

// Path 2: responses whose Content-Type is PDF (shown inline)
const isPdfResponse = (headers: chrome.webRequest.HttpHeader[] = []) => {
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value?.toLowerCase() ?? '';
  return /^application\/(x-)?pdf\b/.test(get('content-type')) && !/^\s*attachment/.test(get('content-disposition'));
};
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || details.statusCode !== 200 || !isPdfResponse(details.responseHeaders)) return;
    void redirectTab(details.tabId, details.url);
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] },
  ['responseHeaders'],
);

// Path 3: local PDFs on file:// (needs "Allow access to file URLs" for the extension)
chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0 || !/\.pdf$/i.test(details.url)) return;
    void redirectTab(details.tabId, details.url);
  },
  { url: [{ schemes: ['file'] }] },
);

// Manual opening
chrome.action.onClicked.addListener(() => void chrome.tabs.create({ url: VIEWER }));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open-link' && info.linkUrl) void chrome.tabs.create({ url: viewerUrl(info.linkUrl) });
  if (info.menuItemId === 'open-page' && tab?.id !== undefined && info.pageUrl)
    void chrome.tabs.update(tab.id, { url: viewerUrl(info.pageUrl) });
  if (info.menuItemId === 'auto-open') {
    const on = info.checked === true;
    void chrome.storage.local.set({ [AUTO_KEY]: on }).then(() => applyRedirectRule(on));
  }
});
