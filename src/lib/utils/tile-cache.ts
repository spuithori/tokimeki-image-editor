/**
 * Tile-Based Cache System
 *
 * Divides the image into tiles for efficient partial cache invalidation.
 * Critical for handling eraser strokes without rebuilding the entire cache.
 *
 * Architecture:
 * - Image is divided into TILE_SIZE x TILE_SIZE pixel tiles
 * - Each tile tracks which annotations affect it
 * - Eraser strokes only invalidate affected tiles
 * - LRU eviction prevents memory bloat
 */

import type { Annotation, AnnotationPoint, Viewport, CropArea } from '../types';
import { SpatialIndex, BoundingBox, getTilesForBounds } from './spatial-index';
import { renderAnnotationToContext } from './annotation-cache';

// Tile size in image coordinates
export const TILE_SIZE = 256;

// Maximum number of tiles to keep in cache (LRU eviction)
const MAX_TILES = 256;

// Tile data structure
export interface TileData {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  strokeIds: Set<string>;
  version: number;
  lastAccess: number;
}

// Tile cache state
export interface TileCacheState {
  tiles: Map<string, TileData>;
  dirtyTiles: Set<string>;
  globalVersion: number;
  imageWidth: number;
  imageHeight: number;
  accessCounter: number;
}

/**
 * Create initial tile cache state
 */
export function createTileCacheState(): TileCacheState {
  return {
    tiles: new Map(),
    dirtyTiles: new Set(),
    globalVersion: 0,
    imageWidth: 0,
    imageHeight: 0,
    accessCounter: 0
  };
}

/**
 * Get tile key from tile coordinates
 */
export function getTileKey(tileX: number, tileY: number): string {
  return `${tileX}:${tileY}`;
}

/**
 * Parse tile key to coordinates
 */
export function parseTileKey(key: string): { tileX: number; tileY: number } {
  const [x, y] = key.split(':').map(Number);
  return { tileX: x, tileY: y };
}

/**
 * Get tile coordinates from image coordinates
 */
export function getTileCoords(x: number, y: number): { tileX: number; tileY: number } {
  return {
    tileX: Math.floor(x / TILE_SIZE),
    tileY: Math.floor(y / TILE_SIZE)
  };
}

/**
 * Get all tiles that an annotation affects
 */
export function getAffectedTiles(annotation: Annotation, spatialIndex: SpatialIndex): string[] {
  const bbox = spatialIndex.getBoundingBox(annotation.id);
  if (!bbox) {
    // Calculate on the fly if not in index
    return calculateAffectedTiles(annotation);
  }
  return getTilesForBounds(bbox, TILE_SIZE);
}

/**
 * Calculate affected tiles without spatial index
 */
function calculateAffectedTiles(annotation: Annotation): string[] {
  const { type, points, strokeWidth } = annotation;
  const tiles: Set<string> = new Set();

  if (points.length === 0 && type !== 'fill') {
    return [];
  }

  const padding = strokeWidth / 2;

  // Get bounding box
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const p of points) {
    const w = (p.width ?? strokeWidth) / 2 + padding;
    minX = Math.min(minX, p.x - w);
    minY = Math.min(minY, p.y - w);
    maxX = Math.max(maxX, p.x + w);
    maxY = Math.max(maxY, p.y + w);
  }

  // Arrow head extra padding
  if (type === 'arrow') {
    const extraPad = strokeWidth * 3;
    minX -= extraPad;
    minY -= extraPad;
    maxX += extraPad;
    maxY += extraPad;
  }

  // Calculate tile range
  const startTileX = Math.floor(minX / TILE_SIZE);
  const endTileX = Math.floor(maxX / TILE_SIZE);
  const startTileY = Math.floor(minY / TILE_SIZE);
  const endTileY = Math.floor(maxY / TILE_SIZE);

  for (let tx = startTileX; tx <= endTileX; tx++) {
    for (let ty = startTileY; ty <= endTileY; ty++) {
      tiles.add(getTileKey(tx, ty));
    }
  }

  return Array.from(tiles);
}

/**
 * Create or get a tile
 */
function getOrCreateTile(
  state: TileCacheState,
  tileKey: string
): TileData {
  let tile = state.tiles.get(tileKey);

  if (!tile) {
    // Use OffscreenCanvas if available, otherwise HTMLCanvasElement
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
      : document.createElement('canvas');

    if (canvas instanceof HTMLCanvasElement) {
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context for tile');
    }

    tile = {
      canvas,
      ctx: ctx as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
      strokeIds: new Set(),
      version: 0,
      lastAccess: state.accessCounter++
    };

    state.tiles.set(tileKey, tile);

    // LRU eviction if too many tiles
    if (state.tiles.size > MAX_TILES) {
      evictLRUTiles(state, Math.floor(MAX_TILES * 0.1));
    }
  } else {
    tile.lastAccess = state.accessCounter++;
  }

  return tile;
}

