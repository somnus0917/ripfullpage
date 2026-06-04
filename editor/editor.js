// Screenshot editor. It supports crop, annotation, mosaic, undo/redo, reset, copy, share, and export.

const EDITOR_IMAGE_KEY = 'ripfullpage:lastImage';
const MIN_CROP_SIZE = 20;
const MAX_HISTORY = 30;
const WATERMARK_PADDING = 16;

const previewImage = document.getElementById('previewImage');
const editCanvas = document.getElementById('editCanvas');
const editContext = editCanvas.getContext('2d');
const imageWrap = document.getElementById('imageWrap');
const cropBox = document.getElementById('cropBox');
const cropSize = document.getElementById('cropSize');
const imageMeta = document.getElementById('imageMeta');
const applyCropButton = document.getElementById('applyCropButton');
const resetButton = document.getElementById('resetButton');
const downloadButton = document.getElementById('downloadButton');
const downloadPdfButton = document.getElementById('downloadPdfButton');
const copyButton = document.getElementById('copyButton');
const watermarkButton = document.getElementById('watermarkButton');
const shareButton = document.getElementById('shareButton');
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
const colorInput = document.getElementById('colorInput');
const sizeInput = document.getElementById('sizeInput');
const fontSizeInput = document.getElementById('fontSizeInput');
const privacyControls = document.getElementById('privacyControls');
const privacyStrengthLabel = document.getElementById('privacyStrengthLabel');
const privacyStrengthInput = document.getElementById('privacyStrengthInput');
const privacyStrengthValue = document.getElementById('privacyStrengthValue');
const formatSelect = document.getElementById('formatSelect');
const qualityInput = document.getElementById('qualityInput');
const dimensionBadge = document.getElementById('dimensionBadge');
const stickerInput = document.getElementById('stickerInput');
const watermarkPanel = document.getElementById('watermarkPanel');
const watermarkTextInput = document.getElementById('watermarkTextInput');
const watermarkFontSizeInput = document.getElementById('watermarkFontSizeInput');
const watermarkOpacityInput = document.getElementById('watermarkOpacityInput');
const applyWatermarkButton = document.getElementById('applyWatermarkButton');
const cancelWatermarkButton = document.getElementById('cancelWatermarkButton');
const watermarkPositionButtons = Array.from(document.querySelectorAll('[data-watermark-position]'));
const watermarkColorButtons = Array.from(document.querySelectorAll('[data-watermark-color]'));
const toolButtons = Array.from(document.querySelectorAll('[data-tool]'));

let originalDataURL = '';
let currentDataURL = '';
let naturalWidth = 0;
let naturalHeight = 0;
let cropRect = null;
let cropDragState = null;
let editDragState = null;
let activeTool = 'crop';
let historyStack = [];
let redoStack = [];
let pendingStickerPoint = null;
let watermarkPosition = 'bottom-right';
let watermarkColor = '#ffffff';

init();

async function init() {
  const stored = await chrome.storage.session.get([
    EDITOR_IMAGE_KEY,
    'ripfullpage:sourceURL',
    'ripfullpage:sourceUrl',
    'ripfullpage:lastSourceURL'
  ]);
  const item = stored[EDITOR_IMAGE_KEY];

  if (!item || !item.dataURL) {
    imageMeta.textContent = '没有找到截图数据';
    setButtonsEnabled(false);
    return;
  }

  originalDataURL = item.dataURL;
  currentDataURL = item.dataURL;
  watermarkTextInput.value = getStoredSourceURL(stored, item);
  historyStack = [currentDataURL];

  bindEvents();
  await loadPreview(currentDataURL);
  setActiveTool(activeTool);
  updateHistoryButtons();
}

function getStoredSourceURL(stored, item) {
  return (
    item.sourceURL ||
    item.sourceUrl ||
    item.pageURL ||
    item.url ||
    stored['ripfullpage:sourceURL'] ||
    stored['ripfullpage:sourceUrl'] ||
    stored['ripfullpage:lastSourceURL'] ||
    ''
  );
}

