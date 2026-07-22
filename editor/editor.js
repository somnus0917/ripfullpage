// Screenshot editor entry point. It coordinates UI state and feature modules.

const {
  EDITOR_IMAGE_KEY,
  LANGUAGE_KEY,
  LAST_SOURCE_URL_KEY,
} = window.ripfullpageConstants;
const MIN_CROP_SIZE = 20;
const MAX_HISTORY = 30;
const WATERMARK_PADDING = 16;
const DEFAULT_LANGUAGE = 'zh_CN';
const TRANSLATIONS = {
  zh_CN: {
    languageLabel: '语言',
    fileActions: '文件操作',
    undo: '撤销',
    redo: '重做',
    applyCrop: '确认裁剪',
    reset: '重置',
    copy: '复制',
    watermark: '水印',
    share: '分享',
    format: '格式',
    quality: '质量',
    downloadImage: '下载图片',
    exportPdf: '导出 PDF',
    editTools: '编辑工具',
    toolCrop: '裁剪',
    toolPen: '画笔',
    toolMarker: '高亮',
    toolRect: '矩形',
    toolEllipse: '椭圆',
    toolArrow: '箭头',
    toolText: '文字',
    toolMosaic: '马赛克',
    toolBlur: '模糊',
    toolSticker: '贴图',
    privacyStrength: '打码强度',
    blurStrength: '模糊强度',
    mosaicStrength: '马赛克强度',
    color: '颜色',
    strokeSize: '粗细',
    fontSize: '字号',
    screenshotPreview: '截图预览',
    editLayer: '编辑图层',
    watermarkText: '水印文字',
    watermarkPlaceholder: '输入水印文字',
    position: '位置',
    watermarkPosition: '水印位置',
    topLeft: '左上',
    topRight: '右上',
    bottomRight: '右下',
    bottomLeft: '左下',
    center: '居中',
    opacity: '透明度',
    watermarkColor: '水印颜色',
    white: '白色',
    black: '黑色',
    gray: '灰色',
    red: '红色',
    applyWatermark: '应用水印',
    cancel: '取消',
    loadingScreenshot: '正在载入截图...',
    loadScreenshotFailed: '载入截图失败',
    noScreenshotData: '没有找到截图数据',
    textPrompt: '输入文字',
    clipboardUnsupported: '当前浏览器不支持图片剪贴板。',
    copying: '复制中...',
    copied: '已复制',
    copyFailed: '复制失败，请确认浏览器允许剪贴板访问。',
    sharing: '分享中...',
    shareFailed: '分享失败，已保留复制/下载方式。',
    exporting: '正在导出...',
    pdfFailed: '导出 PDF 失败，图片可能过大。请尝试先裁剪后再导出。'
  },
  en: {
    languageLabel: 'Language',
    fileActions: 'File actions',
    undo: 'Undo',
    redo: 'Redo',
    applyCrop: 'Apply crop',
    reset: 'Reset',
    copy: 'Copy',
    watermark: 'Watermark',
    share: 'Share',
    format: 'Format',
    quality: 'Quality',
    downloadImage: 'Download image',
    exportPdf: 'Export PDF',
    editTools: 'Editing tools',
    toolCrop: 'Crop',
    toolPen: 'Pen',
    toolMarker: 'Highlight',
    toolRect: 'Rectangle',
    toolEllipse: 'Ellipse',
    toolArrow: 'Arrow',
    toolText: 'Text',
    toolMosaic: 'Mosaic',
    toolBlur: 'Blur',
    toolSticker: 'Sticker',
    privacyStrength: 'Privacy strength',
    blurStrength: 'Blur strength',
    mosaicStrength: 'Mosaic strength',
    color: 'Color',
    strokeSize: 'Stroke',
    fontSize: 'Font size',
    screenshotPreview: 'Screenshot preview',
    editLayer: 'Edit layer',
    watermarkText: 'Watermark text',
    watermarkPlaceholder: 'Enter watermark text',
    position: 'Position',
    watermarkPosition: 'Watermark position',
    topLeft: 'Top left',
    topRight: 'Top right',
    bottomRight: 'Bottom right',
    bottomLeft: 'Bottom left',
    center: 'Center',
    opacity: 'Opacity',
    watermarkColor: 'Watermark color',
    white: 'White',
    black: 'Black',
    gray: 'Gray',
    red: 'Red',
    applyWatermark: 'Apply watermark',
    cancel: 'Cancel',
    loadingScreenshot: 'Loading screenshot...',
    loadScreenshotFailed: 'Could not load screenshot',
    noScreenshotData: 'No screenshot data found',
    textPrompt: 'Enter text',
    clipboardUnsupported: 'This browser does not support image clipboard access.',
    copying: 'Copying...',
    copied: 'Copied',
    copyFailed: 'Copy failed. Please allow clipboard access in your browser.',
    sharing: 'Sharing...',
    shareFailed: 'Share failed. Copy and download are still available.',
    exporting: 'Exporting...',
    pdfFailed: 'PDF export failed. The image may be too large. Try cropping it first.'
  }
};

