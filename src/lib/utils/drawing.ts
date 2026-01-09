/**
 * Core drawing logic for pen and brush tools.
 * Shared between AnnotationTool and QuickDrawEditor.
 */

import type { Annotation, AnnotationPoint, Viewport, CropArea } from '../types';

// ============================================
// Types
// ============================================

export interface DrawingContext {
  canvas: HTMLCanvasElement;
  image: HTMLImageElement;
  viewport: Viewport;
  cropArea?: CropArea | null;
}

export interface BrushState {
  lastPointTime: number;
  lastPointPos: { x: number; y: number } | null;
  recentSpeeds: number[];
  strokeStartTime: number;
}

// ============================================
// Constants
// ============================================

export const MIN_POINT_DISTANCE = 3;

// ============================================
// Coordinate Conversion
// ============================================

/**
 * Get coordinates from mouse or touch event
 */
export function getEventCoords(event: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  if ('touches' in event && event.touches.length > 0) {
    return { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY };
  } else if ('clientX' in event) {
    return { clientX: event.clientX, clientY: event.clientY };
  }
  return { clientX: 0, clientY: 0 };
}

/**
 * Convert screen coordinates to image coordinates (crop-aware)
 */
export function screenToImageCoords(
  clientX: number,
  clientY: number,
  ctx: DrawingContext
): AnnotationPoint | null {
  const { canvas, image, viewport, cropArea } = ctx;

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
 * Convert image coordinates to canvas coordinates (for rendering)
 */
export function imageToCanvasCoords(
  point: AnnotationPoint,
  ctx: DrawingContext
): { x: number; y: number } | null {
  const { canvas, image, viewport, cropArea } = ctx;

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
 * Simplified coordinate conversion for QuickDrawEditor (no viewport transform)
 */
export function simpleScreenToImageCoords(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement
): AnnotationPoint {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

// ============================================
// Annotation Creation
// ============================================

/**
 * Create a new pen annotation
 */
export function createPenAnnotation(
  startPoint: AnnotationPoint,
  color: string,
  strokeWidth: number,
  shadow: boolean = false
): Annotation {
  return {
    id: `annotation-${Date.now()}`,
    type: 'pen',
    color,
    strokeWidth,
    points: [startPoint],
    shadow
  };
}

/**
 * Create a new brush annotation with initial width
 */
export function createBrushAnnotation(
  startPoint: AnnotationPoint,
  color: string,
  strokeWidth: number,
  shadow: boolean = false
): { annotation: Annotation; brushState: BrushState } {
  const now = performance.now();
  const initialWidth = strokeWidth * 0.15; // Entry stroke (入り)

  return {
    annotation: {
      id: `annotation-${Date.now()}`,
      type: 'brush',
      color,
      strokeWidth,
      points: [{ ...startPoint, width: initialWidth }],
      shadow
    },
    brushState: {
      lastPointTime: now,
      lastPointPos: { x: startPoint.x, y: startPoint.y },
      recentSpeeds: [],
      strokeStartTime: now
    }
  };
}

/**
 * Initialize brush state for a new stroke
 */
export function initBrushState(startPoint: AnnotationPoint): BrushState {
  const now = performance.now();
  return {
    lastPointTime: now,
    lastPointPos: { x: startPoint.x, y: startPoint.y },
    recentSpeeds: [],
    strokeStartTime: now
  };
}

// ============================================
// Point Addition
// ============================================

/**
 * Add a point to a pen annotation
 * Returns null if point is too close to the last point
 */
export function addPointToPen(
  annotation: Annotation,
  point: AnnotationPoint,
  minDistance: number = MIN_POINT_DISTANCE
): Annotation | null {
  const lastPoint = annotation.points[annotation.points.length - 1];
  const dx = point.x - lastPoint.x;
  const dy = point.y - lastPoint.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < minDistance) {
    return null;
  }

  return {
    ...annotation,
    points: [...annotation.points, point]
  };
}

/**
 * Add a point to a brush annotation with speed-based width calculation
 * Returns null if point is too close, otherwise returns updated annotation and brush state
 */
export function addPointToBrush(
  annotation: Annotation,
  point: AnnotationPoint,
  brushState: BrushState,
  baseStrokeWidth: number
): { annotation: Annotation; brushState: BrushState } | null {
  const now = performance.now();
  const timeDelta = now - brushState.lastPointTime;
  const strokeAge = now - brushState.strokeStartTime;

  if (!brushState.lastPointPos || timeDelta <= 0) {
    return null;
  }

  const dx = point.x - brushState.lastPointPos.x;
  const dy = point.y - brushState.lastPointPos.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Calculate speed (pixels per millisecond)
  const speed = distance / timeDelta;

  // Adaptive minimum distance: slower drawing requires larger gaps
  const slowSpeedFactor = Math.max(0, 1 - speed * 2);
  const adaptiveMinDistance = MIN_POINT_DISTANCE * (1 + slowSpeedFactor * 2);

  if (distance < adaptiveMinDistance) {
    return null;
  }

  // Track recent speeds for exit stroke analysis
  const newRecentSpeeds = [...brushState.recentSpeeds.slice(-9), speed];

  // Map speed to width: faster = thinner, slower = thicker
  const minWidth = baseStrokeWidth * 0.2;
  const maxWidth = baseStrokeWidth * 2.5;

  // Inverse relationship: high speed = low width (exponential decay)
  const speedFactor = Math.exp(-speed * 2.5);
  let targetWidth = minWidth + (maxWidth - minWidth) * speedFactor;

  // Entry stroke enhancement (入り): gradually increase width for first ~150ms
  if (strokeAge < 150) {
    const entryFactor = Math.min(1, strokeAge / 150);
    const easedEntry = 1 - Math.pow(1 - entryFactor, 3); // Cubic ease-out
    const entryMinWidth = baseStrokeWidth * 0.15;
    targetWidth = entryMinWidth + (targetWidth - entryMinWidth) * easedEntry;
  }

  // Smooth width transition
  const lastWidth = annotation.points[annotation.points.length - 1].width || baseStrokeWidth;
  const smoothingFactor = 0.3 + slowSpeedFactor * 0.4;
  const smoothedWidth = lastWidth * (1 - smoothingFactor) + targetWidth * smoothingFactor;

  return {
    annotation: {
      ...annotation,
      points: [...annotation.points, { ...point, width: smoothedWidth }]
    },
    brushState: {
      lastPointTime: now,
      lastPointPos: { x: point.x, y: point.y },
      recentSpeeds: newRecentSpeeds,
      strokeStartTime: brushState.strokeStartTime
    }
  };
}

// ============================================
// Stroke Finalization
// ============================================

/**
 * Apply exit stroke (抜き) to brush annotation
 * Differentiates between とめ (tome/stop), はね (hane/flick), and normal endings
 */
export function finalizeBrushStroke(
  annotation: Annotation,
  recentSpeeds: number[]
): Annotation {
  if (annotation.type !== 'brush' || annotation.points.length < 2) {
    return annotation;
  }

  const points = [...annotation.points];

  // Analyze exit velocity
  const avgExitSpeed = recentSpeeds.length > 0
    ? recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length
    : 0.5;

  // Speed thresholds for different stroke endings
  const isHane = avgExitSpeed > 0.5; // Fast exit = はね (flick)
  const isTome = avgExitSpeed < 0.25; // Slow exit = とめ (stop)

  if (isTome) {
    // とめ (stopping stroke): maintain width, slight rounding
    const taperCount = Math.min(2, Math.floor(points.length * 0.15));
    for (let i = 0; i < taperCount; i++) {
      const idx = points.length - 1 - i;
      if (idx >= 0 && points[idx].width !== undefined) {
        const taperFactor = (i + 1) / (taperCount + 1);
        points[idx] = {
          ...points[idx],
          width: points[idx].width! * (1 - taperFactor * 0.2)
        };
      }
    }
  } else if (isHane) {
    // はね (flicking stroke): sharp taper
    const taperCount = Math.min(8, Math.floor(points.length * 0.4));
    for (let i = 0; i < taperCount; i++) {
      const idx = points.length - 1 - i;
      if (idx >= 0 && points[idx].width !== undefined) {
        const taperFactor = (i + 1) / taperCount;
        const easedTaper = Math.pow(taperFactor, 1.5);
        points[idx] = {
          ...points[idx],
          width: points[idx].width! * (1 - easedTaper * 0.9)
        };
      }
    }
  } else {
    // Medium speed: normal taper
    const taperCount = Math.min(5, Math.floor(points.length * 0.3));
    for (let i = 0; i < taperCount; i++) {
      const idx = points.length - 1 - i;
      if (idx >= 0 && points[idx].width !== undefined) {
        const taperFactor = (i + 1) / taperCount;
        points[idx] = {
          ...points[idx],
          width: points[idx].width! * (1 - taperFactor * 0.6)
        };
      }
    }
  }

  return { ...annotation, points };
}

// ============================================
// Path Generation (for SVG/Canvas rendering)
// ============================================

/**
 * Generate smooth SVG path using quadratic bezier curves (for pen)
 */
export function generateSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const cpX = curr.x;
    const cpY = curr.y;
    const endX = (curr.x + next.x) / 2;
    const endY = (curr.y + next.y) / 2;

    if (i === 1) {
      const firstMidX = (prev.x + curr.x) / 2;
      const firstMidY = (prev.y + curr.y) / 2;
      path += ` L ${firstMidX} ${firstMidY}`;
    }

    path += ` Q ${cpX} ${cpY} ${endX} ${endY}`;
  }

  const lastPoint = points[points.length - 1];
  path += ` L ${lastPoint.x} ${lastPoint.y}`;

  return path;
}

