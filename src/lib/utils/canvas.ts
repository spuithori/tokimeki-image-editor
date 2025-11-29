import type { CropArea, TransformState, ExportOptions, Viewport, AdjustmentsState, BlurArea, StampArea } from '../types';
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

export function drawImage(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  viewport: Viewport,
  transform: TransformState,
  adjustments: AdjustmentsState,
  cropArea?: CropArea | null,
  blurAreas?: BlurArea[],
  stampAreas?: StampArea[]
): void {
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
  // This modifies the canvas pixels after drawing
  applyAllAdjustments(canvas, img, viewport, adjustments, cropArea);

  // Apply blur areas
  if (blurAreas && blurAreas.length > 0) {
    applyBlurAreas(canvas, img, viewport, blurAreas, cropArea);
  }

  // Apply stamps
  if (stampAreas && stampAreas.length > 0) {
    applyStamps(canvas, img, viewport, stampAreas, cropArea);
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

export function applyTransform(
  img: HTMLImageElement,
  transform: TransformState,
  adjustments: AdjustmentsState,
  cropArea: CropArea | null = null,
  blurAreas: BlurArea[] = [],
  stampAreas: StampArea[] = []
): HTMLCanvasElement {
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
  // For export, create a centered viewport with no offset
  const exportViewport: Viewport = {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    scale: 1
  };
  applyAllAdjustments(canvas, img, exportViewport, adjustments, cropArea);

  // Apply blur areas for export
  if (blurAreas.length > 0) {
    applyBlurAreas(canvas, img, exportViewport, blurAreas, cropArea);
  }

  // Apply stamps for export
  if (stampAreas.length > 0) {
    applyStamps(canvas, img, exportViewport, stampAreas, cropArea);
  }

  return canvas;
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
