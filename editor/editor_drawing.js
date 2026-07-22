// Canvas annotation, privacy tools, and WASM fallback orchestration.
(() => {
  const geometry = window.ripfullpageEditorGeometry;

  if (!geometry) {
    throw new Error("ripfullpage editor geometry is not loaded.");
  }

  const {
    clampRectToCanvas,
    makeRect,
    scalePoint,
  } = geometry;
  const colorInput = document.getElementById("colorInput");
  const sizeInput = document.getElementById("sizeInput");
  const fontSizeInput = document.getElementById("fontSizeInput");
  const privacyStrengthInput = document.getElementById("privacyStrengthInput");

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

async function applyMosaic(context, state, scaleX, scaleY) {
  const rect = getScaledCanvasRect(context, state, scaleX, scaleY);
  const blockSize = getMosaicBlockSize();

  if (await applyWasmMosaic(context, rect, blockSize)) {
    return;
  }

  applyCanvasMosaic(context, rect, blockSize);
}

function applyCanvasMosaic(context, rect, blockSize) {
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

async function applyBlur(context, state, scaleX, scaleY) {
  const rect = getScaledCanvasRect(context, state, scaleX, scaleY);
  const sourceWidth = Math.round(rect.width);
  const sourceHeight = Math.round(rect.height);

  if (sourceWidth < 2 || sourceHeight < 2) {
    return;
  }

  if (await applyWasmBlur(context, rect)) {
    return;
  }

  applyCanvasBlur(context, rect);
}

function applyCanvasBlur(context, rect) {
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

async function applyWasmMosaic(context, rect, blockSize) {
  if (!window.ripfullpageWasmCore) {
    return false;
  }

  try {
    await window.ripfullpageWasmCore.applyMosaic(context, toPixelRect(rect), blockSize);
    return true;
  } catch (error) {
    console.warn('[ripfullpage] Falling back to Canvas mosaic:', error);
    return false;
  }
}

async function applyWasmBlur(context, rect) {
  if (!window.ripfullpageWasmCore) {
    return false;
  }

  try {
    await window.ripfullpageWasmCore.applyBlur(context, toPixelRect(rect), getWasmBlurOptions());
    return true;
  } catch (error) {
    console.warn('[ripfullpage] Falling back to Canvas blur:', error);
    return false;
  }
}

async function applyWasmCrop(sourceContext, targetContext, rect) {
  if (!window.ripfullpageWasmCore) {
    return false;
  }

  try {
    const imageData = await window.ripfullpageWasmCore.crop(sourceContext, toPixelRect(rect));

    targetContext.putImageData(imageData, 0, 0);
    return true;
  } catch (error) {
    console.warn('[ripfullpage] Falling back to Canvas crop:', error);
    return false;
  }
}

function getScaledCanvasRect(context, state, scaleX, scaleY) {
  const start = scalePoint(state.start, scaleX, scaleY);
  const end = scalePoint(state.point, scaleX, scaleY);

  return clampRectToCanvas(makeRect(start.x, start.y, end.x, end.y), context.canvas);
}

function toPixelRect(rect) {
  return {
    left: Math.max(0, Math.round(rect.left)),
    top: Math.max(0, Math.round(rect.top)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
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

function getWasmBlurOptions() {
  const strength = getPrivacyStrength();

  return {
    radius: Math.round(2 + strength * 1.8),
    iterations: strength >= 8 ? 3 : strength >= 4 ? 2 : 1
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

  function loadImage(dataURL) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load image."));
      image.src = dataURL;
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.ripfullpageEditorDrawing = Object.freeze({
    applyBlur,
    applyMosaic,
    applyWasmCrop,
    drawEditState,
    drawPrivacyRectPreview,
    drawStickerState,
  });
})();