/**
 * Smooth a series of points using moving average
 */
export function smoothPoints(
  points: { x: number; y: number }[],
  windowSize: number = 3
): { x: number; y: number }[] {
  if (points.length < 3) return points;

  const result: { x: number; y: number }[] = [];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < points.length; i++) {
    if (i < halfWindow || i >= points.length - halfWindow) {
      result.push(points[i]);
      continue;
    }

    let sumX = 0, sumY = 0, count = 0;
    for (let j = -halfWindow; j <= halfWindow; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < points.length) {
        sumX += points[idx].x;
        sumY += points[idx].y;
        count++;
      }
    }
    result.push({ x: sumX / count, y: sumY / count });
  }

  return result;
}

/**
 * Interpolate points for smoother brush strokes
 */
export function interpolateBrushPoints(
  points: { x: number; y: number; width?: number }[]
): { x: number; y: number; width?: number }[] {
  if (points.length < 2) return points;

  const result: { x: number; y: number; width?: number }[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

    result.push(p1);

    const interpolateCount = Math.floor(dist / 5);
    for (let j = 1; j < interpolateCount; j++) {
      const t = j / interpolateCount;
      const smoothT = t * t * (3 - 2 * t); // smoothstep
      result.push({
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
        width: p1.width !== undefined && p2.width !== undefined
          ? p1.width + (p2.width - p1.width) * smoothT
          : undefined
      });
    }
  }
  result.push(points[points.length - 1]);

  return result;
}

