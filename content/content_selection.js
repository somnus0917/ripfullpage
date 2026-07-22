// Selection overlays and scrollable-target discovery for page captures.
(() => {
  if (window.ripfullpageSelection) {
    return;
  }

  const runtime = window.ripfullpageRuntime;
  const MIN_SELECTION_SIZE = 4;

  if (!runtime) {
    throw new Error("ripfullpage runtime helpers are not loaded.");
  }

  const { showToast, t } = runtime;

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

    title.textContent = t("pageTooLongTitle");
    message.textContent = t("pageTooLongMessage");
    meta.textContent = t("pageTooLongMeta", {
      totalTiles: details.totalTiles,
      pageHeight: details.pageHeight,
      limitedTiles: details.limitedTiles,
      limitedHeight: details.limitedHeight,
    });
    limitButton.textContent = t("limitCapture");
    fullButton.textContent = t("continueFullCapture");
    cancelButton.textContent = t("cancel");

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
    label.textContent = t("selectElement");

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

function selectScrollableElement() {
  return new Promise((resolve) => {
    let activeTarget = null;

    const overlay = document.createElement("div");
    const highlight = document.createElement("div");
    const label = document.createElement("div");

    overlay.className = "ripfullpage-element-overlay";
    highlight.className = "ripfullpage-element-highlight";
    label.className = "ripfullpage-size-label";
    label.textContent = t("selectScrollableElement");

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
    const finish = (element) => {
      cleanup();
      resolve(element);
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
      activeTarget = findScrollableTarget(element);

      if (!activeTarget) {
        highlight.hidden = true;
        label.textContent = t("moveToScrollable");
        label.style.left =
          `${clamp(event.clientX + 12, 8, Math.max(8, window.innerWidth - 170))}px`;
        label.style.top =
          `${clamp(event.clientY + 12, 8, Math.max(8, window.innerHeight - 34))}px`;
        return;
      }

      const rect = clampRectToViewport(
        activeTarget.viewportElement.getBoundingClientRect(),
      );
      const scrollSize = getScrollableTargetSize(activeTarget);
      const axisLabel = getScrollableTargetAxisLabel(activeTarget);

      highlight.hidden = false;
      highlight.style.left = `${rect.left}px`;
      highlight.style.top = `${rect.top}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
      label.textContent =
        `${axisLabel} ${Math.round(scrollSize.width)} x ${Math.round(scrollSize.height)}`;
      label.style.left = `${rect.left}px`;
      label.style.top = `${Math.max(8, rect.top - 32)}px`;
    };
    const onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!activeTarget) {
        showToast(t("clickScrollable"), true);
        return;
      }

      finish(activeTarget);
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

function findScrollableTarget(element) {
  let current = element;

  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    const frameTarget = getSameOriginScrollableFrameTarget(current);

    if (frameTarget) {
      return frameTarget;
    }

    if (isScrollableCaptureTarget(current)) {
      return {
        scrollElement: current,
        viewportElement: current,
        type: "element",
      };
    }

    current = current.parentElement;
  }

  return null;
}

function normalizeScrollableCaptureTarget(target) {
  if (target && target.scrollElement && target.viewportElement) {
    return target;
  }

  return {
    scrollElement: target,
    viewportElement: target,
    type: "element",
  };
}

function getSameOriginScrollableFrameTarget(element) {
  if (!isIframeElement(element)) {
    return null;
  }

  const scrollElement = getFrameScrollElement(element);

  if (!scrollElement || !isScrollableDocumentTarget(scrollElement)) {
    return null;
  }

  return {
    scrollElement,
    viewportElement: element,
    type: "frame",
  };
}

function isIframeElement(element) {
  return (
    element &&
    element.nodeType === Node.ELEMENT_NODE &&
    element.tagName.toLowerCase() === "iframe"
  );
}

function getFrameScrollElement(iframe) {
  try {
    const frameDocument = iframe.contentDocument;

    if (!frameDocument) {
      return null;
    }

    return (
      frameDocument.scrollingElement ||
      frameDocument.documentElement ||
      frameDocument.body
    );
  } catch (_error) {
    return null;
  }
}

function isScrollableCaptureTarget(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  if (
    rect.width < MIN_SELECTION_SIZE ||
    rect.height < MIN_SELECTION_SIZE ||
    style.visibility === "hidden" ||
    style.display === "none"
  ) {
    return false;
  }

  const canScrollX = element.scrollWidth > element.clientWidth + 2;
  const canScrollY = element.scrollHeight > element.clientHeight + 2;
  const allowsScrollX = isScrollableOverflow(style.overflowX);
  const allowsScrollY = isScrollableOverflow(style.overflowY);

  return (canScrollX && allowsScrollX) || (canScrollY && allowsScrollY);
}

function isScrollableDocumentTarget(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const frameWindow = element.ownerDocument.defaultView;

  if (!frameWindow) {
    return false;
  }

  const viewportWidth = frameWindow.innerWidth || element.clientWidth;
  const viewportHeight = frameWindow.innerHeight || element.clientHeight;

  return (
    element.scrollWidth > viewportWidth + 2 ||
    element.scrollHeight > viewportHeight + 2
  );
}

function isScrollableOverflow(value) {
  return /auto|scroll|overlay/.test(value || "");
}

function getScrollableTargetAxisLabel(target) {
  const captureTarget = normalizeScrollableCaptureTarget(target);
  const element = captureTarget.scrollElement;
  const scrollsX = element.scrollWidth > element.clientWidth + 2;
  const scrollsY = element.scrollHeight > element.clientHeight + 2;

  if (scrollsX && scrollsY) {
    return t("scrollBoth");
  }

  return scrollsX ? t("scrollX") : t("scrollY");
}

function getScrollableTargetSize(target) {
  const captureTarget = normalizeScrollableCaptureTarget(target);
  const element = captureTarget.scrollElement;

  return {
    width: Math.max(element.scrollWidth, element.clientWidth),
    height: Math.max(element.scrollHeight, element.clientHeight),
  };
}

function getScrollableTargetCaptureViewport(target) {
  const captureTarget = normalizeScrollableCaptureTarget(target);
  const element = captureTarget.viewportElement;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const left = rect.left + parseCssPixels(style.borderLeftWidth);
  const top = rect.top + parseCssPixels(style.borderTopWidth);
  const viewportRect = {
    left,
    top,
    width: element.clientWidth,
    height: element.clientHeight,
  };
  const clampedRect = clampRectToViewport({
    left: viewportRect.left,
    top: viewportRect.top,
    right: viewportRect.left + viewportRect.width,
    bottom: viewportRect.top + viewportRect.height,
  });

  if (
    Math.abs(clampedRect.width - viewportRect.width) > 2 ||
    Math.abs(clampedRect.height - viewportRect.height) > 2
  ) {
    throw new Error(t("scrollAreaMustBeVisible"));
  }

  return viewportRect;
}

function hideScrollableTargetScrollbars(target) {
  const captureTarget = normalizeScrollableCaptureTarget(target);

  if (captureTarget.type === "frame") {
    return hideFrameScrollbars(captureTarget.scrollElement.ownerDocument);
  }

  captureTarget.scrollElement.classList.add(
    "ripfullpage-scroll-target-capturing",
  );

  return () => {
    if (captureTarget.scrollElement.isConnected) {
      captureTarget.scrollElement.classList.remove(
        "ripfullpage-scroll-target-capturing",
      );
    }
  };
}

function hideFrameScrollbars(frameDocument) {
  if (!frameDocument || !frameDocument.documentElement) {
    return () => {};
  }

  const style = frameDocument.createElement("style");

  style.textContent =
    "html.ripfullpage-scroll-target-capturing," +
    "html.ripfullpage-scroll-target-capturing body{" +
    "scrollbar-width:none!important;" +
    "}" +
    "html.ripfullpage-scroll-target-capturing::-webkit-scrollbar," +
    "html.ripfullpage-scroll-target-capturing body::-webkit-scrollbar{" +
    "width:0!important;height:0!important;display:none!important;" +
    "}";
  frameDocument.documentElement.classList.add(
    "ripfullpage-scroll-target-capturing",
  );
  (frameDocument.head || frameDocument.documentElement).appendChild(style);

  return () => {
    if (frameDocument.documentElement) {
      frameDocument.documentElement.classList.remove(
        "ripfullpage-scroll-target-capturing",
      );
    }

    style.remove();
  };
}

function parseCssPixels(value) {
  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : 0;
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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.ripfullpageSelection = Object.freeze({
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
  });
})();
