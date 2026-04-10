/**
 * Annotation Cache Manager
 *
 * Provides efficient caching for annotation rendering to maintain high FPS
 * even with many annotations, fill operations, and eraser strokes.
 *
 * Architecture:
 * - committedCanvas: Pre-rendered cache of all finalized annotations (sized to fit full scaled image)
 * - currentStroke: Only the in-progress stroke (rendered on top in real-time)
 * - Incremental updates: New strokes are added to cache without full rebuild
 * - Cache invalidation: Only zoom changes, eraser strokes and deletions trigger full rebuild
 * - Pan optimization: Cache is translated without re-rendering
 * - LOD system: Point reduction at low zoom levels (LRU cached)
 * - Spatial indexing utilities: Available for future viewport culling optimization
 */

import type { Annotation, AnnotationPoint, Viewport, CropArea } from '../types';
import { getOrCreateFillCanvas } from './canvas';
import { getSpatialIndex } from './spatial-index';
import { simplifyPath } from '../wasm/stroke-processor';
import { getLODLevel } from './lod';

export interface AnnotationCacheState {
  // The cached canvas containing all committed annotations
  committedCanvas: HTMLCanvasElement | null;
  // Hash of committed annotations to detect changes
  committedHash: string;
  // Number of annotations in the cache
  committedCount: number;
  // Whether the cache needs full rebuild
  isDirty: boolean;
  // Last known canvas dimensions
  width: number;
  height: number;
  // Spatial index sync version
  spatialIndexVersion: number;
  // Viewport state when cache was created
  cachedZoom: number;
  cachedScale: number;
  // Crop area state
  cachedCropHash: string;
  // Cache canvas dimensions (may be larger than display canvas)
  cacheWidth: number;
  cacheHeight: number;
  // Offset from cache origin to display canvas origin
  cacheOriginX: number;
  cacheOriginY: number;
}

export function createAnnotationCacheState(): AnnotationCacheState {
  return {
    committedCanvas: null,
    committedHash: '',
    committedCount: 0,
    isDirty: true,
    width: 0,
    height: 0,
    spatialIndexVersion: 0,
    cachedZoom: 1,
    cachedScale: 1,
    cachedCropHash: '',
    cacheWidth: 0,
    cacheHeight: 0,
    cacheOriginX: 0,
    cacheOriginY: 0
  };
}

/**
 * Generate crop area hash for cache invalidation
 */
function hashCropArea(cropArea: CropArea | null | undefined): string {
  if (!cropArea) return 'none';
  return `${cropArea.x}:${cropArea.y}:${cropArea.width}:${cropArea.height}`;
}

/**
 * Sync spatial index with annotations array
 * Returns the new version number
 */
export function syncSpatialIndex(annotations: Annotation[]): number {
  const index = getSpatialIndex();
  index.sync(annotations);
  return annotations.length;
}

/**
 * Get visible annotations using spatial index (viewport culling)
 * Falls back to all annotations if spatial index is empty
 */
export function getVisibleAnnotations(
  annotations: Annotation[],
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  cropArea?: CropArea | null
): Annotation[] {
  const index = getSpatialIndex();

  // Sync index if needed
  if (index.size !== annotations.length) {
    index.sync(annotations);
  }

  // Query visible annotations
  const visible = index.queryViewport(viewport, canvasWidth, canvasHeight, cropArea);

  // Maintain original order (important for z-ordering)
  const visibleIds = new Set(visible.map(a => a.id));
  return annotations.filter(a => visibleIds.has(a.id));
}

/**
 * Generate a simple hash for annotations to detect changes
 */
function hashAnnotations(annotations: Annotation[]): string {
  return annotations.map(a => `${a.id}:${a.type}:${a.points.length}`).join('|');
}

/**
 * Check if cache needs rebuild
 * Note: Offset (pan) changes do NOT require rebuild - we translate the cached canvas instead
 */
