// Screenshot editor. It displays the captured image, supports interactive cropping,
// reset, and PNG download without using any third-party library.

const EDITOR_IMAGE_KEY = 'ripfullpage:lastImage';
const MIN_CROP_SIZE = 20;

const previewImage = document.getElementById('previewImage');
const imageWrap = document.getElementById('imageWrap');
const cropBox = document.getElementById('cropBox');
const cropSize = document.getElementById('cropSize');
const imageMeta = document.getElementById('imageMeta');
const applyCropButton = document.getElementById('applyCropButton');
const resetButton = document.getElementById('resetButton');
const downloadButton = document.getElementById('downloadButton');

let originalDataURL = '';
let currentDataURL = '';
let naturalWidth = 0;
let naturalHeight = 0;
let cropRect = null;
let dragState = null;

init();

async function init() {
  const stored = await chrome.storage.session.get(EDITOR_IMAGE_KEY);
  const item = stored[EDITOR_IMAGE_KEY];

  if (!item || !item.dataURL) {
    imageMeta.textContent = '没有找到截图数据';
    setButtonsEnabled(false);
    return;
  }

  originalDataURL = item.dataURL;
  currentDataURL = item.dataURL;

  bindEvents();
  await loadPreview(currentDataURL);
}

function bindEvents() {
  previewImage.addEventListener('load', onPreviewLoaded);
  imageWrap.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('resize', resetCropBox);

  applyCropButton.addEventListener('click', applyCrop);
  resetButton.addEventListener('click', resetImage);
  downloadButton.addEventListener('click', downloadImage);
}

function loadPreview(dataURL) {
  return new Promise((resolve, reject) => {
    previewImage.onload = () => {
      onPreviewLoaded();
      resolve();
    };
    previewImage.onerror = () => reject(new Error('Could not load screenshot.'));
    previewImage.src = dataURL;
  });
}

function onPreviewLoaded() {
  naturalWidth = previewImage.naturalWidth;
  naturalHeight = previewImage.naturalHeight;
  imageMeta.textContent = `${naturalWidth} x ${naturalHeight}px`;
  setButtonsEnabled(true);
  resetCropBox();
}

function resetCropBox() {
  if (!naturalWidth || !naturalHeight) {
    return;
  }

  const rect = getRenderedImageRect();
  const insetX = Math.max(12, Math.round(rect.width * 0.08));
  const insetY = Math.max(12, Math.round(rect.height * 0.08));

  cropRect = {
    left: insetX,
    top: insetY,
    width: Math.max(MIN_CROP_SIZE, rect.width - insetX * 2),
    height: Math.max(MIN_CROP_SIZE, rect.height - insetY * 2)
  };

  renderCropBox();
}

function onPointerDown(event) {
  if (!currentDataURL || event.button !== 0) {
    return;
  }

  const imageRect = getRenderedImageRect();
  const localPoint = getLocalPoint(event, imageRect);
  const handle = event.target.dataset.handle || '';
  const isInsideCrop = pointInRect(localPoint, cropRect);

  if (!handle && !isInsideCrop) {
    cropRect = {
      left: clamp(localPoint.x, 0, imageRect.width),
      top: clamp(localPoint.y, 0, imageRect.height),
      width: MIN_CROP_SIZE,
      height: MIN_CROP_SIZE
    };
  }

  dragState = {
    handle: handle || 'move',
    startX: localPoint.x,
    startY: localPoint.y,
    startRect: { ...cropRect }
  };

  imageWrap.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event) {
  if (!dragState) {
    return;
  }

  const imageRect = getRenderedImageRect();
  const point = getLocalPoint(event, imageRect);
  const dx = point.x - dragState.startX;
  const dy = point.y - dragState.startY;

  cropRect = resizeCropRect(dragState.startRect, dragState.handle, dx, dy, imageRect);
  renderCropBox();
  event.preventDefault();
}

function onPointerUp(event) {
  if (!dragState) {
    return;
  }

  dragState = null;

  if (imageWrap.hasPointerCapture(event.pointerId)) {
    imageWrap.releasePointerCapture(event.pointerId);
  }
}

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

async function applyCrop() {
  if (!cropRect) {
    return;
  }

  const image = await loadImage(currentDataURL);
  const imageRect = getRenderedImageRect();
  const scaleX = image.naturalWidth / imageRect.width;
  const scaleY = image.naturalHeight / imageRect.height;
  const sourceX = Math.round(cropRect.left * scaleX);
  const sourceY = Math.round(cropRect.top * scaleY);
  const sourceWidth = Math.round(cropRect.width * scaleX);
  const sourceHeight = Math.round(cropRect.height * scaleY);
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

  currentDataURL = canvas.toDataURL('image/png');
  await chrome.storage.session.set({
    [EDITOR_IMAGE_KEY]: {
      dataURL: currentDataURL,
      createdAt: Date.now()
    }
  });
  await loadPreview(currentDataURL);
}

async function resetImage() {
  currentDataURL = originalDataURL;
  await chrome.storage.session.set({
    [EDITOR_IMAGE_KEY]: {
      dataURL: currentDataURL,
      createdAt: Date.now()
    }
  });
  await loadPreview(currentDataURL);
}

function downloadImage() {
  const anchor = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  anchor.href = currentDataURL;
  anchor.download = `ripfullpage-${timestamp}.png`;
  anchor.click();
}

function renderCropBox() {
  const imageRect = getRenderedImageRect();

  cropBox.hidden = false;
  cropBox.style.left = `${Math.round(cropRect.left)}px`;
  cropBox.style.top = `${Math.round(cropRect.top)}px`;
  cropBox.style.width = `${Math.round(cropRect.width)}px`;
  cropBox.style.height = `${Math.round(cropRect.height)}px`;

  cropSize.textContent = `${Math.round(cropRect.width)} x ${Math.round(cropRect.height)}`;
  cropSize.style.left = '8px';
  cropSize.style.top = cropRect.top > 34 ? '-30px' : '8px';

  imageWrap.style.width = `${Math.round(imageRect.width)}px`;
  imageWrap.style.height = `${Math.round(imageRect.height)}px`;
}

function getRenderedImageRect() {
  const rect = previewImage.getBoundingClientRect();

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
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

function loadImage(dataURL) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image.'));
    image.src = dataURL;
  });
}

function setButtonsEnabled(enabled) {
  applyCropButton.disabled = !enabled;
  resetButton.disabled = !enabled;
  downloadButton.disabled = !enabled;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
