// Shared runtime helpers for the ripfullpage content scripts.
// Keep UI state, translations, and timing helpers away from capture algorithms.

(() => {
  if (window.ripfullpageRuntime) {
    return;
  }

  const DEFAULT_LANGUAGE = "zh_CN";
  const TRANSLATIONS = {
    zh_CN: {
      fullPageFailed: "全页截图失败：{message}",
      elementFailed: "元素截图失败：{message}",
      scrollElementFailed: "滚动元素截图失败：{message}",
      preparingFullPage: "正在准备全页截图，共 {total} 张分块...",
      capturingProgress: "正在截图 {captured}/{total}...",
      stitchingScreenshot: "正在拼接截图...",
      scrollTargetMissing: "滚动区域已不存在。",
      scrollTargetTooSmall: "滚动区域太小，无法截图。",
      preparingScrollElement: "正在准备滚动元素截图，共 {total} 张分块...",
      stitchingScrollElement: "正在拼接滚动元素截图...",
      pageTooLongTitle: "页面过长",
      pageTooLongMessage: "这个页面可能是无限滚动或超长页面，完整截图容易卡住或占用大量内存。",
      pageTooLongMeta: "预计 {totalTiles} 张分块，页面高度 {pageHeight}px。推荐限制为 {limitedTiles} 张分块，约 {limitedHeight}px。",
      limitCapture: "限制截图",
      continueFullCapture: "继续完整截图",
      cancel: "取消",
      selectElement: "点击选择元素，ESC 取消",
      selectScrollableElement: "点击选择内部滚动区域，ESC 取消",
      moveToScrollable: "移动到有内部滚动条的区域",
      clickScrollable: "请点击有内部滚动条的区域。",
      scrollBoth: "横纵滚动",
      scrollX: "横向滚动",
      scrollY: "纵向滚动",
      scrollAreaMustBeVisible: "请先将滚动区域完整显示在窗口内再截图。",
      delayedCapture: "将在 {second} 秒后截图...",
      capturingNow: "正在截图..."
    },
    en: {
      fullPageFailed: "Full page capture failed: {message}",
      elementFailed: "Element capture failed: {message}",
      scrollElementFailed: "Scrollable element capture failed: {message}",
      preparingFullPage: "Preparing full page capture, {total} tiles...",
      capturingProgress: "Capturing {captured}/{total}...",
      stitchingScreenshot: "Stitching screenshot...",
      scrollTargetMissing: "The scrollable area no longer exists.",
      scrollTargetTooSmall: "The scrollable area is too small to capture.",
      preparingScrollElement: "Preparing scrollable element capture, {total} tiles...",
      stitchingScrollElement: "Stitching scrollable element screenshot...",
      pageTooLongTitle: "Page is too long",
      pageTooLongMessage: "This page may be infinite or very long. A full capture can freeze the browser or use a lot of memory.",
      pageTooLongMeta: "Estimated {totalTiles} tiles, page height {pageHeight}px. Recommended limit: {limitedTiles} tiles, about {limitedHeight}px.",
      limitCapture: "Limit capture",
      continueFullCapture: "Continue full capture",
      cancel: "Cancel",
      selectElement: "Click an element, Esc to cancel",
      selectScrollableElement: "Click a scrollable area, Esc to cancel",
      moveToScrollable: "Move to an internally scrollable area",
      clickScrollable: "Please click an area with its own scrollbar.",
      scrollBoth: "Both axes",
      scrollX: "Horizontal",
      scrollY: "Vertical",
      scrollAreaMustBeVisible: "Make the entire scrollable area visible in the window before capturing.",
      delayedCapture: "Capturing in {second}s...",
      capturingNow: "Capturing..."
    }
  };
  let activeToast = null;
  let currentLanguage = DEFAULT_LANGUAGE;

  function normalizeLanguage(language) {
    return Object.prototype.hasOwnProperty.call(TRANSLATIONS, language)
      ? language
      : DEFAULT_LANGUAGE;
  }

  function setLanguage(language) {
    currentLanguage = normalizeLanguage(language);
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

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function waitForAnimationFrame() {
    return new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }

  async function waitForPagePaint() {
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    await wait(80);
  }

  async function waitForCaptureDelay(delaySeconds) {
    const totalSeconds = Math.max(
      0,
      Math.min(5, Math.round(Number(delaySeconds) || 0)),
    );

    if (!totalSeconds) {
      return;
    }

    for (let second = totalSeconds; second > 0; second -= 1) {
      showToast(
        t("delayedCapture", { second }),
        false,
        (totalSeconds - second) / totalSeconds,
      );
      await wait(1000);
    }

    showToast(t("capturingNow"), false, 1);
    await wait(120);
  }

  function showToast(text, isError = false, progress = null) {
    if (!activeToast) {
      activeToast = document.createElement("div");
      activeToast.className = "ripfullpage-toast";
      activeToast.innerHTML =
        '<span class="ripfullpage-toast-text"></span><span class="ripfullpage-toast-bar"><span></span></span>';
      document.documentElement.appendChild(activeToast);
    }

    const textNode = activeToast.querySelector(".ripfullpage-toast-text");
    const fill = activeToast.querySelector(".ripfullpage-toast-bar span");

    textNode.textContent = text;
    activeToast.classList.toggle("ripfullpage-toast-error", isError);
    activeToast.classList.toggle(
      "ripfullpage-toast-has-progress",
      progress !== null,
    );

    if (progress !== null) {
      fill.style.width = `${Math.round(clampProgress(progress) * 100)}%`;
    } else {
      fill.style.width = "0%";
    }

    if (isError) {
      window.setTimeout(hideToast, 5000);
    }
  }

  function hideToast() {
    if (!activeToast) {
      return;
    }

    activeToast.remove();
    activeToast = null;
  }

  function getActiveToast() {
    return activeToast;
  }

  function clampProgress(value) {
    return Math.min(1, Math.max(0, value));
  }

  window.ripfullpageRuntime = {
    getActiveToast,
    hideToast,
    setLanguage,
    showToast,
    t,
    wait,
    waitForCaptureDelay,
    waitForPagePaint,
  };
})();
