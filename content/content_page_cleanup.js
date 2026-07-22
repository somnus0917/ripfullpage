// Hides floating page chrome and site-specific chat composers during capture.
(() => {
  if (window.ripfullpagePageCleanup) {
    return;
  }

  const runtime = window.ripfullpageRuntime;

  if (!runtime) {
    throw new Error("ripfullpage runtime helpers are not loaded.");
  }

  const { getActiveToast } = runtime;

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

function canHideElement(element, options = {}) {
  return (
    element &&
    element.nodeType === Node.ELEMENT_NODE &&
    element !== document.body &&
    element !== document.documentElement &&
    element.style &&
    typeof element.style.setProperty === "function" &&
    (options.allowToast || !element.closest(".ripfullpage-toast"))
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
  const isAiChatComposer = isAiChatComposerElement(
    element,
    style,
    rect,
    name,
  );

  return (
    isKnownExtensionWidget ||
    isExtensionFrame ||
    isAdFrame ||
    isSmallRightOverlay ||
    isRightSideAdCta ||
    isAiChatComposer ||
    isAdWidget
  );
}

function isPageChromeElement(element, style) {
  return style.position === "fixed" || style.position === "sticky";
}

function isAiChatComposerElement(element, style, rect, name) {
  if (!isAiChatPage() || !canHideElement(element)) {
    return false;
  }

  const elementStyle = style || window.getComputedStyle(element);
  const elementRect = rect || element.getBoundingClientRect();

  if (
    elementStyle.visibility === "hidden" ||
    elementStyle.display === "none" ||
    elementRect.width < Math.min(320, window.innerWidth * 0.35) ||
    elementRect.height < 36 ||
    elementRect.height > Math.min(280, window.innerHeight * 0.5)
  ) {
    return false;
  }

  const isNearViewportBottom =
    elementRect.bottom >= window.innerHeight - 180 ||
    elementStyle.position === "fixed" ||
    elementStyle.position === "sticky";

  if (!isNearViewportBottom) {
    return false;
  }

  const editableSelector =
    'textarea,[contenteditable="true"],[role="textbox"],[placeholder*="message" i],[placeholder*="ask" i],[aria-label*="message" i],[aria-label*="ask" i],[data-placeholder*="message" i],[data-placeholder*="ask" i]';
  const editableElement = element.matches(editableSelector)
    ? element
    : element.querySelector(editableSelector);

  if (!editableElement) {
    return false;
  }

  const signature = name || getElementSignature(element);
  const visibleText = (element.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240)
    .toLowerCase();
  const inputHint = [
    editableElement.getAttribute("placeholder"),
    editableElement.getAttribute("aria-label"),
    editableElement.getAttribute("data-placeholder"),
    editableElement.textContent,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const composerText = `${signature} ${visibleText} ${inputHint}`;

  if (isClaudePage()) {
    return /write a message|message claude|sonnet|opus|haiku/.test(
      composerText,
    );
  }

  return /ask anything|message chatgpt|chatgpt can make mistakes|instant|temporary chat|prompt-textarea|send message|voice mode/.test(
    composerText,
  );
}

function isAiChatPage() {
  return isClaudePage() || isChatGptPage();
}

function isClaudePage() {
  return /(^|\.)claude\.ai$/i.test(window.location.hostname);
}

function isChatGptPage() {
  return /(^|\.)chatgpt\.com$/i.test(window.location.hostname) ||
    /(^|\.)chat\.openai\.com$/i.test(window.location.hostname);
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
    isAiChatComposerElement(element, null, rect, name) ||
    /immersive|immersivetranslate|immersive-translate|chrome-extension:/.test(
      name,
    )
  );
}

function hideAlwaysElementsForCapture() {
  const changed = [];
  const floatingElements = findFloatingElements();

  for (const element of floatingElements.alwaysHide) {
    hideElementForCapture(
      changed,
      element,
      shouldCollapseElementForCapture(element),
    );
  }

  return () => restoreHiddenElements(changed);
}

function hidePageChromeForCapture(keepPageChrome) {
  const changed = [];
  const floatingElements = findFloatingElements();

  hideElementForCapture(changed, getActiveToast(), true);

  for (const element of floatingElements.alwaysHide) {
    hideElementForCapture(
      changed,
      element,
      shouldCollapseElementForCapture(element),
    );
  }

  if (!keepPageChrome) {
    for (const element of floatingElements.pageChrome) {
      hideElementForCapture(changed, element, false);
    }
  }

  return () => restoreHiddenElements(changed);
}

function hideElementForCapture(changed, element, collapse) {
  if (
    !canHideElement(element, { allowToast: element === getActiveToast() }) ||
    !element.isConnected
  ) {
    return;
  }

  changed.push({
    element,
    display: element.style.getPropertyValue("display"),
    displayPriority: element.style.getPropertyPriority("display"),
    visibility: element.style.getPropertyValue("visibility"),
    visibilityPriority: element.style.getPropertyPriority("visibility"),
  });

  if (collapse) {
    element.style.setProperty("display", "none", "important");
  }

  element.style.setProperty("visibility", "hidden", "important");
}

function restoreHiddenElements(changed) {
  for (const item of changed) {
    if (!item.element.isConnected) {
      continue;
    }

    if (item.display) {
      item.element.style.setProperty(
        "display",
        item.display,
        item.displayPriority,
      );
    } else {
      item.element.style.removeProperty("display");
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
}

  window.ripfullpagePageCleanup = Object.freeze({
    hideAlwaysElementsForCapture,
    hidePageChromeForCapture,
  });
})();