function bindEvents() {
  window.addEventListener('resize', syncEditorLayout);
  window.addEventListener('keydown', onEditorKeyDown);
  imageWrap.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  applyCropButton.addEventListener('click', applyCrop);
  resetButton.addEventListener('click', resetImage);
  downloadButton.addEventListener('click', downloadImage);
  downloadPdfButton.addEventListener('click', downloadPdf);
  copyButton.addEventListener('click', copyImageToClipboard);
  watermarkButton.addEventListener('click', toggleWatermarkPanel);
  shareButton.addEventListener('click', shareImage);
  undoButton.addEventListener('click', undoEdit);
  redoButton.addEventListener('click', redoEdit);
  stickerInput.addEventListener('change', insertStickerFromInput);
  privacyStrengthInput.addEventListener('input', updatePrivacyControls);
  applyWatermarkButton.addEventListener('click', applyWatermark);
  cancelWatermarkButton.addEventListener('click', hideWatermarkPanel);
  watermarkPanel.addEventListener('pointerdown', (event) => event.stopPropagation());

  for (const button of toolButtons) {
    button.addEventListener('click', () => {
      setActiveTool(button.dataset.tool);
    });
  }

  for (const button of watermarkPositionButtons) {
    button.addEventListener('click', () => {
      setWatermarkPosition(button.dataset.watermarkPosition);
    });
  }

  for (const button of watermarkColorButtons) {
    button.addEventListener('click', () => {
      setWatermarkColor(button.dataset.watermarkColor);
    });
  }
}

function onEditorKeyDown(event) {
  const isCommandKey = event.ctrlKey || event.metaKey;

  if (!isCommandKey || !currentDataURL || isEditableTarget(event.target)) {
    return;
  }

  const key = event.key.toLowerCase();

  if (key === 'c') {
    event.preventDefault();
    copyImageToClipboard();
  }

  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    undoEdit();
  }

  if ((key === 'z' && event.shiftKey) || key === 'y') {
    event.preventDefault();
    redoEdit();
  }
}

function isEditableTarget(target) {
  return (
    target &&
    (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    )
  );
}

function loadPreview(dataURL) {
  return new Promise((resolve, reject) => {
    previewImage.onload = () => {
      naturalWidth = previewImage.naturalWidth;
      naturalHeight = previewImage.naturalHeight;
      imageMeta.textContent = `${naturalWidth} x ${naturalHeight}px`;
      dimensionBadge.textContent = `${naturalWidth} x ${naturalHeight}px`;
      setButtonsEnabled(true);
      syncEditorLayout();
      resetCropBox();
      resolve();
    };
    previewImage.onerror = () => reject(new Error('Could not load screenshot.'));
    previewImage.src = dataURL;
  });
}

