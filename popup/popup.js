// Popup entry point. It forwards the user's choice to the service worker.

const fullPageButton = document.getElementById("fullPageButton");
const customAreaButton = document.getElementById("customAreaButton");
const elementButton = document.getElementById("elementButton");
const scrollElementButton = document.getElementById("scrollElementButton");
const delaySelect = document.getElementById("delaySelect");
const historyList = document.getElementById("historyList");
const historyCount = document.getElementById("historyCount");
const clearHistoryButton = document.getElementById("clearHistoryButton");
const feedbackButton = document.getElementById("feedbackButton");
const statusText = document.getElementById("status");
const languageButtons = Array.from(
  document.querySelectorAll("[data-language-option]"),
);
const { HISTORY_KEY, LANGUAGE_KEY } = window.ripfullpageConstants;
const FEEDBACK_EMAIL = "contact@somnus.wiki";
const DEFAULT_LANGUAGE = "zh_CN";
const TRANSLATIONS = {
  zh_CN: {
    subtitle: "截图工具",
    languageLabel: "语言",
    captureActions: "截图操作",
    fullPage: "全页截图",
    customArea: "自定义截图",
    element: "元素截图",
    scrollElement: "滚动元素截图",
    delayCapture: "延迟截图",
    delay: "延迟",
    delayNow: "立即截图",
    delay2: "2 秒后",
    delay3: "3 秒后",
    delay5: "5 秒后",
    shortcuts: "快捷键",
    shortcutFull: "Alt+Shift+F 全页",
    shortcutArea: "Alt+Shift+S 区域",
    feedback: "反馈",
    history: "截图历史",
    recentScreenshots: "最近截图",
    clear: "清空",
    emptyHistory: "暂无历史",
    starting: "正在启动...",
    startFailed: "启动失败",
    feedbackSubject: "ripfullpage 反馈",
    feedbackBody: "\n\n请描述遇到的问题或建议：\n",
    openHistoryTitle: "打开历史截图",
    deleteHistoryTitle: "删除这张截图",
    deleted: "已删除",
    clearConfirm: "确定删除所有最近截图吗？",
    historyCleared: "已清空最近截图",
    openingHistory: "正在打开历史...",
    openFailed: "打开失败",
    locale: "zh-CN",
  },
  en: {
    subtitle: "Screenshot tool",
    languageLabel: "Language",
    captureActions: "Capture actions",
    fullPage: "Full page capture",
    customArea: "Custom area capture",
    element: "Element capture",
    scrollElement: "Scrollable element capture",
    delayCapture: "Delayed capture",
    delay: "Delay",
    delayNow: "Capture now",
    delay2: "After 2s",
    delay3: "After 3s",
    delay5: "After 5s",
    shortcuts: "Shortcuts",
    shortcutFull: "Alt+Shift+F Full page",
    shortcutArea: "Alt+Shift+S Area",
    feedback: "Feedback",
    history: "Screenshot history",
    recentScreenshots: "Recent screenshots",
    clear: "Clear",
    emptyHistory: "No history yet",
    starting: "Starting...",
    startFailed: "Failed to start",
    feedbackSubject: "ripfullpage feedback",
    feedbackBody: "\n\nPlease describe the issue or suggestion:\n",
    openHistoryTitle: "Open screenshot history",
    deleteHistoryTitle: "Delete this screenshot",
    deleted: "Deleted",
    clearConfirm: "Delete all recent screenshots?",
    historyCleared: "Recent screenshots cleared",
    openingHistory: "Opening history...",
    openFailed: "Failed to open",
    locale: "en-US",
  },
};

let currentLanguage = DEFAULT_LANGUAGE;

fullPageButton.addEventListener("click", () => {
  startCapture("fullPage");
});

customAreaButton.addEventListener("click", () => {
  startCapture("customArea");
});

elementButton.addEventListener("click", () => {
  startCapture("elementArea");
});

scrollElementButton.addEventListener("click", () => {
  startCapture("scrollElementArea");
});

feedbackButton.addEventListener("click", openFeedbackEmail);

clearHistoryButton.addEventListener("click", clearHistory);

for (const button of languageButtons) {
  button.addEventListener("click", () => {
    setLanguage(button.dataset.languageOption);
  });
}

init();

async function init() {
  await loadLanguage();
  applyI18n();
  loadHistory();
}

async function loadLanguage() {
  const stored = await chrome.storage.local.get(LANGUAGE_KEY);
  currentLanguage = normalizeLanguage(stored[LANGUAGE_KEY]);
}

async function setLanguage(language) {
  currentLanguage = normalizeLanguage(language);
  await chrome.storage.local.set({ [LANGUAGE_KEY]: currentLanguage });
  applyI18n();
  loadHistory();
}