/**
 * Generate a filled SVG path for variable-width brush strokes
 */
export function generateBrushPath(
  points: { x: number; y: number; width?: number }[],
  baseWidth: number,
  scale: number
): string {
  // Handle single point
  if (points.length === 1) {
    const p = points[0];
    const width = ((p.width ?? baseWidth) * scale) / 2;
    const rx = width * 0.8;
    const ry = width * 1.2;
    return `M ${p.x} ${p.y - ry}
            C ${p.x + rx * 0.55} ${p.y - ry} ${p.x + rx} ${p.y - ry * 0.55} ${p.x + rx} ${p.y}
            C ${p.x + rx} ${p.y + ry * 0.55} ${p.x + rx * 0.55} ${p.y + ry} ${p.x} ${p.y + ry}
            C ${p.x - rx * 0.55} ${p.y + ry} ${p.x - rx} ${p.y + ry * 0.55} ${p.x - rx} ${p.y}
            C ${p.x - rx} ${p.y - ry * 0.55} ${p.x - rx * 0.55} ${p.y - ry} ${p.x} ${p.y - ry} Z`;
  }

  // Handle 2 points
  if (points.length === 2) {
    const p1 = points[0];
    const p2 = points[1];
    const w1 = ((p1.width ?? baseWidth * 0.3) * scale) / 2;
    const w2 = ((p2.width ?? baseWidth * 0.5) * scale) / 2;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return '';

    const nx = -dy / len;
    const ny = dx / len;

    const startLeft = { x: p1.x + nx * w1, y: p1.y + ny * w1 };
    const startRight = { x: p1.x - nx * w1, y: p1.y - ny * w1 };
    const endLeft = { x: p2.x + nx * w2, y: p2.y + ny * w2 };
    const endRight = { x: p2.x - nx * w2, y: p2.y - ny * w2 };

    const tipExtend = w2 * 0.3;
    const tipX = p2.x + (dx / len) * tipExtend;
    const tipY = p2.y + (dy / len) * tipExtend;

    return `M ${startLeft.x} ${startLeft.y}
            Q ${(startLeft.x + endLeft.x) / 2 + nx * w2 * 0.3} ${(startLeft.y + endLeft.y) / 2 + ny * w2 * 0.3} ${endLeft.x} ${endLeft.y}
            Q ${tipX + nx * w2 * 0.2} ${tipY + ny * w2 * 0.2} ${tipX} ${tipY}
            Q ${tipX - nx * w2 * 0.2} ${tipY - ny * w2 * 0.2} ${endRight.x} ${endRight.y}
            Q ${(startRight.x + endRight.x) / 2 - nx * w2 * 0.3} ${(startRight.y + endRight.y) / 2 - ny * w2 * 0.3} ${startRight.x} ${startRight.y}
            Z`;
  }

  // For 3+ points, interpolate for smoother curves
  const interpolated = interpolateBrushPoints(points);

  let leftSide: { x: number; y: number }[] = [];
  let rightSide: { x: number; y: number }[] = [];

  for (let i = 0; i < interpolated.length; i++) {
    const curr = interpolated[i];
    const width = ((curr.width ?? baseWidth) * scale) / 2;

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

  if (leftSide.length < 2) return '';

  // Apply smoothing
  leftSide = smoothPoints(leftSide, 5);
  rightSide = smoothPoints(rightSide, 5);

  // Build path
  let path = `M ${leftSide[0].x} ${leftSide[0].y}`;

  // Left side forward
  for (let i = 1; i < leftSide.length - 1; i++) {
    const curr = leftSide[i];
    const next = leftSide[i + 1];
    const endX = (curr.x + next.x) / 2;
    const endY = (curr.y + next.y) / 2;
    path += ` Q ${curr.x} ${curr.y} ${endX} ${endY}`;
  }
  path += ` L ${leftSide[leftSide.length - 1].x} ${leftSide[leftSide.length - 1].y}`;

  // End cap
  const lastLeft = leftSide[leftSide.length - 1];
  const lastRight = rightSide[rightSide.length - 1];
  const lastPoint = interpolated[interpolated.length - 1];
  const lastWidth = ((lastPoint.width ?? baseWidth) * scale) / 2;

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
    path += ` Q ${tipX} ${tipY} ${lastRight.x} ${lastRight.y}`;
  } else {
    path += ` L ${lastRight.x} ${lastRight.y}`;
  }

  // Right side backward
  for (let i = rightSide.length - 2; i > 0; i--) {
    const curr = rightSide[i];
    const prev = rightSide[i - 1];
    const endX = (curr.x + prev.x) / 2;
    const endY = (curr.y + prev.y) / 2;
    path += ` Q ${curr.x} ${curr.y} ${endX} ${endY}`;
  }
  path += ` L ${rightSide[0].x} ${rightSide[0].y}`;

  // Start cap
  const firstLeft = leftSide[0];
  const firstPoint = interpolated[0];
  const firstWidth = ((firstPoint.width ?? baseWidth) * scale) / 2;
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
    path += ` Q ${startTipX} ${startTipY} ${firstLeft.x} ${firstLeft.y}`;
  }

  path += ' Z';
  return path;
}
