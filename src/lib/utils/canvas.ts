import type { CropArea, TransformState, ExportOptions, Viewport, AdjustmentsState, BlurArea, StampArea, Annotation } from '../types';
import { applyAllAdjustments, applyGaussianBlur } from './adjustments';

// Image cache for stamp images
const stampImageCache = new Map<string, HTMLImageElement>();

export function preloadStampImage(url: string): Promise<HTMLImageElement> {
  // Return cached image if available
  if (stampImageCache.has(url)) {
    return Promise.resolve(stampImageCache.get(url)!);
  }

  // Load new image
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Allow CORS for external images
    img.onload = () => {
      stampImageCache.set(url, img);
      resolve(img);
    };
    img.onerror = (error) => {
      console.error(`Failed to load stamp image: ${url}`, error);
      reject(error);
    };
    img.src = url;
  });
}

export function getStampImage(url: string): HTMLImageElement | null {
  return stampImageCache.get(url) || null;
}

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function calculateFitScale(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): number {
  const scaleX = canvasWidth / imageWidth;
  const scaleY = canvasHeight / imageHeight;
  return Math.min(scaleX, scaleY, 1); // Don't scale up, only down
}

export async function drawImage(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport,
  transform: TransformState,
  adjustments: AdjustmentsState,
  cropArea?: CropArea | null,
  blurAreas?: BlurArea[],
  stampAreas?: StampArea[],
  annotations?: Annotation[]
): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Ensure filter is reset before starting
  ctx.filter = 'none';

  ctx.save();

  // Apply viewport transformations
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  ctx.translate(centerX + viewport.offsetX, centerY + viewport.offsetY);

  // Apply zoom
  const totalScale = viewport.scale * viewport.zoom;
  ctx.scale(totalScale, totalScale);

  // Rotation
  ctx.rotate((transform.rotation * Math.PI) / 180);

  // Flip
  ctx.scale(
    transform.flipHorizontal ? -1 : 1,
    transform.flipVertical ? -1 : 1
  );

  // Draw image (with crop if specified)
  if (cropArea) {
    // Draw only the cropped area
    ctx.drawImage(
      img,
      cropArea.x,
      cropArea.y,
      cropArea.width,
      cropArea.height,
      -cropArea.width / 2,
      -cropArea.height / 2,
      cropArea.width,
      cropArea.height
    );
  } else {
    // Draw full image centered
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
  }

  ctx.restore();

  // Apply all adjustments via pixel manipulation (Safari-compatible)
  // Uses WebGPU acceleration when available, falls back to CPU
  await applyAllAdjustments(canvas, img, viewport, adjustments, cropArea);

  // Apply blur areas
  if (blurAreas && blurAreas.length > 0) {
    applyBlurAreas(canvas, img, viewport, blurAreas, cropArea);
  }

  // Apply stamps
  if (stampAreas && stampAreas.length > 0) {
    applyStamps(canvas, img, viewport, stampAreas, cropArea);
  }

  // Apply annotations
  if (annotations && annotations.length > 0) {
    applyAnnotations(canvas, img, viewport, annotations, cropArea);
  }
}

export function exportCanvas(
  canvas: HTMLCanvasElement,
  options: ExportOptions
): string {
  if (options.format === 'jpeg') {
    return canvas.toDataURL('image/jpeg', options.quality);
  }
  return canvas.toDataURL('image/png');
}