function syncEditorLayout() {
  if (!naturalWidth || !naturalHeight) {
    return;
  }

  const rect = getRenderedImageRect();

  imageWrap.style.width = `${Math.round(rect.width)}px`;
  imageWrap.style.height = `${Math.round(rect.height)}px`;
  editCanvas.width = Math.max(1, Math.round(rect.width));
  editCanvas.height = Math.max(1, Math.round(rect.height));
  editCanvas.style.width = `${Math.round(rect.width)}px`;
  editCanvas.style.height = `${Math.round(rect.height)}px`;
  clearEditCanvas();

  if (cropRect) {
    clampCropRectToImage();
    renderCropBox();
  }
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

function setActiveTool(tool) {
  activeTool = tool;
  hideWatermarkPanel();

  for (const button of toolButtons) {
    button.classList.toggle('active', button.dataset.tool === tool);
  }

  cropBox.hidden = tool !== 'crop';
  applyCropButton.disabled = tool !== 'crop' || !currentDataURL;
  imageWrap.dataset.tool = tool;
  updatePrivacyControls();
  clearEditCanvas();
}

function updatePrivacyControls() {
  const isPrivacyTool = activeTool === 'mosaic' || activeTool === 'blur';

  privacyControls.hidden = !isPrivacyTool;
  privacyStrengthLabel.textContent = activeTool === 'blur' ? '模糊强度' : '马赛克强度';
  privacyStrengthValue.textContent = privacyStrengthInput.value;
}

function onPointerDown(event) {
  if (!currentDataURL || event.button !== 0) {
    return;
  }

  if (activeTool === 'crop') {
    startCropDrag(event);
    return;
  }

  if (activeTool === 'sticker') {
    startStickerInsert(event);
    return;
  }

  startEditDrag(event);
}

function onPointerMove(event) {
  if (cropDragState) {
    moveCropDrag(event);
    return;
  }

  if (editDragState) {
    moveEditDrag(event);
  }
}

function onPointerUp(event) {
  if (cropDragState) {
    endCropDrag(event);
    return;
  }

  if (editDragState) {
    endEditDrag(event);
  }
}

function startCropDrag(event) {
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

  cropDragState = {
    handle: handle || 'move',
    startX: localPoint.x,
    startY: localPoint.y,
    startRect: { ...cropRect }
  };

  imageWrap.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function moveCropDrag(event) {
  const imageRect = getRenderedImageRect();
  const point = getLocalPoint(event, imageRect);
  const dx = point.x - cropDragState.startX;
  const dy = point.y - cropDragState.startY;

  cropRect = resizeCropRect(cropDragState.startRect, cropDragState.handle, dx, dy, imageRect);
  renderCropBox();
  event.preventDefault();
}

function endCropDrag(event) {
  cropDragState = null;

  if (imageWrap.hasPointerCapture(event.pointerId)) {
    imageWrap.releasePointerCapture(event.pointerId);
  }
}

function startEditDrag(event) {
  const imageRect = getRenderedImageRect();
  const point = getLocalPoint(event, imageRect);

  editDragState = {
    tool: activeTool,
    start: point,
    point,
    points: [point]
  };

  cropBox.hidden = true;
  imageWrap.setPointerCapture(event.pointerId);

  if (activeTool === 'text') {
    endEditDrag(event);
    return;
  }

  drawEditPreview();
  event.preventDefault();
}

function moveEditDrag(event) {
  const imageRect = getRenderedImageRect();
  const point = getLocalPoint(event, imageRect);

  editDragState.point = point;

  if (editDragState.tool === 'pen' || editDragState.tool === 'marker') {
    editDragState.points.push(point);
  }

  drawEditPreview();
  event.preventDefault();
}

async function endEditDrag(event) {
  const state = editDragState;

  editDragState = null;

  if (imageWrap.hasPointerCapture(event.pointerId)) {
    imageWrap.releasePointerCapture(event.pointerId);
  }

  if (!state) {
    return;
  }

  if (state.tool === 'text') {
    const text = window.prompt('输入文字');

    if (!text) {
      clearEditCanvas();
      return;
    }

    state.text = text;
  }

  await commitEditState(state);
}

function startStickerInsert(event) {
  const imageRect = getRenderedImageRect();

  pendingStickerPoint = getLocalPoint(event, imageRect);
  stickerInput.value = '';
  stickerInput.click();
  event.preventDefault();
}

async function insertStickerFromInput() {
  const file = stickerInput.files && stickerInput.files[0];

  if (!file || !pendingStickerPoint) {
    pendingStickerPoint = null;
    return;
  }

  const dataURL = await readFileAsDataURL(file);
  const stickerImage = await loadImage(dataURL);
  const imageRect = getRenderedImageRect();
  const maxRenderedWidth = imageRect.width * 0.28;
  const renderedWidth = Math.max(24, Math.min(maxRenderedWidth, stickerImage.naturalWidth));
  const renderedHeight = renderedWidth * (stickerImage.naturalHeight / stickerImage.naturalWidth);
  const state = {
    tool: 'sticker',
    start: {
      x: pendingStickerPoint.x - renderedWidth / 2,
      y: pendingStickerPoint.y - renderedHeight / 2
    },
    point: pendingStickerPoint,
    stickerDataURL: dataURL,
    stickerRenderedWidth: renderedWidth,
    stickerRenderedHeight: renderedHeight
  };

  pendingStickerPoint = null;
  await commitEditState(state);
}

function drawEditPreview() {
  if (!editDragState) {
    return;
  }

  clearEditCanvas();

  if (editDragState.tool === 'mosaic' || editDragState.tool === 'blur') {
    drawPrivacyRectPreview(editContext, editDragState);
    return;
  }

  drawEditState(editContext, editDragState, 1);
}

async function commitEditState(state) {
  const image = await loadImage(currentDataURL);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const renderedRect = getRenderedImageRect();
  const scaleX = image.naturalWidth / renderedRect.width;
  const scaleY = image.naturalHeight / renderedRect.height;

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);

  if (state.tool === 'mosaic') {
    applyMosaic(context, state, scaleX, scaleY);
  } else if (state.tool === 'blur') {
    applyBlur(context, state, scaleX, scaleY);
  } else if (state.tool === 'sticker') {
    await drawStickerState(context, state, scaleX, scaleY);
  } else {
    drawEditState(context, state, scaleX, scaleY);
  }

  currentDataURL = canvas.toDataURL('image/png');
  pushHistory(currentDataURL);
  await persistCurrentImage();
  await loadPreview(currentDataURL);
  setActiveTool(activeTool);
}

function drawEditState(context, state, scaleX, scaleY = scaleX) {
  const color = colorInput.value;
  const size = Number(sizeInput.value);
  const start = scalePoint(state.start, scaleX, scaleY);
  const end = scalePoint(state.point, scaleX, scaleY);

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (state.tool === 'pen' || state.tool === 'marker') {
    context.globalAlpha = state.tool === 'marker' ? 0.34 : 1;
    context.globalCompositeOperation = state.tool === 'marker' ? 'multiply' : 'source-over';
    context.strokeStyle = color;
    context.lineWidth = size * scaleX;
    context.beginPath();

    state.points.forEach((point, index) => {
      const scaled = scalePoint(point, scaleX, scaleY);

      if (index === 0) {
        context.moveTo(scaled.x, scaled.y);
      } else {
        context.lineTo(scaled.x, scaled.y);
      }
    });

    context.stroke();
  }

  if (state.tool === 'rect') {
    const rect = makeRect(start.x, start.y, end.x, end.y);

    context.strokeStyle = color;
    context.lineWidth = size * scaleX;
    context.strokeRect(rect.left, rect.top, rect.width, rect.height);
  }

  if (state.tool === 'ellipse') {
    const rect = makeRect(start.x, start.y, end.x, end.y);

    context.strokeStyle = color;
    context.lineWidth = size * scaleX;
    context.beginPath();
    context.ellipse(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      Math.max(1, rect.width / 2),
      Math.max(1, rect.height / 2),
      0,
      0,
      Math.PI * 2
    );
    context.stroke();
  }

  if (state.tool === 'arrow') {
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = size * scaleX;
    drawArrow(context, start, end, Math.max(12, size * 4 * scaleX));
  }

  if (state.tool === 'text') {
    const fontSize = Number(fontSizeInput.value);

    context.fillStyle = color;
    context.font = `600 ${fontSize * scaleX}px ui-sans-serif, system-ui, sans-serif`;
    context.textBaseline = 'top';
    context.fillText(state.text, start.x, start.y);
  }

  context.restore();
}

async function drawStickerState(context, state, scaleX, scaleY) {
  const sticker = await loadImage(state.stickerDataURL);
  const x = state.start.x * scaleX;
  const y = state.start.y * scaleY;
  const width = state.stickerRenderedWidth * scaleX;
  const height = state.stickerRenderedHeight * scaleY;

  context.drawImage(sticker, x, y, width, height);
}

function applyMosaic(context, state, scaleX, scaleY) {
  const start = scalePoint(state.start, scaleX, scaleY);
  const end = scalePoint(state.point, scaleX, scaleY);
  const rect = makeRect(start.x, start.y, end.x, end.y);
  const blockSize = getMosaicBlockSize();

  for (let y = rect.top; y < rect.top + rect.height; y += blockSize) {
    for (let x = rect.left; x < rect.left + rect.width; x += blockSize) {
      const width = Math.min(blockSize, rect.left + rect.width - x);
      const height = Math.min(blockSize, rect.top + rect.height - y);
      const sampleX = Math.max(0, Math.floor(x));
      const sampleY = Math.max(0, Math.floor(y));
      const sample = context.getImageData(sampleX, sampleY, 1, 1).data;

      context.fillStyle = `rgb(${sample[0]}, ${sample[1]}, ${sample[2]})`;
      context.fillRect(Math.floor(x), Math.floor(y), Math.ceil(width), Math.ceil(height));
    }
  }
}

function applyBlur(context, state, scaleX, scaleY) {
  const start = scalePoint(state.start, scaleX, scaleY);
  const end = scalePoint(state.point, scaleX, scaleY);
  const rect = clampRectToCanvas(makeRect(start.x, start.y, end.x, end.y), context.canvas);
  const sourceWidth = Math.round(rect.width);
  const sourceHeight = Math.round(rect.height);
  const blurOptions = getBlurOptions();

  if (sourceWidth < 2 || sourceHeight < 2) {
    return;
  }

  const sourceCanvas = document.createElement('canvas');
  const sourceContext = sourceCanvas.getContext('2d');
  const smallCanvas = document.createElement('canvas');
  const smallContext = smallCanvas.getContext('2d');
  const smallWidth = Math.max(1, Math.round(sourceWidth / blurOptions.downscale));
  const smallHeight = Math.max(1, Math.round(sourceHeight / blurOptions.downscale));

  sourceCanvas.width = sourceWidth;
  sourceCanvas.height = sourceHeight;
  smallCanvas.width = smallWidth;
  smallCanvas.height = smallHeight;

  sourceContext.drawImage(
    context.canvas,
    Math.round(rect.left),
    Math.round(rect.top),
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );

  // 根据强度反复缩小再放大选区，模拟可调的高斯模糊。
  for (let index = 0; index < blurOptions.iterations; index += 1) {
    smallContext.clearRect(0, 0, smallWidth, smallHeight);
    smallContext.imageSmoothingEnabled = true;
    smallContext.imageSmoothingQuality = 'high';
    smallContext.drawImage(sourceCanvas, 0, 0, smallWidth, smallHeight);

    sourceContext.clearRect(0, 0, sourceWidth, sourceHeight);
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = 'high';
    sourceContext.drawImage(smallCanvas, 0, 0, sourceWidth, sourceHeight);
  }

  context.drawImage(sourceCanvas, Math.round(rect.left), Math.round(rect.top));
}

function getPrivacyStrength() {
  return clamp(Number(privacyStrengthInput.value) || 5, 1, 10);
}

function getMosaicBlockSize() {
  return Math.max(6, Math.round(getPrivacyStrength() * 4));
}

function getBlurOptions() {
  const strength = getPrivacyStrength();

  return {
    downscale: Math.round(4 + strength),
    iterations: strength >= 8 ? 4 : strength >= 4 ? 3 : 2
  };
}

function drawPrivacyRectPreview(context, state) {
  const rect = makeRect(state.start.x, state.start.y, state.point.x, state.point.y);

  context.save();
  context.fillStyle = 'rgba(96, 165, 250, 0.14)';
  context.strokeStyle = '#60a5fa';
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
  context.strokeRect(rect.left, rect.top, rect.width, rect.height);
  context.setLineDash([]);
  context.restore();
}

function drawArrow(context, start, end, headSize) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);

  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();

  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - headSize * Math.cos(angle - Math.PI / 6),
    end.y - headSize * Math.sin(angle - Math.PI / 6)
  );
  context.lineTo(
    end.x - headSize * Math.cos(angle + Math.PI / 6),
    end.y - headSize * Math.sin(angle + Math.PI / 6)
  );
  context.closePath();
  context.fill();
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
  if (!cropRect || activeTool !== 'crop') {
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
  pushHistory(currentDataURL);
  await persistCurrentImage();
  await loadPreview(currentDataURL);
}

