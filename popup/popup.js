// Popup entry point. It forwards the user's choice to the service worker.

const fullPageButton = document.getElementById('fullPageButton');
const customAreaButton = document.getElementById('customAreaButton');
const statusText = document.getElementById('status');

fullPageButton.addEventListener('click', () => {
  startCapture('fullPage');
});

customAreaButton.addEventListener('click', () => {
  startCapture('customArea');
});

function startCapture(action) {
  setBusy(true);
  statusText.textContent = '正在启动...';

  chrome.runtime.sendMessage({ action }, (response) => {
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
}

function showError(message) {
  setBusy(false);
  statusText.textContent = message;
}
