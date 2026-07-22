// Capture engine for page measurement, scrolling, stitching, and cropping.

(() => {
  if (window.ripfullpageCapture) {
    return;
  }

  const CAPTURE_DELAY_MS = 300;
  const TILE_OVERLAP_CSS_PX = 120;
  const SEAM_OVERWRITE_CSS_PX = 10;
  const MAX_DEFAULT_FULL_PAGE_TILES = 50;
  const MAX_DEFAULT_FULL_PAGE_HEIGHT = 30000;
  const MIN_SELECTION_SIZE = 4;
  const runtime = window.ripfullpageRuntime;

  if (!runtime) {
    throw new Error("ripfullpage runtime helpers are not loaded.");
  }

  const {
    hideToast,
    showToast,
    t,
    wait,
    waitForCaptureDelay,
    waitForPagePaint,
  } = runtime;
  const selection = window.ripfullpageSelection;
  const pageCleanup = window.ripfullpagePageCleanup;

  if (!selection || !pageCleanup) {
    throw new Error("ripfullpage content modules are not loaded.");
  }

  const {
    clampRectToViewport,
    cropImageToViewportRect,
    getScrollableTargetCaptureViewport,
    getScrollableTargetSize,
    hideScrollableTargetScrollbars,
    isScrollableCaptureTarget,
    normalizeScrollableCaptureTarget,
    selectArea,
    selectElement,
    selectScrollableElement,
    showLargeCaptureDialog,
  } = selection;
  const {
    hideAlwaysElementsForCapture,
    hidePageChromeForCapture,
  } = pageCleanup;

  async function captureFullPage(options = {}) {
    await waitForCaptureDelay(options.delaySeconds);

    const autoScrollableTarget = findAutoFullPageScrollableTarget();

    if (autoScrollableTarget) {
      try {
        await captureScrollableElement(autoScrollableTarget);
        return;
      } catch (error) {
        console.warn(
          "[ripfullpage] Auto scrollable full page capture failed, falling back:",
          error,
        );
        hideToast();
      }
    }

    const scrollTarget = getScrollTarget();
    const originalScrollX = getScrollLeft(scrollTarget);
    const originalScrollY = getScrollTop(scrollTarget);
    const originalScrollBehavior =
      document.documentElement.style.scrollBehavior;
    let restoreAlwaysHidden = () => {};

    document.documentElement.style.scrollBehavior = "auto";
    document.documentElement.classList.add("ripfullpage-capturing");

    try {
      restoreAlwaysHidden = hideAlwaysElementsForCapture();
      await waitForPagePaint();

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

      showToast(t("preparingFullPage", { total: totalTiles }), false, 0);
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
            t("capturingProgress", {
              captured: capturedTiles,
              total: totalTiles,
            }),
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

      showToast(t("stitchingScreenshot"));
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
      restoreAlwaysHidden();
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

    await waitForPagePaint();

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

    await waitForPagePaint();

    const dataURL = await requestVisibleTabCapture();
    const image = await loadImage(dataURL);
    const croppedDataURL = cropImageToViewportRect(image, rect);

    await openEditor(croppedDataURL);
  }

  async function startScrollableElementCapture(options = {}) {
    await waitForCaptureDelay(options.delaySeconds);

    const target = await selectScrollableElement();

    if (!target) {
      return;
    }

    await captureScrollableElement(target);
  }

  async function captureScrollableElement(target) {
    const captureTarget = normalizeScrollableCaptureTarget(target);
    const scrollTarget = captureTarget.scrollElement;
    const viewportTarget = captureTarget.viewportElement;

    if (
      !scrollTarget ||
      !viewportTarget ||
      !scrollTarget.isConnected ||
      !viewportTarget.isConnected
    ) {
      throw new Error(t("scrollTargetMissing"));
    }

    const originalScrollLeft = scrollTarget.scrollLeft;
    const originalScrollTop = scrollTarget.scrollTop;
    const originalScrollBehavior = scrollTarget.style.scrollBehavior;
    const originalDocumentScrollBehavior =
      document.documentElement.style.scrollBehavior;
    let capturePageSize = null;
    let xPositions = [];
    let yPositions = [];
    let captureViewport = null;
    let restoreScrollbars = () => {};

    document.documentElement.style.scrollBehavior = "auto";
    document.documentElement.classList.add("ripfullpage-capturing");
    restoreScrollbars = hideScrollableTargetScrollbars(captureTarget);
    scrollTarget.style.scrollBehavior = "auto";

    try {
      await wait(80);

      const pageSize = getScrollableTargetSize(captureTarget);
      captureViewport = getScrollableTargetCaptureViewport(captureTarget);

      if (
        captureViewport.width < MIN_SELECTION_SIZE ||
        captureViewport.height < MIN_SELECTION_SIZE
      ) {
        throw new Error(t("scrollTargetTooSmall"));
      }

      xPositions = buildScrollPositions(
        pageSize.width,
        captureViewport.width,
        TILE_OVERLAP_CSS_PX,
      );
      yPositions = buildScrollPositions(
        pageSize.height,
        captureViewport.height,
        TILE_OVERLAP_CSS_PX,
      );

      const capturePlan = await confirmLargeCaptureIfNeeded(
        pageSize,
        captureViewport,
        xPositions,
        yPositions,
      );

      if (capturePlan.action === "cancel") {
        return;
      }

      capturePageSize = capturePlan.pageSize;
      xPositions = capturePlan.xPositions;
      yPositions = capturePlan.yPositions;

      const tileGrid = [];
      const totalTiles = xPositions.length * yPositions.length;
      let capturedTiles = 0;
      let scaleX = window.devicePixelRatio || 1;
      let scaleY = window.devicePixelRatio || 1;

      showToast(t("preparingScrollElement", { total: totalTiles }), false, 0);

      for (const y of yPositions) {
        const row = [];

        for (const x of xPositions) {
          scrollToPosition(scrollTarget, x, y);
          const actualPosition = await waitForScrollPosition(scrollTarget, x, y);
          await wait(CAPTURE_DELAY_MS);

          capturedTiles += 1;
          showToast(
            t("capturingProgress", {
              captured: capturedTiles,
              total: totalTiles,
            }),
            false,
            capturedTiles / totalTiles,
          );

          const viewportRect = getScrollableTargetCaptureViewport(captureTarget);
          const dataURL = await captureCleanViewport(true);
          const image = await loadImage(dataURL);
          const tileDataURL = cropImageToViewportRect(image, viewportRect);
          const tileImage = await loadImage(tileDataURL);

          scaleX = tileImage.naturalWidth / captureViewport.width;
          scaleY = tileImage.naturalHeight / captureViewport.height;

          row.push({
            x: actualPosition.x,
            y: actualPosition.y,
            image: tileImage,
          });
        }

        tileGrid.push(row);
      }

      showToast(t("stitchingScrollElement"));
      const stitchedDataURL = stitchTiles(
        tileGrid,
        capturePageSize,
        captureViewport,
        scaleX,
        scaleY,
      );
      await openEditor(stitchedDataURL);
      hideToast();
    } finally {
      scrollToPosition(scrollTarget, originalScrollLeft, originalScrollTop);
      scrollTarget.style.scrollBehavior = originalScrollBehavior;
      restoreScrollbars();
      document.documentElement.style.scrollBehavior =
        originalDocumentScrollBehavior;
      document.documentElement.classList.remove("ripfullpage-capturing");
    }
  }

  function getScrollTarget() {
    return (
      document.scrollingElement || document.documentElement || document.body
    );
  }

  function findAutoFullPageScrollableTarget() {
    const documentTarget = getScrollTarget();
    const pageSize = getPageSize(documentTarget);
    const viewport = getViewportSize();
    const documentCanScroll =
      pageSize.height > viewport.height + 2 ||
      pageSize.width > viewport.width + 2;

    if (documentCanScroll) {
      return null;
    }

    let best = null;

    for (const element of walkScrollableCandidateElements(document.body)) {
      if (!isAutoFullPageScrollableCandidate(element, viewport)) {
        continue;
      }

      const rect = clampRectToViewport(element.getBoundingClientRect());
      const scrollRange =
        Math.max(0, element.scrollHeight - element.clientHeight) +
        Math.max(0, element.scrollWidth - element.clientWidth);
      const score =
        rect.width * rect.height +
        scrollRange * Math.min(rect.width, viewport.width);

      if (!best || score > best.score) {
        best = { element, score };
      }
    }

    return best ? best.element : null;
  }

  function* walkScrollableCandidateElements(root) {
    if (!root) {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

    if (root.nodeType === Node.ELEMENT_NODE) {
      yield root;
    }

    let element = walker.nextNode();

    while (element) {
      yield element;

      if (element.shadowRoot) {
        yield* walkScrollableCandidateElements(element.shadowRoot);
      }

      element = walker.nextNode();
    }
  }

  function isAutoFullPageScrollableCandidate(element, viewport) {
    if (
      !element ||
      element === document.body ||
      element === document.documentElement
    ) {
      return false;
    }

    if (!isScrollableCaptureTarget(element)) {
      return false;
    }

    const target = {
      scrollElement: element,
      viewportElement: element,
      type: "element",
    };
    let captureViewport;

    try {
      captureViewport = getScrollableTargetCaptureViewport(target);
    } catch (_error) {
      return false;
    }

    const scrollSize = getScrollableTargetSize(target);
    const hasScrollableContent =
      scrollSize.width > captureViewport.width + 2 ||
      scrollSize.height > captureViewport.height + 2;

    return (
      hasScrollableContent &&
      captureViewport.width >=
        Math.max(MIN_SELECTION_SIZE, viewport.width * 0.35) &&
      captureViewport.height >=
        Math.max(MIN_SELECTION_SIZE, viewport.height * 0.35) &&
      captureViewport.width * captureViewport.height >= viewport.width * viewport.height * 0.18
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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  window.ripfullpageCapture = Object.freeze({
    captureFullPage,
    startCustomAreaCapture,
    startElementCapture,
    startScrollableElementCapture,
  });
})();