async function resetImage() {
  currentDataURL = originalDataURL;
  historyStack = [currentDataURL];
  redoStack = [];
  await persistCurrentImage();
  await loadPreview(currentDataURL);
  updateHistoryButtons();
}

async function undoEdit() {
  if (historyStack.length <= 1) {
    return;
  }

  redoStack.push(historyStack.pop());
  currentDataURL = historyStack[historyStack.length - 1];
  await persistCurrentImage();
  await loadPreview(currentDataURL);
  updateHistoryButtons();
}

async function redoEdit() {
  if (!redoStack.length) {
    return;
  }

  currentDataURL = redoStack.pop();
  historyStack.push(currentDataURL);
  await persistCurrentImage();
  await loadPreview(currentDataURL);
  updateHistoryButtons();
}

function toggleWatermarkPanel(event) {
  event.preventDefault();
  event.stopPropagation();

  if (watermarkPanel.hidden) {
    showWatermarkPanel();
  } else {
    hideWatermarkPanel();
  }
}

function showWatermarkPanel() {
  watermarkPanel.hidden = false;
  watermarkTextInput.focus();
  window.addEventListener('pointerdown', onWatermarkOutsidePointerDown);
}

function hideWatermarkPanel() {
  if (watermarkPanel.hidden) {
    return;
  }

  watermarkPanel.hidden = true;
  window.removeEventListener('pointerdown', onWatermarkOutsidePointerDown);
}

