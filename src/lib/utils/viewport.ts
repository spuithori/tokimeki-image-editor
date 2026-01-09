/**
 * Shared viewport handling logic.
 * Extracted from ImageEditor.svelte for use in multiple components.
 */

import type { Viewport } from '../types';

/**
 * Create initial viewport state
 */
export function createViewport(scale: number = 1): Viewport {
  return {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    scale
  };
}

/**
 * Update viewport with partial changes
 */
export function updateViewport(viewport: Viewport, update: Partial<Viewport>): Viewport {
  return { ...viewport, ...update };
}

/**
 * Handle zoom with optional center point (zoom towards cursor position)
 * Extracted from ImageEditor.handleZoom
 */
export function calculateZoom(
  viewport: Viewport,
  delta: number,
  canvasWidth: number,
  canvasHeight: number,
  centerX?: number,
  centerY?: number,
  canvasRect?: DOMRect
): Viewport {
  const oldZoom = viewport.zoom;
  const newZoom = Math.max(0.1, Math.min(5, oldZoom + delta));

  let newOffsetX = viewport.offsetX;
  let newOffsetY = viewport.offsetY;

  if (centerX !== undefined && centerY !== undefined && canvasRect) {
    // Zoom towards cursor position
    const x = centerX - canvasRect.left - canvasWidth / 2;
    const y = centerY - canvasRect.top - canvasHeight / 2;

    const zoomRatio = newZoom / oldZoom;
    newOffsetX = x - (x - viewport.offsetX) * zoomRatio;
    newOffsetY = y - (y - viewport.offsetY) * zoomRatio;
  }

  return {
    ...viewport,
    zoom: newZoom,
    offsetX: newOffsetX,
    offsetY: newOffsetY
  };
}

/**
 * Calculate pan offset with clamping
 * Extracted from Canvas.svelte calculatePanOffset
 */
export function calculatePanOffset(
  viewport: Viewport,
  deltaX: number,
  deltaY: number,
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  overflowMargin: number = 0.2
): { offsetX: number; offsetY: number } {
  const totalScale = viewport.scale * viewport.zoom;
  const scaledWidth = imageWidth * totalScale;
  const scaledHeight = imageHeight * totalScale;

  const maxOffsetX = (scaledWidth / 2) - (canvasWidth / 2) + (canvasWidth * overflowMargin);
  const maxOffsetY = (scaledHeight / 2) - (canvasHeight / 2) + (canvasHeight * overflowMargin);

  const newOffsetX = viewport.offsetX + deltaX;
  const newOffsetY = viewport.offsetY + deltaY;

  return {
    offsetX: Math.max(-maxOffsetX, Math.min(maxOffsetX, newOffsetX)),
    offsetY: Math.max(-maxOffsetY, Math.min(maxOffsetY, newOffsetY))
  };
}

/**
 * Reset viewport to fit image
 */
export function resetViewport(scale: number): Viewport {
  return {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    scale
  };
}
