// Popup entry point. It forwards the user's choice to the service worker.

const fullPageButton = document.getElementById('fullPageButton');
const customAreaButton = document.getElementById('customAreaButton');
const elementButton = document.getElementById('elementButton');
const delaySelect = document.getElementById('delaySelect');
const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const statusText = document.getElementById('status');
const HISTORY_KEY = 'ripfullpage:history';

fullPageButton.addEventListener('click', () => {
  startCapture('fullPage');
});

customAreaButton.addEventListener('click', () => {
  startCapture('customArea');
});

elementButton.addEventListener('click', () => {
  startCapture('elementArea');
});

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
  delaySelect.disabled = isBusy;
}

function showError(message) {
  setBusy(false);
  statusText.textContent = message;
}

async function loadHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];

  historyCount.textContent = history.length ? `${history.length}` : '';

  if (!history.length) {
    historyList.innerHTML = '<p class="empty-history">暂无历史</p>';
    return;
  }

  historyList.replaceChildren(
    ...history.slice(0, 6).map((item) => createHistoryButton(item))
  );
}

function createHistoryButton(item) {
  const button = document.createElement('button');
  const image = document.createElement('img');
  const time = document.createElement('span');

  button.type = 'button';
  button.className = 'history-item';
  button.title = '打开历史截图';
  image.src = item.thumbnailURL || item.dataURL;
  image.alt = '';
  time.textContent = formatTime(item.createdAt);

  button.append(image, time);
  button.addEventListener('click', () => openHistoryItem(item.id));

  return button;
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
