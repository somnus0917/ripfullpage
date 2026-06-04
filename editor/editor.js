// Screenshot editor. It supports crop, annotation, mosaic, undo/redo, reset, and PNG download.

const EDITOR_IMAGE_KEY = 'ripfullpage:lastImage';
const MIN_CROP_SIZE = 20;
const MAX_HISTORY = 30;

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
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
const colorInput = document.getElementById('colorInput');
const sizeInput = document.getElementById('sizeInput');
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
  historyStack = [currentDataURL];

  bindEvents();
  await loadPreview(currentDataURL);
  setActiveTool(activeTool);
  updateHistoryButtons();
}

function bindEvents() {
  window.addEventListener('resize', syncEditorLayout);
  imageWrap.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  applyCropButton.addEventListener('click', applyCrop);
  resetButton.addEventListener('click', resetImage);
  downloadButton.addEventListener('click', downloadImage);
  downloadPdfButton.addEventListener('click', downloadPdf);
  undoButton.addEventListener('click', undoEdit);
  redoButton.addEventListener('click', redoEdit);

  for (const button of toolButtons) {
    button.addEventListener('click', () => {
      setActiveTool(button.dataset.tool);
    });
  }
}

function loadPreview(dataURL) {
  return new Promise((resolve, reject) => {
    previewImage.onload = () => {
      naturalWidth = previewImage.naturalWidth;
      naturalHeight = previewImage.naturalHeight;
      imageMeta.textContent = `${naturalWidth} x ${naturalHeight}px`;
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

  for (const button of toolButtons) {
    button.classList.toggle('active', button.dataset.tool === tool);
  }

  cropBox.hidden = tool !== 'crop';
  applyCropButton.disabled = tool !== 'crop' || !currentDataURL;
  imageWrap.dataset.tool = tool;
  clearEditCanvas();
}

function onPointerDown(event) {
  if (!currentDataURL || event.button !== 0) {
    return;
  }

  if (activeTool === 'crop') {
    startCropDrag(event);
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

function drawEditPreview() {
  if (!editDragState) {
    return;
  }

  clearEditCanvas();

  if (editDragState.tool === 'mosaic') {
    drawMosaicPreview(editContext, editDragState);
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

  if (state.tool === 'arrow') {
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = size * scaleX;
    drawArrow(context, start, end, Math.max(12, size * 4 * scaleX));
  }

  if (state.tool === 'text') {
    context.fillStyle = color;
    context.font = `600 ${Math.max(14, size * 4) * scaleX}px ui-sans-serif, system-ui, sans-serif`;
    context.textBaseline = 'top';
    context.fillText(state.text, start.x, start.y);
  }

  context.restore();
}

function applyMosaic(context, state, scaleX, scaleY) {
  const start = scalePoint(state.start, scaleX, scaleY);
  const end = scalePoint(state.point, scaleX, scaleY);
  const rect = makeRect(start.x, start.y, end.x, end.y);
  const blockSize = Math.max(8, Number(sizeInput.value) * 2);

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

function drawMosaicPreview(context, state) {
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

function downloadImage() {
  const anchor = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  anchor.href = currentDataURL;
  anchor.download = `ripfullpage-${timestamp}.png`;
  anchor.click();
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
  undoButton.disabled = !enabled || historyStack.length <= 1;
  redoButton.disabled = !enabled || redoStack.length === 0;
  for (const button of toolButtons) {
    button.disabled = !enabled;
  }
  colorInput.disabled = !enabled;
  sizeInput.disabled = !enabled;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
