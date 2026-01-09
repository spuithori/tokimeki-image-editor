/**
 * Unified editor interaction logic.
 * Provides complete event handlers that can be used directly by components.
 * This eliminates the need for wrapper functions in each component.
 */

import type { Viewport, CropArea, AnnotationPoint, Annotation } from '../types';
import { screenToImageCoords, type CoordinateContext } from './coordinates';
import {
  getEventCoords,
  createPenAnnotation,
  createBrushAnnotation,
  addPointToPen,
  addPointToBrush,
  finalizeBrushStroke,
  type BrushState
} from './drawing';

// Constants
export const PAN_OVERFLOW_MARGIN = 0.2;

/**
 * Editor interaction state - shared between all editor components
 */
export interface EditorInteractionState {
  // Pan state
  isPanning: boolean;
  lastPanPosition: { x: number; y: number };
  initialPinchDistance: number;
  initialPinchZoom: number;

  // Space key / two-finger state (for drawing overlays)
  isSpaceHeld: boolean;
  isTwoFingerTouch: boolean;

  // Drawing state
  isDrawing: boolean;
  currentAnnotation: Annotation | null;
  brushState: BrushState | null;
}

/**
 * Create initial editor interaction state
 */
export function createEditorInteractionState(): EditorInteractionState {
  return {
    isPanning: false,
    lastPanPosition: { x: 0, y: 0 },
    initialPinchDistance: 0,
    initialPinchZoom: 1,
    isSpaceHeld: false,
    isTwoFingerTouch: false,
    isDrawing: false,
    currentAnnotation: null,
    brushState: null
  };
}

/**
 * Context for editor operations
 */
export interface EditorContext {
  canvas: HTMLCanvasElement | null;
  image: HTMLImageElement | null;
  viewport: Viewport;
  cropArea?: CropArea | null;
}

/**
 * Calculate clamped pan offset - THE core pan calculation used everywhere
 */
export function calculatePanOffset(
  viewport: Viewport,
  deltaX: number,
  deltaY: number,
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  cropArea?: CropArea | null
): { offsetX: number; offsetY: number } {
  const imgWidth = cropArea ? cropArea.width : imageWidth;
  const imgHeight = cropArea ? cropArea.height : imageHeight;
  const totalScale = viewport.scale * viewport.zoom;
  const scaledWidth = imgWidth * totalScale;
  const scaledHeight = imgHeight * totalScale;

  const maxOffsetX = (scaledWidth / 2) - (canvasWidth / 2) + (canvasWidth * PAN_OVERFLOW_MARGIN);
  const maxOffsetY = (scaledHeight / 2) - (canvasHeight / 2) + (canvasHeight * PAN_OVERFLOW_MARGIN);

  const newOffsetX = viewport.offsetX + deltaX;
  const newOffsetY = viewport.offsetY + deltaY;

  return {
    offsetX: Math.max(-maxOffsetX, Math.min(maxOffsetX, newOffsetX)),
    offsetY: Math.max(-maxOffsetY, Math.min(maxOffsetY, newOffsetY))
  };
}

/**
 * Calculate zoom viewport - THE core zoom calculation used everywhere
 */