const editorGeometry = window.ripfullpageEditorGeometry;
const editorDrawing = window.ripfullpageEditorDrawing;
const editorWatermark = window.ripfullpageEditorWatermark;
const editorExport = window.ripfullpageEditorExport;

if (!editorGeometry || !editorDrawing || !editorWatermark || !editorExport) {
  throw new Error("ripfullpage editor modules are not loaded.");
}

const {
  getLocalPoint,
  makeRect,
  pointInRect,
  resizeCropRect,
  scalePoint,
} = editorGeometry;
const {
  applyBlur,
  applyMosaic,
  applyWasmCrop,
  drawEditState,
  drawPrivacyRectPreview,
  drawStickerState,
} = editorDrawing;
const { drawWatermark } = editorWatermark;
const {
  createOutputBlob,
  createPdfBlob,
  createScreenshotFilename,
  writeImageToClipboard,
} = editorExport;

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
const languageButtons = Array.from(document.querySelectorAll('[data-language-option]'));

let originalDataURL = '';
let currentDataURL = '';
let sourceURL = '';
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
let appliedWatermarkState = null;
let currentLanguage = DEFAULT_LANGUAGE;

init().catch(handleInitializationError);

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    setLanguage(button.dataset.languageOption);
  });
}

async function init() {
  await loadLanguage();
  applyI18n();
  imageMeta.textContent = t('loadingScreenshot');

  const stored = await chrome.storage.session.get([
    EDITOR_IMAGE_KEY,
    'ripfullpage:sourceURL',
    'ripfullpage:sourceUrl',
    LAST_SOURCE_URL_KEY
  ]);
  const item = stored[EDITOR_IMAGE_KEY];

  if (!item || !item.dataURL) {
    imageMeta.textContent = t('noScreenshotData');
    setButtonsEnabled(false);
    window.ripfullpageEditorBootstrap?.markReady();
    return;
  }

  originalDataURL = item.dataURL;
  currentDataURL = item.dataURL;
  sourceURL = getStoredSourceURL(stored, item);
  watermarkTextInput.value = sourceURL;
  historyStack = [currentDataURL];

  await loadPreview(currentDataURL);
  bindEvents();
  setActiveTool(activeTool);
  updateHistoryButtons();
  window.ripfullpageEditorBootstrap?.markReady();
}

function handleInitializationError(error) {
  const detail = error && error.message ? error.message : String(error);
  const message = t('loadScreenshotFailed') + '：' + detail;

  console.error('[ripfullpage] Editor initialization failed:', error);
  setButtonsEnabled(false);
  window.ripfullpageEditorBootstrap?.fail(error, message);
}

async function loadLanguage() {
  const stored = await chrome.storage.local.get(LANGUAGE_KEY);
  currentLanguage = normalizeLanguage(stored[LANGUAGE_KEY]);
}

async function setLanguage(language) {
  currentLanguage = normalizeLanguage(language);
  await chrome.storage.local.set({ [LANGUAGE_KEY]: currentLanguage });
  applyI18n();
  updatePrivacyControls();
}

function normalizeLanguage(language) {
  return Object.prototype.hasOwnProperty.call(TRANSLATIONS, language)
    ? language
    : DEFAULT_LANGUAGE;
}

function t(key) {
  return (
    TRANSLATIONS[currentLanguage] &&
    TRANSLATIONS[currentLanguage][key]
  ) || TRANSLATIONS[DEFAULT_LANGUAGE][key] || key;
}

function applyI18n() {
  document.documentElement.lang = currentLanguage === 'en' ? 'en' : 'zh-CN';

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }

  for (const element of document.querySelectorAll('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle);
  }

  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }

  for (const element of document.querySelectorAll('[data-i18n-alt]')) {
    element.alt = t(element.dataset.i18nAlt);
  }

  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  }

  for (const button of languageButtons) {
    const isActive = button.dataset.languageOption === currentLanguage;

    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
}

function getStoredSourceURL(stored, item) {
  return (
    item.sourceURL ||
    item.sourceUrl ||
    item.pageURL ||
    item.url ||
    stored['ripfullpage:sourceURL'] ||
    stored['ripfullpage:sourceUrl'] ||
    stored[LAST_SOURCE_URL_KEY] ||
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
  privacyStrengthLabel.textContent = activeTool === 'blur' ? t('blurStrength') : t('mosaicStrength');
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
    const text = window.prompt(t('textPrompt'));

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
    await applyMosaic(context, state, scaleX, scaleY);
  } else if (state.tool === 'blur') {
    await applyBlur(context, state, scaleX, scaleY);
  } else if (state.tool === 'sticker') {
    await drawStickerState(context, state, scaleX, scaleY);
  } else {
    drawEditState(context, state, scaleX, scaleY);
  }

  currentDataURL = canvas.toDataURL('image/png');
  clearEditableWatermarkState();
  pushHistory(currentDataURL);
  await persistCurrentImage();
  await loadPreview(currentDataURL);
  setActiveTool(activeTool);
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
  const sourceCanvas = document.createElement('canvas');
  const sourceContext = sourceCanvas.getContext('2d');
  const targetCanvas = document.createElement('canvas');
  const targetContext = targetCanvas.getContext('2d');

  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  sourceContext.drawImage(image, 0, 0);

  targetCanvas.width = Math.max(1, sourceWidth);
  targetCanvas.height = Math.max(1, sourceHeight);

  if (await applyWasmCrop(sourceContext, targetContext, {
    left: sourceX,
    top: sourceY,
    width: targetCanvas.width,
    height: targetCanvas.height
  })) {
    currentDataURL = targetCanvas.toDataURL('image/png');
  } else {
    targetContext.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      targetCanvas.width,
      targetCanvas.height
    );
    currentDataURL = targetCanvas.toDataURL('image/png');
  }

  clearEditableWatermarkState();
  pushHistory(currentDataURL);
  await persistCurrentImage();
  await loadPreview(currentDataURL);
}

