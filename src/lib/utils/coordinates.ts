/**
 * Shared coordinate conversion logic.
 * Extracted from AnnotationTool.svelte for use in multiple components.
 */

import type { Viewport, CropArea, AnnotationPoint } from '../types';

export interface CoordinateContext {
  canvas: HTMLCanvasElement;
  image: HTMLImageElement;
  viewport: Viewport;
  cropArea?: CropArea | null;
}

/**
 * Convert screen coordinates to image coordinates
 * Extracted from AnnotationTool.toImageCoords
 */
export function screenToImageCoords(
  clientX: number,
  clientY: number,
  ctx: CoordinateContext
): AnnotationPoint | null {
  const { canvas, image, viewport, cropArea } = ctx;
  if (!canvas || !image) return null;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const canvasX = (clientX - rect.left) * scaleX;
  const canvasY = (clientY - rect.top) * scaleY;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const totalScale = viewport.scale * viewport.zoom;

  // Calculate based on crop or full image
  const sourceWidth = cropArea ? cropArea.width : image.width;
  const sourceHeight = cropArea ? cropArea.height : image.height;
  const offsetX = cropArea ? cropArea.x : 0;
  const offsetY = cropArea ? cropArea.y : 0;

  // Convert to crop-relative coordinates
  const relativeX = (canvasX - centerX - viewport.offsetX) / totalScale + sourceWidth / 2;
  const relativeY = (canvasY - centerY - viewport.offsetY) / totalScale + sourceHeight / 2;

  // Convert to absolute image coordinates
  return {
    x: relativeX + offsetX,
    y: relativeY + offsetY
  };
}

/**
 * Convert image coordinates to canvas coordinates for rendering
 * Extracted from AnnotationTool.toCanvasCoords
 */
export function imageToCanvasCoords(
  point: AnnotationPoint,
  ctx: CoordinateContext
): { x: number; y: number } | null {
  const { canvas, image, viewport, cropArea } = ctx;
  if (!canvas || !image) return null;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const totalScale = viewport.scale * viewport.zoom;

  const sourceWidth = cropArea ? cropArea.width : image.width;
  const sourceHeight = cropArea ? cropArea.height : image.height;
  const offsetX = cropArea ? cropArea.x : 0;
  const offsetY = cropArea ? cropArea.y : 0;

  const relativeX = point.x - offsetX;
  const relativeY = point.y - offsetY;

  return {
    x: (relativeX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX,
    y: (relativeY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY
  };
}

/**
 * Convert multiple points from image to canvas coordinates
 */
export function imagePointsToCanvasCoords(
  points: AnnotationPoint[],
  ctx: CoordinateContext
): { x: number; y: number; width?: number }[] {
  return points
    .map(p => {
      const coords = imageToCanvasCoords(p, ctx);
      if (!coords) return null;
      return { ...coords, width: p.width };
    })
    .filter((p): p is { x: number; y: number; width?: number } => p !== null);
}

/**
 * Get the total scale factor (viewport scale * zoom)
 */
export function getTotalScale(viewport: Viewport): number {
  return viewport.scale * viewport.zoom;
}