function normalizeLanguage(language) {
  return Object.prototype.hasOwnProperty.call(TRANSLATIONS, language)
    ? language
    : DEFAULT_LANGUAGE;
}

function t(key, values = {}) {
  const template =
    TRANSLATIONS[currentLanguage][key] ||
    TRANSLATIONS[DEFAULT_LANGUAGE][key] ||
    key;

  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

function applyI18n() {
  document.documentElement.lang = currentLanguage === "en" ? "en" : "zh-CN";

  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }

  for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  }

  for (const button of languageButtons) {
    const isActive = button.dataset.languageOption === currentLanguage;

    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function startCapture(action) {
  setBusy(true);
  statusText.textContent = t("starting");

  chrome.runtime.sendMessage(
    {
      action,
      options: {
        delaySeconds: Number(delaySelect.value),
        language: currentLanguage,
      },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message);
        return;
      }

      if (!response || !response.ok) {
        showError(
          response && response.error ? response.error : t("startFailed"),
        );
        return;
      }

      window.close();
    },
  );
}

function setBusy(isBusy) {
  fullPageButton.disabled = isBusy;
  customAreaButton.disabled = isBusy;
  elementButton.disabled = isBusy;
  scrollElementButton.disabled = isBusy;
  delaySelect.disabled = isBusy;
  clearHistoryButton.disabled = isBusy;

  for (const button of languageButtons) {
    button.disabled = isBusy;
  }
}

function showError(message) {
  setBusy(false);
  statusText.textContent = message;
}

function openFeedbackEmail() {
  const subject = encodeURIComponent(t("feedbackSubject"));
  const body = encodeURIComponent(t("feedbackBody"));
  const mailtoURL = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;

  chrome.tabs.create({ url: mailtoURL }, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      window.location.href = mailtoURL;
      return;
    }

    window.close();
  });
}

async function loadHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];

  historyCount.textContent = history.length ? `${history.length}` : "";
  clearHistoryButton.hidden = !history.length;
  clearHistoryButton.disabled = !history.length;

  if (!history.length) {
    historyList.replaceChildren(createEmptyHistoryMessage());
    return;
  }

  historyList.replaceChildren(
    ...history.map((item) => createHistoryItem(item)),
  );
}

function createHistoryItem(item) {
  const wrapper = document.createElement("div");
  const openButton = document.createElement("button");
  const deleteButton = document.createElement("button");
  const image = document.createElement("img");
  const time = document.createElement("span");

  wrapper.className = "history-item";
  openButton.type = "button";
  openButton.className = "history-open-button";
  openButton.title = t("openHistoryTitle");
  deleteButton.type = "button";
  deleteButton.className = "history-delete-button";
  deleteButton.title = t("deleteHistoryTitle");
  deleteButton.setAttribute("aria-label", t("deleteHistoryTitle"));
  deleteButton.textContent = "×";
  image.src = item.thumbnailURL || item.dataURL;
  image.alt = "";
  time.textContent = formatTime(item.createdAt);

  openButton.append(image, time);
  openButton.addEventListener("click", () => openHistoryItem(item.id));
  deleteButton.addEventListener("click", () => deleteHistoryItem(item.id));
  wrapper.append(openButton, deleteButton);

  return wrapper;
}

function createEmptyHistoryMessage() {
  const message = document.createElement("p");

  message.className = "empty-history";
  message.textContent = t("emptyHistory");
  return message;
}

async function deleteHistoryItem(id) {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
  const nextHistory = history.filter((item) => item.id !== id);

  await chrome.storage.local.set({
    [HISTORY_KEY]: nextHistory,
  });

  statusText.textContent = t("deleted");
  loadHistory();
}

async function clearHistory() {
  const confirmed = window.confirm(t("clearConfirm"));

  if (!confirmed) {
    return;
  }

  await chrome.storage.local.set({
    [HISTORY_KEY]: [],
  });

  statusText.textContent = t("historyCleared");
  loadHistory();
}

function openHistoryItem(id) {
  setBusy(true);
  statusText.textContent = t("openingHistory");

  chrome.runtime.sendMessage({ action: "openHistoryItem", id }, (response) => {
    if (chrome.runtime.lastError) {
      showError(chrome.runtime.lastError.message);
      return;
    }

    if (!response || !response.ok) {
      showError(response && response.error ? response.error : t("openFailed"));
      return;
    }

    window.close();
  });
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  return new Date(timestamp).toLocaleTimeString(t("locale"), {
    hour: "2-digit",
    minute: "2-digit",
  });
}
