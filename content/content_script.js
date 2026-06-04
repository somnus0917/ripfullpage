// Content script injected only when the user starts a capture from the popup.
// It handles page measurement, scrolling, custom selection UI, image stitching, and cropping.

(() => {
  if (window.ripfullpageContentLoaded) {
    return;
  }

  window.ripfullpageContentLoaded = true;

  const CAPTURE_DELAY_MS = 300;
  const TILE_OVERLAP_CSS_PX = 120;
  const SEAM_OVERWRITE_CSS_PX = 10;
  const MAX_DEFAULT_FULL_PAGE_TILES = 50;
  const MAX_DEFAULT_FULL_PAGE_HEIGHT = 30000;
  const MIN_SELECTION_SIZE = 4;
  let activeToast = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.action !== "string") {
      return false;
    }

    if (message.action === "startCapture") {
      sendResponse({ ok: true });
      captureFullPage({
        delaySeconds: message.delaySeconds,
      }).catch((error) => {
        console.error("[ripfullpage] Full page capture failed:", error);
        showToast(`全页截图失败：${error.message}`, true);
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
        showToast(`元素截图失败：${error.message}`, true);
      });
      return false;
    }

    return false;
  });

  async function captureFullPage(options = {}) {
    await waitForCaptureDelay(options.delaySeconds);

    const scrollTarget = getScrollTarget();
    const originalScrollX = getScrollLeft(scrollTarget);
    const originalScrollY = getScrollTop(scrollTarget);
    const originalScrollBehavior =
      document.documentElement.style.scrollBehavior;
    const pageSize = getPageSize(scrollTarget);
    const viewport = getViewportSize();
    let capturePageSize = { ...pageSize };
    let xPositions = buildScrollPositions(
      pageSize.width,
      viewport.width,
      TILE_OVERLAP_CSS_PX,
    );
    let yPositions = buildScrollPositions(
      pageSize.height,
      viewport.height,
      TILE_OVERLAP_CSS_PX,
    );
    const capturePlan = await confirmLargeCaptureIfNeeded(
      pageSize,
      viewport,
      xPositions,
      yPositions,
    );

    if (capturePlan.action === "cancel") {
      return;
    }

    if (capturePlan.action === "limit") {
      capturePageSize = capturePlan.pageSize;
      xPositions = capturePlan.xPositions;
      yPositions = capturePlan.yPositions;
    }

    const tileGrid = [];
    const totalTiles = xPositions.length * yPositions.length;
    let capturedTiles = 0;
    let scaleX = window.devicePixelRatio || 1;
    let scaleY = window.devicePixelRatio || 1;

    document.documentElement.style.scrollBehavior = "auto";
    document.documentElement.classList.add("ripfullpage-capturing");
    showToast(`正在准备全页截图，共 ${totalTiles} 张分块...`, false, 0);

    try {
      for (const y of yPositions) {
        const row = [];

        for (const x of xPositions) {
          scrollToPosition(scrollTarget, x, y);
          const actualPosition = await waitForScrollPosition(
            scrollTarget,
            x,
            y,
          );
          await wait(CAPTURE_DELAY_MS);

          capturedTiles += 1;
          showToast(
            `正在截图 ${capturedTiles}/${totalTiles}...`,
            false,
            capturedTiles / totalTiles,
          );

          const isFirstTile = capturedTiles === 1;
          const dataURL = await captureCleanViewport(isFirstTile);
          const image = await loadImage(dataURL);

          scaleX = image.naturalWidth / viewport.width;
          scaleY = image.naturalHeight / viewport.height;

          row.push({
            x: actualPosition.x,
            y: actualPosition.y,
            image,
          });
        }

        tileGrid.push(row);
      }

      showToast("正在拼接截图...");
      const stitchedDataURL = stitchTiles(
        tileGrid,
        capturePageSize,
        viewport,
        scaleX,
        scaleY,
      );
      await openEditor(stitchedDataURL);
      hideToast();
    } finally {
      scrollToPosition(scrollTarget, originalScrollX, originalScrollY);
      document.documentElement.style.scrollBehavior = originalScrollBehavior;
      document.documentElement.classList.remove("ripfullpage-capturing");
    }
  }

  async function confirmLargeCaptureIfNeeded(
    pageSize,
    viewport,
    xPositions,
    yPositions,
  ) {
    const totalTiles = xPositions.length * yPositions.length;

    if (
      totalTiles <= MAX_DEFAULT_FULL_PAGE_TILES &&
      pageSize.height <= MAX_DEFAULT_FULL_PAGE_HEIGHT
    ) {
      return {
        action: "full",
        pageSize,
        xPositions,
        yPositions,
      };
    }

    const limitedPlan = buildLimitedCapturePlan(pageSize, viewport);
    const choice = await showLargeCaptureDialog({
      totalTiles,
      pageHeight: pageSize.height,
      limitedTiles:
        limitedPlan.xPositions.length * limitedPlan.yPositions.length,
      limitedHeight: limitedPlan.pageSize.height,
    });

    if (choice === "full") {
      return {
        action: "full",
        pageSize,
        xPositions,
        yPositions,
      };
    }

    if (choice === "limit") {
      return {
        action: "limit",
        ...limitedPlan,
      };
    }

    return {
      action: "cancel",
      pageSize,
      xPositions,
      yPositions,
    };
  }

  function buildLimitedCapturePlan(pageSize, viewport) {
    const limitedPageSize = {
      width: pageSize.width,
      height: Math.min(pageSize.height, MAX_DEFAULT_FULL_PAGE_HEIGHT),
    };
    const xPositions = buildScrollPositions(
      limitedPageSize.width,
      viewport.width,
      TILE_OVERLAP_CSS_PX,
    );
    let yPositions = buildScrollPositions(
      limitedPageSize.height,
      viewport.height,
      TILE_OVERLAP_CSS_PX,
    );
    const maxRows = Math.max(
      1,
      Math.floor(MAX_DEFAULT_FULL_PAGE_TILES / xPositions.length),
    );

    if (yPositions.length > maxRows) {
      yPositions = yPositions.slice(0, maxRows);
      limitedPageSize.height = Math.min(
        limitedPageSize.height,
        yPositions[yPositions.length - 1] + viewport.height,
      );
    }

    return {
      pageSize: limitedPageSize,
      xPositions,
      yPositions,
    };
  }

  async function startCustomAreaCapture(options = {}) {
    await waitForCaptureDelay(options.delaySeconds);

    const rect = await selectArea();

    if (!rect) {
      return;
    }

    const dataURL = await requestVisibleTabCapture();
    const image = await loadImage(dataURL);
    const croppedDataURL = cropImageToViewportRect(image, rect);

    await openEditor(croppedDataURL);
  }

  async function startElementCapture(options = {}) {
    await waitForCaptureDelay(options.delaySeconds);

    const rect = await selectElement();

    if (!rect) {
      return;
    }

    const dataURL = await requestVisibleTabCapture();
    const image = await loadImage(dataURL);
    const croppedDataURL = cropImageToViewportRect(image, rect);

    await openEditor(croppedDataURL);
  }

  function getScrollTarget() {
    return (
      document.scrollingElement || document.documentElement || document.body
    );
  }

  function getPageSize(scrollTarget) {
    const doc = document.documentElement;
    const body = document.body || doc;
    const target = scrollTarget || getScrollTarget();

    return {
      width: Math.max(
        target.scrollWidth,
        doc.scrollWidth,
        body.scrollWidth,
        doc.offsetWidth,
        body.offsetWidth,
        doc.clientWidth,
      ),
      height: Math.max(
        target.scrollHeight,
        doc.scrollHeight,
        body.scrollHeight,
        doc.offsetHeight,
        body.offsetHeight,
        doc.clientHeight,
      ),
    };
  }

  function getViewportSize() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  function buildScrollPositions(totalSize, viewportSize, overlapSize = 0) {
    if (totalSize <= viewportSize) {
      return [0];
    }

    const positions = [];
    const step = Math.max(1, viewportSize - overlapSize);
    let current = 0;

    while (current + viewportSize < totalSize) {
      positions.push(current);
      current += step;
    }

    const finalPosition = Math.max(0, totalSize - viewportSize);

    if (positions[positions.length - 1] !== finalPosition) {
      positions.push(finalPosition);
    }

    return positions;
  }

  function scrollToPosition(scrollTarget, x, y) {
    if (
      scrollTarget === document.documentElement ||
      scrollTarget === document.body ||
      scrollTarget === document.scrollingElement
    ) {
      window.scrollTo(x, y);
      scrollTarget.scrollLeft = x;
      scrollTarget.scrollTop = y;
      return;
    }

    scrollTarget.scrollLeft = x;
    scrollTarget.scrollTop = y;
  }

  async function waitForScrollPosition(scrollTarget, targetX, targetY) {
    let position = getScrollPosition(scrollTarget);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await wait(50);
      position = getScrollPosition(scrollTarget);

      if (
        Math.abs(position.x - targetX) <= 2 &&
        Math.abs(position.y - targetY) <= 2
      ) {
        break;
      }
    }

    return position;
  }

  function getScrollPosition(scrollTarget) {
    return {
      x: getScrollLeft(scrollTarget),
      y: getScrollTop(scrollTarget),
    };
  }

  function getScrollLeft(scrollTarget) {
    if (
      scrollTarget === document.documentElement ||
      scrollTarget === document.body ||
      scrollTarget === document.scrollingElement
    ) {
      return window.scrollX || scrollTarget.scrollLeft || 0;
    }

    return scrollTarget.scrollLeft || 0;
  }

  function getScrollTop(scrollTarget) {
    if (
      scrollTarget === document.documentElement ||
      scrollTarget === document.body ||
      scrollTarget === document.scrollingElement
    ) {
      return window.scrollY || scrollTarget.scrollTop || 0;
    }

    return scrollTarget.scrollTop || 0;
  }

  function stitchTiles(tileGrid, pageSize, viewport, scaleX, scaleY) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const effectivePageSize = getEffectivePageSize(
      tileGrid,
      pageSize,
      viewport,
    );

    canvas.width = Math.max(1, Math.round(effectivePageSize.width * scaleX));
    canvas.height = Math.max(1, Math.round(effectivePageSize.height * scaleY));

    for (let rowIndex = 0; rowIndex < tileGrid.length; rowIndex += 1) {
      const row = tileGrid[rowIndex];

      for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        const tile = row[columnIndex];
        const sourceLeftCss = getHorizontalLeadingCropCss(
          tileGrid,
          rowIndex,
          columnIndex,
          viewport.width,
        );
        const sourceTopCss = getVerticalLeadingCropCss(
          tileGrid,
          rowIndex,
          columnIndex,
          viewport.height,
        );
        const sourceWidthCss = Math.min(
          viewport.width - sourceLeftCss,
          effectivePageSize.width - tile.x - sourceLeftCss,
        );
        const sourceHeightCss = Math.min(
          viewport.height - sourceTopCss,
          effectivePageSize.height - tile.y - sourceTopCss,
        );
        const sourceLeft = Math.round(sourceLeftCss * scaleX);
        const sourceTop = Math.round(sourceTopCss * scaleY);
        const sourceWidth = Math.round(sourceWidthCss * scaleX);
        const sourceHeight = Math.round(sourceHeightCss * scaleY);
        const targetX = Math.round((tile.x + sourceLeftCss) * scaleX);
        const targetY = Math.round((tile.y + sourceTopCss) * scaleY);

        if (sourceWidth <= 0 || sourceHeight <= 0) {
          continue;
        }

        context.drawImage(
          tile.image,
          sourceLeft,
          sourceTop,
          sourceWidth,
          sourceHeight,
          targetX,
          targetY,
          sourceWidth,
          sourceHeight,
        );
      }
    }

    return canvas.toDataURL("image/png");
  }

  function getEffectivePageSize(tileGrid, pageSize, viewport) {
    let maxCapturedRight = viewport.width;
    let maxCapturedBottom = viewport.height;

    for (const row of tileGrid) {
      for (const tile of row) {
        maxCapturedRight = Math.max(maxCapturedRight, tile.x + viewport.width);
        maxCapturedBottom = Math.max(
          maxCapturedBottom,
          tile.y + viewport.height,
        );
      }
    }

    return {
      width: Math.min(pageSize.width, maxCapturedRight),
      height: Math.min(pageSize.height, maxCapturedBottom),
    };
  }

  function getHorizontalLeadingCropCss(
    tileGrid,
    rowIndex,
    columnIndex,
    viewportWidth,
  ) {
    if (columnIndex === 0) {
      return 0;
    }

    const row = tileGrid[rowIndex];
    const previousTile = row[columnIndex - 1];
    const currentTile = row[columnIndex];
    const overlap = previousTile.x + viewportWidth - currentTile.x;

    return Math.max(
      0,
      Math.min(viewportWidth - 1, overlap - SEAM_OVERWRITE_CSS_PX),
    );
  }

  function getVerticalLeadingCropCss(
    tileGrid,
    rowIndex,
    columnIndex,
    viewportHeight,
  ) {
    if (rowIndex === 0) {
      return 0;
    }

    const previousRow = tileGrid[rowIndex - 1];
    const previousTile =
      previousRow[columnIndex] || previousRow[previousRow.length - 1];
    const currentTile = tileGrid[rowIndex][columnIndex];
    const overlap = previousTile.y + viewportHeight - currentTile.y;

    return Math.max(
      0,
      Math.min(viewportHeight - 1, overlap - SEAM_OVERWRITE_CSS_PX),
    );
  }

  function showLargeCaptureDialog(details) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      const dialog = document.createElement("div");
      const title = document.createElement("h2");
      const message = document.createElement("p");
      const meta = document.createElement("p");
      const actions = document.createElement("div");
      const limitButton = document.createElement("button");
      const fullButton = document.createElement("button");
      const cancelButton = document.createElement("button");

      overlay.className = "ripfullpage-dialog-overlay";
      dialog.className = "ripfullpage-dialog";
      actions.className = "ripfullpage-dialog-actions";
      limitButton.className =
        "ripfullpage-dialog-button ripfullpage-dialog-primary";
      fullButton.className = "ripfullpage-dialog-button";
      cancelButton.className = "ripfullpage-dialog-button";

      title.textContent = "页面过长";
      message.textContent =
        "这个页面可能是无限滚动或超长页面，完整截图容易卡住或占用大量内存。";
      meta.textContent =
        `预计 ${details.totalTiles} 张分块，页面高度 ${details.pageHeight}px。` +
        ` 推荐限制为 ${details.limitedTiles} 张分块，约 ${details.limitedHeight}px。`;
      limitButton.textContent = "限制截图";
      fullButton.textContent = "继续完整截图";
      cancelButton.textContent = "取消";

      const cleanup = (choice) => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        resolve(choice);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup("cancel");
        }
      };

      limitButton.addEventListener("click", () => cleanup("limit"));
      fullButton.addEventListener("click", () => cleanup("full"));
      cancelButton.addEventListener("click", () => cleanup("cancel"));
      document.addEventListener("keydown", onKeyDown, true);

      actions.append(limitButton, fullButton, cancelButton);
      dialog.append(title, message, meta, actions);
      overlay.append(dialog);
      document.documentElement.appendChild(overlay);
      limitButton.focus();
    });
  }

  function selectArea() {
    return new Promise((resolve) => {
      let startX = 0;
      let startY = 0;
      let currentRect = null;
      let isDragging = false;

      const overlay = document.createElement("div");
      const selection = document.createElement("div");
      const label = document.createElement("div");

      overlay.className = "ripfullpage-overlay";
      selection.className = "ripfullpage-selection";
      label.className = "ripfullpage-size-label";

      overlay.append(selection, label);
      document.documentElement.appendChild(overlay);

      const cleanup = () => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.removeEventListener("mousedown", onMouseDown, true);
        overlay.removeEventListener("mousemove", onMouseMove, true);
        overlay.removeEventListener("mouseup", onMouseUp, true);
        overlay.remove();
      };

      const finish = (rect) => {
        cleanup();
        resolve(rect);
      };

      const cancel = () => {
        cleanup();
        resolve(null);
      };

      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      };

      const onMouseDown = (event) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        isDragging = true;
        startX = event.clientX;
        startY = event.clientY;
        currentRect = makeRect(startX, startY, startX, startY);
        renderSelection(currentRect, selection, label);
      };

      const onMouseMove = (event) => {
        if (!isDragging) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        currentRect = makeRect(startX, startY, event.clientX, event.clientY);
        renderSelection(currentRect, selection, label);
      };

      const onMouseUp = (event) => {
        if (!isDragging) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        isDragging = false;
        currentRect = makeRect(startX, startY, event.clientX, event.clientY);

        if (
          currentRect.width < MIN_SELECTION_SIZE ||
          currentRect.height < MIN_SELECTION_SIZE
        ) {
          cancel();
          return;
        }

        finish(currentRect);
      };

      document.addEventListener("keydown", onKeyDown, true);
      overlay.addEventListener("mousedown", onMouseDown, true);
      overlay.addEventListener("mousemove", onMouseMove, true);
      overlay.addEventListener("mouseup", onMouseUp, true);
    });
  }

  function selectElement() {
    return new Promise((resolve) => {
      let activeElement = null;

      const overlay = document.createElement("div");
      const highlight = document.createElement("div");
      const label = document.createElement("div");

      overlay.className = "ripfullpage-element-overlay";
      highlight.className = "ripfullpage-element-highlight";
      label.className = "ripfullpage-size-label";
      label.textContent = "点击选择元素，ESC 取消";

      overlay.append(highlight, label);
      document.documentElement.appendChild(overlay);

      const cleanup = () => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.removeEventListener("mousemove", onMouseMove, true);
        overlay.removeEventListener("click", onClick, true);
        overlay.remove();
      };
      const cancel = () => {
        cleanup();
        resolve(null);
      };
      const finish = (rect) => {
        cleanup();
        resolve(rect);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      };
      const onMouseMove = (event) => {
        overlay.style.pointerEvents = "none";
        const element = document.elementFromPoint(event.clientX, event.clientY);
        overlay.style.pointerEvents = "auto";
        activeElement = findSelectableElement(element);

        if (!activeElement) {
          highlight.hidden = true;
          return;
        }

        const rect = clampRectToViewport(activeElement.getBoundingClientRect());

        highlight.hidden = false;
        highlight.style.left = `${rect.left}px`;
        highlight.style.top = `${rect.top}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
        label.textContent = `${Math.round(rect.width)} x ${Math.round(rect.height)}`;
        label.style.left = `${rect.left}px`;
        label.style.top = `${Math.max(8, rect.top - 32)}px`;
      };
      const onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!activeElement) {
          return;
        }

        const rect = clampRectToViewport(activeElement.getBoundingClientRect());

        if (
          rect.width < MIN_SELECTION_SIZE ||
          rect.height < MIN_SELECTION_SIZE
        ) {
          cancel();
          return;
        }

        finish(rect);
      };

      document.addEventListener("keydown", onKeyDown, true);
      overlay.addEventListener("mousemove", onMouseMove, true);
      overlay.addEventListener("click", onClick, true);
    });
  }

  function findSelectableElement(element) {
    let current = element;

    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      const rect = current.getBoundingClientRect();

      if (
        rect.width >= MIN_SELECTION_SIZE &&
        rect.height >= MIN_SELECTION_SIZE
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function clampRectToViewport(rect) {
    const left = clamp(rect.left, 0, window.innerWidth);
    const top = clamp(rect.top, 0, window.innerHeight);
    const right = clamp(rect.right, 0, window.innerWidth);
    const bottom = clamp(rect.bottom, 0, window.innerHeight);

    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function makeRect(x1, y1, x2, y2) {
    const left = clamp(Math.min(x1, x2), 0, window.innerWidth);
    const top = clamp(Math.min(y1, y2), 0, window.innerHeight);
    const right = clamp(Math.max(x1, x2), 0, window.innerWidth);
    const bottom = clamp(Math.max(y1, y2), 0, window.innerHeight);

    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  }

  function renderSelection(rect, selection, label) {
    selection.style.left = `${rect.left}px`;
    selection.style.top = `${rect.top}px`;
    selection.style.width = `${rect.width}px`;
    selection.style.height = `${rect.height}px`;

    label.textContent = `${Math.round(rect.width)} x ${Math.round(rect.height)}`;
    label.style.left = `${rect.left}px`;
    label.style.top = `${Math.max(8, rect.top - 32)}px`;
  }

  function cropImageToViewportRect(image, rect) {
    const scaleX = image.naturalWidth / window.innerWidth;
    const scaleY = image.naturalHeight / window.innerHeight;
    const sourceX = Math.round(rect.left * scaleX);
    const sourceY = Math.round(rect.top * scaleY);
    const sourceWidth = Math.round(rect.width * scaleX);
    const sourceHeight = Math.round(rect.height * scaleY);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = Math.max(1, sourceWidth);
    canvas.height = Math.max(1, sourceHeight);

    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    return canvas.toDataURL("image/png");
  }

  function requestVisibleTabCapture() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "capture" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.ok || !response.dataURL) {
          reject(
            new Error(
              response && response.error ? response.error : "Capture failed.",
            ),
          );
          return;
        }

        resolve(response.dataURL);
      });
    });
  }

  async function captureCleanViewport(keepPageChrome) {
    const restorePageChrome = hidePageChromeForCapture(keepPageChrome);

    try {
      await wait(80);
      return await requestVisibleTabCapture();
    } finally {
      restorePageChrome();
    }
  }

  function findFloatingElements() {
    const alwaysHide = new Set();
    const pageChrome = new Set();

    for (const element of document.querySelectorAll("body *")) {
      if (!canHideElement(element) || !shouldHideElementForCapture(element)) {
        continue;
      }

      if (shouldAlwaysHideElement(element)) {
        alwaysHide.add(element);
      } else {
        pageChrome.add(element);
      }
    }

    for (const element of findRightSideOverlayElements()) {
      if (canHideElement(element)) {
        alwaysHide.add(element);
      }
    }

    return {
      alwaysHide: Array.from(alwaysHide),
      pageChrome: Array.from(pageChrome),
    };
  }

  function findRightSideOverlayElements() {
    const elements = new Set();
    const sampleXs = [
      window.innerWidth - 8,
      window.innerWidth - 24,
      window.innerWidth - 48,
      window.innerWidth - 80,
      window.innerWidth - 112,
    ].filter((x) => x > 0);
    const sampleYs = [];

    for (let y = 72; y < window.innerHeight - 24; y += 48) {
      sampleYs.push(y);
    }

    for (const x of sampleXs) {
      for (const y of sampleYs) {
        for (const element of document.elementsFromPoint(x, y)) {
          const candidate = findHideCandidateFromPointElement(element);

          if (candidate) {
            elements.add(candidate);
          }
        }
      }
    }

    return Array.from(elements);
  }

  function findHideCandidateFromPointElement(element) {
    let current = element;

    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      if (canHideElement(current) && shouldAlwaysHideElement(current)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function canHideElement(element) {
    return (
      element &&
      element.nodeType === Node.ELEMENT_NODE &&
      element !== document.body &&
      element !== document.documentElement &&
      element.style &&
      typeof element.style.setProperty === "function" &&
      !element.closest(".ripfullpage-toast")
    );
  }

  function shouldHideElementForCapture(element) {
    if (!canHideElement(element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    if (style.visibility === "hidden" || style.display === "none") {
      return false;
    }

    if (rect.width < 1 || rect.height < 1) {
      return false;
    }

    return (
      shouldAlwaysHideElement(element) ||
      isPageChromeElement(element, style) ||
      isLikelyFloatingWidget(element)
    );
  }

  function shouldAlwaysHideElement(element) {
    if (!canHideElement(element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const name = getElementSignature(element);
    const isKnownExtensionWidget =
      /immersive|immersivetranslate|immersive-translate|imt-|chrome-extension:/.test(
        name,
      );
    const isAdWidget =
      /(^|\W)(ad|ads|advert|advertisement|sponsor|sponsored|promo|promoted)(\W|$)|carbonads|data-collective|retool/.test(
        name,
      );
    const isExtensionFrame =
      element.tagName.toLowerCase() === "iframe" &&
      /chrome-extension:|immersive|translate|translation/.test(name);
    const isAdFrame =
      element.tagName.toLowerCase() === "iframe" &&
      /(^|\W)(ad|ads|advert|sponsor|promo)(\W|$)|doubleclick|googlesyndication|carbonads|data-collective|retool/.test(
        name,
      );
    const isSmallRightOverlay =
      rect.width <= 180 &&
      rect.height <= 320 &&
      rect.right >= window.innerWidth - 140 &&
      rect.left >= window.innerWidth * 0.65 &&
      style.zIndex !== "auto" &&
      Number(style.zIndex) >= 10;
    const isRightSideAdCta =
      isSmallRightElement(rect) &&
      /join now|start.*free|free trial|try.*free|Start Building|learn more|sign up|get started/.test(
        name,
      );

    return (
      isKnownExtensionWidget ||
      isExtensionFrame ||
      isAdFrame ||
      isSmallRightOverlay ||
      isRightSideAdCta ||
      isAdWidget
    );
  }

  function isPageChromeElement(element, style) {
    return style.position === "fixed" || style.position === "sticky";
  }

  function isLikelyFloatingWidget(element) {
    if (!canHideElement(element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    if (style.visibility === "hidden" || style.display === "none") {
      return false;
    }

    if (rect.width < 1 || rect.height < 1) {
      return false;
    }

    const name = getElementSignature(element);
    const isKnownExtensionWidget =
      /immersive|immersivetranslate|immersive-translate|imt-|chrome-extension:/.test(
        name,
      );
    const isNamedFloatingWidget =
      /float|floating|fixed|sticky|toolbar|widget|back-to-top|scroll-to-top|share|dock|assistant/.test(
        name,
      );
    const isAdWidget =
      /(^|\W)(ad|ads|advert|advertisement|sponsor|sponsored|promo|promoted)(\W|$)|carbonads|data-collective|retool/.test(
        name,
      );
    const isExtensionFrame =
      element.tagName.toLowerCase() === "iframe" &&
      /chrome-extension:|immersive|translate|translation/.test(name);
    const isAdFrame =
      element.tagName.toLowerCase() === "iframe" &&
      /(^|\W)(ad|ads|advert|sponsor|promo)(\W|$)|doubleclick|googlesyndication|carbonads|data-collective|retool/.test(
        name,
      );
    const isSmallSideElement = isSmallRightElement(rect);
    const hasOverlayStacking =
      style.zIndex !== "auto" && Number(style.zIndex) >= 10;
    const floatsOnViewport =
      style.position === "fixed" || style.position === "sticky";

    return (
      isKnownExtensionWidget ||
      isExtensionFrame ||
      isAdFrame ||
      (isAdWidget &&
        (floatsOnViewport || isSmallSideElement || hasOverlayStacking)) ||
      floatsOnViewport ||
      (isSmallSideElement && (hasOverlayStacking || isNamedFloatingWidget))
    );
  }

  function getElementSignature(element) {
    const className =
      typeof element.className === "string" ? element.className : "";
    const src = element.getAttribute("src") || "";
    const title = element.getAttribute("title") || "";
    const ariaLabel = element.getAttribute("aria-label") || "";
    const dataTestId = element.getAttribute("data-testid") || "";
    const dataId = element.getAttribute("data-id") || "";
    const role = element.getAttribute("role") || "";
    const visibleText = getShortVisibleText(element);

    return `${element.tagName} ${element.id} ${className} ${src} ${title} ${ariaLabel} ${dataTestId} ${dataId} ${role} ${visibleText}`.toLowerCase();
  }

  function getShortVisibleText(element) {
    const rect = element.getBoundingClientRect();

    if (rect.width > 260 || rect.height > 120) {
      return "";
    }

    return (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function isSmallRightElement(rect) {
    return (
      rect.width <= 220 &&
      rect.height <= 120 &&
      rect.right >= window.innerWidth - 120 &&
      rect.left >= window.innerWidth * 0.58
    );
  }

  function shouldCollapseElementForCapture(element) {
    const rect = element.getBoundingClientRect();
    const name = getElementSignature(element);

    return (
      isSmallRightElement(rect) ||
      /immersive|immersivetranslate|immersive-translate|chrome-extension:/.test(
        name,
      )
    );
  }

  function hidePageChromeForCapture(keepPageChrome) {
    const changed = [];
    const floatingElements = findFloatingElements();

    if (activeToast) {
      changed.push({
        element: activeToast,
        display: activeToast.style.getPropertyValue("display"),
        displayPriority: activeToast.style.getPropertyPriority("display"),
        visibility: activeToast.style.getPropertyValue("visibility"),
        visibilityPriority: activeToast.style.getPropertyPriority("visibility"),
      });
      activeToast.style.setProperty("display", "none", "important");
      activeToast.style.setProperty("visibility", "hidden", "important");
    }

    for (const element of floatingElements.alwaysHide) {
      if (!canHideElement(element) || !element.isConnected) {
        continue;
      }

      changed.push({
        element,
        display: element.style.getPropertyValue("display"),
        displayPriority: element.style.getPropertyPriority("display"),
        visibility: element.style.getPropertyValue("visibility"),
        visibilityPriority: element.style.getPropertyPriority("visibility"),
      });
      if (shouldCollapseElementForCapture(element)) {
        element.style.setProperty("display", "none", "important");
      }
      element.style.setProperty("visibility", "hidden", "important");
    }

    if (!keepPageChrome) {
      for (const element of floatingElements.pageChrome) {
        if (!canHideElement(element) || !element.isConnected) {
          continue;
        }

        changed.push({
          element,
          visibility: element.style.getPropertyValue("visibility"),
          visibilityPriority: element.style.getPropertyPriority("visibility"),
        });
        element.style.setProperty("visibility", "hidden", "important");
      }
    }

    return () => {
      for (const item of changed) {
        if (!item.element.isConnected) {
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(item, "display")) {
          if (item.display) {
            item.element.style.setProperty(
              "display",
              item.display,
              item.displayPriority,
            );
          } else {
            item.element.style.removeProperty("display");
          }
        }

        if (item.visibility) {
          item.element.style.setProperty(
            "visibility",
            item.visibility,
            item.visibilityPriority,
          );
        } else {
          item.element.style.removeProperty("visibility");
        }
      }
    };
  }

  function openEditor(dataURL) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "openEditor", dataURL },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response || !response.ok) {
            reject(
              new Error(
                response && response.error
                  ? response.error
                  : "Could not open editor.",
              ),
            );
            return;
          }

          resolve();
        },
      );
    });
  }

  function loadImage(dataURL) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load captured image."));
      image.src = dataURL;
    });
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
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
        `将在 ${second} 秒后截图...`,
        false,
        (totalSeconds - second) / totalSeconds,
      );
      await wait(1000);
    }

    showToast("正在截图...", false, 1);
    await wait(120);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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
    const bar = activeToast.querySelector(".ripfullpage-toast-bar");
    const fill = activeToast.querySelector(".ripfullpage-toast-bar span");

    textNode.textContent = text;
    activeToast.classList.toggle("ripfullpage-toast-error", isError);
    activeToast.classList.toggle(
      "ripfullpage-toast-has-progress",
      progress !== null,
    );

    if (progress !== null) {
      fill.style.width = `${Math.round(clamp(progress, 0, 1) * 100)}%`;
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
})();
