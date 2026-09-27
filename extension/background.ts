/**
 * Chrome 拡張のバックグラウンド（MV3 service worker）。
 *
 * ブラウザで開かれた PDF を pdfedt のビューワページ（index.html#src=<元 URL>）に付け替える。
 * Chrome 内蔵の PDF ビューワを無効化する API は無いため、3 つの経路で先回りする:
 *   1. URL が .pdf で終わる http(s)   → declarativeNetRequest で要求自体をリダイレクト（内蔵ビューワは起動しない）
 *   2. URL からは分からない http(s)   → webRequest.onHeadersReceived で Content-Type を見てタブを差し替える
 *   3. file:// のローカル PDF          → webNavigation.onBeforeNavigate でタブを差し替える
 * 加えて、ツールバーのアイコンと PDF リンクの右クリックメニューから手動で開ける。
 * 差し替え先のページが元 URL を fetch して読み込む（ビューワが取りに行く先はユーザーが開こうとした URL だけ）。
 */
const VIEWER = chrome.runtime.getURL('index.html');
const viewerUrl = (src: string) => `${VIEWER}#src=${src}`;

const PDF_URL = String.raw`^https?://[^?#]+\.pdf(\?.*)?$`;
const RULE_ID = 1;

/** 経路 1: 自動転送の ON/OFF（storage.local）。OFF でも手動で開く経路は残す */
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
            // \0 は regexFilter の全一致（= 元 URL）
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

/** 自動転送が ON ならタブをビューワに差し替える */
async function redirectTab(tabId: number, src: string) {
  if (await isAutoOpen()) await chrome.tabs.update(tabId, { url: viewerUrl(src) });
}

// 経路 2: レスポンスの Content-Type が PDF（inline 表示されるもの）
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

// 経路 3: file:// のローカル PDF（拡張の「ファイルの URL へのアクセスを許可する」が必要）
chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0 || !/\.pdf$/i.test(details.url)) return;
    void redirectTab(details.tabId, details.url);
  },
  { url: [{ schemes: ['file'] }] },
);

// 手動で開く
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