export function needsCacheRebuild(
  state: AnnotationCacheState,
  annotations: Annotation[],
  width: number,
  height: number,
  viewport?: Viewport,
  cropArea?: CropArea | null
): boolean {
  if (state.isDirty) return true;
  if (!state.committedCanvas) return true;
  if (state.width !== width || state.height !== height) return true;

  // Check zoom/scale changes (requires full rebuild)
  if (viewport) {
    if (state.cachedZoom !== viewport.zoom || state.cachedScale !== viewport.scale) {
      return true;
    }
  }

  // Check crop area changes
  const currentCropHash = hashCropArea(cropArea);
  if (state.cachedCropHash !== currentCropHash) {
    return true;
  }

  const currentHash = hashAnnotations(annotations);
  if (state.committedHash !== currentHash) {
    // Check if it's just an addition (can do incremental update)
    if (annotations.length > state.committedCount) {
      const addedAnnotations = annotations.slice(state.committedCount);
      // If any added annotation is an eraser stroke, need full rebuild
      if (addedAnnotations.some(a => a.type === 'eraser-stroke')) {
        return true;
      }
      // Otherwise can do incremental update
      return false;
    }
    // Deletion or modification - need full rebuild
    return true;
  }

  return false;
}

/**
 * Check if we can do incremental update (just add new annotations to cache)
 */
export function canDoIncrementalUpdate(
  state: AnnotationCacheState,
  annotations: Annotation[]
): boolean {
  if (!state.committedCanvas || state.isDirty) return false;
  if (annotations.length <= state.committedCount) return false;

  const addedAnnotations = annotations.slice(state.committedCount);
  // Can't do incremental if any new annotation is eraser
  return !addedAnnotations.some(a => a.type === 'eraser-stroke');
}

// LRU Cache for LOD-simplified points
// Map preserves insertion order, so we can implement LRU by:
// - Moving accessed entries to end (delete + re-insert)
// - Pruning from beginning (oldest entries)
const lodCache = new Map<string, AnnotationPoint[]>();
const LOD_CACHE_MAX_SIZE = 500;
const LOD_CACHE_PRUNE_COUNT = 100;

/**
 * Clear LOD cache (call when annotations are modified)
 */
export function clearLodCache(): void {
  lodCache.clear();
}

/**
 * Get from LRU cache with access tracking
 */
function lodCacheGet(key: string): AnnotationPoint[] | undefined {
  const value = lodCache.get(key);
  if (value !== undefined) {
    // Move to end (most recently used)
    lodCache.delete(key);
    lodCache.set(key, value);
  }
  return value;
}

/**
 * Set in LRU cache with size limit enforcement
 */
function lodCacheSet(key: string, value: AnnotationPoint[]): void {
  // If key exists, delete first to update position
  if (lodCache.has(key)) {
    lodCache.delete(key);
  }
  lodCache.set(key, value);

  // Prune oldest entries if over limit
  if (lodCache.size > LOD_CACHE_MAX_SIZE) {
    const keysToDelete = Array.from(lodCache.keys()).slice(0, LOD_CACHE_PRUNE_COUNT);
    for (const k of keysToDelete) {
      lodCache.delete(k);
    }
  }
}

/**
 * Apply LOD simplification to annotation points for rendering
 * Results are cached per annotation/tolerance/pointCount combination
 */
