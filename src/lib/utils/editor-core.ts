/**
 * Core editor logic shared between ImageEditor and QuickDrawEditor.
 * Contains all state management, handlers, and utility functions.
 */

import type {
  EditorMode,
  EditorState,
  CropArea,
  TransformState,
  Viewport,
  AdjustmentsState,
  BlurArea,
  StampArea,
  Annotation,
  ExportOptions
} from '../types';
import { loadImage, calculateFitScale, downloadImage, applyTransformWithWebGPU } from './canvas';
import { createEmptyHistory, createSnapshot, addToHistory, undo, redo, canUndo as checkCanUndo, canRedo as checkCanRedo, type EditorHistory, type EditorSnapshot } from './history';
import { createDefaultAdjustments } from './adjustments';
import { createViewport, updateViewport } from './viewport';
import { calculateZoomViewport } from './editor-interaction';

// ============================================================================
// STATE CREATION
// ============================================================================

/**
 * Create initial editor state
 */
export function createEditorState(): EditorState {
  return {
    mode: null,
    imageData: {
      original: null,
      current: null,
      width: 0,
      height: 0
    },
    cropArea: null,
    transform: createDefaultTransform(),
    adjustments: createDefaultAdjustments(),
    exportOptions: createDefaultExportOptions(),
    viewport: createViewport(1),
    history: createEmptyHistory(),
    blurAreas: [],
    stampAreas: [],
    annotations: []
  };
}

/**
 * Create default transform state
 */
export function createDefaultTransform(): TransformState {
  return {
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    scale: 1
  };
}

/**
 * Create default export options
 */
export function createDefaultExportOptions(): ExportOptions {
  return {
    format: 'png',
    quality: 0.9
  };
}

// ============================================================================
// IMAGE LOADING
// ============================================================================

export interface ImageLoadResult {
  image: HTMLImageElement;
  width: number;
  height: number;
  fitScale: number;
}

/**
 * Load image from File object
 */
export async function loadImageFromFile(
  file: File,
  canvasWidth: number,
  canvasHeight: number
): Promise<ImageLoadResult> {
  const img = await loadImage(file);
  const fitScale = calculateFitScale(img.width, img.height, canvasWidth, canvasHeight);
  return {
    image: img,
    width: img.width,
    height: img.height,
    fitScale
  };
}

/**
 * Load image from URL or Data URL
 */
export async function loadImageFromUrl(
  url: string,
  canvasWidth: number,
  canvasHeight: number
): Promise<ImageLoadResult> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
  });
  const fitScale = calculateFitScale(img.width, img.height, canvasWidth, canvasHeight);
  return {
    image: img,
    width: img.width,
    height: img.height,
    fitScale
  };
}

/**
 * Create a blank white image
 */
export async function createBlankImage(
  width: number,
  height: number
): Promise<ImageLoadResult> {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const ctx = tempCanvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
  }
  const img = new Image();
  img.src = tempCanvas.toDataURL();
  await new Promise<void>(resolve => { img.onload = () => resolve(); });
  return {
    image: img,
    width,
    height,
    fitScale: 1
  };
}

/**
 * Apply loaded image to state (returns partial state update)
 */
export function applyImageToState(
  result: ImageLoadResult,
  initialMode?: EditorMode | null
): Partial<EditorState> {
  return {
    imageData: {
      original: result.image,
      current: result.image,
      width: result.width,
      height: result.height
    },
    cropArea: null,
    transform: createDefaultTransform(),
    viewport: createViewport(result.fitScale),
    blurAreas: [],
    stampAreas: [],
    annotations: [],
    history: createEmptyHistory(),
    mode: initialMode ?? null
  };
}

// ============================================================================
// STATE UPDATES
// ============================================================================

/**
 * Update mode
 */
export function setMode(state: EditorState, mode: EditorMode): EditorState {
  return { ...state, mode };
}

/**
 * Apply crop and calculate new viewport
 */