export function calculateZoomViewport(
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

// ============================================================================
// PURE PAN/ZOOM HANDLERS (for Canvas.svelte - pan on any drag)
// ============================================================================

/**
 * Handle mouse down for pure pan mode (Canvas.svelte)
 */
export function handlePureMouseDown(
  event: MouseEvent,
  state: EditorInteractionState
): EditorInteractionState | null {
  if (event.button === 0 || event.button === 1) {
    event.preventDefault();
    return {
      ...state,
      isPanning: true,
      lastPanPosition: { x: event.clientX, y: event.clientY }
    };
  }
  return null;
}

/**
 * Handle mouse move for pure pan mode (Canvas.svelte)
 */
export function handlePureMouseMove(
  event: MouseEvent,
  state: EditorInteractionState,
  ctx: EditorContext
): { state: EditorInteractionState; viewportUpdate: { offsetX: number; offsetY: number } } | null {
  if (!state.isPanning || !ctx.canvas || !ctx.image) return null;

  event.preventDefault();

  const deltaX = event.clientX - state.lastPanPosition.x;
  const deltaY = event.clientY - state.lastPanPosition.y;

  const result = calculatePanOffset(
    ctx.viewport,
    deltaX,
    deltaY,
    ctx.image.width,
    ctx.image.height,
    ctx.canvas.width,
    ctx.canvas.height,
    ctx.cropArea
  );

  return {
    state: {
      ...state,
      lastPanPosition: { x: event.clientX, y: event.clientY }
    },
    viewportUpdate: result
  };
}

/**
 * Handle mouse up for pure pan mode
 */
export function handlePureMouseUp(state: EditorInteractionState): EditorInteractionState {
  return { ...state, isPanning: false };
}

/**
 * Handle touch start for pure pan mode (Canvas.svelte)
 */
export function handlePureTouchStart(
  event: TouchEvent,
  state: EditorInteractionState,
  viewport: Viewport
): EditorInteractionState {
  if (event.touches.length === 1) {
    event.preventDefault();
    return {
      ...state,
      isPanning: true,
      lastPanPosition: { x: event.touches[0].clientX, y: event.touches[0].clientY },
      initialPinchDistance: 0
    };
  } else if (event.touches.length === 2) {
    event.preventDefault();
    return {
      ...state,
      isPanning: false,
      isTwoFingerTouch: true,
      initialPinchDistance: 0,
      initialPinchZoom: viewport.zoom
    };
  }
  return state;
}

/**
 * Handle touch move for pure pan mode (Canvas.svelte)
 */
export function handlePureTouchMove(
  event: TouchEvent,
  state: EditorInteractionState,
  ctx: EditorContext
): {
  state: EditorInteractionState;
  viewportUpdate?: { offsetX: number; offsetY: number };
  zoomInfo?: { delta: number; centerX: number; centerY: number };
} | null {
  if (!ctx.canvas || !ctx.image) return null;

  if (event.touches.length === 1 && state.isPanning) {
    event.preventDefault();

    const touch = event.touches[0];
    const deltaX = touch.clientX - state.lastPanPosition.x;
    const deltaY = touch.clientY - state.lastPanPosition.y;

    const result = calculatePanOffset(
      ctx.viewport,
      deltaX,
      deltaY,
      ctx.image.width,
      ctx.image.height,
      ctx.canvas.width,
      ctx.canvas.height,
      ctx.cropArea
    );

    return {
      state: {
        ...state,
        lastPanPosition: { x: touch.clientX, y: touch.clientY }
      },
      viewportUpdate: result
    };
  } else if (event.touches.length === 2) {
    event.preventDefault();

    const touch1 = event.touches[0];
    const touch2 = event.touches[1];
    const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);

    if (state.initialPinchDistance === 0) {
      return {
        state: {
          ...state,
          initialPinchDistance: distance,
          initialPinchZoom: ctx.viewport.zoom,
          isPanning: false
        }
      };
    } else {
      const scale = distance / state.initialPinchDistance;
      const newZoom = Math.max(0.1, Math.min(5, state.initialPinchZoom * scale));
      const delta = newZoom - ctx.viewport.zoom;

      return {
        state,
        zoomInfo: {
          delta,
          centerX: (touch1.clientX + touch2.clientX) / 2,
          centerY: (touch1.clientY + touch2.clientY) / 2
        }
      };
    }
  }

  return null;
}

/**
 * Handle touch end for pure pan mode
 */
export function handlePureTouchEnd(
  event: TouchEvent,
  state: EditorInteractionState
): EditorInteractionState {
  if (event.touches.length === 0) {
    return {
      ...state,
      isPanning: false,
      isTwoFingerTouch: false,
      initialPinchDistance: 0
    };
  } else if (event.touches.length === 1) {
    return {
      ...state,
      isPanning: true,
      lastPanPosition: { x: event.touches[0].clientX, y: event.touches[0].clientY },
      initialPinchDistance: 0
    };
  }
  return state;
}

