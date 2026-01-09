<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import type { Annotation, AnnotationType, AnnotationPoint, Viewport, TransformState, CropArea } from '../types';
  import { screenToImageCoords } from '../utils/canvas';
  import {
    getEventCoords,
    createPenAnnotation,
    createBrushAnnotation,
    addPointToPen,
    addPointToBrush,
    finalizeBrushStroke,
    generateSmoothPath,
    smoothPoints,
    interpolateBrushPoints,
    generateBrushPath,
    MIN_POINT_DISTANCE,
    type BrushState
  } from '../utils/drawing';
  import {
    createEditorInteractionState,
    handleOverlayKeyDown,
    handleOverlayKeyUp,
    calculatePanOffset,
    calculateZoomViewport,
    shouldPan,
    type EditorInteractionState,
    type EditorContext
  } from '../utils/editor-interaction';
  import {
    screenToImageCoords as sharedScreenToImageCoords,
    imageToCanvasCoords as sharedImageToCanvasCoords,
    type CoordinateContext
  } from '../utils/coordinates';
  import { Pencil, Eraser, ArrowRight, Square, Brush, Type } from 'lucide-svelte';
  import ToolPanel from './ToolPanel.svelte';
  import { DEFAULT_COLOR_PRESETS, DEFAULT_DRAWING_COLOR } from '../utils/colors';

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
  let currentColor = $state(initialColor ?? DEFAULT_DRAWING_COLOR);
  let strokeWidth = $state(initialStrokeWidth ?? 10);
  let shadowEnabled = $state(false);

  // Text tool state
  let fontSize = $state(48);
  let textInput = $state('');
  let isTextInputVisible = $state(false);
  let textInputPosition = $state<{ x: number; y: number; imageX: number; imageY: number } | null>(null);
  let textInputElement = $state<HTMLInputElement | null>(null);

  // Text drag state
  let isDraggingText = $state(false);
  let draggedTextId = $state<string | null>(null);
  let textDragStart = $state<{ x: number; y: number; originalX: number; originalY: number } | null>(null);
  let isHoveringText = $state(false);

  // Text selection and resize state
  let selectedTextId = $state<string | null>(null);
  let isResizingText = $state(false);
  let textResizeStart = $state<{ y: number; originalFontSize: number } | null>(null);
  let isHoveringResizeHandle = $state(false);

  // Text editing state
  let editingTextId = $state<string | null>(null);
  let editingTextValue = $state('');

  // Clear text selection and editing when switching away from text tool
  $effect(() => {
    if (currentTool !== 'text') {
      selectedTextId = null;
      editingTextId = null;
      editingTextValue = '';
      isTextInputVisible = false;
      textInputPosition = null;
    }
  });

  // Update selected text color when currentColor changes
  let prevColor = $state(currentColor);
  $effect(() => {
    if (selectedTextId && currentColor !== prevColor) {
      const updatedAnnotations = annotations.map(a => {
        if (a.id === selectedTextId) {
          return { ...a, color: currentColor };
        }
        return a;
      });
      onUpdate(updatedAnnotations);
    }
    prevColor = currentColor;
  });

  // Get selected text annotation with canvas bounds
  let selectedTextBounds = $derived.by(() => {
    if (!selectedTextId) return null;
    const annotation = annotations.find(a => a.id === selectedTextId);
    if (!annotation || annotation.type !== 'text' || !annotation.text) return null;

    const point = toCanvasCoords(annotation.points[0]);
    if (!point) return null;

    const totalScale = viewport.scale * viewport.zoom;
    const scaledFontSize = (annotation.fontSize ?? 48) * totalScale;
    const textWidth = calculateTextWidth(annotation.text, scaledFontSize);
    const textHeight = scaledFontSize;

    return {
      annotation,
      x: point.x,
      y: point.y,
      width: textWidth,
      height: textHeight
    };
  });

  // Use shared color presets
  const colorPresets = DEFAULT_COLOR_PRESETS;

  // Calculate text width considering full-width and half-width characters
  function calculateTextWidth(text: string, fontSize: number): number {
    let width = 0;
    for (const char of text) {
      const code = char.charCodeAt(0);
      // Full-width characters: CJK, full-width alphanumeric, Hangul
      const isFullWidth =
        (code >= 0x3000 && code <= 0x9FFF) || // CJK symbols, Hiragana, Katakana, CJK Unified
        (code >= 0xFF00 && code <= 0xFFEF) || // Full-width forms
        (code >= 0xAC00 && code <= 0xD7AF) || // Hangul syllables
        (code >= 0x1100 && code <= 0x11FF);   // Hangul Jamo

      width += isFullWidth ? fontSize : fontSize * 0.6;
    }
    return width;
  }

  // Drawing state
  let isDrawing = $state(false);
  let currentAnnotation = $state<Annotation | null>(null);

  // Brush state for speed-based width calculation (using shared type)
  let brushState = $state<BrushState | null>(null);

  // Interaction state (using shared utility - SAME as Canvas and QuickDrawEditor)
  let interactionState = $state<EditorInteractionState>(createEditorInteractionState());

  // Editor context for shared handlers
  let editorContext = $derived<EditorContext>({
    canvas,
    image,
    viewport,
    cropArea
  });

  // Coordinate context for shared utilities
  let coordContext = $derived<CoordinateContext | null>(
    canvas && image
      ? { canvas, image, viewport, cropArea }
      : null
  );

  // Convert screen coords to image coords (using shared utility)
  function toImageCoords(clientX: number, clientY: number): AnnotationPoint | null {
    if (!coordContext) return null;
    return sharedScreenToImageCoords(clientX, clientY, coordContext);
  }

  // Convert image coords to canvas coords for rendering (using shared utility)
  function toCanvasCoords(point: AnnotationPoint): { x: number; y: number } | null {
    if (!coordContext) return null;
    return sharedImageToCanvasCoords(point, coordContext);
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

  // Keyboard handlers for panning (using shared utility - SAME as QuickDrawEditor)
  function handleKeyDown(event: KeyboardEvent) {
    const result = handleOverlayKeyDown(event, interactionState);
    if (result) interactionState = result;
  }

  function handleKeyUp(event: KeyboardEvent) {
    const result = handleOverlayKeyUp(event, interactionState);
    if (result) interactionState = result;
  }

  function handleMouseDown(event: MouseEvent | TouchEvent) {
    if (!canvas || !image) return;
    if ('button' in event && event.button !== 0) return;

    const coords = getEventCoords(event);
    event.preventDefault();

    // Start panning if space is held (using shared utility - SAME as QuickDrawEditor)
    if (shouldPan(interactionState)) {
      interactionState = {
        ...interactionState,
        isPanning: true,
        lastPanPosition: { x: coords.clientX, y: coords.clientY }
      };
      return;
    }

    const imagePoint = toImageCoords(coords.clientX, coords.clientY);
    if (!imagePoint) return;

    if (currentTool === 'text') {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (coords.clientX - rect.left) * scaleX;
      const canvasY = (coords.clientY - rect.top) * scaleY;

      // Check if clicking on resize handle of selected text
      if (selectedTextBounds) {
        const handleSize = 12;
        const handleX = selectedTextBounds.x + selectedTextBounds.width;
        const handleY = selectedTextBounds.y + selectedTextBounds.height;

        if (canvasX >= handleX - handleSize && canvasX <= handleX + handleSize &&
            canvasY >= handleY - handleSize && canvasY <= handleY + handleSize) {
          // Start resizing
          isResizingText = true;
          textResizeStart = {
            y: coords.clientY,
            originalFontSize: selectedTextBounds.annotation.fontSize ?? 48
          };
          return;
        }
      }

      // Check if clicking on existing text annotation
      const textAnnotation = findTextAnnotationAtPoint(canvasX, canvasY);
      if (textAnnotation) {
        // Cancel any open text input first
        if (isTextInputVisible) {
          cancelTextInput();
        }

        // Select and start dragging immediately
        selectedTextId = textAnnotation.id;
        isDraggingText = true;
        draggedTextId = textAnnotation.id;
        textDragStart = {
          x: coords.clientX,
          y: coords.clientY,
          originalX: textAnnotation.points[0].x,
          originalY: textAnnotation.points[0].y
        };
        return;
      }

      // Clicking elsewhere - deselect and show text input for new text
      selectedTextId = null;
      textInputPosition = {
        x: coords.clientX - rect.left,
        y: coords.clientY - rect.top,
        imageX: imagePoint.x,
        imageY: imagePoint.y
      };
      textInput = '';
      isTextInputVisible = true;
      // Focus the input after it's rendered
      setTimeout(() => {
        textInputElement?.focus();
      }, 10);
      return;
    }

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
      // Use shared drawing utility
      currentAnnotation = createPenAnnotation(imagePoint, currentColor, strokeWidth, shadowEnabled);
    } else if (currentTool === 'brush') {
      // Use shared drawing utility
      const result = createBrushAnnotation(imagePoint, currentColor, strokeWidth, shadowEnabled);
      currentAnnotation = result.annotation;
      brushState = result.brushState;
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

  function handleMouseMove(event: MouseEvent | TouchEvent) {
    const coords = getEventCoords(event);

    // Check hover state for text tool
    if (currentTool === 'text' && canvas && !isDraggingText && !interactionState.isPanning && !isResizingText) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (coords.clientX - rect.left) * scaleX;
      const canvasY = (coords.clientY - rect.top) * scaleY;

      // Check if hovering over resize handle
      if (selectedTextBounds) {
        const handleSize = 12;
        const handleX = selectedTextBounds.x + selectedTextBounds.width;
        const handleY = selectedTextBounds.y + selectedTextBounds.height;
        if (canvasX >= handleX - handleSize && canvasX <= handleX + handleSize &&
            canvasY >= handleY - handleSize && canvasY <= handleY + handleSize) {
          isHoveringText = false;
          isHoveringResizeHandle = true;
          return;
        }
      }
      isHoveringResizeHandle = false;

      const textAnnotation = findTextAnnotationAtPoint(canvasX, canvasY);
      isHoveringText = textAnnotation !== null;
    } else if (currentTool !== 'text') {
      isHoveringText = false;
      isHoveringResizeHandle = false;
    }

    // Handle panning (using shared utility - SAME as QuickDrawEditor)
    if (interactionState.isPanning && canvas && image && onViewportChange) {
      event.preventDefault();
      const deltaX = coords.clientX - interactionState.lastPanPosition.x;
      const deltaY = coords.clientY - interactionState.lastPanPosition.y;
      const result = calculatePanOffset(viewport, deltaX, deltaY, image.width, image.height, canvas.width, canvas.height, cropArea);
      interactionState = { ...interactionState, lastPanPosition: { x: coords.clientX, y: coords.clientY } };
      onViewportChange(result);
      return;
    }

    // Handle text resizing
    if (isResizingText && selectedTextId && textResizeStart) {
      event.preventDefault();
      const dy = coords.clientY - textResizeStart.y;
      // Scale: moving down increases size, moving up decreases
      const scaleFactor = 1 + dy / 100;
      const newFontSize = Math.max(12, Math.min(300, textResizeStart.originalFontSize * scaleFactor));

      const updatedAnnotations = annotations.map(a => {
        if (a.id === selectedTextId) {
          return { ...a, fontSize: Math.round(newFontSize) };
        }
        return a;
      });
      onUpdate(updatedAnnotations);
      return;
    }

    // Handle text dragging
    if (isDraggingText && draggedTextId && textDragStart && canvas) {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const totalScale = viewport.scale * viewport.zoom;

      // Calculate delta in screen pixels, then convert to image coordinates
      const dx = (coords.clientX - textDragStart.x) * (canvas.width / rect.width) / totalScale;
      const dy = (coords.clientY - textDragStart.y) * (canvas.height / rect.height) / totalScale;

      // Update the annotation position
      const updatedAnnotations = annotations.map(a => {
        if (a.id === draggedTextId) {
          return {
            ...a,
            points: [{ x: textDragStart.originalX + dx, y: textDragStart.originalY + dy }]
          };
        }
        return a;
      });
      onUpdate(updatedAnnotations);
      return;
    }

    if (!isDrawing || !currentAnnotation || !canvas || !image) return;

    const imagePoint = toImageCoords(coords.clientX, coords.clientY);
    if (!imagePoint) return;

    event.preventDefault();

    if (currentTool === 'pen') {
      // Use shared drawing utility
      const updated = addPointToPen(currentAnnotation, imagePoint);
      if (updated) {
        currentAnnotation = updated;
      }
    } else if (currentTool === 'brush' && brushState) {
      // Use shared drawing utility
      const result = addPointToBrush(currentAnnotation, imagePoint, brushState, strokeWidth);
      if (result) {
        currentAnnotation = result.annotation;
        brushState = result.brushState;
      }
    } else if (currentTool === 'arrow' || currentTool === 'rectangle') {
      currentAnnotation = {
        ...currentAnnotation,
        points: [currentAnnotation.points[0], imagePoint]
      };
    }
  }

  function handleMouseUp(event?: MouseEvent | TouchEvent) {
    // Stop panning (using shared utility - SAME as QuickDrawEditor)
    if (interactionState.isPanning) {
      interactionState = { ...interactionState, isPanning: false };
      return;
    }

    // Stop text resizing
    if (isResizingText) {
      isResizingText = false;
      textResizeStart = null;
      return;
    }

    // Stop text dragging
    if (isDraggingText) {
      isDraggingText = false;
      draggedTextId = null;
      textDragStart = null;
      return;
    }

    if (!isDrawing || !currentAnnotation) {
      isDrawing = false;
      return;
    }

    // Apply exit stroke (抜き) for brush (using shared utility)
    if (currentAnnotation.type === 'brush' && brushState) {
      currentAnnotation = finalizeBrushStroke(currentAnnotation, brushState.recentSpeeds);
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
    brushState = null;
  }

  function findTextAnnotationAtPoint(canvasX: number, canvasY: number): Annotation | null {
    const totalScale = viewport.scale * viewport.zoom;

    for (let i = annotations.length - 1; i >= 0; i--) {
      const annotation = annotations[i];
      if (annotation.type !== 'text' || !annotation.text) continue;

      const points = annotation.points.map(p => toCanvasCoords(p)).filter(Boolean) as { x: number; y: number }[];
      if (points.length === 0) continue;

      const fontSize = (annotation.fontSize ?? 48) * totalScale;
      const textWidth = calculateTextWidth(annotation.text, fontSize);
      const textHeight = fontSize;
      const textX = points[0].x;
      const textY = points[0].y;

      if (canvasX >= textX - 5 && canvasX <= textX + textWidth + 5 &&
          canvasY >= textY - 5 && canvasY <= textY + textHeight + 5) {
        return annotation;
      }
    }

    return null;
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
      } else if (annotation.type === 'text' && annotation.text) {
        if (points.length >= 1) {
          const totalScale = viewport.scale * viewport.zoom;
          const fontSize = (annotation.fontSize ?? 48) * totalScale;
          const textWidth = calculateTextWidth(annotation.text, fontSize);
          const textHeight = fontSize;
          const textX = points[0].x;
          const textY = points[0].y;

          if (canvasX >= textX - hitRadius && canvasX <= textX + textWidth + hitRadius &&
              canvasY >= textY - hitRadius && canvasY <= textY + textHeight + hitRadius) {
            return i;
          }
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

  function confirmTextInput() {
    if (textInput.trim() && textInputPosition) {
      const newAnnotation: Annotation = {
        id: `annotation-${Date.now()}`,
        type: 'text',
        color: currentColor,
        strokeWidth: strokeWidth,
        points: [{ x: textInputPosition.imageX, y: textInputPosition.imageY }],
        shadow: shadowEnabled,
        text: textInput.trim(),
        fontSize: fontSize
      };
      onUpdate([...annotations, newAnnotation]);
    }
    cancelTextInput();
  }

  function cancelTextInput() {
    isTextInputVisible = false;
    textInput = '';
    textInputPosition = null;
  }

  function handleTextInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (editingTextId) {
        confirmTextEdit();
      } else {
        confirmTextInput();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (editingTextId) {
        cancelTextEdit();
      } else {
        cancelTextInput();
      }
    }
  }

  function startTextEdit(annotation: Annotation) {
    if (!annotation.text) return;
    editingTextId = annotation.id;
    editingTextValue = annotation.text;
    isTextInputVisible = true;

    // Position the input at the text location
    const point = toCanvasCoords(annotation.points[0]);
    if (point && canvas) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / canvas.width;
      const scaleY = rect.height / canvas.height;
      textInputPosition = {
        x: point.x * scaleX,
        y: point.y * scaleY,
        imageX: annotation.points[0].x,
        imageY: annotation.points[0].y
      };
    }

    setTimeout(() => {
      textInputElement?.focus();
      textInputElement?.select();
    }, 10);
  }

  function confirmTextEdit() {
    if (editingTextId && editingTextValue.trim()) {
      const updatedAnnotations = annotations.map(a => {
        if (a.id === editingTextId) {
          return { ...a, text: editingTextValue.trim() };
        }
        return a;
      });
      onUpdate(updatedAnnotations);
    }
    cancelTextEdit();
  }

  function cancelTextEdit() {
    editingTextId = null;
    editingTextValue = '';
    isTextInputVisible = false;
    textInputPosition = null;
  }

  function handleDoubleClick(event: MouseEvent) {
    if (currentTool !== 'text' || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;

    const textAnnotation = findTextAnnotationAtPoint(canvasX, canvasY);
    if (textAnnotation) {
      event.preventDefault();
      startTextEdit(textAnnotation);
    }
  }

  function handleTouchStart(event: TouchEvent) {
    // Two-finger touch starts panning (using shared utility - SAME as QuickDrawEditor)
    if (event.touches.length === 2) {
      event.preventDefault();

      // Cancel any current drawing
      if (isDrawing) {
        isDrawing = false;
        currentAnnotation = null;
        brushState = null;
      }

      interactionState = {
        ...interactionState,
        isTwoFingerTouch: true,
        isPanning: true,
        initialPinchDistance: 0,
        initialPinchZoom: viewport.zoom
      };
      return;
    }

    // Single finger - normal drawing (only if not already in two-finger mode)
    if (event.touches.length === 1 && !interactionState.isTwoFingerTouch) {
      handleMouseDown(event);
    }
  }

  function handleTouchMove(event: TouchEvent) {
    // Two-finger panning/zooming (using shared utility - SAME as QuickDrawEditor)
    if (event.touches.length === 2 && interactionState.isPanning && onViewportChange && canvas) {
      event.preventDefault();
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);

      if (interactionState.initialPinchDistance === 0) {
        interactionState = { ...interactionState, initialPinchDistance: distance, initialPinchZoom: viewport.zoom };
      } else {
        const scale = distance / interactionState.initialPinchDistance;
        const newZoom = Math.max(0.1, Math.min(5, interactionState.initialPinchZoom * scale));
        const delta = newZoom - viewport.zoom;
        const centerX = (touch1.clientX + touch2.clientX) / 2;
        const centerY = (touch1.clientY + touch2.clientY) / 2;
        const canvasRect = canvas.getBoundingClientRect();
        const newViewport = calculateZoomViewport(viewport, delta, canvas.width, canvas.height, centerX, centerY, canvasRect);
        onViewportChange({ zoom: newViewport.zoom, offsetX: newViewport.offsetX, offsetY: newViewport.offsetY });
      }
      return;
    }

    // Single finger drawing (only if not in two-finger mode)
    if (event.touches.length === 1 && !interactionState.isTwoFingerTouch) {
      handleMouseMove(event);
    }
  }

  function handleTouchEnd(event: TouchEvent) {
    // When all fingers are lifted (using shared utility - SAME as QuickDrawEditor)
    if (event.touches.length === 0) {
      if (interactionState.isPanning) {
        interactionState = { ...interactionState, isPanning: false, isTwoFingerTouch: false, initialPinchDistance: 0 };
      }
      handleMouseUp();
    }
    // When going from 2 fingers to 1, stay in pan mode but don't draw
    else if (event.touches.length === 1 && interactionState.isTwoFingerTouch) {
      interactionState = {
        ...interactionState,
        isPanning: true,
        lastPanPosition: { x: event.touches[0].clientX, y: event.touches[0].clientY },
        initialPinchDistance: 0
      };
    }
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
  class:panning={interactionState.isSpaceHeld || interactionState.isTwoFingerTouch}
  class:dragging-text={isDraggingText}
  class:text-mode={currentTool === 'text'}
  class:hovering-text={isHoveringText}
  class:hovering-resize={isHoveringResizeHandle}
  class:resizing-text={isResizingText}
  onmousedown={handleMouseDown}
  ondblclick={handleDoubleClick}
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
        {#if points.length === 1}
          <!-- Single point - draw a dot -->
          <circle
            cx={points[0].x}
            cy={points[0].y}
            r={annotation.strokeWidth * totalScale / 2}
            fill={annotation.color}
            filter={shadowFilter}
          />
        {:else}
          <path
            d={generateSmoothPath(points)}
            fill="none"
            stroke={annotation.color}
            stroke-width={annotation.strokeWidth * totalScale}
            stroke-linecap="round"
            stroke-linejoin="round"
            filter={shadowFilter}
          />
        {/if}
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
      {:else if annotation.type === 'text' && points.length >= 1 && annotation.text && annotation.id !== editingTextId}
        {@const scaledFontSize = (annotation.fontSize ?? 48) * totalScale}
        <text
          x={points[0].x}
          y={points[0].y + scaledFontSize * 0.88}
          fill={annotation.color}
          font-size={scaledFontSize}
          font-family="sans-serif"
          font-weight="bold"
          dominant-baseline="alphabetic"
          filter={shadowFilter}
        >{annotation.text}</text>
      {/if}
    {/each}

    <!-- Render current annotation being drawn -->
    {#if currentAnnotationCanvas && currentAnnotationCanvas.canvasPoints.length > 0}
      {@const points = currentAnnotationCanvas.canvasPoints}
      {@const totalScale = viewport.scale * viewport.zoom}
      {@const currentShadowFilter = currentAnnotationCanvas.shadow ? 'url(#annotation-shadow)' : 'none'}

      {#if currentAnnotationCanvas.type === 'pen'}
        {#if points.length === 1}
          <!-- Single point - draw a dot -->
          <circle
            cx={points[0].x}
            cy={points[0].y}
            r={currentAnnotationCanvas.strokeWidth * totalScale / 2}
            fill={currentAnnotationCanvas.color}
            filter={currentShadowFilter}
          />
        {:else}
          <path
            d={generateSmoothPath(points)}
            fill="none"
            stroke={currentAnnotationCanvas.color}
            stroke-width={currentAnnotationCanvas.strokeWidth * totalScale}
            stroke-linecap="round"
            stroke-linejoin="round"
            filter={currentShadowFilter}
          />
        {/if}
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

    <!-- Selection box and resize handle for selected text -->
    {#if selectedTextBounds}
      {@const padding = 4}
      {@const handleSize = 10}
      <rect
        x={selectedTextBounds.x - padding}
        y={selectedTextBounds.y - padding}
        width={selectedTextBounds.width + padding * 2}
        height={selectedTextBounds.height + padding * 2}
        fill="none"
        stroke="var(--primary-color, #63b97b)"
        stroke-width="2"
        stroke-dasharray="4 2"
      />
      <!-- Resize handle (bottom-right corner) -->
      <rect
        x={selectedTextBounds.x + selectedTextBounds.width - handleSize / 2 + padding}
        y={selectedTextBounds.y + selectedTextBounds.height - handleSize / 2 + padding}
        width={handleSize}
        height={handleSize}
        fill="var(--primary-color, #63b97b)"
        stroke="#fff"
        stroke-width="1"
        rx="2"
        class="resize-handle"
      />
    {/if}
  </svg>

  <!-- Text input overlay -->
  {#if isTextInputVisible && textInputPosition}
    {@const editingAnnotation = editingTextId ? annotations.find(a => a.id === editingTextId) : null}
    {@const inputColor = editingAnnotation?.color ?? currentColor}
    {@const inputFontSize = (editingAnnotation?.fontSize ?? fontSize) * viewport.scale * viewport.zoom}
    <div
      class="text-input-container"
      style="left: {textInputPosition.x}px; top: {textInputPosition.y}px;"
    >
      {#if editingTextId}
        <input
          bind:this={textInputElement}
          type="text"
          class="text-input"
          bind:value={editingTextValue}
          onkeydown={handleTextInputKeydown}
          onblur={confirmTextEdit}
          placeholder={$_('annotate.textPlaceholder')}
          style="color: {inputColor}; font-size: {inputFontSize}px;"
        />
      {:else}
        <input
          bind:this={textInputElement}
          type="text"
          class="text-input"
          bind:value={textInput}
          onkeydown={handleTextInputKeydown}
          onblur={confirmTextInput}
          placeholder={$_('annotate.textPlaceholder')}
          style="color: {inputColor}; font-size: {inputFontSize}px;"
        />
      {/if}
    </div>
  {/if}
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
        <button
          class="tool-btn"
          class:active={currentTool === 'text'}
          onclick={() => currentTool = 'text'}
          title={$_('annotate.text')}
        >
          <Type size={20} />
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

    <!-- Stroke width (hidden for text tool) -->
    {#if currentTool !== 'text'}
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
    {/if}

    <!-- Font size (text tool only) -->
    {#if currentTool === 'text'}
      <div class="control-group">
        <label for="font-size">
          <span>{$_('annotate.fontSize')}</span>
          <span class="value">{fontSize}px</span>
        </label>
        <input
          id="font-size"
          type="range"
          min="12"
          max="200"
          bind:value={fontSize}
        />
      </div>
    {/if}

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

    &.text-mode {
      cursor: text;
    }

    &.hovering-text,
    &.dragging-text {
      cursor: move;
    }

    &.hovering-resize,
    &.resizing-text {
      cursor: nwse-resize;
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

  .text-input-container {
    position: absolute;
    z-index: 10;
    transform: translateY(-50%);
  }

  .text-input {
    background: rgba(0, 0, 0, 0.7);
    border: 2px solid var(--primary-color, #63b97b);
    border-radius: 4px;
    padding: 4px 8px;
    min-width: 100px;
    max-width: 400px;
    font-weight: bold;
    outline: none;

    &::placeholder {
      color: rgba(255, 255, 255, 0.5);
      font-weight: normal;
    }
  }
</style>