async function resetImage() {
  currentDataURL = originalDataURL;
  historyStack = [currentDataURL];
  redoStack = [];
  clearEditableWatermarkState();
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

  const canReplaceWatermark = canReplaceEditableWatermark();
  const baseDataURL = canReplaceWatermark
    ? appliedWatermarkState.baseDataURL
    : currentDataURL;
  const image = await loadImage(baseDataURL);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const options = {
    text,
    position: watermarkPosition,
    color: watermarkColor,
    fontSize: Number(watermarkFontSizeInput.value),
    opacity: Number(watermarkOpacityInput.value) / 100
  };

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);

  // 最近一次水印保留底图，重复应用时替换水印而不是继续叠加。
  drawWatermark(context, options);

  currentDataURL = canvas.toDataURL('image/png');
  appliedWatermarkState = {
    baseDataURL,
    resultDataURL: currentDataURL,
    options
  };
  pushHistory(currentDataURL, { replaceCurrent: canReplaceWatermark });
  await persistCurrentImage();
  await loadPreview(currentDataURL);
  hideWatermarkPanel();
}

function canReplaceEditableWatermark() {
  return (
    appliedWatermarkState &&
    appliedWatermarkState.resultDataURL === currentDataURL &&
    historyStack[historyStack.length - 1] === currentDataURL
  );
}

function clearEditableWatermarkState() {
  appliedWatermarkState = null;
}

async function downloadImage() {
  const anchor = document.createElement('a');
  const type = formatSelect.value;
  const blob = await createOutputBlob(currentDataURL, type, Number(qualityInput.value));
  const url = URL.createObjectURL(blob);

  anchor.href = url;
  anchor.download = createScreenshotFilename(type, sourceURL);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyImageToClipboard() {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    window.alert(t('clipboardUnsupported'));
    return;
  }

  const originalText = copyButton.textContent;

  try {
    copyButton.disabled = true;
    copyButton.textContent = t('copying');
    const type = 'image/png';
    const blob = await createOutputBlob(currentDataURL, type, Number(qualityInput.value));
    await writeImageToClipboard(blob);
    copyButton.textContent = t('copied');
    window.setTimeout(() => {
      copyButton.textContent = originalText;
      copyButton.disabled = false;
    }, 1200);
  } catch (error) {
    console.error('[ripfullpage] Copy failed:', error);
    copyButton.textContent = originalText;
    copyButton.disabled = false;
    window.alert(t('copyFailed'));
  }
}

async function shareImage() {
  const originalText = shareButton.textContent;

  try {
    const type = formatSelect.value;
    const blob = await createOutputBlob(currentDataURL, type, Number(qualityInput.value));
    const file = new File(
      [blob],
      createScreenshotFilename(type, sourceURL),
      { type: blob.type }
    );

    if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
      await copyImageToClipboard();
      return;
    }

    shareButton.disabled = true;
    shareButton.textContent = t('sharing');
    await navigator.share({
      title: 'ripfullpage screenshot',
      files: [file]
    });
  } catch (error) {
    if (error && error.name !== 'AbortError') {
      console.error('[ripfullpage] Share failed:', error);
      window.alert(t('shareFailed'));
    }
  } finally {
    shareButton.textContent = originalText;
    shareButton.disabled = false;
  }
}

async function downloadPdf() {
  const originalText = downloadPdfButton.textContent;

  try {
    downloadPdfButton.disabled = true;
    downloadPdfButton.textContent = t("exporting");

    const blob = await createPdfBlob(currentDataURL);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = createScreenshotFilename("application/pdf", sourceURL);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error("[ripfullpage] PDF export failed:", error);
    window.alert(t("pdfFailed"));
  } finally {
    downloadPdfButton.textContent = originalText;
    downloadPdfButton.disabled = false;
  }
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

function clearEditCanvas() {
  editContext.clearRect(0, 0, editCanvas.width, editCanvas.height);
}

function pushHistory(dataURL, options = {}) {
  if (options.replaceCurrent && historyStack.length) {
    historyStack[historyStack.length - 1] = dataURL;
  } else {
    historyStack.push(dataURL);
  }

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
      sourceURL,
      createdAt: Date.now()
    },
    [LAST_SOURCE_URL_KEY]: sourceURL
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