// ============================================================================
// DRAWING OVERLAY HANDLERS (for QuickDrawEditor, AnnotationTool - space+drag to pan)
// ============================================================================

/**
 * Handle key down for drawing overlay (space to pan)
 */
export function handleOverlayKeyDown(
  event: KeyboardEvent,
  state: EditorInteractionState
): EditorInteractionState | null {
  if (event.code === 'Space' && !state.isSpaceHeld) {
    event.preventDefault();
    return { ...state, isSpaceHeld: true };
  }
  return null;
}

/**
 * Handle key up for drawing overlay
 */
export function handleOverlayKeyUp(
  event: KeyboardEvent,
  state: EditorInteractionState
): EditorInteractionState | null {
  if (event.code === 'Space') {
    event.preventDefault();
    return { ...state, isSpaceHeld: false, isPanning: false };
  }
  return null;
}

/**
 * Check if should pan (space held or two-finger touch)
 */
export function shouldPan(state: EditorInteractionState): boolean {
  return state.isSpaceHeld || state.isTwoFingerTouch;
}

/**
 * Handle mouse down for drawing overlay
 */
export function handleOverlayMouseDown(
  event: MouseEvent,
  state: EditorInteractionState,
  ctx: EditorContext,
  tool: 'pen' | 'brush',
  color: string,
  strokeWidth: number,
  shadow: boolean = false
): EditorInteractionState {
  if (event.button !== 0) return state;

  event.preventDefault();

  // If space is held, start panning
  if (shouldPan(state)) {
    return {
      ...state,
      isPanning: true,
      lastPanPosition: { x: event.clientX, y: event.clientY }
    };
  }

  // Otherwise start drawing
  if (!ctx.canvas || !ctx.image) return state;

  const coordContext: CoordinateContext = {
    canvas: ctx.canvas,
    image: ctx.image,
    viewport: ctx.viewport,
    cropArea: ctx.cropArea
  };

  const imagePoint = screenToImageCoords(event.clientX, event.clientY, coordContext);
  if (!imagePoint) return state;

  if (tool === 'pen') {
    return {
      ...state,
      isDrawing: true,
      currentAnnotation: createPenAnnotation(imagePoint, color, strokeWidth, shadow),
      brushState: null
    };
  } else {
    const result = createBrushAnnotation(imagePoint, color, strokeWidth, shadow);
    return {
      ...state,
      isDrawing: true,
      currentAnnotation: result.annotation,
      brushState: result.brushState
    };
  }
}

/**
 * Handle mouse move for drawing overlay
 */
export function handleOverlayMouseMove(
  event: MouseEvent,
  state: EditorInteractionState,
  ctx: EditorContext,
  tool: 'pen' | 'brush',
  strokeWidth: number
): { state: EditorInteractionState; viewportUpdate?: { offsetX: number; offsetY: number } } | null {
  if (!ctx.canvas || !ctx.image) return null;

  // Handle panning
  if (state.isPanning) {
    event.preventDefault();

    const deltaX = event.clientX - state.lastPanPosition.x;
    const deltaY = event.clientY - state.lastPanPosition.y;

    const result = calculatePanOffset(
      ctx.viewport,
      deltaX,
      deltaY,
      ctx.image.width,
      ctx.image.height,
      ctx.canvas.width,
      ctx.canvas.height,
      ctx.cropArea
    );

    return {
      state: {
        ...state,
        lastPanPosition: { x: event.clientX, y: event.clientY }
      },
      viewportUpdate: result
    };
  }

  // Handle drawing
  if (!state.isDrawing || !state.currentAnnotation) return null;

  event.preventDefault();

  const coordContext: CoordinateContext = {
    canvas: ctx.canvas,
    image: ctx.image,
    viewport: ctx.viewport,
    cropArea: ctx.cropArea
  };

  const imagePoint = screenToImageCoords(event.clientX, event.clientY, coordContext);
  if (!imagePoint) return null;

  if (tool === 'pen') {
    const updated = addPointToPen(state.currentAnnotation, imagePoint);
    if (updated) {
      return { state: { ...state, currentAnnotation: updated } };
    }
  } else if (tool === 'brush' && state.brushState) {
    const result = addPointToBrush(state.currentAnnotation, imagePoint, state.brushState, strokeWidth);
    if (result) {
      return {
        state: {
          ...state,
          currentAnnotation: result.annotation,
          brushState: result.brushState
        }
      };
    }
  }

  return null;
}