export function applyCrop(
  state: EditorState,
  cropArea: CropArea,
  canvasWidth: number,
  canvasHeight: number
): EditorState {
  const fitScale = calculateFitScale(cropArea.width, cropArea.height, canvasWidth, canvasHeight);
  return {
    ...state,
    cropArea,
    mode: null,
    viewport: {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      scale: fitScale
    }
  };
}

/**
 * Update transform
 */
export function applyTransformUpdate(
  state: EditorState,
  transform: Partial<TransformState>
): EditorState {
  return {
    ...state,
    transform: { ...state.transform, ...transform }
  };
}

/**
 * Update adjustments
 */
export function applyAdjustmentsUpdate(
  state: EditorState,
  adjustments: Partial<AdjustmentsState>
): EditorState {
  return {
    ...state,
    adjustments: { ...state.adjustments, ...adjustments }
  };
}

/**
 * Apply filter (replace all adjustments)
 */
export function applyFilter(
  state: EditorState,
  adjustments: AdjustmentsState
): EditorState {
  return { ...state, adjustments };
}

/**
 * Update blur areas
 */
export function setBlurAreas(state: EditorState, blurAreas: BlurArea[]): EditorState {
  return { ...state, blurAreas };
}

/**
 * Update stamp areas
 */
export function setStampAreas(state: EditorState, stampAreas: StampArea[]): EditorState {
  return { ...state, stampAreas };
}

/**
 * Update annotations
 */
export function setAnnotations(state: EditorState, annotations: Annotation[]): EditorState {
  return { ...state, annotations };
}

/**
 * Update viewport
 */
export function setViewport(state: EditorState, viewportUpdate: Partial<Viewport>): EditorState {
  return {
    ...state,
    viewport: updateViewport(state.viewport, viewportUpdate)
  };
}

/**
 * Update export options
 */
export function setExportOptions(state: EditorState, options: Partial<ExportOptions>): EditorState {
  return {
    ...state,
    exportOptions: { ...state.exportOptions, ...options }
  };
}

/**
 * Reset state to initial (preserve image)
 */
export function resetState(state: EditorState, canvasWidth: number, canvasHeight: number): EditorState {
  if (!state.imageData.original) return state;

  const fitScale = calculateFitScale(
    state.imageData.original.width,
    state.imageData.original.height,
    canvasWidth,
    canvasHeight
  );

  return {
    ...state,
    cropArea: null,
    transform: createDefaultTransform(),
    viewport: createViewport(fitScale)
  };
}

// ============================================================================
// ZOOM HANDLING
// ============================================================================

/**
 * Handle zoom from wheel event or programmatic call
 */
export function handleZoom(
  state: EditorState,
  delta: number,
  canvasWidth: number,
  canvasHeight: number,
  centerX?: number,
  centerY?: number,
  canvasRect?: DOMRect
): EditorState {
  const newViewport = calculateZoomViewport(
    state.viewport,
    delta,
    canvasWidth,
    canvasHeight,
    centerX,
    centerY,
    canvasRect
  );
  return { ...state, viewport: newViewport };
}

// ============================================================================
// HISTORY MANAGEMENT
// ============================================================================

/**
 * Save current state to history
 */
export function saveToHistory(state: EditorState): EditorState {
  const snapshot = createSnapshot(
    state.cropArea,
    state.transform,
    state.adjustments,
    state.viewport,
    state.blurAreas,
    state.stampAreas,
    state.annotations
  );
  return {
    ...state,
    history: addToHistory(state.history, snapshot)
  };
}

/**
 * Apply a snapshot to state
 */
