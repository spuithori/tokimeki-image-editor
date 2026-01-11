/**
 * High-Performance Annotation Renderer
 *
 * Integrates all optimization systems:
 * - Spatial indexing (R-tree)
 * - Tile-based caching
 * - LOD simplification
 * - Double buffering
 * - WASM tessellation (when available)
 *
 * Provides a unified API for annotation rendering with 100,000+ stroke support.
 */

import type { Annotation, AnnotationPoint, Viewport, CropArea } from '../types';
import { SpatialIndex, getSpatialIndex, resetSpatialIndex, BoundingBox } from './spatial-index';
import {
  TileCacheState,
  createTileCacheState,
  markTilesDirty,
  markAllTilesDirty,
  updateDirtyTiles,
  compositeTilesToCanvas,
  onAnnotationAdded,
  onAnnotationRemoved,
  onEraserStroke,
  clearTileCache,
  getTileCacheStats,
  TILE_SIZE
} from './tile-cache';
import { getLODLevel, simplifyForLOD, shouldSimplify, getTessellationQuality } from './lod';
import { initWasm, tessellateVariableStroke, tessellateStroke as tessellateStrokeWasm } from '../wasm/stroke-processor';
import { renderAnnotationToContext } from './annotation-cache';

// ============================================================================
// Double Buffer System
// ============================================================================

interface DoubleBuffer {
  front: HTMLCanvasElement;
  back: HTMLCanvasElement;
  frontCtx: CanvasRenderingContext2D;
  backCtx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

function createDoubleBuffer(width: number, height: number): DoubleBuffer {
  const front = document.createElement('canvas');
  const back = document.createElement('canvas');

  front.width = width;
  front.height = height;
  back.width = width;
  back.height = height;

  const frontCtx = front.getContext('2d')!;
  const backCtx = back.getContext('2d')!;

  return { front, back, frontCtx, backCtx, width, height };
}

function resizeDoubleBuffer(buffer: DoubleBuffer, width: number, height: number): void {
  if (buffer.width === width && buffer.height === height) return;

  buffer.front.width = width;
  buffer.front.height = height;
  buffer.back.width = width;
  buffer.back.height = height;
  buffer.width = width;
  buffer.height = height;
}

function swapBuffers(buffer: DoubleBuffer): void {
  const tempCanvas = buffer.front;
  const tempCtx = buffer.frontCtx;

  buffer.front = buffer.back;
  buffer.frontCtx = buffer.backCtx;
  buffer.back = tempCanvas;
  buffer.backCtx = tempCtx;
}

// ============================================================================
// Annotation Renderer State
// ============================================================================

export interface AnnotationRendererState {
  // Core systems
  spatialIndex: SpatialIndex;
  tileCache: TileCacheState;
  doubleBuffer: DoubleBuffer | null;

  // State tracking
  annotations: Annotation[];
  annotationHash: string;
  lastViewport: Viewport | null;
  lastImageWidth: number;
  lastImageHeight: number;

  // Current stroke (being drawn)
  currentStroke: Annotation | null;

  // Flags
  isInitialized: boolean;
  wasmAvailable: boolean;
  needsFullRedraw: boolean;