/**
 * Handle mouse up for drawing overlay
 * Returns the completed annotation if drawing was finished
 */
export function handleOverlayMouseUp(
  state: EditorInteractionState,
  tool: 'pen' | 'brush'
): { state: EditorInteractionState; completedAnnotation?: Annotation } {
  // Stop panning
  if (state.isPanning) {
    return { state: { ...state, isPanning: false } };
  }

  // Stop drawing
  if (!state.isDrawing || !state.currentAnnotation) {
    return { state };
  }

  let finalAnnotation = state.currentAnnotation;

  // Finalize brush stroke
  if (tool === 'brush' && state.brushState) {
    finalAnnotation = finalizeBrushStroke(state.currentAnnotation, state.brushState.recentSpeeds);
  }

  // Check if annotation is valid
  const isValid = finalAnnotation.points.length >= 1;

  return {
    state: {
      ...state,
      isDrawing: false,
      currentAnnotation: null,
      brushState: null
    },
    completedAnnotation: isValid ? finalAnnotation : undefined
  };
}

/**
 * Handle touch start for drawing overlay
 */
export function handleOverlayTouchStart(
  event: TouchEvent,
  state: EditorInteractionState,
  ctx: EditorContext,
  tool: 'pen' | 'brush',
  color: string,
  strokeWidth: number,
  shadow: boolean = false
): EditorInteractionState {
  if (!ctx.canvas || !ctx.image) return state;

  // Two-finger touch for panning/zooming
  if (event.touches.length === 2) {
    event.preventDefault();
    return {
      ...state,
      isTwoFingerTouch: true,
      isPanning: true,
      isDrawing: false,
      currentAnnotation: null,
      brushState: null,
      initialPinchDistance: 0,
      initialPinchZoom: ctx.viewport.zoom
    };
  }

  // Single finger
  if (event.touches.length === 1 && !state.isTwoFingerTouch) {
    if (shouldPan(state)) {
      event.preventDefault();
      return {
        ...state,
        isPanning: true,
        lastPanPosition: { x: event.touches[0].clientX, y: event.touches[0].clientY }
      };
    } else {
      // Start drawing
      const coordContext: CoordinateContext = {
        canvas: ctx.canvas,
        image: ctx.image,
        viewport: ctx.viewport,
        cropArea: ctx.cropArea
      };

      const imagePoint = screenToImageCoords(event.touches[0].clientX, event.touches[0].clientY, coordContext);
      if (!imagePoint) return state;

      event.preventDefault();

      if (tool === 'pen') {
        return {
          ...state,
          isDrawing: true,
          currentAnnotation: createPenAnnotation(imagePoint, color, strokeWidth, shadow),
          brushState: null
        };
      } else {
        const result = createBrushAnnotation(imagePoint, color, strokeWidth, shadow);
        return {
          ...state,
          isDrawing: true,
          currentAnnotation: result.annotation,
          brushState: result.brushState
        };
      }
    }
  }

  return state;
}

/**
 * Handle touch move for drawing overlay
 */