export function applySnapshot(state: EditorState, snapshot: EditorSnapshot | null): EditorState {
  if (!snapshot) return state;
  return {
    ...state,
    cropArea: snapshot.cropArea ? { ...snapshot.cropArea } : null,
    transform: { ...snapshot.transform },
    adjustments: { ...snapshot.adjustments },
    viewport: { ...snapshot.viewport },
    blurAreas: snapshot.blurAreas ? snapshot.blurAreas.map(area => ({ ...area })) : [],
    stampAreas: snapshot.stampAreas ? snapshot.stampAreas.map(area => ({ ...area })) : [],
    annotations: snapshot.annotations ? snapshot.annotations.map(a => ({
      ...a,
      points: a.points.map(p => ({ ...p }))
    })) : []
  };
}

/**
 * Undo last action
 */
export function handleUndo(state: EditorState): EditorState {
  const result = undo(state.history);
  if (result.snapshot) {
    const newState = applySnapshot(state, result.snapshot);
    return { ...newState, history: result.history };
  }
  return state;
}

/**
 * Redo last undone action
 */
export function handleRedo(state: EditorState): EditorState {
  const result = redo(state.history);
  if (result.snapshot) {
    const newState = applySnapshot(state, result.snapshot);
    return { ...newState, history: result.history };
  }
  return state;
}

/**
 * Check if undo is available
 */
export function canUndo(state: EditorState): boolean {
  return checkCanUndo(state.history);
}

/**
 * Check if redo is available
 */
export function canRedo(state: EditorState): boolean {
  return checkCanRedo(state.history);
}

// ============================================================================
// KEYBOARD HANDLING
// ============================================================================

export interface KeyboardAction {
  type: 'undo' | 'redo' | 'none';
}

/**
 * Handle keyboard shortcuts (returns action type)
 */
export function getKeyboardAction(event: KeyboardEvent): KeyboardAction {
  // Check if input/textarea is focused
  const target = event.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return { type: 'none' };
  }

  // Ctrl+Z or Cmd+Z for undo
  if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
    event.preventDefault();
    return { type: 'undo' };
  }

  // Ctrl+Shift+Z or Cmd+Shift+Z for redo
  if ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) {
    event.preventDefault();
    return { type: 'redo' };
  }

  // Ctrl+Y for redo
  if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
    event.preventDefault();
    return { type: 'redo' };
  }

  return { type: 'none' };
}

/**
 * Apply keyboard action to state
 */
export function applyKeyboardAction(state: EditorState, action: KeyboardAction): EditorState {
  switch (action.type) {
    case 'undo':
      return handleUndo(state);
    case 'redo':
      return handleRedo(state);
    default:
      return state;
  }
}

// ============================================================================
// EXPORT HANDLING
// ============================================================================

export interface ExportResult {
  dataUrl: string;
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Export editor state to image
 */
export async function exportImage(state: EditorState): Promise<ExportResult | null> {
  if (!state.imageData.original) return null;

  const exportCanvas = await applyTransformWithWebGPU(
    state.imageData.original,
    state.transform,
    state.adjustments,
    state.cropArea,
    state.blurAreas,
    state.stampAreas,
    state.annotations
  );

  const format = state.exportOptions.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const dataUrl = exportCanvas.toDataURL(format, state.exportOptions.quality);

  const blob = await new Promise<Blob>((resolve) => {
    exportCanvas.toBlob(b => resolve(b!), format, state.exportOptions.quality);
  });

  const bitmap = await createImageBitmap(blob);
  const result = {
    dataUrl,
    blob,
    width: bitmap.width,
    height: bitmap.height
  };
  bitmap.close();

  return result;
}

/**
 * Download exported image
 */
export async function downloadExportedImage(state: EditorState): Promise<void> {
  const result = await exportImage(state);
  if (!result) return;

  const filename = `edited-image-${Date.now()}.${state.exportOptions.format}`;
  downloadImage(result.dataUrl, filename);
}

// ============================================================================
// ANNOTATION HELPERS (for QuickDrawEditor)
// ============================================================================

/**
 * Add a new annotation to state
 */
export function addAnnotation(state: EditorState, annotation: Annotation): EditorState {
  return {
    ...state,
    annotations: [...state.annotations, annotation]
  };
}

/**
 * Remove last annotation (undo)
 */
export function removeLastAnnotation(state: EditorState): EditorState {
  if (state.annotations.length === 0) return state;
  return {
    ...state,
    annotations: state.annotations.slice(0, -1)
  };
}

// ============================================================================
// DRAG & DROP HANDLING
// ============================================================================

/**
 * Handle file drop event
 */
export function getDroppedFile(event: DragEvent): File | null {
  event.preventDefault();
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    return files[0];
  }
  return null;
}