/**
 * Evict least recently used tiles
 */
function evictLRUTiles(state: TileCacheState, count: number): void {
  const entries = Array.from(state.tiles.entries());
  entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  for (let i = 0; i < count && i < entries.length; i++) {
    state.tiles.delete(entries[i][0]);
  }
}

/**
 * Mark tiles as dirty based on annotation change
 */
export function markTilesDirty(
  state: TileCacheState,
  annotation: Annotation,
  spatialIndex: SpatialIndex
): void {
  const affectedTiles = getAffectedTiles(annotation, spatialIndex);
  for (const tileKey of affectedTiles) {
    state.dirtyTiles.add(tileKey);
  }
}

/**
 * Mark all tiles as dirty (full invalidation)
 */
export function markAllTilesDirty(state: TileCacheState): void {
  for (const tileKey of state.tiles.keys()) {
    state.dirtyTiles.add(tileKey);
  }
  state.globalVersion++;
}

/**
 * Render a single tile
 */
function renderTile(
  tile: TileData,
  tileX: number,
  tileY: number,
  annotations: Annotation[],
  spatialIndex: SpatialIndex
): void {
  const { ctx } = tile;

  // Clear tile
  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);

  // Get annotations that affect this tile
  const tileMinX = tileX * TILE_SIZE;
  const tileMinY = tileY * TILE_SIZE;
  const tileBounds: BoundingBox = {
    minX: tileMinX,
    minY: tileMinY,
    maxX: tileMinX + TILE_SIZE,
    maxY: tileMinY + TILE_SIZE
  };

  const visibleAnnotations = spatialIndex.queryBounds(tileBounds);

  // Sort by original order (maintain z-index)
  const annotationOrder = new Map(annotations.map((a, i) => [a.id, i]));
  visibleAnnotations.sort((a, b) => {
    const orderA = annotationOrder.get(a.id) ?? 0;
    const orderB = annotationOrder.get(b.id) ?? 0;
    return orderA - orderB;
  });

  // Clear stroke tracking
  tile.strokeIds.clear();

  // Coordinate transform for this tile (image coords -> tile coords)
  const toTileCoords = (point: AnnotationPoint) => ({
    x: point.x - tileMinX,
    y: point.y - tileMinY
  });

  // Render fills first
  for (const annotation of visibleAnnotations) {
    if (annotation.type === 'fill') {
      renderAnnotationToTile(ctx, annotation, toTileCoords, tileMinX, tileMinY);
      tile.strokeIds.add(annotation.id);
    }
  }

  // Render other annotations
  for (const annotation of visibleAnnotations) {
    if (annotation.type !== 'fill') {
      renderAnnotationToTile(ctx, annotation, toTileCoords, tileMinX, tileMinY);
      tile.strokeIds.add(annotation.id);
    }
  }

  tile.version++;
}

/**
 * Render annotation to tile context (in image coordinates, offset by tile origin)
 */
function renderAnnotationToTile(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  annotation: Annotation,
  toTileCoords: (point: AnnotationPoint) => { x: number; y: number },
  tileOriginX: number,
  tileOriginY: number
): void {
  // Use the existing render function with scale=1 (image coordinates)
  renderAnnotationToContext(
    ctx as CanvasRenderingContext2D,
    annotation,
    toTileCoords,
    1, // totalScale = 1 for image coordinates
    -tileOriginX,
    -tileOriginY
  );
}

/**
 * Update dirty tiles
 */
export function updateDirtyTiles(
  state: TileCacheState,
  annotations: Annotation[],
  spatialIndex: SpatialIndex,
  imageWidth: number,
  imageHeight: number
): TileCacheState {
  // Check if image size changed
  if (state.imageWidth !== imageWidth || state.imageHeight !== imageHeight) {
    // Clear all tiles on size change
    state.tiles.clear();
    state.dirtyTiles.clear();
    state.imageWidth = imageWidth;
    state.imageHeight = imageHeight;
    state.globalVersion++;

    // Mark all visible tiles as dirty
    const maxTileX = Math.ceil(imageWidth / TILE_SIZE);
    const maxTileY = Math.ceil(imageHeight / TILE_SIZE);
    for (let tx = 0; tx < maxTileX; tx++) {
      for (let ty = 0; ty < maxTileY; ty++) {
        state.dirtyTiles.add(getTileKey(tx, ty));
      }
    }
  }

  // Render dirty tiles
  for (const tileKey of state.dirtyTiles) {
    const { tileX, tileY } = parseTileKey(tileKey);

    // Skip tiles outside image bounds
    if (tileX < 0 || tileY < 0 ||
        tileX * TILE_SIZE >= imageWidth ||
        tileY * TILE_SIZE >= imageHeight) {
      continue;
    }

    const tile = getOrCreateTile(state, tileKey);
    renderTile(tile, tileX, tileY, annotations, spatialIndex);
  }

  state.dirtyTiles.clear();
  return state;
}

