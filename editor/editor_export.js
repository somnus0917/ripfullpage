// Image, clipboard, share filename, and PDF export helpers.
(() => {
async function createOutputBlob(dataURL, type, qualityPercent) {
  const image = await loadImage(dataURL);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const normalizedType = normalizeImageType(type);
  const quality = Number(qualityPercent) / 100;

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
  if (type === 'application/pdf') {
    return 'pdf';
  }

  const normalizedType = normalizeImageType(type);

  if (normalizedType === 'image/jpeg') {
    return 'jpg';
  }

  if (normalizedType === 'image/webp') {
    return 'webp';
  }

  return 'png';
}

function createScreenshotFilename(type, sourceURL) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sourceSlug = createSourceSlug(sourceURL);
  const prefix = sourceSlug ? `ripfullpage-${sourceSlug}` : 'ripfullpage';

  return `${prefix}-${timestamp}.${getFileExtension(type)}`;
}

function createSourceSlug(url) {
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 3)
      .join('-');

    return sanitizeFilenamePart([host, path].filter(Boolean).join('-'));
  } catch (_error) {
    return sanitizeFilenamePart(url);
  }
}

function sanitizeFilenamePart(value) {
  return String(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function writeImageToClipboard(blob) {
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob
    })
  ]);
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

  async function createPdfBlob(dataURL) {
    const image = await loadImage(dataURL);
    const pages = await createPdfImagePages(image);
    const pdfBytes = buildPdfDocument(pages);

    return new Blob([pdfBytes], { type: "application/pdf" });
  }

  function loadImage(dataURL) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load image."));
      image.src = dataURL;
    });
  }

  window.ripfullpageEditorExport = Object.freeze({
    createOutputBlob,
    createPdfBlob,
    createScreenshotFilename,
    writeImageToClipboard,
  });
})();
