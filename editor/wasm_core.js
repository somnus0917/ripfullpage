const WASM_CORE_URL = 'wasm/ripfullpage_core.wasm';
const OK = 0;

let corePromise = null;

window.ripfullpageWasmCore = {
  applyMosaic,
  applyBlur,
  crop,
  isAvailable
};

async function isAvailable() {
  try {
    await loadCore();
    return true;
  } catch (error) {
    console.warn('[ripfullpage] Rust WASM core is unavailable:', error);
    return false;
  }
}

async function applyMosaic(context, rect, blockSize) {
  const imageData = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
  const core = await loadCore();

  withWasmBuffer(core, imageData.data, (ptr, len) => {
    const status = core.exports.rip_apply_mosaic(
      ptr,
      len,
      imageData.width,
      imageData.height,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      blockSize
    );

    assertStatus(status, 'rip_apply_mosaic');
    imageData.data.set(readWasmBytes(core, ptr, len));
  });

  context.putImageData(imageData, 0, 0);
}

async function applyBlur(context, rect, options) {
  const imageData = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
  const core = await loadCore();

  withWasmBuffer(core, imageData.data, (ptr, len) => {
    const status = core.exports.rip_apply_box_blur(
      ptr,
      len,
      imageData.width,
      imageData.height,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      options.radius,
      options.iterations
    );

    assertStatus(status, 'rip_apply_box_blur');
    imageData.data.set(readWasmBytes(core, ptr, len));
  });

  context.putImageData(imageData, 0, 0);
}

async function crop(context, rect) {
  const source = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
  const target = new ImageData(Math.max(1, rect.width), Math.max(1, rect.height));
  const core = await loadCore();

  withWasmBuffer(core, source.data, (sourcePtr, sourceLen) => {
    withWasmBuffer(core, target.data, (targetPtr, targetLen) => {
      const status = core.exports.rip_crop(
        sourcePtr,
        sourceLen,
        targetPtr,
        targetLen,
        source.width,
        source.height,
        rect.left,
        rect.top,
        rect.width,
        rect.height
      );

      assertStatus(status, 'rip_crop');
      target.data.set(readWasmBytes(core, targetPtr, targetLen));
    });
  });

  return target;
}

async function loadCore() {
  if (!corePromise) {
    corePromise = instantiateCore();
  }

  return corePromise;
}

async function instantiateCore() {
  const response = await fetch(chrome.runtime.getURL(WASM_CORE_URL));

  if (!response.ok) {
    throw new Error(`Could not load WASM core: ${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {});

  return result.instance;
}

function withWasmBuffer(core, sourceBytes, callback) {
  const ptr = core.exports.rip_alloc(sourceBytes.byteLength);

  if (!ptr) {
    throw new Error('Rust WASM allocation failed.');
  }

  try {
    writeWasmBytes(core, ptr, sourceBytes);
    callback(ptr, sourceBytes.byteLength);
  } finally {
    core.exports.rip_free(ptr, sourceBytes.byteLength);
  }
}

function writeWasmBytes(core, ptr, sourceBytes) {
  new Uint8Array(core.exports.memory.buffer, ptr, sourceBytes.byteLength)
    .set(sourceBytes);
}

function readWasmBytes(core, ptr, len) {
  return new Uint8Array(core.exports.memory.buffer, ptr, len);
}

function assertStatus(status, operation) {
  if (status !== OK) {
    throw new Error(`${operation} failed with status ${status}`);
  }
}
