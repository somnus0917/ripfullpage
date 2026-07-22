// Background service worker for ripfullpage.
// It injects the content script on demand, captures visible tabs, and opens the editor.

importScripts('../shared/constants.js');

const {
  EDITOR_IMAGE_KEY,
  HISTORY_KEY,
  LANGUAGE_KEY,
  LAST_SOURCE_URL_KEY
} = globalThis.ripfullpageConstants;
const MAX_HISTORY_ITEMS = 12;
const MIN_CAPTURE_INTERVAL_MS = 650;
const DEFAULT_LANGUAGE = 'zh_CN';
const TRANSLATIONS = {
  zh_CN: {
    noActiveTab: '没有找到当前标签页。',
    restrictedPage: '浏览器扩展无法截取此页面。',
    cannotIdentifyTab: '无法识别要截图的标签页。',
    missingScreenshotData: '缺少截图数据。',
    missingHistoryItemId: '缺少历史截图 ID。',
    historyItemNotFound: '没有找到这张历史截图。'
  },
  en: {
    noActiveTab: 'No active tab found.',
    restrictedPage: 'This page cannot be captured by browser extensions.',
    cannotIdentifyTab: 'Cannot identify the tab to capture.',
    missingScreenshotData: 'Missing screenshot data.',
    missingHistoryItemId: 'Missing history item id.',
    historyItemNotFound: 'History item not found.'
  }
};

let lastVisibleCaptureAt = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== 'string') {
    return false;
  }

  if (
    message.action === 'fullPage' ||
    message.action === 'customArea' ||
    message.action === 'elementArea' ||
    message.action === 'scrollElementArea'
  ) {
    startCaptureFlow(message.action, message.options || {})
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === 'capture') {
    captureCurrentTab(sender.tab)
      .then((dataURL) => sendResponse({ ok: true, dataURL }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === 'openEditor') {
    openEditor(message.dataURL, getTabSourceURL(sender.tab))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === 'openHistoryItem') {
    openHistoryItem(message.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener((command) => {
  const actionByCommand = {
    'full-page-capture': 'fullPage',
    'custom-area-capture': 'customArea'
  };
  const action = actionByCommand[command];

  if (!action) {
    return;
  }

  startCaptureFlow(action).catch((error) => {
    console.error('[ripfullpage] Command capture failed:', error);
  });
});

async function startCaptureFlow(flowAction, options = {}) {
  const language = await getPreferredLanguage(options.language);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id) {
    throw new Error(t('noActiveTab', language));
  }

  if (isRestrictedUrl(tab.url)) {
    throw new Error(t('restrictedPage', language));
  }

  await ensureContentScript(tab.id);

  const contentActionByFlow = {
    fullPage: 'startCapture',
    customArea: 'startCustomArea',
    elementArea: 'startElementCapture',
    scrollElementArea: 'startScrollableElementCapture'
  };
  const action = contentActionByFlow[flowAction];

  await chrome.tabs.sendMessage(tab.id, {
    action,
    delaySeconds: normalizeDelaySeconds(options.delaySeconds),
    language
  });
}

async function ensureContentScript(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content/content_style.css']
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      'content/content_runtime.js',
      'content/content_selection.js',
      'content/content_page_cleanup.js',
      'content/content_capture.js',
      'content/content_script.js'
    ]
  });
}

async function captureCurrentTab(tab) {
  if (!tab || typeof tab.windowId !== 'number') {
    const language = await getPreferredLanguage();

    throw new Error(t('cannotIdentifyTab', language));
  }

  await waitForCaptureSlot();

  // captureVisibleTab is intentionally centralized here because content scripts
  // do not have access to chrome.tabs.captureVisibleTab.
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
}

async function waitForCaptureSlot() {
  const elapsed = Date.now() - lastVisibleCaptureAt;
  const waitMs = Math.max(0, MIN_CAPTURE_INTERVAL_MS - elapsed);

  if (waitMs > 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, waitMs);
    });
  }

  lastVisibleCaptureAt = Date.now();
}

async function openEditor(dataURL, sourceURL = '') {
  if (!dataURL || typeof dataURL !== 'string') {
    const language = await getPreferredLanguage();

    throw new Error(t('missingScreenshotData', language));
  }

  try {
    await saveHistoryItem(dataURL, sourceURL);
  } catch (error) {
    // History is convenient, but it should never block the screenshot result.
    console.warn('[ripfullpage] Could not save screenshot history:', error);
  }

  await chrome.storage.session.set({
    [EDITOR_IMAGE_KEY]: {
      dataURL,
      sourceURL,
      createdAt: Date.now()
    },
    [LAST_SOURCE_URL_KEY]: sourceURL
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL('editor/editor.html')
  });
}

async function openHistoryItem(id) {
  if (!id) {
    const language = await getPreferredLanguage();

    throw new Error(t('missingHistoryItemId', language));
  }

  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
  const item = history.find((entry) => entry.id === id);

  if (!item || !item.dataURL) {
    const language = await getPreferredLanguage();

    throw new Error(t('historyItemNotFound', language));
  }

  await chrome.storage.session.set({
    [EDITOR_IMAGE_KEY]: {
      dataURL: item.dataURL,
      sourceURL: item.sourceURL || '',
      createdAt: item.createdAt || Date.now()
    },
    [LAST_SOURCE_URL_KEY]: item.sourceURL || ''
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL('editor/editor.html')
  });
}

async function saveHistoryItem(dataURL, sourceURL = '') {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
  const createdAt = Date.now();
  const item = {
    id: `shot-${createdAt}-${Math.random().toString(16).slice(2)}`,
    dataURL,
    sourceURL,
    thumbnailURL: await createThumbnailDataURL(dataURL),
    createdAt
  };

  history.unshift(item);

  await chrome.storage.local.set({
    [HISTORY_KEY]: history.slice(0, MAX_HISTORY_ITEMS)
  });
}

async function createThumbnailDataURL(dataURL) {
  const image = await createImageBitmap(await dataURLToBlob(dataURL));
  const canvas = new OffscreenCanvas(180, 120);
  const context = canvas.getContext('2d');
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const x = Math.round((canvas.width - width) / 2);
  const y = Math.round((canvas.height - height) / 2);

  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, x, y, width, height);
  image.close();

  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.78 });
  return blobToDataURL(blob);
}

async function dataURLToBlob(dataURL) {
  const response = await fetch(dataURL);
  return response.blob();
}

function blobToDataURL(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';

    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }

    return `data:${blob.type};base64,${btoa(binary)}`;
  });
}

function getTabSourceURL(tab) {
  return tab && typeof tab.url === 'string' ? tab.url : '';
}

function normalizeDelaySeconds(value) {
  const seconds = Number(value);

  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.max(0, Math.min(5, Math.round(seconds)));
}

async function getPreferredLanguage(language) {
  if (isSupportedLanguage(language)) {
    return language;
  }

  const stored = await chrome.storage.local.get(LANGUAGE_KEY);

  return isSupportedLanguage(stored[LANGUAGE_KEY])
    ? stored[LANGUAGE_KEY]
    : DEFAULT_LANGUAGE;
}

function isSupportedLanguage(language) {
  return Object.prototype.hasOwnProperty.call(TRANSLATIONS, language);
}

function t(key, language = DEFAULT_LANGUAGE) {
  return (
    TRANSLATIONS[language] &&
    TRANSLATIONS[language][key]
  ) || TRANSLATIONS[DEFAULT_LANGUAGE][key] || key;
}

function isRestrictedUrl(url = '') {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('brave://') ||
    url.startsWith('vivaldi://') ||
    url.startsWith('opera://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://')
  );
}