/**
 * Handle file input change event
 */
export function getInputFile(event: Event): File | null {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    return target.files[0];
  }
  return null;
}

/**
 * Handle drag over event (prevents default)
 */
export function handleDragOver(event: DragEvent): void {
  event.preventDefault();
}

// ============================================================================
// QUICK DRAW STATE (Simplified state for QuickDrawEditor)
// ============================================================================

import {
  createEditorInteractionState,
  handleOverlayKeyDown,
  handleOverlayKeyUp,
  handleOverlayMouseDown,
  handleOverlayMouseMove,
  handleOverlayMouseUp,
  handleOverlayTouchStart,
  handleOverlayTouchMove,
  handleOverlayTouchEnd,
  handleWheelZoom,
  type EditorInteractionState,
  type EditorContext
} from './editor-interaction';

/**
 * Simplified state for QuickDrawEditor
 */
export interface QuickDrawState {
  image: HTMLImageElement | null;
  viewport: Viewport;
  annotations: Annotation[];
  interactionState: EditorInteractionState;
  isInitialized: boolean;
}

/**
 * Create initial QuickDraw state
 */
export function createQuickDrawState(): QuickDrawState {
  return {
    image: null,
    viewport: createViewport(1),
    annotations: [],
    interactionState: createEditorInteractionState(),
    isInitialized: false
  };
}

/**
 * Apply loaded image to QuickDraw state
 */
export function applyQuickDrawImage(
  state: QuickDrawState,
  image: HTMLImageElement,
  fitScale: number
): QuickDrawState {
  return {
    ...state,
    image,
    viewport: createViewport(fitScale),
    isInitialized: true
  };
}

/**
 * Handle key down for QuickDraw
 */
export function handleQuickDrawKeyDown(
  state: QuickDrawState,
  event: KeyboardEvent
): QuickDrawState {
  const result = handleOverlayKeyDown(event, state.interactionState);
  if (result) {
    return { ...state, interactionState: result };
  }
  return state;
}

/**
 * Handle key up for QuickDraw
 */
export function handleQuickDrawKeyUp(
  state: QuickDrawState,
  event: KeyboardEvent
): QuickDrawState {
  const result = handleOverlayKeyUp(event, state.interactionState);
  if (result) {
    return { ...state, interactionState: result };
  }
  return state;
}

/**
 * Handle mouse down for QuickDraw
 */
export function handleQuickDrawMouseDown(
  state: QuickDrawState,
  event: MouseEvent,
  ctx: EditorContext,
  tool: 'pen' | 'brush',
  color: string,
  strokeWidth: number
): QuickDrawState {
  if (!state.isInitialized) return state;
  const newInteractionState = handleOverlayMouseDown(event, state.interactionState, ctx, tool, color, strokeWidth);
  return { ...state, interactionState: newInteractionState };
}

/**
 * Handle mouse move for QuickDraw
 */
export function handleQuickDrawMouseMove(
  state: QuickDrawState,
  event: MouseEvent,
  ctx: EditorContext,
  tool: 'pen' | 'brush',
  strokeWidth: number
): QuickDrawState {
  const result = handleOverlayMouseMove(event, state.interactionState, ctx, tool, strokeWidth);
  if (result) {
    let newState = { ...state, interactionState: result.state };
    if (result.viewportUpdate) {
      newState = { ...newState, viewport: updateViewport(newState.viewport, result.viewportUpdate) };
    }
    return newState;
  }
  return state;
}