function applyLODToPoints(points: AnnotationPoint[], zoom: number, annotationId?: string): AnnotationPoint[] {
  if (points.length < 2) return points;

  const lod = getLODLevel(zoom);
  const tolerance = lod.simplifyTolerance;

  // Use LRU cache if annotationId provided
  if (annotationId) {
    const cacheKey = `${annotationId}:${tolerance}:${points.length}`;
    const cached = lodCacheGet(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    const simplified = simplifyPath(points, tolerance);
    lodCacheSet(cacheKey, simplified);
    return simplified;
  }

  return simplifyPath(points, tolerance);
}

/**
 * Render a single annotation to a canvas context
 * Supports LOD-based point simplification for performance at low zoom levels
 */
export function renderAnnotationToContext(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number,
  originX: number,
  originY: number,
  zoom: number = 1
): void {
  if (annotation.points.length === 0 && annotation.type !== 'fill') return;

  ctx.save();

  // Apply shadow if enabled
  if (annotation.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }

  if (annotation.type === 'fill') {
    const fillCanvas = getOrCreateFillCanvas(annotation);
    if (fillCanvas) {
      ctx.drawImage(
        fillCanvas,
        originX,
        originY,
        fillCanvas.width * totalScale,
        fillCanvas.height * totalScale
      );
    }
  } else if (annotation.type === 'pen') {
    // Apply LOD to reduce points at low zoom levels (cached per annotation)
    const lodPoints = applyLODToPoints(annotation.points, zoom, annotation.id);
    const points = lodPoints.map(toCanvasCoords);
    ctx.strokeStyle = annotation.color;
    ctx.lineWidth = annotation.strokeWidth * totalScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      ctx.fillStyle = annotation.color;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, annotation.strokeWidth * totalScale / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();
    }
  } else if (annotation.type === 'brush') {
    renderBrushAnnotation(ctx, annotation, toCanvasCoords, totalScale, zoom);
  } else if (annotation.type === 'arrow') {
    renderArrowAnnotation(ctx, annotation, toCanvasCoords, totalScale);
  } else if (annotation.type === 'rectangle') {
    renderRectangleAnnotation(ctx, annotation, toCanvasCoords, totalScale);
  } else if (annotation.type === 'text' && annotation.text) {
    const point = toCanvasCoords(annotation.points[0]);
    const scaledFontSize = (annotation.fontSize ?? 48) * totalScale;
    ctx.fillStyle = annotation.color;
    ctx.font = `bold ${scaledFontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(annotation.text, point.x, point.y);
  } else if (annotation.type === 'eraser-stroke') {
    renderEraserStroke(ctx, annotation, toCanvasCoords, totalScale);
  }

  ctx.restore();
}

function renderBrushAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number,
  zoom: number = 1
): void {
  // Don't apply LOD to brush strokes - the width variation at each point
  // is crucial for the calligraphy aesthetic. Brush strokes typically have
  // fewer points anyway due to the minimum distance threshold.
  const rawPoints = annotation.points.map(p => ({
    ...toCanvasCoords(p),
    width: p.width ?? annotation.strokeWidth
  }));
  ctx.fillStyle = annotation.color;

  if (rawPoints.length === 1) {
    const p = rawPoints[0];
    const width = (p.width * totalScale) / 2;
    const rx = width * 0.8;
    const ry = width * 1.2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
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
  } else {
    // 3+ points - interpolate for smooth outline
    const interpolated = interpolatePoints(rawPoints);
    const { leftSide, rightSide } = generateOutline(interpolated, totalScale);

    if (leftSide.length >= 2) {
      renderBrushPath(ctx, leftSide, rightSide, interpolated, totalScale);
    }
  }
}

function interpolatePoints(rawPoints: { x: number; y: number; width: number }[]): { x: number; y: number; width: number }[] {
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
  return interpolated;
}

function generateOutline(
  interpolated: { x: number; y: number; width: number }[],
  totalScale: number
): { leftSide: { x: number; y: number }[]; rightSide: { x: number; y: number }[] } {
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

  // Smooth the outline
  leftSide = smoothOutline(leftSide);
  rightSide = smoothOutline(rightSide);

  return { leftSide, rightSide };
}

function smoothOutline(pts: { x: number; y: number }[], windowSize: number = 5): { x: number; y: number }[] {
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
}

function renderBrushPath(
  ctx: CanvasRenderingContext2D,
  leftSide: { x: number; y: number }[],
  rightSide: { x: number; y: number }[],
  interpolated: { x: number; y: number; width: number }[],
  totalScale: number
): void {
  ctx.beginPath();
  ctx.moveTo(leftSide[0].x, leftSide[0].y);

  // Left side
  for (let i = 1; i < leftSide.length - 1; i++) {
    const curr = leftSide[i];
    const next = leftSide[i + 1];
    const endX = (curr.x + next.x) / 2;
    const endY = (curr.y + next.y) / 2;
    ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
  }
  ctx.lineTo(leftSide[leftSide.length - 1].x, leftSide[leftSide.length - 1].y);

  // End cap
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

  // Right side backward
  for (let i = rightSide.length - 2; i > 0; i--) {
    const curr = rightSide[i];
    const prev = rightSide[i - 1];
    const endX = (curr.x + prev.x) / 2;
    const endY = (curr.y + prev.y) / 2;
    ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
  }
  ctx.lineTo(rightSide[0].x, rightSide[0].y);

  // Start cap
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

function renderArrowAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length < 2) return;

  const start = toCanvasCoords(annotation.points[0]);
  const end = toCanvasCoords(annotation.points[1]);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const scaledStroke = annotation.strokeWidth * totalScale;
  const headLength = scaledStroke * 3;
  const headWidth = scaledStroke * 2;
  const lineEndX = end.x - headLength * 0.7 * Math.cos(angle);
  const lineEndY = end.y - headLength * 0.7 * Math.sin(angle);

  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = scaledStroke;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(lineEndX, lineEndY);
  ctx.stroke();

  ctx.fillStyle = annotation.color;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - headLength * Math.cos(angle) + headWidth * Math.sin(angle),
             end.y - headLength * Math.sin(angle) - headWidth * Math.cos(angle));
  ctx.lineTo(end.x - headLength * Math.cos(angle) - headWidth * Math.sin(angle),
             end.y - headLength * Math.sin(angle) + headWidth * Math.cos(angle));
  ctx.closePath();
  ctx.fill();
}

function renderRectangleAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length < 2) return;

  const p0 = toCanvasCoords(annotation.points[0]);
  const p1 = toCanvasCoords(annotation.points[1]);
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);
  const cornerRadius = annotation.strokeWidth * totalScale * 1.5;

  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = annotation.strokeWidth * totalScale;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cornerRadius);
  ctx.stroke();
}

function renderEraserStroke(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  const points = annotation.points.map(toCanvasCoords);
  ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.lineWidth = annotation.strokeWidth * totalScale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, annotation.strokeWidth * totalScale / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Build or update the committed canvas cache
 * Uses spatial indexing for viewport culling and LOD for point reduction
 * Cache is sized to fit the entire scaled image to prevent edge clipping
 */
export function updateAnnotationCache(
  state: AnnotationCacheState,
  annotations: Annotation[],
  width: number,
  height: number,
  image: HTMLImageElement,
  viewport: Viewport,
  cropArea: CropArea | null | undefined
): AnnotationCacheState {
  const needsRebuild = needsCacheRebuild(state, annotations, width, height, viewport, cropArea);
  const canIncremental = canDoIncrementalUpdate(state, annotations);

  // If no rebuild needed and no incremental update, return current state
  if (!needsRebuild && !canIncremental) {
    return state;
  }

  // Calculate transform parameters
  const totalScale = viewport.scale * viewport.zoom;
  const zoom = viewport.zoom;
  const sourceWidth = cropArea ? cropArea.width : image.width;
  const sourceHeight = cropArea ? cropArea.height : image.height;
  const cropOffsetX = cropArea ? cropArea.x : 0;
  const cropOffsetY = cropArea ? cropArea.y : 0;

  // Calculate cache canvas size to fit the entire scaled image
  // This ensures annotations at edges aren't clipped
  const scaledImageWidth = sourceWidth * totalScale;
  const scaledImageHeight = sourceHeight * totalScale;
  const cacheWidth = Math.max(width, Math.ceil(scaledImageWidth));
  const cacheHeight = Math.max(height, Math.ceil(scaledImageHeight));

  // Cache origin is at the center of the cache canvas
  const cacheCenterX = cacheWidth / 2;
  const cacheCenterY = cacheHeight / 2;

  // Origin offset: how much to translate the cache when compositing to the display
  const cacheOriginX = (cacheWidth - width) / 2;
  const cacheOriginY = (cacheHeight - height) / 2;

  // Render annotations centered in the cache
  const toCanvasCoords = (point: AnnotationPoint) => ({
    x: (point.x - cropOffsetX - sourceWidth / 2) * totalScale + cacheCenterX,
    y: (point.y - cropOffsetY - sourceHeight / 2) * totalScale + cacheCenterY
  });

  const originX = (0 - cropOffsetX - sourceWidth / 2) * totalScale + cacheCenterX;
  const originY = (0 - cropOffsetY - sourceHeight / 2) * totalScale + cacheCenterY;

  // Reuse existing canvas if possible, resize if needed
  let committedCanvas = state.committedCanvas;
  if (!committedCanvas) {
    committedCanvas = document.createElement('canvas');
  }

  // Resize canvas if dimensions changed (this also clears the canvas)
  if (committedCanvas.width !== cacheWidth || committedCanvas.height !== cacheHeight) {
    committedCanvas.width = cacheWidth;
    committedCanvas.height = cacheHeight;
  }

  const ctx = committedCanvas.getContext('2d');
  if (!ctx) return state;

  // Render all annotations to cache (no viewport culling for cache)
  // Cache is rendered at offset 0 and translated during compositing,
  // so we need all annotations, not just currently visible ones.
  // LOD simplification keeps this fast even for 1000+ annotations.
  const allAnnotations = annotations;

  if (needsRebuild && !canIncremental) {
    // Full rebuild
    ctx.clearRect(0, 0, cacheWidth, cacheHeight);

    // Render fills first
    for (const annotation of allAnnotations) {
      if (annotation.type === 'fill') {
        renderAnnotationToContext(ctx, annotation, toCanvasCoords, totalScale, originX, originY, zoom);
      }
    }

    // Render other annotations
    for (const annotation of allAnnotations) {
      if (annotation.type !== 'fill') {
        renderAnnotationToContext(ctx, annotation, toCanvasCoords, totalScale, originX, originY, zoom);
      }
    }
  } else if (canIncremental) {
    // Incremental update - only add new annotations
    const newAnnotations = annotations.slice(state.committedCount);

    // Render fills first among new annotations
    for (const annotation of newAnnotations) {
      if (annotation.type === 'fill') {
        renderAnnotationToContext(ctx, annotation, toCanvasCoords, totalScale, originX, originY, zoom);
      }
    }

    // Render other new annotations
    for (const annotation of newAnnotations) {
      if (annotation.type !== 'fill') {
        renderAnnotationToContext(ctx, annotation, toCanvasCoords, totalScale, originX, originY, zoom);
      }
    }
  }

  return {
    committedCanvas,
    committedHash: hashAnnotations(annotations),
    committedCount: annotations.length,
    isDirty: false,
    width,
    height,
    spatialIndexVersion: annotations.length,
    cachedZoom: viewport.zoom,
    cachedScale: viewport.scale,
    cachedCropHash: hashCropArea(cropArea),
    cacheWidth,
    cacheHeight,
    cacheOriginX,
    cacheOriginY
  };
}

/**
 * Render the final composited view (cache + current stroke)
 * Cache may be larger than display canvas to accommodate zoomed content
 */
export function renderAnnotationsWithCache(
  targetCanvas: HTMLCanvasElement,
  cacheState: AnnotationCacheState,
  currentStroke: Annotation | null,
  image: HTMLImageElement,
  viewport: Viewport,
  cropArea: CropArea | null | undefined
): void {
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return;

  const width = targetCanvas.width;
  const height = targetCanvas.height;

  // Clear target
  ctx.clearRect(0, 0, width, height);

  // Draw cached annotations
  // Cache is larger than display and centered, so we need to calculate
  // which part of the cache to draw based on viewport offset
  if (cacheState.committedCanvas && cacheState.cacheWidth > 0) {
    // Source coordinates in the cache canvas
    // Cache center corresponds to display center at offset 0
    const srcX = cacheState.cacheOriginX - viewport.offsetX;
    const srcY = cacheState.cacheOriginY - viewport.offsetY;

    ctx.drawImage(
      cacheState.committedCanvas,
      srcX, srcY, width, height,  // Source rectangle
      0, 0, width, height          // Destination rectangle
    );
  }

  // Draw current stroke on top
  if (currentStroke && currentStroke.points.length > 0) {
    const totalScale = viewport.scale * viewport.zoom;
    const zoom = viewport.zoom;
    const centerX = width / 2;
    const centerY = height / 2;
    const sourceWidth = cropArea ? cropArea.width : image.width;
    const sourceHeight = cropArea ? cropArea.height : image.height;
    const cropOffsetX = cropArea ? cropArea.x : 0;
    const cropOffsetY = cropArea ? cropArea.y : 0;

    const toCanvasCoords = (point: AnnotationPoint) => ({
      x: (point.x - cropOffsetX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX,
      y: (point.y - cropOffsetY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY
    });

    const originX = (0 - cropOffsetX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX;
    const originY = (0 - cropOffsetY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY;

    // Current stroke doesn't need LOD (always render at full detail for responsiveness)
    renderAnnotationToContext(ctx, currentStroke, toCanvasCoords, totalScale, originX, originY, zoom);
  }
}

/**
 * Invalidate the cache (force full rebuild on next update)
 */
export function invalidateCache(state: AnnotationCacheState): AnnotationCacheState {
  return { ...state, isDirty: true };
}
