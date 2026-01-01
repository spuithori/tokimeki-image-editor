<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import type { Annotation, AnnotationType, AnnotationPoint, Viewport, TransformState, CropArea } from '../types';
  import { screenToImageCoords } from '../utils/canvas';
  import { Pencil, Eraser, ArrowRight, Square, Brush } from 'lucide-svelte';
  import ToolPanel from './ToolPanel.svelte';

  interface Props {
    canvas: HTMLCanvasElement | null;
    image: HTMLImageElement | null;
    viewport: Viewport;
    transform: TransformState;
    annotations: Annotation[];
    cropArea?: CropArea | null;
    initialTool?: AnnotationType | 'eraser';
    initialStrokeWidth?: number;
    initialColor?: string;
    onUpdate: (annotations: Annotation[]) => void;
    onClose: () => void;
    onViewportChange?: (viewport: Partial<Viewport>) => void;
  }

  let { canvas, image, viewport, transform, annotations, cropArea, initialTool, initialStrokeWidth, initialColor, onUpdate, onClose, onViewportChange }: Props = $props();

  let containerElement = $state<HTMLDivElement | null>(null);

  // Tool settings
  let currentTool = $state<AnnotationType | 'eraser'>(initialTool ?? 'pen');
  let currentColor = $state(initialColor ?? '#FF6B6B');
  let strokeWidth = $state(initialStrokeWidth ?? 10);
  let shadowEnabled = $state(false);

  // Preset colors - modern bright tones
  const colorPresets = ['#FF6B6B', '#FFA94D', '#FFD93D', '#6BCB77', '#4D96FF', '#9B72F2', '#F8F9FA', '#495057'];

  // Drawing state
  let isDrawing = $state(false);
  let currentAnnotation = $state<Annotation | null>(null);

  // Brush state for speed-based width calculation
  let lastPointTime = $state(0);
  let lastPointPos = $state<{ x: number; y: number } | null>(null);
  let recentSpeeds = $state<number[]>([]); // Track recent speeds for exit stroke analysis
  let strokeStartTime = $state(0); // Track when stroke started

  // Panning state (Space + drag on desktop, 2-finger drag on mobile)
  let isSpaceHeld = $state(false);
  let isPanning = $state(false);
  let panStart = $state<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  let isTwoFingerTouch = $state(false);

  // Helper to get coordinates from mouse or touch event
  function getEventCoords(event: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
    if ('touches' in event && event.touches.length > 0) {
      return { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY };
    } else if ('clientX' in event) {
      return { clientX: event.clientX, clientY: event.clientY };
    }
    return { clientX: 0, clientY: 0 };
  }

  // Convert screen coords to image coords (crop-aware)
  function toImageCoords(clientX: number, clientY: number): AnnotationPoint | null {
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

  // Convert image coords to canvas coords for rendering
  function toCanvasCoords(point: AnnotationPoint): { x: number; y: number } | null {
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

  onMount(() => {
    if (containerElement) {
      containerElement.addEventListener('touchstart', handleTouchStart as any, { passive: false });
      containerElement.addEventListener('touchmove', handleTouchMove as any, { passive: false });
      containerElement.addEventListener('touchend', handleTouchEnd as any, { passive: false });
    }

    return () => {
      if (containerElement) {
        containerElement.removeEventListener('touchstart', handleTouchStart as any);
        containerElement.removeEventListener('touchmove', handleTouchMove as any);
        containerElement.removeEventListener('touchend', handleTouchEnd as any);
      }
    };
  });

  // Keyboard handlers for panning (Space + drag)
  function handleKeyDown(event: KeyboardEvent) {
    if (event.code === 'Space' && !isSpaceHeld) {
      isSpaceHeld = true;
      event.preventDefault();
    }
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (event.code === 'Space') {
      isSpaceHeld = false;
      isPanning = false;
      panStart = null;
    }
  }

  function handleMouseDown(event: MouseEvent | TouchEvent) {
    if (!canvas || !image) return;
    if ('button' in event && event.button !== 0) return;

    const coords = getEventCoords(event);
    event.preventDefault();

    // Start panning if space is held
    if (isSpaceHeld) {
      isPanning = true;
      panStart = {
        x: coords.clientX,
        y: coords.clientY,
        offsetX: viewport.offsetX,
        offsetY: viewport.offsetY
      };
      return;
    }

    const imagePoint = toImageCoords(coords.clientX, coords.clientY);
    if (!imagePoint) return;

    if (currentTool === 'eraser') {
      // Find and remove annotation at click point
      const canvasPoint = { x: coords.clientX, y: coords.clientY };
      const rect = canvas.getBoundingClientRect();
      const localX = canvasPoint.x - rect.left;
      const localY = canvasPoint.y - rect.top;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = localX * scaleX;
      const canvasY = localY * scaleY;

      // Check each annotation for hit
      const hitIndex = findAnnotationAtPoint(canvasX, canvasY);
      if (hitIndex !== -1) {
        const updated = annotations.filter((_, i) => i !== hitIndex);
        onUpdate(updated);
      }
      return;
    }

    isDrawing = true;

    if (currentTool === 'pen') {
      currentAnnotation = {
        id: `annotation-${Date.now()}`,
        type: 'pen',
        color: currentColor,
        strokeWidth: strokeWidth,
        points: [imagePoint],
        shadow: shadowEnabled
      };
    } else if (currentTool === 'brush') {
      // Initialize brush with time tracking for speed-based width
      const now = performance.now();
      lastPointTime = now;
      strokeStartTime = now;
      lastPointPos = { x: imagePoint.x, y: imagePoint.y };
      recentSpeeds = [];

      // Start with a very thin width (entry stroke - 入り)
      // This creates the characteristic thin entry of calligraphy
      const initialWidth = strokeWidth * 0.15;
      currentAnnotation = {
        id: `annotation-${Date.now()}`,
        type: 'brush',
        color: currentColor,
        strokeWidth: strokeWidth,
        points: [{ ...imagePoint, width: initialWidth }],
        shadow: shadowEnabled
      };
    } else if (currentTool === 'arrow' || currentTool === 'rectangle') {
      currentAnnotation = {
        id: `annotation-${Date.now()}`,
        type: currentTool,
        color: currentColor,
        strokeWidth: strokeWidth,
        points: [imagePoint, imagePoint],
        shadow: shadowEnabled
      };
    }
  }

  // Minimum distance threshold for pen tool (in image coordinates)
  // This absorbs micro-movements of the mouse
  const MIN_POINT_DISTANCE = 3;

  function handleMouseMove(event: MouseEvent | TouchEvent) {
    const coords = getEventCoords(event);

    // Handle panning
    if (isPanning && panStart && onViewportChange) {
      event.preventDefault();
      const dx = coords.clientX - panStart.x;
      const dy = coords.clientY - panStart.y;
      onViewportChange({
        offsetX: panStart.offsetX + dx,
        offsetY: panStart.offsetY + dy
      });
      return;
    }

    if (!isDrawing || !currentAnnotation || !canvas || !image) return;

    const imagePoint = toImageCoords(coords.clientX, coords.clientY);
    if (!imagePoint) return;

    event.preventDefault();

    if (currentTool === 'pen') {
      // Check distance from last point to absorb micro-movements
      const lastPoint = currentAnnotation.points[currentAnnotation.points.length - 1];
      const dx = imagePoint.x - lastPoint.x;
      const dy = imagePoint.y - lastPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Only add point if it's far enough from the last point
      if (distance >= MIN_POINT_DISTANCE) {
        currentAnnotation = {
          ...currentAnnotation,
          points: [...currentAnnotation.points, imagePoint]
        };
      }
    } else if (currentTool === 'brush') {
      // Calculate speed-based width for brush
      const now = performance.now();
      const timeDelta = now - lastPointTime;
      const strokeAge = now - strokeStartTime; // How long since stroke started

      if (lastPointPos && timeDelta > 0) {
        const dx = imagePoint.x - lastPointPos.x;
        const dy = imagePoint.y - lastPointPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Calculate speed (pixels per millisecond)
        const speed = distance / timeDelta;

        // Adaptive minimum distance: slower drawing requires larger gaps to reduce zigzag
        // Fast drawing (speed > 0.5): use smaller threshold for detail
        // Slow drawing (speed < 0.2): use larger threshold to prevent zigzag
        const baseMinDistance = MIN_POINT_DISTANCE;
        const slowSpeedFactor = Math.max(0, 1 - speed * 2); // 1 at speed=0, 0 at speed>=0.5
        const adaptiveMinDistance = baseMinDistance * (1 + slowSpeedFactor * 2); // 1x to 3x base distance

        if (distance >= adaptiveMinDistance) {
          // Track recent speeds for exit stroke analysis (とめ/はね detection)
          recentSpeeds = [...recentSpeeds.slice(-9), speed];

          // Map speed to width: faster = thinner, slower = thicker
          const minWidth = strokeWidth * 0.2;
          const maxWidth = strokeWidth * 2.5;

          // Inverse relationship: high speed = low width
          // Use exponential decay for more natural feel
          const speedFactor = Math.exp(-speed * 2.5);
          let targetWidth = minWidth + (maxWidth - minWidth) * speedFactor;

          // Entry stroke enhancement (入り): gradually increase width for first ~100ms
          // This creates smoother entry
          if (strokeAge < 150) {
            const entryFactor = Math.min(1, strokeAge / 150);
            // Use easing function for smooth entry
            const easedEntry = 1 - Math.pow(1 - entryFactor, 3); // Cubic ease-out
            const entryMinWidth = strokeWidth * 0.15;
            targetWidth = entryMinWidth + (targetWidth - entryMinWidth) * easedEntry;
          }

          // Smooth width transition - use stronger smoothing for slow drawing
          // This prevents rapid width changes that cause zigzag
          const lastWidth = currentAnnotation.points[currentAnnotation.points.length - 1].width || strokeWidth;
          const smoothingFactor = 0.3 + slowSpeedFactor * 0.4; // 0.3 (fast) to 0.7 (slow)
          const smoothedWidth = lastWidth * (1 - smoothingFactor) + targetWidth * smoothingFactor;

          currentAnnotation = {
            ...currentAnnotation,
            points: [...currentAnnotation.points, { ...imagePoint, width: smoothedWidth }]
          };

          lastPointTime = now;
          lastPointPos = { x: imagePoint.x, y: imagePoint.y };
        }
      }
    } else if (currentTool === 'arrow' || currentTool === 'rectangle') {
      currentAnnotation = {
        ...currentAnnotation,
        points: [currentAnnotation.points[0], imagePoint]
      };
    }
  }

  function handleMouseUp(event?: MouseEvent | TouchEvent) {
    // Stop panning
    if (isPanning) {
      isPanning = false;
      panStart = null;
      return;
    }

    if (!isDrawing || !currentAnnotation) {
      isDrawing = false;
      return;
    }

    // Apply exit stroke (抜き) for brush - differentiate とめ (tome) vs はね (hane)
    if (currentAnnotation.type === 'brush' && currentAnnotation.points.length >= 2) {
      const points = [...currentAnnotation.points];

      // Analyze exit velocity to determine stroke ending type
      // とめ (tome): slow ending = deliberate stop, maintain width
      // はね (hane): fast ending = flicking motion, taper sharply
      const avgExitSpeed = recentSpeeds.length > 0
        ? recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length
        : 0.5;

      // Speed threshold: below = とめ, above = はね
      // Typical speeds: 0.1-0.3 (slow), 0.3-0.8 (medium), 0.8+ (fast)
      const isHane = avgExitSpeed > 0.5; // Fast exit = はね
      const isTome = avgExitSpeed < 0.25; // Slow exit = とめ

      if (isTome) {
        // とめ (stopping stroke): maintain width at the end, slight rounding
        // Apply minimal tapering to create a deliberate stop appearance
        const taperCount = Math.min(2, Math.floor(points.length * 0.15));
        for (let i = 0; i < taperCount; i++) {
          const idx = points.length - 1 - i;
          if (idx >= 0 && points[idx].width !== undefined) {
            const taperFactor = (i + 1) / (taperCount + 1);
            // Very subtle taper - maintain most of the width
            points[idx] = {
              ...points[idx],
              width: points[idx].width! * (1 - taperFactor * 0.2)
            };
          }
        }
      } else if (isHane) {
        // はね (flicking stroke): sharp taper for dynamic flick appearance
        const taperCount = Math.min(8, Math.floor(points.length * 0.4));
        for (let i = 0; i < taperCount; i++) {
          const idx = points.length - 1 - i;
          if (idx >= 0 && points[idx].width !== undefined) {
            const taperFactor = (i + 1) / taperCount;
            // Strong taper with exponential curve for sharp flick
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

      currentAnnotation = { ...currentAnnotation, points };
    }

    // Only save if annotation has enough points
    if (currentAnnotation.points.length >= 2 ||
       (currentAnnotation.type === 'pen' && currentAnnotation.points.length >= 1) ||
       (currentAnnotation.type === 'brush' && currentAnnotation.points.length >= 1)) {
      // For arrow/rectangle, ensure start and end are different
      if (currentAnnotation.type !== 'pen' && currentAnnotation.type !== 'brush') {
        const start = currentAnnotation.points[0];
        const end = currentAnnotation.points[1];
        const distance = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
        if (distance > 5) {
          onUpdate([...annotations, currentAnnotation]);
        }
      } else {
        onUpdate([...annotations, currentAnnotation]);
      }
    }

    isDrawing = false;
    currentAnnotation = null;
    lastPointTime = 0;
    lastPointPos = null;
    recentSpeeds = [];
    strokeStartTime = 0;
  }

  function findAnnotationAtPoint(canvasX: number, canvasY: number): number {
    const hitRadius = 10;

    for (let i = annotations.length - 1; i >= 0; i--) {
      const annotation = annotations[i];
      const points = annotation.points.map(p => toCanvasCoords(p)).filter(Boolean) as { x: number; y: number }[];

      if (annotation.type === 'pen') {
        // Check distance to any segment
        for (let j = 0; j < points.length - 1; j++) {
          const dist = pointToSegmentDistance(canvasX, canvasY, points[j], points[j + 1]);
          if (dist < hitRadius) return i;
        }
      } else if (annotation.type === 'arrow') {
        if (points.length >= 2) {
          const dist = pointToSegmentDistance(canvasX, canvasY, points[0], points[1]);
          if (dist < hitRadius) return i;
        }
      } else if (annotation.type === 'rectangle') {
        if (points.length >= 2) {
          const minX = Math.min(points[0].x, points[1].x);
          const maxX = Math.max(points[0].x, points[1].x);
          const minY = Math.min(points[0].y, points[1].y);
          const maxY = Math.max(points[0].y, points[1].y);

          // Check if near any edge
          const nearTop = Math.abs(canvasY - minY) < hitRadius && canvasX >= minX - hitRadius && canvasX <= maxX + hitRadius;
          const nearBottom = Math.abs(canvasY - maxY) < hitRadius && canvasX >= minX - hitRadius && canvasX <= maxX + hitRadius;
          const nearLeft = Math.abs(canvasX - minX) < hitRadius && canvasY >= minY - hitRadius && canvasY <= maxY + hitRadius;
          const nearRight = Math.abs(canvasX - maxX) < hitRadius && canvasY >= minY - hitRadius && canvasY <= maxY + hitRadius;

          if (nearTop || nearBottom || nearLeft || nearRight) return i;
        }
      }
    }

    return -1;
  }

  function pointToSegmentDistance(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
      return Math.sqrt((px - a.x) ** 2 + (py - a.y) ** 2);
    }

    let t = ((px - a.x) * dx + (py - a.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const nearestX = a.x + t * dx;
    const nearestY = a.y + t * dy;

    return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
  }

  function handleClearAll() {
    onUpdate([]);
  }

  function handleTouchStart(event: TouchEvent) {
    // Two-finger touch starts panning
    if (event.touches.length === 2) {
      event.preventDefault();
      isTwoFingerTouch = true;

      // Use the midpoint of the two touches
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      const midX = (touch1.clientX + touch2.clientX) / 2;
      const midY = (touch1.clientY + touch2.clientY) / 2;

      // Cancel any current drawing
      if (isDrawing) {
        isDrawing = false;
        currentAnnotation = null;
      }

      isPanning = true;
      panStart = {
        x: midX,
        y: midY,
        offsetX: viewport.offsetX,
        offsetY: viewport.offsetY
      };
      return;
    }

    // Single finger - normal drawing (only if not already in two-finger mode)
    if (event.touches.length === 1 && !isTwoFingerTouch) {
      handleMouseDown(event);
    }
  }

  function handleTouchMove(event: TouchEvent) {
    // Two-finger panning
    if (event.touches.length === 2 && isPanning && panStart && onViewportChange) {
      event.preventDefault();

      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      const midX = (touch1.clientX + touch2.clientX) / 2;
      const midY = (touch1.clientY + touch2.clientY) / 2;

      const dx = midX - panStart.x;
      const dy = midY - panStart.y;
      onViewportChange({
        offsetX: panStart.offsetX + dx,
        offsetY: panStart.offsetY + dy
      });
      return;
    }

    // Single finger drawing (only if not in two-finger mode)
    if (event.touches.length === 1 && !isTwoFingerTouch) {
      handleMouseMove(event);
    }
  }

  function handleTouchEnd(event: TouchEvent) {
    // When all fingers are lifted
    if (event.touches.length === 0) {
      if (isPanning) {
        isPanning = false;
        panStart = null;
      }
      isTwoFingerTouch = false;
      handleMouseUp();
    }
    // When going from 2 fingers to 1, stay in pan mode but don't draw
    else if (event.touches.length === 1 && isTwoFingerTouch) {
      // Update pan start to the remaining finger position
      if (isPanning && onViewportChange) {
        const touch = event.touches[0];
        panStart = {
          x: touch.clientX,
          y: touch.clientY,
          offsetX: viewport.offsetX,
          offsetY: viewport.offsetY
        };
      }
    }
  }

  // Generate smooth SVG path using quadratic bezier curves
  function generateSmoothPath(points: { x: number; y: number }[]): string {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2) {
      return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    }

    let path = `M ${points[0].x} ${points[0].y}`;

    // Use quadratic bezier curves for smooth lines
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];

      // Calculate control point (midpoint between previous and current)
      const cpX = curr.x;
      const cpY = curr.y;

      // Calculate end point (midpoint between current and next)
      const endX = (curr.x + next.x) / 2;
      const endY = (curr.y + next.y) / 2;

      if (i === 1) {
        // First segment: line to first midpoint, then curve
        const firstMidX = (prev.x + curr.x) / 2;
        const firstMidY = (prev.y + curr.y) / 2;
        path += ` L ${firstMidX} ${firstMidY}`;
      }

      path += ` Q ${cpX} ${cpY} ${endX} ${endY}`;
    }

    // Final segment to last point
    const lastPoint = points[points.length - 1];
    path += ` L ${lastPoint.x} ${lastPoint.y}`;

    return path;
  }

  // Smooth a series of points using moving average
  function smoothPoints(
    points: { x: number; y: number }[],
    windowSize: number = 3
  ): { x: number; y: number }[] {
    if (points.length < 3) return points;

    const result: { x: number; y: number }[] = [];
    const halfWindow = Math.floor(windowSize / 2);

    for (let i = 0; i < points.length; i++) {
      // Keep first and last points unchanged for proper shape
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

  // Interpolate points for smoother brush strokes
  function interpolateBrushPoints(
    points: { x: number; y: number; width?: number }[]
  ): { x: number; y: number; width?: number }[] {
    if (points.length < 2) return points;

    const result: { x: number; y: number; width?: number }[] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

      result.push(p1);

      // Add interpolated points if distance is large
      const interpolateCount = Math.floor(dist / 5); // Add point every 5 pixels
      for (let j = 1; j < interpolateCount; j++) {
        const t = j / interpolateCount;
        // Use smoothstep for width interpolation
        const smoothT = t * t * (3 - 2 * t);
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

  // Generate a filled SVG path for variable-width brush strokes
  function generateBrushPath(
    points: { x: number; y: number; width?: number }[],
    baseWidth: number,
    scale: number
  ): string {
    // Handle single point - create an elliptical brush mark (点)
    if (points.length === 1) {
      const p = points[0];
      const width = ((p.width ?? baseWidth) * scale) / 2;
      // Create a slightly elongated ellipse for brush-like appearance
      const rx = width * 0.8;
      const ry = width * 1.2;
      return `M ${p.x} ${p.y - ry}
              C ${p.x + rx * 0.55} ${p.y - ry} ${p.x + rx} ${p.y - ry * 0.55} ${p.x + rx} ${p.y}
              C ${p.x + rx} ${p.y + ry * 0.55} ${p.x + rx * 0.55} ${p.y + ry} ${p.x} ${p.y + ry}
              C ${p.x - rx * 0.55} ${p.y + ry} ${p.x - rx} ${p.y + ry * 0.55} ${p.x - rx} ${p.y}
              C ${p.x - rx} ${p.y - ry * 0.55} ${p.x - rx * 0.55} ${p.y - ry} ${p.x} ${p.y - ry} Z`;
    }

    // Handle 2 points - create a teardrop/brush stroke shape
    if (points.length === 2) {
      const p1 = points[0];
      const p2 = points[1];
      const w1 = ((p1.width ?? baseWidth * 0.3) * scale) / 2;
      const w2 = ((p2.width ?? baseWidth * 0.5) * scale) / 2;

      // Direction vector
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return '';

      // Perpendicular
      const nx = -dy / len;
      const ny = dx / len;

      // Create teardrop shape
      const startLeft = { x: p1.x + nx * w1, y: p1.y + ny * w1 };
      const startRight = { x: p1.x - nx * w1, y: p1.y - ny * w1 };
      const endLeft = { x: p2.x + nx * w2, y: p2.y + ny * w2 };
      const endRight = { x: p2.x - nx * w2, y: p2.y - ny * w2 };

      // Extend the tip slightly for brush-like appearance
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

      // Calculate direction using central difference when possible
      let dx: number, dy: number;
      if (i === 0) {
        dx = interpolated[1].x - curr.x;
        dy = interpolated[1].y - curr.y;
      } else if (i === interpolated.length - 1) {
        dx = curr.x - interpolated[i - 1].x;
        dy = curr.y - interpolated[i - 1].y;
      } else {
        // Use wider window for smoother direction calculation
        const lookback = Math.min(i, 3);
        const lookforward = Math.min(interpolated.length - 1 - i, 3);
        dx = interpolated[i + lookforward].x - interpolated[i - lookback].x;
        dy = interpolated[i + lookforward].y - interpolated[i - lookback].y;
      }

      // Normalize
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;

      const nx = -dy / len; // Perpendicular
      const ny = dx / len;

      leftSide.push({ x: curr.x + nx * width, y: curr.y + ny * width });
      rightSide.push({ x: curr.x - nx * width, y: curr.y - ny * width });
    }

    if (leftSide.length < 2) return '';

    // Apply smoothing to both sides to reduce zigzag
    leftSide = smoothPoints(leftSide, 5);
    rightSide = smoothPoints(rightSide, 5);

    // Build path: left side forward, right side backward
    let path = `M ${leftSide[0].x} ${leftSide[0].y}`;

    // Smooth left side with quadratic curves
    for (let i = 1; i < leftSide.length - 1; i++) {
      const curr = leftSide[i];
      const next = leftSide[i + 1];
      const endX = (curr.x + next.x) / 2;
      const endY = (curr.y + next.y) / 2;
      path += ` Q ${curr.x} ${curr.y} ${endX} ${endY}`;
    }
    path += ` L ${leftSide[leftSide.length - 1].x} ${leftSide[leftSide.length - 1].y}`;

    // End cap - smooth connection at stroke tip
    const lastLeft = leftSide[leftSide.length - 1];
    const lastRight = rightSide[rightSide.length - 1];
    const lastPoint = interpolated[interpolated.length - 1];
    const lastWidth = ((lastPoint.width ?? baseWidth) * scale) / 2;

    // Create rounded end cap using bezier curve
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

    // Smooth right side backward
    for (let i = rightSide.length - 2; i > 0; i--) {
      const curr = rightSide[i];
      const prev = rightSide[i - 1];
      const endX = (curr.x + prev.x) / 2;
      const endY = (curr.y + prev.y) / 2;
      path += ` Q ${curr.x} ${curr.y} ${endX} ${endY}`;
    }
    path += ` L ${rightSide[0].x} ${rightSide[0].y}`;

    // Start cap - smooth connection at stroke start
    const firstLeft = leftSide[0];
    const firstRight = rightSide[0];
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

    path += ' Z'; // Close path
    return path;
  }

  // Get current annotation canvas coordinates with width data for brush
  let currentAnnotationCanvas = $derived.by(() => {
    if (!currentAnnotation) return null;
    const points = currentAnnotation.points.map(p => {
      const canvasCoords = toCanvasCoords(p);
      if (!canvasCoords) return null;
      return { ...canvasCoords, width: p.width };
    }).filter(Boolean) as { x: number; y: number; width?: number }[];
    return { ...currentAnnotation, canvasPoints: points };
  });
</script>

<svelte:window
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
  onkeydown={handleKeyDown}
  onkeyup={handleKeyUp}
/>

<!-- Overlay -->
<div
  bind:this={containerElement}
  class="annotation-tool-overlay"
  class:panning={isSpaceHeld || isTwoFingerTouch}
  onmousedown={handleMouseDown}
  role="button"
  tabindex="-1"
>
  <svg class="annotation-tool-svg">
    <!-- Shadow filter definition -->
    <defs>
      <filter id="annotation-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.5)" />
      </filter>
    </defs>

    <!-- Render existing annotations -->
    {#each annotations as annotation (annotation.id)}
      {@const points = annotation.points.map(p => toCanvasCoords(p)).filter(Boolean) as { x: number; y: number }[]}
      {@const totalScale = viewport.scale * viewport.zoom}
      {@const shadowFilter = annotation.shadow ? 'url(#annotation-shadow)' : 'none'}

      {#if annotation.type === 'pen' && points.length > 0}
        <path
          d={generateSmoothPath(points)}
          fill="none"
          stroke={annotation.color}
          stroke-width={annotation.strokeWidth * totalScale}
          stroke-linecap="round"
          stroke-linejoin="round"
          filter={shadowFilter}
        />
      {:else if annotation.type === 'brush' && points.length >= 1}
        {@const brushPoints = annotation.points.map(p => {
          const canvasCoords = toCanvasCoords(p);
          if (!canvasCoords) return null;
          return { ...canvasCoords, width: p.width };
        }).filter(Boolean) as { x: number; y: number; width?: number }[]}
        <path
          d={generateBrushPath(brushPoints, annotation.strokeWidth, totalScale)}
          fill={annotation.color}
          stroke="none"
          filter={shadowFilter}
        />
      {:else if annotation.type === 'arrow' && points.length >= 2}
        {@const start = points[0]}
        {@const end = points[1]}
        {@const angle = Math.atan2(end.y - start.y, end.x - start.x)}
        {@const scaledStroke = annotation.strokeWidth * totalScale}
        {@const headLength = scaledStroke * 3}
        {@const headWidth = scaledStroke * 2}
        {@const lineEndX = end.x - headLength * 0.7 * Math.cos(angle)}
        {@const lineEndY = end.y - headLength * 0.7 * Math.sin(angle)}

        <g filter={shadowFilter}>
          <line
            x1={start.x}
            y1={start.y}
            x2={lineEndX}
            y2={lineEndY}
            stroke={annotation.color}
            stroke-width={scaledStroke}
            stroke-linecap="round"
          />
          <polygon
            points="{end.x},{end.y} {end.x - headLength * Math.cos(angle) + headWidth * Math.sin(angle)},{end.y - headLength * Math.sin(angle) - headWidth * Math.cos(angle)} {end.x - headLength * Math.cos(angle) - headWidth * Math.sin(angle)},{end.y - headLength * Math.sin(angle) + headWidth * Math.cos(angle)}"
            fill={annotation.color}
          />
        </g>
      {:else if annotation.type === 'rectangle' && points.length >= 2}
        {@const x = Math.min(points[0].x, points[1].x)}
        {@const y = Math.min(points[0].y, points[1].y)}
        {@const w = Math.abs(points[1].x - points[0].x)}
        {@const h = Math.abs(points[1].y - points[0].y)}
        {@const cornerRadius = annotation.strokeWidth * totalScale * 1.5}

        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={cornerRadius}
          ry={cornerRadius}
          fill="none"
          stroke={annotation.color}
          stroke-width={annotation.strokeWidth * totalScale}
          filter={shadowFilter}
        />
      {/if}
    {/each}

    <!-- Render current annotation being drawn -->
    {#if currentAnnotationCanvas && currentAnnotationCanvas.canvasPoints.length > 0}
      {@const points = currentAnnotationCanvas.canvasPoints}
      {@const totalScale = viewport.scale * viewport.zoom}
      {@const currentShadowFilter = currentAnnotationCanvas.shadow ? 'url(#annotation-shadow)' : 'none'}

      {#if currentAnnotationCanvas.type === 'pen'}
        <path
          d={generateSmoothPath(points)}
          fill="none"
          stroke={currentAnnotationCanvas.color}
          stroke-width={currentAnnotationCanvas.strokeWidth * totalScale}
          stroke-linecap="round"
          stroke-linejoin="round"
          filter={currentShadowFilter}
        />
      {:else if currentAnnotationCanvas.type === 'brush' && points.length >= 1}
        <path
          d={generateBrushPath(points, currentAnnotationCanvas.strokeWidth, totalScale)}
          fill={currentAnnotationCanvas.color}
          stroke="none"
          filter={currentShadowFilter}
        />
      {:else if currentAnnotationCanvas.type === 'arrow' && points.length >= 2}
        {@const start = points[0]}
        {@const end = points[1]}
        {@const angle = Math.atan2(end.y - start.y, end.x - start.x)}
        {@const scaledStroke = currentAnnotationCanvas.strokeWidth * totalScale}
        {@const headLength = scaledStroke * 3}
        {@const headWidth = scaledStroke * 2}
        {@const lineEndX = end.x - headLength * 0.7 * Math.cos(angle)}
        {@const lineEndY = end.y - headLength * 0.7 * Math.sin(angle)}

        <g filter={currentShadowFilter}>
          <line
            x1={start.x}
            y1={start.y}
            x2={lineEndX}
            y2={lineEndY}
            stroke={currentAnnotationCanvas.color}
            stroke-width={scaledStroke}
            stroke-linecap="round"
          />
          <polygon
            points="{end.x},{end.y} {end.x - headLength * Math.cos(angle) + headWidth * Math.sin(angle)},{end.y - headLength * Math.sin(angle) - headWidth * Math.cos(angle)} {end.x - headLength * Math.cos(angle) - headWidth * Math.sin(angle)},{end.y - headLength * Math.sin(angle) + headWidth * Math.cos(angle)}"
            fill={currentAnnotationCanvas.color}
          />
        </g>
      {:else if currentAnnotationCanvas.type === 'rectangle' && points.length >= 2}
        {@const x = Math.min(points[0].x, points[1].x)}
        {@const y = Math.min(points[0].y, points[1].y)}
        {@const w = Math.abs(points[1].x - points[0].x)}
        {@const h = Math.abs(points[1].y - points[0].y)}
        {@const cornerRadius = currentAnnotationCanvas.strokeWidth * totalScale * 1.5}

        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={cornerRadius}
          ry={cornerRadius}
          fill="none"
          stroke={currentAnnotationCanvas.color}
          stroke-width={currentAnnotationCanvas.strokeWidth * totalScale}
          filter={currentShadowFilter}
        />
      {/if}
    {/if}
  </svg>
</div>

<!-- Control panel -->
<ToolPanel title={$_('editor.annotate')} {onClose}>
  {#snippet children()}
    <!-- Tool selection -->
    <div class="tool-group">
      <span class="group-label">{$_('annotate.tool')}</span>
      <div class="tool-buttons">
        <button
          class="tool-btn"
          class:active={currentTool === 'pen'}
          onclick={() => currentTool = 'pen'}
          title={$_('annotate.pen')}
        >
          <Pencil size={20} />
        </button>
        <button
          class="tool-btn"
          class:active={currentTool === 'brush'}
          onclick={() => currentTool = 'brush'}
          title={$_('annotate.brush')}
        >
          <Brush size={20} />
        </button>
        <button
          class="tool-btn"
          class:active={currentTool === 'eraser'}
          onclick={() => currentTool = 'eraser'}
          title={$_('annotate.eraser')}
        >
          <Eraser size={20} />
        </button>
        <button
          class="tool-btn"
          class:active={currentTool === 'arrow'}
          onclick={() => currentTool = 'arrow'}
          title={$_('annotate.arrow')}
        >
          <ArrowRight size={20} />
        </button>
        <button
          class="tool-btn"
          class:active={currentTool === 'rectangle'}
          onclick={() => currentTool = 'rectangle'}
          title={$_('annotate.rectangle')}
        >
          <Square size={20} />
        </button>
      </div>
    </div>

    <!-- Color selection -->
    <div class="control-group">
      <span class="group-label">{$_('annotate.color')}</span>
      <div class="color-presets">
        {#each colorPresets as color}
          <button
            class="color-btn"
            class:active={currentColor === color}
            style="background-color: {color}; {color === '#ffffff' ? 'border: 1px solid #666;' : ''}"
            onclick={() => currentColor = color}
            title={color}
          ></button>
        {/each}
        <input
          type="color"
          class="color-picker"
          value={currentColor}
          oninput={(e) => currentColor = e.currentTarget.value}
        />
      </div>
    </div>

    <!-- Stroke width -->
    <div class="control-group">
      <label for="stroke-width">
        <span>{$_('annotate.strokeWidth')}</span>
        <span class="value">{strokeWidth}px</span>
      </label>
      <input
        id="stroke-width"
        type="range"
        min="5"
        max="100"
        bind:value={strokeWidth}
      />
    </div>

    <!-- Shadow toggle -->
    <div class="control-group">
      <label class="toggle-label">
        <span>{$_('annotate.shadow')}</span>
        <button
          class="toggle-btn"
          class:active={shadowEnabled}
          onclick={() => shadowEnabled = !shadowEnabled}
          type="button"
          title={$_('annotate.shadow')}
        >
          <span class="toggle-track">
            <span class="toggle-thumb"></span>
          </span>
        </button>
      </label>
    </div>
  {/snippet}

  {#snippet actions()}
    <button class="btn btn-danger" onclick={handleClearAll} disabled={annotations.length === 0}>
      {$_('annotate.clearAll')}
    </button>
  {/snippet}
</ToolPanel>

<style lang="postcss">
  .annotation-tool-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    cursor: crosshair;
    user-select: none;

    &.panning {
      cursor: grab;
    }

    &.panning:active {
      cursor: grabbing;
    }
  }

  .annotation-tool-svg {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .tool-group,
  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    @media (max-width: 767px) {
      flex-direction: row;
      align-items: center;
      gap: 0.75rem;
    }
  }

  .group-label {
    font-size: 0.9rem;
    color: #ccc;

    @media (max-width: 767px) {
      font-size: 0.75rem;
      white-space: nowrap;
      min-width: 50px;
    }
  }

  .tool-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: #333;
    border: 2px solid transparent;
    border-radius: 8px;
    color: #ccc;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tool-btn:hover {
    background: #444;
    color: #fff;
  }

  .tool-btn.active {
    background: var(--primary-color, #63b97b);
    border-color: var(--primary-color, #63b97b);
    color: #fff;
  }

  .color-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .color-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: all 0.2s;
  }

  .color-btn:hover {
    transform: scale(1.1);
  }

  .color-btn.active {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--primary-color, #63b97b);
  }

  .color-picker {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    padding: 0;
    cursor: pointer;
    background: transparent;
  }

  .color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .color-picker::-webkit-color-swatch {
    border-radius: 50%;
    border: 1px solid #666;
  }

  .control-group label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9rem;
    color: #ccc;

    @media (max-width: 767px) {
      font-size: 0.75rem;
      gap: 0.5rem;
    }
  }

  .control-group .value {
    font-weight: 600;
  }

  .control-group input[type='range'] {
    width: 100%;
    height: 6px;
    background: #444;
    border-radius: 3px;
    outline: none;
    cursor: pointer;

    @media (max-width: 767px) {
      width: 80px;
      flex-shrink: 0;
    }
  }

  .control-group input[type='range']::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--primary-color, #63b97b);
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
  }

  .control-group input[type='range']::-webkit-slider-thumb:hover {
    transform: scale(1.1);
  }

  .control-group input[type='range']::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--primary-color, #63b97b);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;

    @media (max-width: 767px) {
      padding: 0.4rem 0.75rem;
      font-size: 0.75rem;
    }
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-danger {
    background: #cc3333;
    color: #fff;
  }

  .btn-danger:hover:not(:disabled) {
    background: #dd4444;
  }

  .toggle-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9rem;
    color: #ccc;
  }

  .toggle-btn {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .toggle-track {
    display: block;
    width: 44px;
    height: 24px;
    background: #444;
    border-radius: 12px;
    position: relative;
    transition: background 0.2s;
  }

  .toggle-btn.active .toggle-track {
    background: var(--primary-color, #63b97b);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
  }

  .toggle-btn.active .toggle-thumb {
    transform: translateX(20px);
  }
</style>