/**
 * Handle mouse up for QuickDraw
 */
export function handleQuickDrawMouseUp(
  state: QuickDrawState,
  tool: 'pen' | 'brush'
): QuickDrawState {
  const result = handleOverlayMouseUp(state.interactionState, tool);
  let newState = { ...state, interactionState: result.state };
  if (result.completedAnnotation) {
    newState = { ...newState, annotations: [...newState.annotations, result.completedAnnotation] };
  }
  return newState;
}

/**
 * Handle touch start for QuickDraw
 */
export function handleQuickDrawTouchStart(
  state: QuickDrawState,
  event: TouchEvent,
  ctx: EditorContext,
  tool: 'pen' | 'brush',
  color: string,
  strokeWidth: number
): QuickDrawState {
  if (!state.isInitialized) return state;
  const newInteractionState = handleOverlayTouchStart(event, state.interactionState, ctx, tool, color, strokeWidth);
  return { ...state, interactionState: newInteractionState };
}

/**
 * Handle touch move for QuickDraw
 */
export function handleQuickDrawTouchMove(
  state: QuickDrawState,
  event: TouchEvent,
  ctx: EditorContext,
  tool: 'pen' | 'brush',
  strokeWidth: number,
  canvasWidth: number,
  canvasHeight: number,
  canvasRect: DOMRect | null
): QuickDrawState {
  const result = handleOverlayTouchMove(event, state.interactionState, ctx, tool, strokeWidth);
  if (result) {
    let newState = { ...state, interactionState: result.state };
    if (result.viewportUpdate) {
      newState = { ...newState, viewport: updateViewport(newState.viewport, result.viewportUpdate) };
    }
    if (result.zoomInfo && canvasRect) {
      newState = {
        ...newState,
        viewport: handleWheelZoom(
          { deltaY: -result.zoomInfo.delta * 1000, clientX: result.zoomInfo.centerX, clientY: result.zoomInfo.centerY, preventDefault: () => {} } as WheelEvent,
          newState.viewport, canvasWidth, canvasHeight, canvasRect
        )
      };
    }
    return newState;
  }
  return state;
}

/**
 * Handle touch end for QuickDraw
 */
export function handleQuickDrawTouchEnd(
  state: QuickDrawState,
  event: TouchEvent,
  tool: 'pen' | 'brush'
): QuickDrawState {
  const result = handleOverlayTouchEnd(event, state.interactionState, tool);
  let newState = { ...state, interactionState: result.state };
  if (result.completedAnnotation) {
    newState = { ...newState, annotations: [...newState.annotations, result.completedAnnotation] };
  }
  return newState;
}

/**
 * Handle wheel zoom for QuickDraw
 */
export function handleQuickDrawWheel(
  state: QuickDrawState,
  event: WheelEvent,
  canvasWidth: number,
  canvasHeight: number,
  canvasRect: DOMRect
): QuickDrawState {
  event.preventDefault();
  return {
    ...state,
    viewport: handleWheelZoom(event, state.viewport, canvasWidth, canvasHeight, canvasRect)
  };
}

/**
 * Handle viewport change for QuickDraw
 */
export function handleQuickDrawViewportChange(
  state: QuickDrawState,
  viewportUpdate: Partial<Viewport>
): QuickDrawState {
  return {
    ...state,
    viewport: updateViewport(state.viewport, viewportUpdate)
  };
}

/**
 * Handle zoom for QuickDraw
 */
export function handleQuickDrawZoom(
  state: QuickDrawState,
  delta: number,
  canvasWidth: number,
  canvasHeight: number,
  canvasRect: DOMRect,
  centerX?: number,
  centerY?: number
): QuickDrawState {
  return {
    ...state,
    viewport: handleWheelZoom(
      { deltaY: -delta * 1000, clientX: centerX ?? 0, clientY: centerY ?? 0, preventDefault: () => {} } as WheelEvent,
      state.viewport, canvasWidth, canvasHeight, canvasRect
    )
  };
}