/**
 * Composite tiles to output canvas for a given viewport
 */
export function compositeTilesToCanvas(
  state: TileCacheState,
  targetCanvas: HTMLCanvasElement,
  viewport: Viewport,
  cropArea: CropArea | null | undefined,
  imageWidth: number,
  imageHeight: number
): void {
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return;

  const canvasWidth = targetCanvas.width;
  const canvasHeight = targetCanvas.height;
  const { zoom, offsetX, offsetY, scale } = viewport;
  const totalScale = scale * zoom;

  // Source dimensions (after crop)
  const sourceWidth = cropArea ? cropArea.width : imageWidth;
  const sourceHeight = cropArea ? cropArea.height : imageHeight;
  const cropOffsetX = cropArea ? cropArea.x : 0;
  const cropOffsetY = cropArea ? cropArea.y : 0;

  // Calculate visible area in image coordinates
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  // Calculate which tiles are visible
  const visibleMinX = cropOffsetX + (-offsetX - centerX) / totalScale + sourceWidth / 2;
  const visibleMinY = cropOffsetY + (-offsetY - centerY) / totalScale + sourceHeight / 2;
  const visibleMaxX = cropOffsetX + (canvasWidth - offsetX - centerX) / totalScale + sourceWidth / 2;
  const visibleMaxY = cropOffsetY + (canvasHeight - offsetY - centerY) / totalScale + sourceHeight / 2;

  const startTileX = Math.floor(visibleMinX / TILE_SIZE);
  const endTileX = Math.floor(visibleMaxX / TILE_SIZE);
  const startTileY = Math.floor(visibleMinY / TILE_SIZE);
  const endTileY = Math.floor(visibleMaxY / TILE_SIZE);

  // Clear target
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Draw visible tiles
  for (let tx = startTileX; tx <= endTileX; tx++) {
    for (let ty = startTileY; ty <= endTileY; ty++) {
      const tileKey = getTileKey(tx, ty);
      const tile = state.tiles.get(tileKey);

      if (!tile) continue;

      // Calculate destination position on canvas
      const tileImageX = tx * TILE_SIZE;
      const tileImageY = ty * TILE_SIZE;

      // Convert tile origin to canvas coordinates
      const destX = (tileImageX - cropOffsetX - sourceWidth / 2) * totalScale + centerX + offsetX;
      const destY = (tileImageY - cropOffsetY - sourceHeight / 2) * totalScale + centerY + offsetY;
      const destWidth = TILE_SIZE * totalScale;
      const destHeight = TILE_SIZE * totalScale;

      // Draw tile
      ctx.drawImage(
        tile.canvas as CanvasImageSource,
        destX,
        destY,
        destWidth,
        destHeight
      );
    }
  }
}

/**
 * Handle annotation added
 */
export function onAnnotationAdded(
  state: TileCacheState,
  annotation: Annotation,
  spatialIndex: SpatialIndex
): void {
  markTilesDirty(state, annotation, spatialIndex);
}

/**
 * Handle annotation removed
 */
export function onAnnotationRemoved(
  state: TileCacheState,
  annotation: Annotation,
  spatialIndex: SpatialIndex
): void {
  markTilesDirty(state, annotation, spatialIndex);

  // Remove from tile stroke tracking
  for (const tile of state.tiles.values()) {
    tile.strokeIds.delete(annotation.id);
  }
}

/**
 * Handle eraser stroke - only invalidate affected tiles
 */
export function onEraserStroke(
  state: TileCacheState,
  eraserAnnotation: Annotation,
  spatialIndex: SpatialIndex
): void {
  // Mark tiles affected by eraser as dirty
  markTilesDirty(state, eraserAnnotation, spatialIndex);

  // Also need to re-render tiles that contain strokes the eraser might have affected
  const eraserBounds = spatialIndex.getBoundingBox(eraserAnnotation.id);
  if (eraserBounds) {
    const affectedStrokes = spatialIndex.queryBounds(eraserBounds);
    for (const stroke of affectedStrokes) {
      if (stroke.id !== eraserAnnotation.id) {
        markTilesDirty(state, stroke, spatialIndex);
      }
    }
  }
}

/**
 * Clear all tiles
 */
export function clearTileCache(state: TileCacheState): void {
  state.tiles.clear();
  state.dirtyTiles.clear();
  state.globalVersion++;
}

/**
 * Get cache statistics
 */
export function getTileCacheStats(state: TileCacheState): {
  tileCount: number;
  dirtyCount: number;
  memoryEstimate: number;
} {
  const tileCount = state.tiles.size;
  const dirtyCount = state.dirtyTiles.size;
  // Each tile is TILE_SIZE x TILE_SIZE x 4 bytes (RGBA)
  const memoryEstimate = tileCount * TILE_SIZE * TILE_SIZE * 4;

  return { tileCount, dirtyCount, memoryEstimate };
}