function onWatermarkOutsidePointerDown(event) {
  if (watermarkPanel.contains(event.target) || watermarkButton.contains(event.target)) {
    return;
  }

  hideWatermarkPanel();
}

function setWatermarkPosition(position) {
  watermarkPosition = position || 'bottom-right';

  for (const button of watermarkPositionButtons) {
    button.classList.toggle('active', button.dataset.watermarkPosition === watermarkPosition);
  }
}

function setWatermarkColor(color) {
  watermarkColor = color || '#ffffff';

  for (const button of watermarkColorButtons) {
    button.classList.toggle('active', button.dataset.watermarkColor === watermarkColor);
  }
}

async function applyWatermark() {
  const text = watermarkTextInput.value.trim();

  if (!text) {
    hideWatermarkPanel();
    return;
  }

  const image = await loadImage(currentDataURL);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);

  // 水印直接绘制进主图，确保导出、复制、撤销/重做都走同一份图片状态。
  drawWatermark(context, {
    text,
    position: watermarkPosition,
    color: watermarkColor,
    fontSize: Number(watermarkFontSizeInput.value),
    opacity: Number(watermarkOpacityInput.value) / 100
  });

  currentDataURL = canvas.toDataURL('image/png');
  pushHistory(currentDataURL);
  await persistCurrentImage();
  await loadPreview(currentDataURL);
  hideWatermarkPanel();
}

