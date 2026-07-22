// Content-script entry point for capture commands from the service worker.
(() => {
  if (window.ripfullpageContentLoaded) {
    return;
  }

  const runtime = window.ripfullpageRuntime;
  const capture = window.ripfullpageCapture;

  if (!runtime || !capture) {
    throw new Error("ripfullpage content modules are not loaded.");
  }

  const { setLanguage, showToast, t } = runtime;
  const {
    captureFullPage,
    startCustomAreaCapture,
    startElementCapture,
    startScrollableElementCapture,
  } = capture;

  window.ripfullpageContentLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.action !== "string") {
      return false;
    }

    setLanguage(message.language);

    if (message.action === "startCapture") {
      sendResponse({ ok: true });
      captureFullPage({
        delaySeconds: message.delaySeconds,
      }).catch((error) => {
        console.error("[ripfullpage] Full page capture failed:", error);
        showToast(t("fullPageFailed", { message: error.message }), true);
      });
      return false;
    }

    if (message.action === "startCustomArea") {
      sendResponse({ ok: true });
      startCustomAreaCapture({
        delaySeconds: message.delaySeconds,
      }).catch((error) => {
        console.error("[ripfullpage] Custom area capture failed:", error);
      });
      return false;
    }

    if (message.action === "startElementCapture") {
      sendResponse({ ok: true });
      startElementCapture({
        delaySeconds: message.delaySeconds,
      }).catch((error) => {
        console.error("[ripfullpage] Element capture failed:", error);
        showToast(t("elementFailed", { message: error.message }), true);
      });
      return false;
    }

    if (message.action === "startScrollableElementCapture") {
      sendResponse({ ok: true });
      startScrollableElementCapture({
        delaySeconds: message.delaySeconds,
      }).catch((error) => {
        console.error("[ripfullpage] Scrollable element capture failed:", error);
        showToast(t("scrollElementFailed", { message: error.message }), true);
      });
      return false;
    }

    return false;
  });
})();
