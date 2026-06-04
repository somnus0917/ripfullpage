// Background service worker for ripfullpage.
// It injects the content script on demand, captures visible tabs, and opens the editor.

const EDITOR_IMAGE_KEY = 'ripfullpage:lastImage';
const MIN_CAPTURE_INTERVAL_MS = 650;

let lastVisibleCaptureAt = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== 'string') {
    return false;
  }

  if (message.action === 'fullPage' || message.action === 'customArea') {
    startCaptureFlow(message.action)
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
    openEditor(message.dataURL)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function startCaptureFlow(flowAction) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id) {
    throw new Error('No active tab found.');
  }

  if (isRestrictedUrl(tab.url)) {
    throw new Error('This page cannot be captured by browser extensions.');
  }

  await ensureContentScript(tab.id);

  const action = flowAction === 'fullPage' ? 'startCapture' : 'startCustomArea';
  await chrome.tabs.sendMessage(tab.id, { action });
}

async function ensureContentScript(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content/content_style.css']
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/content_script.js']
  });
}

async function captureCurrentTab(tab) {
  if (!tab || typeof tab.windowId !== 'number') {
    throw new Error('Cannot identify the tab to capture.');
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

async function openEditor(dataURL) {
  if (!dataURL || typeof dataURL !== 'string') {
    throw new Error('Missing screenshot data.');
  }

  await chrome.storage.session.set({
    [EDITOR_IMAGE_KEY]: {
      dataURL,
      createdAt: Date.now()
    }
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL('editor/editor.html')
  });
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
