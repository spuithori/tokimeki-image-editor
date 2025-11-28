import type { CropArea, TransformState, ExportOptions, Viewport } from '../types';

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
  cropArea?: CropArea | null
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  cropArea: CropArea | null = null
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
