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
  const MIN_SELECTION_SIZE = 4;
  let activeToast = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.action !== "string") {
      return false;
    }

    if (message.action === "startCapture") {
      sendResponse({ ok: true });
      captureFullPage().catch((error) => {
        console.error("[ripfullpage] Full page capture failed:", error);
        showToast(`全页截图失败：${error.message}`, true);
      });
      return false;
    }

    if (message.action === "startCustomArea") {
      sendResponse({ ok: true });
      startCustomAreaCapture().catch((error) => {
        console.error("[ripfullpage] Custom area capture failed:", error);
      });
      return false;
    }

    return false;
  });

  async function captureFullPage() {
    const scrollTarget = getScrollTarget();
    const originalScrollX = getScrollLeft(scrollTarget);
    const originalScrollY = getScrollTop(scrollTarget);
    const originalScrollBehavior =
      document.documentElement.style.scrollBehavior;
    const pageSize = getPageSize(scrollTarget);
    const viewport = getViewportSize();
    const xPositions = buildScrollPositions(
      pageSize.width,
      viewport.width,
      TILE_OVERLAP_CSS_PX,
    );
    const yPositions = buildScrollPositions(
      pageSize.height,
      viewport.height,
      TILE_OVERLAP_CSS_PX,
    );
    const tileGrid = [];
    const totalTiles = xPositions.length * yPositions.length;
    let capturedTiles = 0;
    let scaleX = window.devicePixelRatio || 1;
    let scaleY = window.devicePixelRatio || 1;

    document.documentElement.style.scrollBehavior = "auto";
    document.documentElement.classList.add("ripfullpage-capturing");
    showToast(`正在准备全页截图，共 ${totalTiles} 张分块...`);

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
          showToast(`正在截图 ${capturedTiles}/${totalTiles}...`);

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
        pageSize,
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

  async function startCustomAreaCapture() {
    const rect = await selectArea();

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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function showToast(text, isError = false) {
    if (!activeToast) {
      activeToast = document.createElement("div");
      activeToast.className = "ripfullpage-toast";
      document.documentElement.appendChild(activeToast);
    }

    activeToast.textContent = text;
    activeToast.classList.toggle("ripfullpage-toast-error", isError);

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
