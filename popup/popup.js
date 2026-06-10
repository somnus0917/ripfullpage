// Popup entry point. It forwards the user's choice to the service worker.

const fullPageButton = document.getElementById('fullPageButton');
const customAreaButton = document.getElementById('customAreaButton');
const elementButton = document.getElementById('elementButton');
const scrollElementButton = document.getElementById('scrollElementButton');
const delaySelect = document.getElementById('delaySelect');
const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const clearHistoryButton = document.getElementById('clearHistoryButton');
const feedbackButton = document.getElementById('feedbackButton');
const statusText = document.getElementById('status');
const HISTORY_KEY = 'ripfullpage:history';
const FEEDBACK_EMAIL = 'somnus0917chen@hotmail.com';

fullPageButton.addEventListener('click', () => {
  startCapture('fullPage');
});

customAreaButton.addEventListener('click', () => {
  startCapture('customArea');
});

elementButton.addEventListener('click', () => {
  startCapture('elementArea');
});

scrollElementButton.addEventListener('click', () => {
  startCapture('scrollElementArea');
});

feedbackButton.addEventListener('click', openFeedbackEmail);

clearHistoryButton.addEventListener('click', clearHistory);

loadHistory();

function startCapture(action) {
  setBusy(true);
  statusText.textContent = '正在启动...';

  chrome.runtime.sendMessage({
    action,
    options: {
      delaySeconds: Number(delaySelect.value)
    }
  }, (response) => {
    if (chrome.runtime.lastError) {
      showError(chrome.runtime.lastError.message);
      return;
    }

    if (!response || !response.ok) {
      showError(response && response.error ? response.error : '启动失败');
      return;
    }

    window.close();
  });
}

function setBusy(isBusy) {
  fullPageButton.disabled = isBusy;
  customAreaButton.disabled = isBusy;
  elementButton.disabled = isBusy;
  scrollElementButton.disabled = isBusy;
  delaySelect.disabled = isBusy;
  clearHistoryButton.disabled = isBusy;
}

function showError(message) {
  setBusy(false);
  statusText.textContent = message;
}

function openFeedbackEmail() {
  const subject = encodeURIComponent('ripfullpage 反馈');
  const body = encodeURIComponent('\n\n请描述遇到的问题或建议：\n');
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

  historyCount.textContent = history.length ? `${history.length}` : '';
  clearHistoryButton.hidden = !history.length;
  clearHistoryButton.disabled = !history.length;

  if (!history.length) {
    historyList.innerHTML = '<p class="empty-history">暂无历史</p>';
    return;
  }

  historyList.replaceChildren(
    ...history.map((item) => createHistoryItem(item))
  );
}

function createHistoryItem(item) {
  const wrapper = document.createElement('div');
  const openButton = document.createElement('button');
  const deleteButton = document.createElement('button');
  const image = document.createElement('img');
  const time = document.createElement('span');

  wrapper.className = 'history-item';
  openButton.type = 'button';
  openButton.className = 'history-open-button';
  openButton.title = '打开历史截图';
  deleteButton.type = 'button';
  deleteButton.className = 'history-delete-button';
  deleteButton.title = '删除这张截图';
  deleteButton.setAttribute('aria-label', '删除这张截图');
  deleteButton.textContent = '×';
  image.src = item.thumbnailURL || item.dataURL;
  image.alt = '';
  time.textContent = formatTime(item.createdAt);

  openButton.append(image, time);
  openButton.addEventListener('click', () => openHistoryItem(item.id));
  deleteButton.addEventListener('click', () => deleteHistoryItem(item.id));
  wrapper.append(openButton, deleteButton);

  return wrapper;
}

async function deleteHistoryItem(id) {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
  const nextHistory = history.filter((item) => item.id !== id);

  await chrome.storage.local.set({
    [HISTORY_KEY]: nextHistory
  });

  statusText.textContent = '已删除';
  loadHistory();
}

async function clearHistory() {
  const confirmed = window.confirm('确定删除所有最近截图吗？');

  if (!confirmed) {
    return;
  }

  await chrome.storage.local.set({
    [HISTORY_KEY]: []
  });

  statusText.textContent = '已清空最近截图';
  loadHistory();
}

function openHistoryItem(id) {
  setBusy(true);
  statusText.textContent = '正在打开历史...';

  chrome.runtime.sendMessage({ action: 'openHistoryItem', id }, (response) => {
    if (chrome.runtime.lastError) {
      showError(chrome.runtime.lastError.message);
      return;
    }

    if (!response || !response.ok) {
      showError(response && response.error ? response.error : '打开失败');
      return;
    }

    window.close();
  });
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '';
  }

  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });
}
