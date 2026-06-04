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
    if (!message || typeof message.action !== 'string') {
      return false;
    }

    if (message.action === 'startCapture') {
      sendResponse({ ok: true });
      captureFullPage().catch((error) => {
        console.error('[ripfullpage] Full page capture failed:', error);
        showToast(`全页截图失败：${error.message}`, true);
      });
      return false;
    }

    if (message.action === 'startCustomArea') {
      sendResponse({ ok: true });
      startCustomAreaCapture().catch((error) => {
        console.error('[ripfullpage] Custom area capture failed:', error);
      });
      return false;
    }

    return false;
  });

  async function captureFullPage() {
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;
    const originalScrollBehavior = document.documentElement.style.scrollBehavior;
    const pageSize = getPageSize();
    const viewport = getViewportSize();
    const xPositions = buildScrollPositions(pageSize.width, viewport.width, TILE_OVERLAP_CSS_PX);
    const yPositions = buildScrollPositions(pageSize.height, viewport.height, TILE_OVERLAP_CSS_PX);
    const tileGrid = [];
    const totalTiles = xPositions.length * yPositions.length;
    let capturedTiles = 0;
    let scaleX = window.devicePixelRatio || 1;
    let scaleY = window.devicePixelRatio || 1;

    document.documentElement.style.scrollBehavior = 'auto';
    document.documentElement.classList.add('ripfullpage-capturing');
    showToast(`正在准备全页截图，共 ${totalTiles} 张分块...`);

    try {
      for (const y of yPositions) {
        const row = [];

        for (const x of xPositions) {
          window.scrollTo(x, y);
          await wait(CAPTURE_DELAY_MS);

          capturedTiles += 1;
          showToast(`正在截图 ${capturedTiles}/${totalTiles}...`);

          const dataURL = await captureCleanViewport();
          const image = await loadImage(dataURL);

          scaleX = image.naturalWidth / viewport.width;
          scaleY = image.naturalHeight / viewport.height;

          row.push({ x, y, image });
        }

        tileGrid.push(row);
      }

      showToast('正在拼接截图...');
      const stitchedDataURL = stitchTiles(tileGrid, pageSize, viewport, scaleX, scaleY, xPositions, yPositions);
      await openEditor(stitchedDataURL);
      hideToast();
    } finally {
      window.scrollTo(originalScrollX, originalScrollY);
      document.documentElement.style.scrollBehavior = originalScrollBehavior;
      document.documentElement.classList.remove('ripfullpage-capturing');
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

  function getPageSize() {
    const doc = document.documentElement;
    const body = document.body || doc;

    return {
      width: Math.max(
        doc.scrollWidth,
        body.scrollWidth,
        doc.offsetWidth,
        body.offsetWidth,
        doc.clientWidth
      ),
      height: Math.max(
        doc.scrollHeight,
        body.scrollHeight,
        doc.offsetHeight,
        body.offsetHeight,
        doc.clientHeight
      )
    };
  }

  function getViewportSize() {
    return {
      width: window.innerWidth,
      height: window.innerHeight
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

  function stitchTiles(tileGrid, pageSize, viewport, scaleX, scaleY, xPositions, yPositions) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    canvas.width = Math.max(1, Math.round(pageSize.width * scaleX));
    canvas.height = Math.max(1, Math.round(pageSize.height * scaleY));

    for (let rowIndex = 0; rowIndex < tileGrid.length; rowIndex += 1) {
      const row = tileGrid[rowIndex];

      for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        const tile = row[columnIndex];
        const sourceLeftCss = getLeadingCropCss(xPositions, columnIndex, viewport.width, SEAM_OVERWRITE_CSS_PX);
        const sourceTopCss = getLeadingCropCss(yPositions, rowIndex, viewport.height, SEAM_OVERWRITE_CSS_PX);
        const sourceWidthCss = Math.min(viewport.width - sourceLeftCss, pageSize.width - tile.x - sourceLeftCss);
        const sourceHeightCss = Math.min(viewport.height - sourceTopCss, pageSize.height - tile.y - sourceTopCss);
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
          sourceHeight
        );
      }
    }

    return canvas.toDataURL('image/png');
  }

  function getLeadingCropCss(positions, index, viewportSize, seamOverwriteSize = 0) {
    if (index === 0) {
      return 0;
    }

    const previousEnd = positions[index - 1] + viewportSize;
    const overlap = previousEnd - positions[index];
    return Math.max(0, Math.min(viewportSize - 1, overlap - seamOverwriteSize));
  }

  function selectArea() {
    return new Promise((resolve) => {
      let startX = 0;
      let startY = 0;
      let currentRect = null;
      let isDragging = false;

      const overlay = document.createElement('div');
      const selection = document.createElement('div');
      const label = document.createElement('div');

      overlay.className = 'ripfullpage-overlay';
      selection.className = 'ripfullpage-selection';
      label.className = 'ripfullpage-size-label';

      overlay.append(selection, label);
      document.documentElement.appendChild(overlay);

      const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.removeEventListener('mousedown', onMouseDown, true);
        overlay.removeEventListener('mousemove', onMouseMove, true);
        overlay.removeEventListener('mouseup', onMouseUp, true);
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
        if (event.key === 'Escape') {
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

        if (currentRect.width < MIN_SELECTION_SIZE || currentRect.height < MIN_SELECTION_SIZE) {
          cancel();
          return;
        }

        finish(currentRect);
      };

      document.addEventListener('keydown', onKeyDown, true);
      overlay.addEventListener('mousedown', onMouseDown, true);
      overlay.addEventListener('mousemove', onMouseMove, true);
      overlay.addEventListener('mouseup', onMouseUp, true);
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
      height: bottom - top
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
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

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
      canvas.height
    );

    return canvas.toDataURL('image/png');
  }

  function requestVisibleTabCapture() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'capture' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.ok || !response.dataURL) {
          reject(new Error(response && response.error ? response.error : 'Capture failed.'));
          return;
        }

        resolve(response.dataURL);
      });
    });
  }

  async function captureCleanViewport() {
    const restorePageChrome = hidePageChromeForCapture();

    try {
      await wait(80);
      return await requestVisibleTabCapture();
    } finally {
      restorePageChrome();
    }
  }

  function findFloatingElements() {
    const elements = new Set();

    for (const element of document.querySelectorAll('body *')) {
      if (canHideElement(element) && shouldHideElementForCapture(element)) {
        elements.add(element);
      }
    }

    for (const element of findRightSideOverlayElements()) {
      if (canHideElement(element)) {
        elements.add(element);
      }
    }

    return Array.from(elements);
  }

  function findRightSideOverlayElements() {
    const elements = new Set();
    const sampleXs = [
      window.innerWidth - 8,
      window.innerWidth - 24,
      window.innerWidth - 48,
      window.innerWidth - 80,
      window.innerWidth - 112
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

    while (current && current !== document.body && current !== document.documentElement) {
      if (canHideElement(current) && isLikelyFloatingWidget(current)) {
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
      typeof element.style.setProperty === 'function' &&
      !element.closest('.ripfullpage-toast')
    );
  }

  function shouldHideElementForCapture(element) {
    if (!canHideElement(element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    if (style.visibility === 'hidden' || style.display === 'none') {
      return false;
    }

    if (rect.width < 1 || rect.height < 1) {
      return false;
    }

    return (
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      isLikelyFloatingWidget(element)
    );
  }

  function isLikelyFloatingWidget(element) {
    if (!canHideElement(element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    if (style.visibility === 'hidden' || style.display === 'none') {
      return false;
    }

    if (rect.width < 1 || rect.height < 1) {
      return false;
    }

    const name = getElementSignature(element);
    const isNamedWidget =
      /immersive|immersivetranslate|immersive-translate|imt-|translate|translation|float|floating|fixed|sticky|toolbar|widget|sidebar|toc|back-to-top|scroll-to-top|share|dock|assistant/.test(name);
    const isExtensionFrame =
      element.tagName.toLowerCase() === 'iframe' &&
      /chrome-extension:|immersive|translate|translation/.test(name);
    const isSmallSideElement =
      rect.width <= 180 &&
      rect.height <= 320 &&
      rect.right >= window.innerWidth - 140 &&
      rect.left >= window.innerWidth * 0.65;
    const hasOverlayStacking = style.zIndex !== 'auto' && Number(style.zIndex) >= 10;
    const floatsOnViewport = style.position === 'fixed' || style.position === 'sticky';

    return isNamedWidget || isExtensionFrame || (isSmallSideElement && (hasOverlayStacking || floatsOnViewport));
  }

  function getElementSignature(element) {
    const className = typeof element.className === 'string' ? element.className : '';
    const src = element.getAttribute('src') || '';
    const title = element.getAttribute('title') || '';
    const ariaLabel = element.getAttribute('aria-label') || '';
    const dataTestId = element.getAttribute('data-testid') || '';
    const dataId = element.getAttribute('data-id') || '';

    return `${element.tagName} ${element.id} ${className} ${src} ${title} ${ariaLabel} ${dataTestId} ${dataId}`.toLowerCase();
  }

  function hidePageChromeForCapture() {
    const changed = [];
    const floatingElements = findFloatingElements();

    if (activeToast) {
      changed.push({
        element: activeToast,
        display: activeToast.style.getPropertyValue('display'),
        displayPriority: activeToast.style.getPropertyPriority('display'),
        visibility: activeToast.style.getPropertyValue('visibility'),
        visibilityPriority: activeToast.style.getPropertyPriority('visibility')
      });
      activeToast.style.setProperty('display', 'none', 'important');
      activeToast.style.setProperty('visibility', 'hidden', 'important');
    }

    for (const element of floatingElements) {
      if (
        !canHideElement(element) ||
        !element.isConnected
      ) {
        continue;
      }

      changed.push({
        element,
        display: element.style.getPropertyValue('display'),
        displayPriority: element.style.getPropertyPriority('display'),
        visibility: element.style.getPropertyValue('visibility'),
        visibilityPriority: element.style.getPropertyPriority('visibility')
      });
      element.style.setProperty('display', 'none', 'important');
      element.style.setProperty('visibility', 'hidden', 'important');
    }

    return () => {
      for (const item of changed) {
        if (!item.element.isConnected) {
          continue;
        }

        if (item.display) {
          item.element.style.setProperty('display', item.display, item.displayPriority);
        } else {
          item.element.style.removeProperty('display');
        }

        if (item.visibility) {
          item.element.style.setProperty('visibility', item.visibility, item.visibilityPriority);
        } else {
          item.element.style.removeProperty('visibility');
        }
      }
    };
  }

  function openEditor(dataURL) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'openEditor', dataURL }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.ok) {
          reject(new Error(response && response.error ? response.error : 'Could not open editor.'));
          return;
        }

        resolve();
      });
    });
  }

  function loadImage(dataURL) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load captured image.'));
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
      activeToast = document.createElement('div');
      activeToast.className = 'ripfullpage-toast';
      document.documentElement.appendChild(activeToast);
    }

    activeToast.textContent = text;
    activeToast.classList.toggle('ripfullpage-toast-error', isError);

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
