// Watermark rendering primitives for the editor.
(() => {
  const WATERMARK_PADDING = 16;

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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.ripfullpageEditorWatermark = Object.freeze({
    drawWatermark,
  });
})();