function drawWatermark(context, options) {
  const padding = WATERMARK_PADDING;
  const fontSize = clamp(options.fontSize || 16, 12, 36);
  const opacity = clamp(options.opacity || 0.4, 0.1, 1);
  const canvas = context.canvas;
  const labelPaddingX = Math.max(10, Math.round(fontSize * 0.55));
  const labelPaddingY = Math.max(6, Math.round(fontSize * 0.32));
  const maxTextWidth = Math.max(1, canvas.width - padding * 2 - labelPaddingX * 2);

  context.save();
  context.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  context.textBaseline = 'top';

  const metrics = context.measureText(options.text);
  const textWidth = Math.min(metrics.width, maxTextWidth);
  const textHeight = fontSize * 1.25;
  const labelWidth = textWidth + labelPaddingX * 2;
  const labelHeight = textHeight + labelPaddingY * 2;
  const position = getWatermarkPoint(
    options.position,
    canvas.width,
    canvas.height,
    labelWidth,
    labelHeight,
    padding
  );
  const textX = position.x + labelPaddingX;
  const textY = position.y + labelPaddingY;

  // 半透明底托 + 文字描边 + 阴影，让水印在浅色和深色截图上都更清楚。
  drawRoundedRect(context, position.x, position.y, labelWidth, labelHeight, Math.max(8, fontSize * 0.35));
  context.fillStyle = getWatermarkBackdropColor(options.color, opacity);
  context.fill();

  context.shadowBlur = 4;
  context.shadowColor = getWatermarkShadowColor(options.color);
  context.lineWidth = Math.max(2, fontSize / 9);
  context.strokeStyle = getWatermarkStrokeColor(options.color, opacity);
  context.strokeText(options.text, textX, textY, maxTextWidth);
  context.fillStyle = hexToRgba(options.color, opacity);
  context.fillText(options.text, textX, textY, maxTextWidth);
  context.restore();
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function getWatermarkPoint(position, canvasWidth, canvasHeight, textWidth, textHeight, padding) {
  const points = {
    'top-left': {
      x: padding,
      y: padding
    },
    'top-right': {
      x: canvasWidth - textWidth - padding,
      y: padding
    },
    'bottom-left': {
      x: padding,
      y: canvasHeight - textHeight - padding
    },
    'bottom-right': {
      x: canvasWidth - textWidth - padding,
      y: canvasHeight - textHeight - padding
    },
    center: {
      x: (canvasWidth - textWidth) / 2,
      y: (canvasHeight - textHeight) / 2
    }
  };
  const point = points[position] || points['bottom-right'];

  return {
    x: clamp(point.x, padding, Math.max(padding, canvasWidth - textWidth - padding)),
    y: clamp(point.y, padding, Math.max(padding, canvasHeight - textHeight - padding))
  };
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getWatermarkShadowColor(color) {
  return color.toLowerCase() === '#000000'
    ? 'rgba(255, 255, 255, 0.55)'
    : 'rgba(0, 0, 0, 0.62)';
}

function getWatermarkStrokeColor(color, opacity) {
  return color.toLowerCase() === '#000000'
    ? `rgba(255, 255, 255, ${Math.min(0.75, opacity + 0.1)})`
    : `rgba(0, 0, 0, ${Math.min(0.82, opacity + 0.1)})`;
}

function getWatermarkBackdropColor(color, opacity) {
  return color.toLowerCase() === '#000000'
    ? `rgba(255, 255, 255, ${Math.min(0.38, opacity * 0.36)})`
    : `rgba(2, 6, 23, ${Math.min(0.46, opacity * 0.42)})`;
}

async function downloadImage() {
  const anchor = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = await createOutputBlob(formatSelect.value);
  const url = URL.createObjectURL(blob);

  anchor.href = url;
  anchor.download = `ripfullpage-${timestamp}.${getFileExtension(formatSelect.value)}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyImageToClipboard() {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    window.alert('当前浏览器不支持图片剪贴板。');
    return;
  }

  const originalText = copyButton.textContent;

  try {
    copyButton.disabled = true;
    copyButton.textContent = '复制中...';
    const blob = await createOutputBlob('image/png');

    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ]);
    copyButton.textContent = '已复制';
    window.setTimeout(() => {
      copyButton.textContent = originalText;
      copyButton.disabled = false;
    }, 1200);
  } catch (error) {
    console.error('[ripfullpage] Copy failed:', error);
    copyButton.textContent = originalText;
    copyButton.disabled = false;
    window.alert('复制失败，请确认浏览器允许剪贴板访问。');
  }
}

async function shareImage() {
  const originalText = shareButton.textContent;

  try {
    const type = formatSelect.value;
    const blob = await createOutputBlob(type);
    const file = new File(
      [blob],
      `ripfullpage-${new Date().toISOString().replace(/[:.]/g, '-')}.${getFileExtension(type)}`,
      { type: blob.type }
    );

    if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
      await copyImageToClipboard();
      return;
    }

    shareButton.disabled = true;
    shareButton.textContent = '分享中...';
    await navigator.share({
      title: 'ripfullpage screenshot',
      files: [file]
    });
  } catch (error) {
    if (error && error.name !== 'AbortError') {
      console.error('[ripfullpage] Share failed:', error);
      window.alert('分享失败，已保留复制/下载方式。');
    }
  } finally {
    shareButton.textContent = originalText;
    shareButton.disabled = false;
  }
}

async function createOutputBlob(type) {
  const image = await loadImage(currentDataURL);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const normalizedType = normalizeImageType(type);
  const quality = Number(qualityInput.value) / 100;

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  if (normalizedType === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(image, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not export image.'));
        }
      },
      normalizedType,
      normalizedType === 'image/png' ? undefined : quality
    );
  });
}

function normalizeImageType(type) {
  if (type === 'image/jpeg' || type === 'image/webp') {
    return type;
  }

  return 'image/png';
}

function getFileExtension(type) {
  const normalizedType = normalizeImageType(type);

  if (normalizedType === 'image/jpeg') {
    return 'jpg';
  }

  if (normalizedType === 'image/webp') {
    return 'webp';
  }

  return 'png';
}

async function downloadPdf() {
  const originalText = downloadPdfButton.textContent;

  try {
    downloadPdfButton.disabled = true;
    downloadPdfButton.textContent = '正在导出...';

    const image = await loadImage(currentDataURL);
    const pages = await createPdfImagePages(image);
    const pdfBytes = buildPdfDocument(pages);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    anchor.href = url;
    anchor.download = `ripfullpage-${timestamp}.pdf`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error('[ripfullpage] PDF export failed:', error);
    window.alert('导出 PDF 失败，图片可能过大。请尝试先裁剪后再导出。');
  } finally {
    downloadPdfButton.textContent = originalText;
    downloadPdfButton.disabled = false;
  }
}

async function createPdfImagePages(image) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 24;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const scale = contentWidth / image.naturalWidth;
  const sliceHeight = Math.max(1, Math.floor(contentHeight / scale));
  const pages = [];
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = image.naturalWidth;

  for (let y = 0; y < image.naturalHeight; y += sliceHeight) {
    const currentSliceHeight = Math.min(sliceHeight, image.naturalHeight - y);
    const drawHeight = currentSliceHeight * scale;
    const imageY = pageHeight - margin - drawHeight;
    const jpegDataURL = drawImageSliceToJpeg(
      canvas,
      context,
      image,
      y,
      currentSliceHeight,
    );

    pages.push({
      jpegBytes: dataURLToBytes(jpegDataURL),
      pixelWidth: image.naturalWidth,
      pixelHeight: currentSliceHeight,
      pageWidth,
      pageHeight,
      drawX: margin,
      drawY: imageY,
      drawWidth: contentWidth,
      drawHeight,
    });

    await waitForFrame();
  }

  return pages;
}

function drawImageSliceToJpeg(canvas, context, image, sourceY, sourceHeight) {
  canvas.height = sourceHeight;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    0,
    sourceY,
    image.naturalWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas.toDataURL('image/jpeg', 0.92);
}

function buildPdfDocument(pages) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let byteLength = 0;

  const appendBytes = (bytes) => {
    chunks.push(bytes);
    byteLength += bytes.length;
  };
  const appendText = (text) => {
    appendBytes(encoder.encode(text));
  };
  const addObject = (objectNumber, parts) => {
    offsets[objectNumber] = byteLength;
    appendText(`${objectNumber} 0 obj\n`);

    for (const part of parts) {
      if (typeof part === 'string') {
        appendText(part);
      } else {
        appendBytes(part);
      }
    }

    appendText('\nendobj\n');
  };

  appendText('%PDF-1.4\n');

  const totalObjects = 2 + pages.length * 3;
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 3);
  const kids = pageObjectNumbers.map((number) => `${number} 0 R`).join(' ');

  addObject(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  addObject(2, [`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`]);

  pages.forEach((page, index) => {
    const pageObjectNumber = 3 + index * 3;
    const contentObjectNumber = pageObjectNumber + 1;
    const imageObjectNumber = pageObjectNumber + 2;
    const imageName = `Im${index + 1}`;
    const content = [
      'q',
      `${formatPdfNumber(page.drawWidth)} 0 0 ${formatPdfNumber(page.drawHeight)} ${formatPdfNumber(page.drawX)} ${formatPdfNumber(page.drawY)} cm`,
      `/${imageName} Do`,
      'Q',
    ].join('\n');
    const contentLength = encoder.encode(content).length;

    addObject(pageObjectNumber, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatPdfNumber(page.pageWidth)} ${formatPdfNumber(page.pageHeight)}] `,
      `/Resources << /XObject << /${imageName} ${imageObjectNumber} 0 R >> >> `,
      `/Contents ${contentObjectNumber} 0 R >>`,
    ]);
    addObject(contentObjectNumber, [
      `<< /Length ${contentLength} >>\nstream\n`,
      content,
      '\nendstream',
    ]);
    addObject(imageObjectNumber, [
      `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} `,
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.length} >>\nstream\n`,
      page.jpegBytes,
      '\nendstream',
    ]);
  });

  const xrefOffset = byteLength;

  appendText(`xref\n0 ${totalObjects + 1}\n`);
  appendText('0000000000 65535 f \n');

  for (let objectNumber = 1; objectNumber <= totalObjects; objectNumber += 1) {
    appendText(`${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`);
  }

  appendText(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  return concatUint8Arrays(chunks, byteLength);
}

function dataURLToBytes(dataURL) {
  const base64 = dataURL.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function concatUint8Arrays(chunks, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function formatPdfNumber(value) {
  return Number(value.toFixed(3)).toString();
}

function waitForFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

function renderCropBox() {
  if (!cropRect) {
    return;
  }

  cropBox.hidden = activeTool !== 'crop';
  cropBox.style.left = `${Math.round(cropRect.left)}px`;
  cropBox.style.top = `${Math.round(cropRect.top)}px`;
  cropBox.style.width = `${Math.round(cropRect.width)}px`;
  cropBox.style.height = `${Math.round(cropRect.height)}px`;

  cropSize.textContent = `${Math.round(cropRect.width)} x ${Math.round(cropRect.height)}`;
  cropSize.style.left = '8px';
  cropSize.style.top = cropRect.top > 34 ? '-30px' : '8px';
}

function clampCropRectToImage() {
  const rect = getRenderedImageRect();

  cropRect.left = clamp(cropRect.left, 0, rect.width - MIN_CROP_SIZE);
  cropRect.top = clamp(cropRect.top, 0, rect.height - MIN_CROP_SIZE);
  cropRect.width = clamp(cropRect.width, MIN_CROP_SIZE, rect.width - cropRect.left);
  cropRect.height = clamp(cropRect.height, MIN_CROP_SIZE, rect.height - cropRect.top);
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

function clearEditCanvas() {
  editContext.clearRect(0, 0, editCanvas.width, editCanvas.height);
}

function pushHistory(dataURL) {
  historyStack.push(dataURL);

  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
  }

  redoStack = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  undoButton.disabled = historyStack.length <= 1;
  redoButton.disabled = redoStack.length === 0;
}

async function persistCurrentImage() {
  await chrome.storage.session.set({
    [EDITOR_IMAGE_KEY]: {
      dataURL: currentDataURL,
      createdAt: Date.now()
    }
  });
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
  applyCropButton.disabled = !enabled || activeTool !== 'crop';
  resetButton.disabled = !enabled;
  downloadButton.disabled = !enabled;
  downloadPdfButton.disabled = !enabled;
  copyButton.disabled = !enabled;
  watermarkButton.disabled = !enabled;
  shareButton.disabled = !enabled;
  undoButton.disabled = !enabled || historyStack.length <= 1;
  redoButton.disabled = !enabled || redoStack.length === 0;
  for (const button of toolButtons) {
    button.disabled = !enabled;
  }
  colorInput.disabled = !enabled;
  sizeInput.disabled = !enabled;
  fontSizeInput.disabled = !enabled;
  formatSelect.disabled = !enabled;
  qualityInput.disabled = !enabled;
  watermarkTextInput.disabled = !enabled;
  watermarkFontSizeInput.disabled = !enabled;
  watermarkOpacityInput.disabled = !enabled;
  applyWatermarkButton.disabled = !enabled;
  cancelWatermarkButton.disabled = !enabled;
  for (const button of watermarkPositionButtons) {
    button.disabled = !enabled;
  }
  for (const button of watermarkColorButtons) {
    button.disabled = !enabled;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