  // Performance stats
  lastFrameTime: number;
  frameCount: number;
  avgFrameTime: number;
}

let rendererState: AnnotationRendererState | null = null;

/**
 * Initialize the annotation renderer
 */
export async function initAnnotationRenderer(): Promise<AnnotationRendererState> {
  // Try to initialize WASM
  const wasmAvailable = await initWasm();

  const state: AnnotationRendererState = {
    spatialIndex: getSpatialIndex(),
    tileCache: createTileCacheState(),
    doubleBuffer: null,

    annotations: [],
    annotationHash: '',
    lastViewport: null,
    lastImageWidth: 0,
    lastImageHeight: 0,

    currentStroke: null,

    isInitialized: true,
    wasmAvailable,
    needsFullRedraw: true,

    lastFrameTime: 0,
    frameCount: 0,
    avgFrameTime: 0
  };

  rendererState = state;
  return state;
}

/**
 * Get the current renderer state (initialize if needed)
 */
export async function getRendererState(): Promise<AnnotationRendererState> {
  if (!rendererState || !rendererState.isInitialized) {
    return initAnnotationRenderer();
  }
  return rendererState;
}

/**
 * Reset the renderer state
 */
export function resetAnnotationRenderer(): void {
  if (rendererState) {
    clearTileCache(rendererState.tileCache);
    resetSpatialIndex();
    rendererState = null;
  }
}

/**
 * Generate hash for annotation array
 */
function hashAnnotations(annotations: Annotation[]): string {
  return annotations.map(a => `${a.id}:${a.type}:${a.points.length}`).join('|');
}

/**
 * Sync annotations with the spatial index
 */
export function syncAnnotations(
  state: AnnotationRendererState,
  annotations: Annotation[]
): void {
  const newHash = hashAnnotations(annotations);

  if (newHash === state.annotationHash) {
    return; // No change
  }

  // Find changes
  const currentIds = new Set(state.annotations.map(a => a.id));
  const newIds = new Set(annotations.map(a => a.id));

  // Handle removals
  for (const oldAnnotation of state.annotations) {
    if (!newIds.has(oldAnnotation.id)) {
      state.spatialIndex.remove(oldAnnotation.id);
      onAnnotationRemoved(state.tileCache, oldAnnotation, state.spatialIndex);
    }
  }

  // Handle additions and updates
  for (const newAnnotation of annotations) {
    const existing = state.spatialIndex.get(newAnnotation.id);

    if (!existing) {
      // New annotation
      state.spatialIndex.insert(newAnnotation);
      onAnnotationAdded(state.tileCache, newAnnotation, state.spatialIndex);
    } else if (existing.points.length !== newAnnotation.points.length) {
      // Updated annotation
      state.spatialIndex.update(newAnnotation);
      markTilesDirty(state.tileCache, newAnnotation, state.spatialIndex);
    }
  }

  // Handle eraser strokes specially
  const eraserStrokes = annotations.filter(
    a => a.type === 'eraser-stroke' && !currentIds.has(a.id)
  );
  for (const eraser of eraserStrokes) {
    onEraserStroke(state.tileCache, eraser, state.spatialIndex);
  }

  state.annotations = annotations;
  state.annotationHash = newHash;
}

/**
 * Set the current stroke being drawn
 */
export function setCurrentStroke(
  state: AnnotationRendererState,
  stroke: Annotation | null
): void {
  state.currentStroke = stroke;
}

/**
 * Render annotations to the target canvas
 */
export function renderAnnotations(
  state: AnnotationRendererState,
  targetCanvas: HTMLCanvasElement,
  annotations: Annotation[],
  image: HTMLImageElement,
  viewport: Viewport,
  cropArea: CropArea | null | undefined,
  currentStroke: Annotation | null
): void {
  const startTime = performance.now();

  const width = targetCanvas.width;
  const height = targetCanvas.height;
  const imageWidth = cropArea ? cropArea.width : image.width;
  const imageHeight = cropArea ? cropArea.height : image.height;

  // Ensure double buffer exists
  if (!state.doubleBuffer) {
    state.doubleBuffer = createDoubleBuffer(width, height);
  } else {
    resizeDoubleBuffer(state.doubleBuffer, width, height);
  }

  // Sync annotations
  syncAnnotations(state, annotations);

  // Update tile cache
  updateDirtyTiles(state.tileCache, annotations, state.spatialIndex, imageWidth, imageHeight);

  // Render to back buffer
  const ctx = state.doubleBuffer.backCtx;
  ctx.clearRect(0, 0, width, height);

  // Get visible annotations using spatial index
  const visibleAnnotations = state.spatialIndex.queryViewport(
    viewport,
    width,
    height,
    cropArea
  );

  // Sort by original order
  const annotationOrder = new Map(annotations.map((a, i) => [a.id, i]));
  visibleAnnotations.sort((a, b) => {
    const orderA = annotationOrder.get(a.id) ?? 0;
    const orderB = annotationOrder.get(b.id) ?? 0;
    return orderA - orderB;
  });

  // Calculate transform
  const totalScale = viewport.scale * viewport.zoom;
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

  // Apply LOD simplification for rendering
  const lod = getLODLevel(viewport.zoom);

  // Render fills first
  for (const annotation of visibleAnnotations) {
    if (annotation.type === 'fill') {
      renderAnnotationToContext(ctx, annotation, toCanvasCoords, totalScale, originX, originY);
    }
  }

  // Render other annotations with LOD
  for (const annotation of visibleAnnotations) {
    if (annotation.type !== 'fill') {
      // Apply LOD simplification if needed
      let renderAnnotation = annotation;

      if (shouldSimplify(viewport.zoom, annotation.points.length) &&
          (annotation.type === 'pen' || annotation.type === 'brush')) {
        const simplifiedPoints = simplifyForLOD(annotation.points, viewport.zoom);
        renderAnnotation = { ...annotation, points: simplifiedPoints };
      }

      renderAnnotationToContext(ctx, renderAnnotation, toCanvasCoords, totalScale, originX, originY);
    }
  }

  // Render current stroke on top
  if (currentStroke && currentStroke.points.length > 0) {
    renderAnnotationToContext(ctx, currentStroke, toCanvasCoords, totalScale, originX, originY);
  }

  // Swap buffers
  swapBuffers(state.doubleBuffer);

  // Copy front buffer to target
  const targetCtx = targetCanvas.getContext('2d');
  if (targetCtx) {
    targetCtx.clearRect(0, 0, width, height);
    targetCtx.drawImage(state.doubleBuffer.front, 0, 0);
  }

  // Update stats
  const frameTime = performance.now() - startTime;
  state.lastFrameTime = frameTime;
  state.frameCount++;
  state.avgFrameTime = (state.avgFrameTime * (state.frameCount - 1) + frameTime) / state.frameCount;

  // Store viewport
  state.lastViewport = { ...viewport };
  state.lastImageWidth = imageWidth;
  state.lastImageHeight = imageHeight;
}

/**
 * Optimized render when only viewport changed (pan/zoom)
 * Reuses cached tiles without re-rendering
 */
export function renderViewportChange(
  state: AnnotationRendererState,
  targetCanvas: HTMLCanvasElement,
  viewport: Viewport,
  cropArea: CropArea | null | undefined
): void {
  if (!state.doubleBuffer) return;

  const width = targetCanvas.width;
  const height = targetCanvas.height;

  // Use tile compositing for viewport-only changes
  compositeTilesToCanvas(
    state.tileCache,
    state.doubleBuffer.back,
    viewport,
    cropArea,
    state.lastImageWidth,
    state.lastImageHeight
  );

  // Swap and copy
  swapBuffers(state.doubleBuffer);

  const targetCtx = targetCanvas.getContext('2d');
  if (targetCtx) {
    targetCtx.clearRect(0, 0, width, height);
    targetCtx.drawImage(state.doubleBuffer.front, 0, 0);
  }
}

/**
 * Get performance statistics
 */
export function getRendererStats(state: AnnotationRendererState): {
  visibleAnnotations: number;
  totalAnnotations: number;
  tileCount: number;
  dirtyTiles: number;
  avgFrameTime: number;
  wasmAvailable: boolean;
  memoryEstimate: number;
} {
  const tileStats = getTileCacheStats(state.tileCache);

  return {
    visibleAnnotations: state.spatialIndex.size,
    totalAnnotations: state.annotations.length,
    tileCount: tileStats.tileCount,
    dirtyTiles: tileStats.dirtyCount,
    avgFrameTime: state.avgFrameTime,
    wasmAvailable: state.wasmAvailable,
    memoryEstimate: tileStats.memoryEstimate
  };
}

/**
 * Force full redraw
 */
export function invalidateRenderer(state: AnnotationRendererState): void {
  markAllTilesDirty(state.tileCache);
  state.needsFullRedraw = true;
}

/**
 * Check if annotation is visible in current viewport
 */
export function isAnnotationVisible(
  state: AnnotationRendererState,
  annotationId: string,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  cropArea?: CropArea | null
): boolean {
  const visibleAnnotations = state.spatialIndex.queryViewport(
    viewport,
    canvasWidth,
    canvasHeight,
    cropArea
  );

  return visibleAnnotations.some(a => a.id === annotationId);
}

/**
 * Get annotations at a specific point (for eraser, selection, etc.)
 */
export function getAnnotationsAtPoint(
  state: AnnotationRendererState,
  x: number,
  y: number,
  radius: number = 5
): Annotation[] {
  return state.spatialIndex.queryPoint(x, y, radius);
}
