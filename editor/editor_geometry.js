// Pure coordinate and crop-rectangle helpers for the editor.
(() => {
  const MIN_CROP_SIZE = 20;

function resizeCropRect(startRect, handle, dx, dy, bounds) {
  let left = startRect.left;
  let top = startRect.top;
  let right = startRect.left + startRect.width;
  let bottom = startRect.top + startRect.height;

  if (handle === 'move') {
    left = clamp(startRect.left + dx, 0, bounds.width - startRect.width);
    top = clamp(startRect.top + dy, 0, bounds.height - startRect.height);
    return {
      left,
      top,
      width: startRect.width,
      height: startRect.height
    };
  }

  if (handle.includes('w')) {
    left = clamp(startRect.left + dx, 0, right - MIN_CROP_SIZE);
  }

  if (handle.includes('e')) {
    right = clamp(right + dx, left + MIN_CROP_SIZE, bounds.width);
  }

  if (handle.includes('n')) {
    top = clamp(startRect.top + dy, 0, bottom - MIN_CROP_SIZE);
  }

  if (handle.includes('s')) {
    bottom = clamp(bottom + dy, top + MIN_CROP_SIZE, bounds.height);
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

function getLocalPoint(event, imageRect) {
  return {
    x: clamp(event.clientX - imageRect.left, 0, imageRect.width),
    y: clamp(event.clientY - imageRect.top, 0, imageRect.height)
  };
}

function pointInRect(point, rect) {
  return (
    rect &&
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

function scalePoint(point, scaleX, scaleY) {
  return {
    x: point.x * scaleX,
    y: point.y * scaleY
  };
}

function makeRect(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

function clampRectToCanvas(rect, canvas) {
  const left = clamp(rect.left, 0, canvas.width);
  const top = clamp(rect.top, 0, canvas.height);
  const right = clamp(rect.left + rect.width, 0, canvas.width);
  const bottom = clamp(rect.top + rect.height, 0, canvas.height);

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.ripfullpageEditorGeometry = Object.freeze({
    clampRectToCanvas,
    getLocalPoint,
    makeRect,
    pointInRect,
    resizeCropRect,
    scalePoint,
  });
})();