export function handleOverlayTouchMove(
  event: TouchEvent,
  state: EditorInteractionState,
  ctx: EditorContext,
  tool: 'pen' | 'brush',
  strokeWidth: number
): {
  state: EditorInteractionState;
  viewportUpdate?: { offsetX: number; offsetY: number };
  zoomInfo?: { delta: number; centerX: number; centerY: number };
} | null {
  if (!ctx.canvas || !ctx.image) return null;

  // Two-finger pinch zoom
  if (event.touches.length === 2 && state.isPanning) {
    event.preventDefault();

    const touch1 = event.touches[0];
    const touch2 = event.touches[1];
    const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);

    if (state.initialPinchDistance === 0) {
      return {
        state: {
          ...state,
          initialPinchDistance: distance,
          initialPinchZoom: ctx.viewport.zoom
        }
      };
    } else {
      const scale = distance / state.initialPinchDistance;
      const newZoom = Math.max(0.1, Math.min(5, state.initialPinchZoom * scale));
      const delta = newZoom - ctx.viewport.zoom;

      return {
        state,
        zoomInfo: {
          delta,
          centerX: (touch1.clientX + touch2.clientX) / 2,
          centerY: (touch1.clientY + touch2.clientY) / 2
        }
      };
    }
  }

  // Single finger
  if (event.touches.length === 1) {
    // Panning
    if (state.isPanning || shouldPan(state)) {
      event.preventDefault();

      const touch = event.touches[0];
      const deltaX = touch.clientX - state.lastPanPosition.x;
      const deltaY = touch.clientY - state.lastPanPosition.y;

      const result = calculatePanOffset(
        ctx.viewport,
        deltaX,
        deltaY,
        ctx.image.width,
        ctx.image.height,
        ctx.canvas.width,
        ctx.canvas.height,
        ctx.cropArea
      );

      return {
        state: {
          ...state,
          isPanning: true,
          lastPanPosition: { x: touch.clientX, y: touch.clientY }
        },
        viewportUpdate: result
      };
    }

    // Drawing
    if (state.isDrawing && state.currentAnnotation && !state.isTwoFingerTouch) {
      event.preventDefault();

      const coordContext: CoordinateContext = {
        canvas: ctx.canvas,
        image: ctx.image,
        viewport: ctx.viewport,
        cropArea: ctx.cropArea
      };

      const touch = event.touches[0];
      const imagePoint = screenToImageCoords(touch.clientX, touch.clientY, coordContext);
      if (!imagePoint) return null;

      if (tool === 'pen') {
        const updated = addPointToPen(state.currentAnnotation, imagePoint);
        if (updated) {
          return { state: { ...state, currentAnnotation: updated } };
        }
      } else if (tool === 'brush' && state.brushState) {
        const result = addPointToBrush(state.currentAnnotation, imagePoint, state.brushState, strokeWidth);
        if (result) {
          return {
            state: {
              ...state,
              currentAnnotation: result.annotation,
              brushState: result.brushState
            }
          };
        }
      }
    }
  }

  return null;
}

/**
 * Handle touch end for drawing overlay
 */
export function handleOverlayTouchEnd(
  event: TouchEvent,
  state: EditorInteractionState,
  tool: 'pen' | 'brush'
): { state: EditorInteractionState; completedAnnotation?: Annotation } {
  if (event.touches.length === 0) {
    // All fingers lifted - finalize
    if (state.isDrawing && state.currentAnnotation) {
      let finalAnnotation = state.currentAnnotation;
      if (tool === 'brush' && state.brushState) {
        finalAnnotation = finalizeBrushStroke(state.currentAnnotation, state.brushState.recentSpeeds);
      }
      const isValid = finalAnnotation.points.length >= 1;

      return {
        state: {
          ...state,
          isPanning: false,
          isTwoFingerTouch: false,
          isDrawing: false,
          currentAnnotation: null,
          brushState: null,
          initialPinchDistance: 0
        },
        completedAnnotation: isValid ? finalAnnotation : undefined
      };
    }

    return {
      state: {
        ...state,
        isPanning: false,
        isTwoFingerTouch: false,
        initialPinchDistance: 0
      }
    };
  } else if (event.touches.length === 1 && state.isTwoFingerTouch) {
    // Two to one finger - continue panning
    return {
      state: {
        ...state,
        isPanning: true,
        lastPanPosition: { x: event.touches[0].clientX, y: event.touches[0].clientY },
        initialPinchDistance: 0
      }
    };
  }

  return { state };
}

/**
 * Handle wheel zoom
 */
export function handleWheelZoom(
  event: WheelEvent,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  canvasRect: DOMRect
): Viewport {
  const delta = -event.deltaY * 0.001;
  return calculateZoomViewport(
    viewport,
    delta,
    canvasWidth,
    canvasHeight,
    event.clientX,
    event.clientY,
    canvasRect
  );
}