/**
 * Undo last annotation for QuickDraw
 */
export function quickDrawUndo(state: QuickDrawState): QuickDrawState {
  if (state.annotations.length === 0) return state;
  return {
    ...state,
    annotations: state.annotations.slice(0, -1)
  };
}

/**
 * Export QuickDraw state to image
 * Renders the image at its original size with annotations
 */
export interface QuickDrawExportResult {
  dataUrl: string;
  blob: Blob;
  width: number;
  height: number;
}

export async function exportQuickDraw(state: QuickDrawState): Promise<QuickDrawExportResult | null> {
  if (!state.image) return null;

  // Create export canvas at the image's natural dimensions
  const canvas = document.createElement('canvas');
  canvas.width = state.image.width;
  canvas.height = state.image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Draw the background image
  ctx.drawImage(state.image, 0, 0);

  // Draw annotations directly on the canvas (in image coordinates)
  for (const annotation of state.annotations) {
    if (annotation.points.length === 0) continue;

    ctx.save();

    // Apply shadow if specified
    if (annotation.shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = annotation.strokeWidth;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }

    if (annotation.type === 'pen') {
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (annotation.points.length === 1) {
        // Single point - draw a circle
        ctx.fillStyle = annotation.color;
        ctx.beginPath();
        ctx.arc(annotation.points[0].x, annotation.points[0].y, annotation.strokeWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Multiple points - draw smooth path
        ctx.beginPath();
        ctx.moveTo(annotation.points[0].x, annotation.points[0].y);

        // Use quadratic curves for smooth drawing
        for (let i = 1; i < annotation.points.length - 1; i++) {
          const p0 = annotation.points[i];
          const p1 = annotation.points[i + 1];
          const midX = (p0.x + p1.x) / 2;
          const midY = (p0.y + p1.y) / 2;
          ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
        }

        // Draw to the last point
        const lastPoint = annotation.points[annotation.points.length - 1];
        ctx.lineTo(lastPoint.x, lastPoint.y);
        ctx.stroke();
      }
    } else if (annotation.type === 'brush') {
      // Brush uses filled path with variable width
      ctx.fillStyle = annotation.color;

      if (annotation.points.length === 1) {
        // Single point - draw a circle
        const point = annotation.points[0];
        const radius = (point.pressure ?? 1) * annotation.strokeWidth / 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Draw brush stroke with pressure-based width
        for (let i = 0; i < annotation.points.length - 1; i++) {
          const p0 = annotation.points[i];
          const p1 = annotation.points[i + 1];
          const r0 = (p0.pressure ?? 1) * annotation.strokeWidth / 2;
          const r1 = (p1.pressure ?? 1) * annotation.strokeWidth / 2;

          // Draw a quad between points
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) continue;

          const nx = -dy / len;
          const ny = dx / len;

          ctx.beginPath();
          ctx.moveTo(p0.x + nx * r0, p0.y + ny * r0);
          ctx.lineTo(p1.x + nx * r1, p1.y + ny * r1);
          ctx.lineTo(p1.x - nx * r1, p1.y - ny * r1);
          ctx.lineTo(p0.x - nx * r0, p0.y - ny * r0);
          ctx.closePath();
          ctx.fill();

          // Draw circles at each point for smooth joins
          ctx.beginPath();
          ctx.arc(p0.x, p0.y, r0, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw circle at last point
        const lastPoint = annotation.points[annotation.points.length - 1];
        const lastRadius = (lastPoint.pressure ?? 1) * annotation.strokeWidth / 2;
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, lastRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // Generate output
  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob(b => resolve(b!), 'image/png');
  });

  return {
    dataUrl,
    blob,
    width: canvas.width,
    height: canvas.height
  };
}