export function downloadImage(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

export async function applyTransform(
  img: HTMLImageElement,
  transform: TransformState,
  adjustments: AdjustmentsState,
  cropArea: CropArea | null = null,
  blurAreas: BlurArea[] = [],
  stampAreas: StampArea[] = [],
  annotations: Annotation[] = []
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Calculate source dimensions
  const sourceWidth = cropArea ? cropArea.width : img.width;
  const sourceHeight = cropArea ? cropArea.height : img.height;

  // Calculate canvas size based on rotation
  const needsSwap = transform.rotation === 90 || transform.rotation === 270;
  canvas.width = needsSwap ? sourceHeight : sourceWidth;
  canvas.height = needsSwap ? sourceWidth : sourceHeight;

  // Ensure filter is reset before starting
  ctx.filter = 'none';

  ctx.save();

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(
    transform.flipHorizontal ? -1 : 1,
    transform.flipVertical ? -1 : 1
  );

  if (cropArea) {
    ctx.drawImage(
      img,
      cropArea.x,
      cropArea.y,
      cropArea.width,
      cropArea.height,
      -sourceWidth / 2,
      -sourceHeight / 2,
      sourceWidth,
      sourceHeight
    );
  } else {
    ctx.drawImage(img, -sourceWidth / 2, -sourceHeight / 2);
  }

  ctx.restore();

  // Apply all adjustments via pixel manipulation (Safari-compatible)
  // Uses WebGPU acceleration when available, falls back to CPU
  // For export, create a centered viewport with no offset
  const exportViewport: Viewport = {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    scale: 1
  };
  await applyAllAdjustments(canvas, img, exportViewport, adjustments, cropArea);

  // Apply blur areas for export
  if (blurAreas.length > 0) {
    applyBlurAreas(canvas, img, exportViewport, blurAreas, cropArea);
  }

  // Apply stamps for export
  if (stampAreas.length > 0) {
    applyStamps(canvas, img, exportViewport, stampAreas, cropArea);
  }

  // Apply annotations for export
  if (annotations.length > 0) {
    applyAnnotations(canvas, img, exportViewport, annotations, cropArea);
  }

  return canvas;
}

/**
 * Apply all transformations and export using WebGPU (when available)
 * Falls back to Canvas2D if WebGPU is not supported
 */
export async function applyTransformWithWebGPU(
  img: HTMLImageElement,
  transform: TransformState,
  adjustments: AdjustmentsState,
  cropArea: CropArea | null = null,
  blurAreas: BlurArea[] = [],
  stampAreas: StampArea[] = [],
  annotations: Annotation[] = []
): Promise<HTMLCanvasElement> {
  // Try WebGPU export first
  if (navigator.gpu) {
    try {
      const { exportWithWebGPU } = await import('./webgpu-render');
      const webgpuCanvas = await exportWithWebGPU(
        img,
        adjustments,
        transform,
        cropArea,
        blurAreas
      );

      if (webgpuCanvas) {
        // Apply stamps and annotations on top (WebGPU doesn't handle these yet)
        if (stampAreas.length > 0 || annotations.length > 0) {
          // Create a new Canvas2D to composite WebGPU result + stamps + annotations
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = webgpuCanvas.width;
          finalCanvas.height = webgpuCanvas.height;
          const ctx = finalCanvas.getContext('2d');

          if (ctx) {
            // Draw WebGPU result
            ctx.drawImage(webgpuCanvas, 0, 0);

            // Apply stamps on top
            const exportViewport: Viewport = {
              zoom: 1,
              offsetX: 0,
              offsetY: 0,
              scale: 1
            };
            if (stampAreas.length > 0) {
              applyStamps(finalCanvas, img, exportViewport, stampAreas, cropArea);
            }
            if (annotations.length > 0) {
              applyAnnotations(finalCanvas, img, exportViewport, annotations, cropArea);
            }

            return finalCanvas;
          }
        }

        return webgpuCanvas;
      }
    } catch (error) {
      console.warn('WebGPU export failed, falling back to Canvas2D:', error);
    }
  }

  // Fallback to Canvas2D
  return applyTransform(img, transform, adjustments, cropArea, blurAreas, stampAreas, annotations);
}

export function screenToImageCoords(
  screenX: number,
  screenY: number,
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport,
  transform: TransformState
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();

  // Convert screen coordinates to canvas coordinates
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const canvasX = (screenX - rect.left) * scaleX;
  const canvasY = (screenY - rect.top) * scaleY;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  const totalScale = viewport.scale * viewport.zoom;

  // Inverse transform
  const x = (canvasX - centerX - viewport.offsetX) / totalScale + img.width / 2;
  const y = (canvasY - centerY - viewport.offsetY) / totalScale + img.height / 2;

  return { x, y };
}

export function imageToCanvasCoords(
  imageX: number,
  imageY: number,
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport
): { x: number; y: number } {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  const totalScale = viewport.scale * viewport.zoom;

  const x = (imageX - img.width / 2) * totalScale + centerX + viewport.offsetX;
  const y = (imageY - img.height / 2) * totalScale + centerY + viewport.offsetY;

  return { x, y };
}

// Deprecated: use imageToCanvasCoords instead
export function imageToScreenCoords(
  imageX: number,
  imageY: number,
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport
): { x: number; y: number } {
  return imageToCanvasCoords(imageX, imageY, canvas, img, viewport);
}

/**
 * Apply blur effects to specified areas of the canvas
 * Uses pixel manipulation for Safari compatibility
 */
export function applyBlurAreas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport,
  blurAreas: BlurArea[],
  cropArea?: CropArea | null
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const totalScale = viewport.scale * viewport.zoom;

  // Create a temporary canvas to extract regions for blurring
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;

  blurAreas.forEach(blurArea => {
    // Determine source dimensions based on crop
    const sourceWidth = cropArea ? cropArea.width : img.width;
    const sourceHeight = cropArea ? cropArea.height : img.height;
    const offsetX = cropArea ? cropArea.x : 0;
    const offsetY = cropArea ? cropArea.y : 0;

    // Convert blur area to crop-relative coordinates
    const relativeX = blurArea.x - offsetX;
    const relativeY = blurArea.y - offsetY;

    // Calculate blur area in canvas coordinates
    const canvasBlurX = (relativeX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX;
    const canvasBlurY = (relativeY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY;
    const canvasBlurWidth = blurArea.width * totalScale;
    const canvasBlurHeight = blurArea.height * totalScale;

    // Calculate image bounds on canvas
    const imgCanvasLeft = (0 - sourceWidth / 2) * totalScale + centerX + viewport.offsetX;
    const imgCanvasTop = (0 - sourceHeight / 2) * totalScale + centerY + viewport.offsetY;
    const imgCanvasRight = imgCanvasLeft + sourceWidth * totalScale;
    const imgCanvasBottom = imgCanvasTop + sourceHeight * totalScale;

    // Clip blur area to image bounds
    const clippedX = Math.max(imgCanvasLeft, canvasBlurX);
    const clippedY = Math.max(imgCanvasTop, canvasBlurY);
    const clippedRight = Math.min(imgCanvasRight, canvasBlurX + canvasBlurWidth);
    const clippedBottom = Math.min(imgCanvasBottom, canvasBlurY + canvasBlurHeight);
    const clippedWidth = clippedRight - clippedX;
    const clippedHeight = clippedBottom - clippedY;

    if (clippedWidth <= 0 || clippedHeight <= 0) return;

    // Calculate blur radius in pixels
    const imageBlurPx = (blurArea.blurStrength / 100) * 100;
    const blurRadius = imageBlurPx * totalScale;

    // Add padding for blur to work properly at edges
    const padding = Math.ceil(blurRadius * 2);

    const paddedX = Math.max(0, clippedX - padding);
    const paddedY = Math.max(0, clippedY - padding);
    const paddedRight = Math.min(canvas.width, clippedRight + padding);
    const paddedBottom = Math.min(canvas.height, clippedBottom + padding);
    const paddedWidth = paddedRight - paddedX;
    const paddedHeight = paddedBottom - paddedY;

    // Extract the padded region from the canvas
    tempCanvas.width = paddedWidth;
    tempCanvas.height = paddedHeight;
    tempCtx.clearRect(0, 0, paddedWidth, paddedHeight);
    tempCtx.drawImage(
      canvas,
      paddedX, paddedY, paddedWidth, paddedHeight,
      0, 0, paddedWidth, paddedHeight
    );

    // Apply blur to the temporary canvas
    applyGaussianBlur(
      tempCanvas,
      0,
      0,
      paddedWidth,
      paddedHeight,
      blurRadius
    );

    // Calculate the portion to draw back (excluding padding)
    const srcX = clippedX - paddedX;
    const srcY = clippedY - paddedY;

    // Draw only the non-padded portion back to the main canvas
    ctx.drawImage(
      tempCanvas,
      srcX, srcY, clippedWidth, clippedHeight,
      clippedX, clippedY, clippedWidth, clippedHeight
    );
  });
}

/**
 * Apply stamp decorations to the canvas
 */
export function applyStamps(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport,
  stampAreas: StampArea[],
  cropArea?: CropArea | null
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const totalScale = viewport.scale * viewport.zoom;

  stampAreas.forEach(stamp => {
    // Determine source dimensions based on crop
    const sourceWidth = cropArea ? cropArea.width : img.width;
    const sourceHeight = cropArea ? cropArea.height : img.height;
    const offsetX = cropArea ? cropArea.x : 0;
    const offsetY = cropArea ? cropArea.y : 0;

    // Convert stamp area to crop-relative coordinates
    const relativeX = stamp.x - offsetX;
    const relativeY = stamp.y - offsetY;

    // Calculate stamp center in canvas coordinates
    const canvasCenterX = (relativeX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX;
    const canvasCenterY = (relativeY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY;
    const canvasWidth = stamp.width * totalScale;
    const canvasHeight = stamp.height * totalScale;

    // Save context
    ctx.save();

    // Apply transformation
    ctx.translate(canvasCenterX, canvasCenterY);
    ctx.rotate((stamp.rotation || 0) * Math.PI / 180);

    // Render stamp based on type
    if (stamp.stampType === 'emoji') {
      // Render emoji
      ctx.font = `${canvasHeight}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(stamp.stampContent, 0, 0);
    } else if (stamp.stampType === 'image' || stamp.stampType === 'svg') {
      // Get image from cache
      const stampImg = getStampImage(stamp.stampContent);
      if (stampImg) {
        ctx.drawImage(
          stampImg,
          -canvasWidth / 2,
          -canvasHeight / 2,
          canvasWidth,
          canvasHeight
        );
      } else {
        // Draw placeholder while loading
        ctx.fillStyle = '#ccc';
        ctx.fillRect(-canvasWidth / 2, -canvasHeight / 2, canvasWidth, canvasHeight);
        // Start loading if not already loading
        preloadStampImage(stamp.stampContent).catch(console.error);
      }
    }

    // Restore context
    ctx.restore();
  });
}

/**
 * Apply annotation drawings to the canvas
 * Supports pen strokes, arrows, and rectangles
 */
export function applyAnnotations(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport,
  annotations: Annotation[],
  cropArea?: CropArea | null
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const totalScale = viewport.scale * viewport.zoom;

  // Determine source dimensions based on crop
  const sourceWidth = cropArea ? cropArea.width : img.width;
  const sourceHeight = cropArea ? cropArea.height : img.height;
  const offsetX = cropArea ? cropArea.x : 0;
  const offsetY = cropArea ? cropArea.y : 0;

  // Helper to convert image coords to canvas coords
  const toCanvasCoords = (x: number, y: number) => {
    const relativeX = x - offsetX;
    const relativeY = y - offsetY;
    return {
      x: (relativeX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX,
      y: (relativeY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY
    };
  };

  annotations.forEach(annotation => {
    if (annotation.points.length === 0) return;

    ctx.save();
    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = annotation.strokeWidth * totalScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Apply shadow if enabled
    if (annotation.shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;
    }

    if (annotation.type === 'pen') {
      // Draw pen stroke with smooth curves
      const points = annotation.points.map(p => toCanvasCoords(p.x, p.y));

      if (points.length === 0) return;

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);

      if (points.length === 1) {
        // Single point - just a dot
        ctx.lineTo(points[0].x, points[0].y);
      } else if (points.length === 2) {
        // Two points - straight line
        ctx.lineTo(points[1].x, points[1].y);
      } else {
        // Use quadratic bezier curves for smooth lines
        for (let i = 1; i < points.length - 1; i++) {
          const prev = points[i - 1];
          const curr = points[i];
          const next = points[i + 1];

          if (i === 1) {
            // First segment: line to first midpoint
            const firstMidX = (prev.x + curr.x) / 2;
            const firstMidY = (prev.y + curr.y) / 2;
            ctx.lineTo(firstMidX, firstMidY);
          }

          // Calculate end point (midpoint between current and next)
          const endX = (curr.x + next.x) / 2;
          const endY = (curr.y + next.y) / 2;

          // Quadratic bezier curve with current point as control point
          ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
        }

        // Final segment to last point
        const lastPoint = points[points.length - 1];
        ctx.lineTo(lastPoint.x, lastPoint.y);
      }
      ctx.stroke();

    } else if (annotation.type === 'brush' && annotation.points.length >= 1) {
      // Draw brush stroke with variable width
      const rawPoints = annotation.points.map(p => ({
        ...toCanvasCoords(p.x, p.y),
        width: p.width ?? annotation.strokeWidth
      }));

      // Handle single point - create an elliptical brush mark (点)
      if (rawPoints.length === 1) {
        const p = rawPoints[0];
        const width = (p.width * totalScale) / 2;
        const rx = width * 0.8;
        const ry = width * 1.2;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();

      // Handle 2 points - create a teardrop/brush stroke shape
      } else if (rawPoints.length === 2) {
        const p1 = rawPoints[0];
        const p2 = rawPoints[1];
        const w1 = ((p1.width ?? annotation.strokeWidth * 0.3) * totalScale) / 2;
        const w2 = ((p2.width ?? annotation.strokeWidth * 0.5) * totalScale) / 2;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const nx = -dy / len;
          const ny = dx / len;

          const tipExtend = w2 * 0.3;
          const tipX = p2.x + (dx / len) * tipExtend;
          const tipY = p2.y + (dy / len) * tipExtend;

          ctx.beginPath();
          ctx.moveTo(p1.x + nx * w1, p1.y + ny * w1);
          ctx.quadraticCurveTo(
            (p1.x + nx * w1 + p2.x + nx * w2) / 2 + nx * w2 * 0.3,
            (p1.y + ny * w1 + p2.y + ny * w2) / 2 + ny * w2 * 0.3,
            p2.x + nx * w2, p2.y + ny * w2
          );
          ctx.quadraticCurveTo(tipX + nx * w2 * 0.2, tipY + ny * w2 * 0.2, tipX, tipY);
          ctx.quadraticCurveTo(tipX - nx * w2 * 0.2, tipY - ny * w2 * 0.2, p2.x - nx * w2, p2.y - ny * w2);
          ctx.quadraticCurveTo(
            (p1.x - nx * w1 + p2.x - nx * w2) / 2 - nx * w2 * 0.3,
            (p1.y - ny * w1 + p2.y - ny * w2) / 2 - ny * w2 * 0.3,
            p1.x - nx * w1, p1.y - ny * w1
          );
          ctx.closePath();
          ctx.fill();
        }

      // Handle 3+ points with interpolation for smoother curves
      } else {
        // Interpolate points for smoother curves
        const interpolated: { x: number; y: number; width: number }[] = [];
        for (let i = 0; i < rawPoints.length - 1; i++) {
          const p1 = rawPoints[i];
          const p2 = rawPoints[i + 1];
          const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

          interpolated.push(p1);

          const interpolateCount = Math.floor(dist / 5);
          for (let j = 1; j < interpolateCount; j++) {
            const t = j / interpolateCount;
            const smoothT = t * t * (3 - 2 * t);
            interpolated.push({
              x: p1.x + (p2.x - p1.x) * t,
              y: p1.y + (p2.y - p1.y) * t,
              width: p1.width + (p2.width - p1.width) * smoothT
            });
          }
        }
        interpolated.push(rawPoints[rawPoints.length - 1]);

        // Generate outline for variable-width path
        let leftSide: { x: number; y: number }[] = [];
        let rightSide: { x: number; y: number }[] = [];

        for (let i = 0; i < interpolated.length; i++) {
          const curr = interpolated[i];
          const width = (curr.width * totalScale) / 2;

          let dx: number, dy: number;
          if (i === 0) {
            dx = interpolated[1].x - curr.x;
            dy = interpolated[1].y - curr.y;
          } else if (i === interpolated.length - 1) {
            dx = curr.x - interpolated[i - 1].x;
            dy = curr.y - interpolated[i - 1].y;
          } else {
            const lookback = Math.min(i, 3);
            const lookforward = Math.min(interpolated.length - 1 - i, 3);
            dx = interpolated[i + lookforward].x - interpolated[i - lookback].x;
            dy = interpolated[i + lookforward].y - interpolated[i - lookback].y;
          }

          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) continue;

          const nx = -dy / len;
          const ny = dx / len;

          leftSide.push({ x: curr.x + nx * width, y: curr.y + ny * width });
          rightSide.push({ x: curr.x - nx * width, y: curr.y - ny * width });
        }

        // Smooth the outline points to reduce zigzag
        const smoothOutline = (pts: { x: number; y: number }[], windowSize: number = 5) => {
          if (pts.length < 3) return pts;
          const result: { x: number; y: number }[] = [];
          const halfWindow = Math.floor(windowSize / 2);
          for (let i = 0; i < pts.length; i++) {
            if (i < halfWindow || i >= pts.length - halfWindow) {
              result.push(pts[i]);
              continue;
            }
            let sumX = 0, sumY = 0, count = 0;
            for (let j = -halfWindow; j <= halfWindow; j++) {
              const idx = i + j;
              if (idx >= 0 && idx < pts.length) {
                sumX += pts[idx].x;
                sumY += pts[idx].y;
                count++;
              }
            }
            result.push({ x: sumX / count, y: sumY / count });
          }
          return result;
        };

        leftSide = smoothOutline(leftSide);
        rightSide = smoothOutline(rightSide);

        if (leftSide.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(leftSide[0].x, leftSide[0].y);

          // Left side with smooth curves
          for (let i = 1; i < leftSide.length - 1; i++) {
            const curr = leftSide[i];
            const next = leftSide[i + 1];
            const endX = (curr.x + next.x) / 2;
            const endY = (curr.y + next.y) / 2;
            ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
          }
          ctx.lineTo(leftSide[leftSide.length - 1].x, leftSide[leftSide.length - 1].y);

          // End cap with rounded connection
          const lastPoint = interpolated[interpolated.length - 1];
          const lastWidth = (lastPoint.width * totalScale) / 2;
          const tipExtend = lastWidth * 0.4;
          const lastDx = interpolated.length > 1
            ? interpolated[interpolated.length - 1].x - interpolated[interpolated.length - 2].x
            : 0;
          const lastDy = interpolated.length > 1
            ? interpolated[interpolated.length - 1].y - interpolated[interpolated.length - 2].y
            : 0;
          const lastLen = Math.sqrt(lastDx * lastDx + lastDy * lastDy);

          if (lastLen > 0) {
            const tipX = lastPoint.x + (lastDx / lastLen) * tipExtend;
            const tipY = lastPoint.y + (lastDy / lastLen) * tipExtend;
            ctx.quadraticCurveTo(tipX, tipY, rightSide[rightSide.length - 1].x, rightSide[rightSide.length - 1].y);
          } else {
            ctx.lineTo(rightSide[rightSide.length - 1].x, rightSide[rightSide.length - 1].y);
          }

          // Right side backward with smooth curves
          for (let i = rightSide.length - 2; i > 0; i--) {
            const curr = rightSide[i];
            const prev = rightSide[i - 1];
            const endX = (curr.x + prev.x) / 2;
            const endY = (curr.y + prev.y) / 2;
            ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
          }
          ctx.lineTo(rightSide[0].x, rightSide[0].y);

          // Start cap with rounded connection
          const firstPoint = interpolated[0];
          const firstWidth = (firstPoint.width * totalScale) / 2;
          const startExtend = firstWidth * 0.3;
          const firstDx = interpolated.length > 1
            ? interpolated[0].x - interpolated[1].x
            : 0;
          const firstDy = interpolated.length > 1
            ? interpolated[0].y - interpolated[1].y
            : 0;
          const firstLen = Math.sqrt(firstDx * firstDx + firstDy * firstDy);

          if (firstLen > 0) {
            const startTipX = firstPoint.x + (firstDx / firstLen) * startExtend;
            const startTipY = firstPoint.y + (firstDy / firstLen) * startExtend;
            ctx.quadraticCurveTo(startTipX, startTipY, leftSide[0].x, leftSide[0].y);
          }

          ctx.closePath();
          ctx.fill();
        }
      }

    } else if (annotation.type === 'arrow' && annotation.points.length >= 2) {
      // Draw arrow
      const start = toCanvasCoords(annotation.points[0].x, annotation.points[0].y);
      const end = toCanvasCoords(annotation.points[1].x, annotation.points[1].y);

      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const scaledStroke = annotation.strokeWidth * totalScale;
      const headLength = scaledStroke * 3;
      const headWidth = scaledStroke * 2;

      // Draw line (shortened to not overlap with arrowhead)
      const lineEndX = end.x - headLength * 0.7 * Math.cos(angle);
      const lineEndY = end.y - headLength * 0.7 * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(lineEndX, lineEndY);
      ctx.stroke();

      // Draw arrowhead
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLength * Math.cos(angle) + headWidth * Math.sin(angle),
        end.y - headLength * Math.sin(angle) - headWidth * Math.cos(angle)
      );
      ctx.lineTo(
        end.x - headLength * Math.cos(angle) - headWidth * Math.sin(angle),
        end.y - headLength * Math.sin(angle) + headWidth * Math.cos(angle)
      );
      ctx.closePath();
      ctx.fill();

    } else if (annotation.type === 'rectangle' && annotation.points.length >= 2) {
      // Draw rounded rectangle
      const start = toCanvasCoords(annotation.points[0].x, annotation.points[0].y);
      const end = toCanvasCoords(annotation.points[1].x, annotation.points[1].y);

      const rectX = Math.min(start.x, end.x);
      const rectY = Math.min(start.y, end.y);
      const rectWidth = Math.abs(end.x - start.x);
      const rectHeight = Math.abs(end.y - start.y);
      const cornerRadius = annotation.strokeWidth * totalScale * 1.5;

      ctx.beginPath();
      ctx.roundRect(rectX, rectY, rectWidth, rectHeight, cornerRadius);
      ctx.stroke();
    }

    ctx.restore();
  });
}
