<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import {
    RotateCw,
    RotateCcw,
    FlipHorizontal,
    FlipVertical,
    X,
    Check,
    Crop as CropIcon,
    Lock,
    Unlock,
    Repeat2,
    RotateCcwSquare,
    Maximize2
  } from 'lucide-svelte';
  import type { CropArea, Viewport, TransformState } from '../types';
  import { screenToImageCoords, imageToCanvasCoords } from '../utils/canvas';
  import FloatingRail from './FloatingRail.svelte';
  import RailButton from './RailButton.svelte';
  import Popover from './Popover.svelte';
  import { haptic } from '../utils/haptics';

  // Aspect lock — when true, resizing maintains the locked ratio.
  let aspectLocked = $state(false);
  let lockedAspectRatio = $state<number | null>(null);

  let aspectPopoverOpen = $state(false);
  let aspectAnchor = $state<HTMLElement | null>(null);
  function toggleAspectPopover() {
    aspectPopoverOpen = !aspectPopoverOpen;
  }

  // ratio === null → free aspect
  function chooseAspect(ratio: number | null) {
    haptic('selection');
    if (ratio === null) {
      aspectLocked = false;
      lockedAspectRatio = null;
    } else {
      setAspectRatio(ratio);
      aspectLocked = true;
      lockedAspectRatio = ratio;
    }
    aspectPopoverOpen = false;
  }

  function toggleAspectLock() {
    if (aspectLocked) {
      aspectLocked = false;
      lockedAspectRatio = null;
    } else {
      aspectLocked = true;
      lockedAspectRatio = cropArea.width / cropArea.height;
    }
    haptic('selection');
  }

  function swapOrientation() {
    if (!image) return;
    const newWidth = Math.min(cropArea.height, image.width);
    const newHeight = Math.min(cropArea.width, image.height);
    cropArea = {
      x: Math.max(0, Math.min(image.width - newWidth, cropArea.x + (cropArea.width - newWidth) / 2)),
      y: Math.max(0, Math.min(image.height - newHeight, cropArea.y + (cropArea.height - newHeight) / 2)),
      width: newWidth,
      height: newHeight
    };
    if (lockedAspectRatio !== null) {
      lockedAspectRatio = 1 / lockedAspectRatio;
    }
    haptic('selection');
  }

  function resetCrop() {
    if (!image) return;
    cropArea = { x: 0, y: 0, width: image.width, height: image.height };
    aspectLocked = false;
    lockedAspectRatio = null;
    haptic('warning');
  }

  // Display helpers
  let displayWidth = $derived(Math.round(cropArea.width));
  let displayHeight = $derived(Math.round(cropArea.height));
  let displayRatio = $derived.by(() => {
    const r = cropArea.width / cropArea.height;
    const presets: [number, string][] = [
      [1, '1:1'],
      [4 / 5, '4:5'],
      [5 / 4, '5:4'],
      [4 / 3, '4:3'],
      [3 / 4, '3:4'],
      [3 / 2, '3:2'],
      [2 / 3, '2:3'],
      [16 / 9, '16:9'],
      [9 / 16, '9:16']
    ];
    for (const [ratio, label] of presets) {
      if (Math.abs(r - ratio) < 0.01) return label;
    }
    return null;
  });

  interface Props {
    canvas: HTMLCanvasElement | null;
    image: HTMLImageElement | null;
    viewport: Viewport;
    transform: TransformState;
    /** Previously-applied crop to seed the frame with (null = start from full image) */
    seedCropArea?: CropArea | null;
    onApply: (cropArea: CropArea) => void;
    onCancel: () => void;
    onViewportChange?: (viewport: Partial<Viewport>) => void;
    onTransformChange?: (transform: Partial<TransformState>) => void;
  }

  let {
    canvas,
    image,
    viewport,
    transform,
    seedCropArea = null,
    onApply,
    onCancel,
    onViewportChange,
    onTransformChange
  }: Props = $props();

  let containerElement = $state<HTMLDivElement | null>(null);

  // Crop area in image coordinates
  let cropArea = $state<CropArea>({
    x: 0,
    y: 0,
    width: 200,
    height: 200
  });

  let isDragging = $state(false);
  let isResizing = $state(false);
  let dragStart = $state({ x: 0, y: 0 });
  let resizeHandle = $state<string | null>(null);
  let initialCropArea = $state<CropArea | null>(null);

  // Viewport panning state.
  //   'frame'  — drag inside frame: image scrolls under stationary frame (iOS Photos)
  //   'canvas' — drag outside frame: viewport itself moves (image + frame together)
  let isPanning = $state(false);
  let panType = $state<'frame' | 'canvas'>('frame');
  let lastPanPosition = $state({ x: 0, y: 0 });

  // Touch pinch zoom state — pinch now zooms the underlying image, not the crop area.
  let initialPinchDistance = $state(0);
  let initialPinchZoom = $state(1);

  // True when any drag-like interaction is in progress (used to brighten the grid)
  let isInteracting = $derived(isResizing || isPanning);

  // SVG render constants — placed up here, derived geometry placed after canvasCoords below
  const cornerLen = 22;
  const cornerThickness = 4;
  const barThickness = 4;

  // Track if crop area has been initialized (non-reactive to prevent re-initialization)
  let cropAreaInitialized = false;

  // Helper to get coordinates from mouse or touch event
  function getEventCoords(event: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
    if ('touches' in event && event.touches.length > 0) {
      return { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY };
    } else if ('clientX' in event) {
      return { clientX: event.clientX, clientY: event.clientY };
    }
    return { clientX: 0, clientY: 0 };
  }

  // Canvas coordinates for rendering
  let canvasCoords = $derived.by(() => {
    if (!canvas || !image) return null;

    const topLeft = imageToCanvasCoords(cropArea.x, cropArea.y, canvas, image, viewport);
    const bottomRight = imageToCanvasCoords(
      cropArea.x + cropArea.width,
      cropArea.y + cropArea.height,
      canvas,
      image,
      viewport
    );

    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    };
  });

  // Derived SVG values that depend on canvasCoords
  let gridStroke = $derived(isInteracting ? 'var(--tk-crop-grid-active)' : 'var(--tk-crop-grid)');
  let frameStrokeWidth = $derived(isInteracting ? 2 : 1.5);
  let edgeBarLenH = $derived(canvasCoords ? Math.max(20, canvasCoords.width / 3) : 0);
  let edgeBarLenV = $derived(canvasCoords ? Math.max(20, canvasCoords.height / 3) : 0);
  let edgeOffsetX = $derived(canvasCoords ? (canvasCoords.width - edgeBarLenH) / 2 : 0);
  let edgeOffsetY = $derived(canvasCoords ? (canvasCoords.height - edgeBarLenV) / 2 : 0);

  onMount(() => {
    if (containerElement) {
      // Touch listeners need passive: false to allow preventDefault for pinch / drag
      containerElement.addEventListener('touchstart', handleContainerTouchStartUnified as any, { passive: false });
      containerElement.addEventListener('touchmove', handleContainerTouchMoveUnified as any, { passive: false });
      containerElement.addEventListener('touchend', handleContainerTouchEndUnified as any, { passive: false });
    }

    return () => {
      if (containerElement) {
        containerElement.removeEventListener('touchstart', handleContainerTouchStartUnified as any);
        containerElement.removeEventListener('touchmove', handleContainerTouchMoveUnified as any);
        containerElement.removeEventListener('touchend', handleContainerTouchEndUnified as any);
      }
    };
  });

  $effect(() => {
    if (image && !cropAreaInitialized) {
      // Seed the frame with the previously-applied crop, or the full image if none.
      cropAreaInitialized = true;
      if (seedCropArea) {
        const sx = Math.max(0, Math.min(image.width, seedCropArea.x));
        const sy = Math.max(0, Math.min(image.height, seedCropArea.y));
        cropArea = {
          x: sx,
          y: sy,
          width: Math.max(1, Math.min(seedCropArea.width, image.width - sx)),
          height: Math.max(1, Math.min(seedCropArea.height, image.height - sy))
        };
      } else {
        cropArea = {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height
        };
      }
    }
  });

  function handleMouseDown(event: MouseEvent | TouchEvent, handle?: string) {
    if (!canvas || !image) return;

    event.preventDefault();
    event.stopPropagation();

    const coords = getEventCoords(event);

    if (handle) {
      // Resize via corner / edge handle — cancel any pan that the container started
      dragStart = { x: coords.clientX, y: coords.clientY };
      initialCropArea = { ...cropArea };
      isResizing = true;
      resizeHandle = handle;
      isPanning = false;
      haptic('selection');
    } else {
      // Frame interior drag → pan the underlying image (iOS Photos / Lightroom style).
      // The frame stays put on screen; the image moves beneath it.
      isPanning = true;
      panType = 'frame';
      isDragging = false;
      lastPanPosition = { x: coords.clientX, y: coords.clientY };
    }
  }

  // Get handle size based on device type (larger for touch)
  function getHandleRadius(event: Event): number {
    return 'touches' in event ? 20 : 6; // 20px for touch, 6px for mouse
  }

  // Check if point is near any resize handle
  function isNearResizeHandle(mouseX: number, mouseY: number, handleRadius: number): boolean {
    if (!canvasCoords) return false;

    const { x, y, width, height } = canvasCoords;
    const handles = [
      { cx: x, cy: y },                           // nw
      { cx: x + width / 2, cy: y },               // n
      { cx: x + width, cy: y },                   // ne
      { cx: x + width, cy: y + height / 2 },      // e
      { cx: x + width, cy: y + height },          // se
      { cx: x + width / 2, cy: y + height },      // s
      { cx: x, cy: y + height },                  // sw
      { cx: x, cy: y + height / 2 },              // w
    ];

    for (const handle of handles) {
      const distance = Math.sqrt((mouseX - handle.cx) ** 2 + (mouseY - handle.cy) ** 2);
      if (distance <= handleRadius) {
        return true;
      }
    }
    return false;
  }

  // Container mousedown — frame interior and handles stop propagation in their
  // own handlers, so this only fires when the user pressed *outside* the frame.
  // That case = canvas pan (viewport moves, image and frame both follow the finger).
  function handleContainerMouseDown(event: MouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    isPanning = true;
    panType = 'canvas';
    isResizing = false;
    resizeHandle = null;
    initialCropArea = null;
    lastPanPosition = { x: event.clientX, y: event.clientY };
  }


  function handleMouseMove(event: MouseEvent | TouchEvent) {
    if (!canvas || !image) return;

    const coords = getEventCoords(event);

    // ── Pan — two flavours depending on where the drag started ──
    if (isPanning) {
      const deltaX = coords.clientX - lastPanPosition.x;
      const deltaY = coords.clientY - lastPanPosition.y;
      event.preventDefault();

      if (panType === 'canvas') {
        // Drag started outside the frame → move the viewport itself.
        // Both image and frame translate together (cropArea is untouched).
        if (onViewportChange) {
          onViewportChange({
            offsetX: viewport.offsetX + deltaX,
            offsetY: viewport.offsetY + deltaY
          });
        }
        lastPanPosition = { x: coords.clientX, y: coords.clientY };
        return;
      }

      // panType === 'frame'
      // Drag inside the frame → image scrolls under a stationary frame.
      // cropArea moves in image space by the inverse of the finger motion, and
      // viewport.offset is counter-adjusted so the frame's canvas position stays put.
      const scale = viewport.scale * viewport.zoom;
      const imageDeltaX = deltaX / scale;
      const imageDeltaY = deltaY / scale;

      let newCropX = cropArea.x - imageDeltaX;
      let newCropY = cropArea.y - imageDeltaY;

      // Clamp to image bounds — the frame can't leave the picture
      newCropX = Math.max(0, Math.min(image.width - cropArea.width, newCropX));
      newCropY = Math.max(0, Math.min(image.height - cropArea.height, newCropY));

      const actualImageDeltaX = newCropX - cropArea.x;
      const actualImageDeltaY = newCropY - cropArea.y;
      const actualScreenDeltaX = -actualImageDeltaX * scale;
      const actualScreenDeltaY = -actualImageDeltaY * scale;

      cropArea = { ...cropArea, x: newCropX, y: newCropY };

      if (onViewportChange) {
        onViewportChange({
          offsetX: viewport.offsetX + actualScreenDeltaX,
          offsetY: viewport.offsetY + actualScreenDeltaY
        });
      }

      lastPanPosition = { x: coords.clientX, y: coords.clientY };
      return;
    }

    // Handle crop area resizing
    if (!isResizing || !initialCropArea || !resizeHandle) return;

    const deltaX = coords.clientX - dragStart.x;
    const deltaY = coords.clientY - dragStart.y;

    // Convert delta to image coordinates
    const scale = viewport.scale * viewport.zoom;
    const imageDeltaX = deltaX / scale;
    const imageDeltaY = deltaY / scale;

    const minSize = 50;
    const ratio = lockedAspectRatio;
    const isCorner = resizeHandle.length === 2;

    if (ratio !== null) {
      // ── Aspect-locked resize ────────────────────────────────────────────
      let newWidth = initialCropArea.width;
      let newHeight = initialCropArea.height;
      let newX = initialCropArea.x;
      let newY = initialCropArea.y;

      if (isCorner) {
        // Use the dominant axis to drive the resize, derive the other from the ratio
        const dxSign = resizeHandle.includes('e') ? 1 : -1;
        const dySign = resizeHandle.includes('s') ? 1 : -1;
        const dxAdj = imageDeltaX * dxSign;
        const dyAdj = imageDeltaY * dySign;

        if (Math.abs(dxAdj) > Math.abs(dyAdj)) {
          newWidth = initialCropArea.width + dxAdj;
          newHeight = newWidth / ratio;
        } else {
          newHeight = initialCropArea.height + dyAdj;
          newWidth = newHeight * ratio;
        }

        if (newWidth < minSize || newHeight < minSize) return;

        // Anchor opposite corner
        if (resizeHandle.includes('w')) {
          newX = initialCropArea.x + initialCropArea.width - newWidth;
        }
        if (resizeHandle.includes('n')) {
          newY = initialCropArea.y + initialCropArea.height - newHeight;
        }
      } else {
        // Edge handle — drive on the perpendicular axis, expand symmetrically on the other
        if (resizeHandle === 'e' || resizeHandle === 'w') {
          if (resizeHandle === 'e') {
            newWidth = initialCropArea.width + imageDeltaX;
          } else {
            newWidth = initialCropArea.width - imageDeltaX;
            newX = initialCropArea.x + imageDeltaX;
          }
          newHeight = newWidth / ratio;
          newY = initialCropArea.y + (initialCropArea.height - newHeight) / 2;
        } else {
          if (resizeHandle === 's') {
            newHeight = initialCropArea.height + imageDeltaY;
          } else {
            newHeight = initialCropArea.height - imageDeltaY;
            newY = initialCropArea.y + imageDeltaY;
          }
          newWidth = newHeight * ratio;
          newX = initialCropArea.x + (initialCropArea.width - newWidth) / 2;
        }
        if (newWidth < minSize || newHeight < minSize) return;
      }

      // Bounds check — refuse the update if it would push outside the image
      if (newX < 0 || newY < 0 || newX + newWidth > image.width || newY + newHeight > image.height) return;

      cropArea = { x: newX, y: newY, width: newWidth, height: newHeight };
    } else {
      // ── Free resize ────────────────────────────────────────────────────
      let next = { ...cropArea };

      if (resizeHandle.includes('w')) {
        const newX = Math.max(
          0,
          Math.min(initialCropArea.x + initialCropArea.width - minSize, initialCropArea.x + imageDeltaX)
        );
        next.width = initialCropArea.width + (initialCropArea.x - newX);
        next.x = newX;
      }
      if (resizeHandle.includes('e')) {
        next.width = Math.max(minSize, Math.min(image.width - initialCropArea.x, initialCropArea.width + imageDeltaX));
      }
      if (resizeHandle.includes('n')) {
        const newY = Math.max(
          0,
          Math.min(initialCropArea.y + initialCropArea.height - minSize, initialCropArea.y + imageDeltaY)
        );
        next.height = initialCropArea.height + (initialCropArea.y - newY);
        next.y = newY;
      }
      if (resizeHandle.includes('s')) {
        next.height = Math.max(
          minSize,
          Math.min(image.height - initialCropArea.y, initialCropArea.height + imageDeltaY)
        );
      }

      cropArea = next;
    }
  }

  function handleMouseUp() {
    isDragging = false;
    isResizing = false;
    isPanning = false;
    resizeHandle = null;
    initialCropArea = null;
  }

  // These will be defined below after pinch zoom handlers are renamed

  function apply() {
    onApply(cropArea);
  }

  function setAspectRatio(ratio: number) {
    if (!image) return;

    let newWidth: number;
    let newHeight: number;

    // Calculate crop size to fill as much of the image as possible
    const imageAspectRatio = image.width / image.height;

    if (imageAspectRatio > ratio) {
      // Image is wider than the target ratio
      // Use full height, calculate width
      newHeight = image.height;
      newWidth = newHeight * ratio;
    } else {
      // Image is taller than the target ratio
      // Use full width, calculate height
      newWidth = image.width;
      newHeight = newWidth / ratio;
    }

    // Center the crop area
    cropArea = {
      x: (image.width - newWidth) / 2,
      y: (image.height - newHeight) / 2,
      width: newWidth,
      height: newHeight
    };
  }

  // Wheel zoom — exponential (log-scale feel), cursor-focused.
  // Normalizes trackpad line-mode / pixel-mode. Shift = coarse step.
  function handleWheel(event: WheelEvent) {
    if (!canvas || !image) return;
    event.preventDefault();
    event.stopPropagation();

    let dy = event.deltaY;
    if (event.deltaMode === 1) dy *= 16; // line
    else if (event.deltaMode === 2) dy *= 100; // page

    const coarseness = event.shiftKey ? 0.0048 : 0.002;
    const factor = Math.exp(-dy * coarseness);
    const targetZoom = viewport.zoom * factor;

    const rect = canvas.getBoundingClientRect();
    const focusX = event.clientX - rect.left;
    const focusY = event.clientY - rect.top;
    applyCursorFocusedZoom(targetZoom, focusX, focusY);
  }

  // Keyboard shortcuts — Enter / Esc / Arrow keys (1px), Shift+Arrow (10px)
  function handleKeyDown(event: KeyboardEvent) {
    // Don't hijack keys while user is typing in an input
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      apply();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (!image) return;
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      cropArea = { ...cropArea, x: Math.max(0, cropArea.x - step) };
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      cropArea = { ...cropArea, x: Math.min(image.width - cropArea.width, cropArea.x + step) };
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      cropArea = { ...cropArea, y: Math.max(0, cropArea.y - step) };
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      cropArea = { ...cropArea, y: Math.min(image.height - cropArea.height, cropArea.y + step) };
    } else if (event.key === '0' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      fitToScreen();
    }
  }

  // ── Cursor-focused canvas zoom ─────────────────────────────────────────
  // This is the *standard* zoom: both the image and the frame scale together
  // (the frame is drawn relative to cropArea in image space, so as viewport.zoom
  //  changes, the frame naturally follows the image on screen). cropArea is
  //  NOT modified — the "which part of the image is cropped" selection is
  //  preserved across zooms, only its visual size on canvas changes.
  //
  // Pan (frame-stationary) is still handled separately in handleMouseMove,
  // where both cropArea and viewport.offset update together.
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 10;

  function applyCursorFocusedZoom(
    targetZoom: number,
    focusCanvasX: number,
    focusCanvasY: number
  ): boolean {
    if (!canvas || !onViewportChange) return false;

    const oldZoom = viewport.zoom;
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
    if (Math.abs(clampedZoom - oldZoom) < 1e-4) return false;

    // Keep the image point under the focus stationary on screen.
    const cxRel = focusCanvasX - canvas.width / 2;
    const cyRel = focusCanvasY - canvas.height / 2;
    const zoomRatio = clampedZoom / oldZoom;
    const newOffsetX = cxRel - (cxRel - viewport.offsetX) * zoomRatio;
    const newOffsetY = cyRel - (cyRel - viewport.offsetY) * zoomRatio;

    onViewportChange({
      zoom: clampedZoom,
      offsetX: newOffsetX,
      offsetY: newOffsetY
    });
    return true;
  }

  function fitToScreen() {
    if (!onViewportChange) return;
    haptic('light');
    onViewportChange({ zoom: 1, offsetX: 0, offsetY: 0 });
  }

  function handlePinchZoomStart(event: TouchEvent) {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    const t1 = event.touches[0];
    const t2 = event.touches[1];
    initialPinchDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    initialPinchZoom = viewport.zoom;
  }

  function handlePinchZoomMove(event: TouchEvent) {
    if (event.touches.length !== 2 || initialPinchDistance === 0) return;
    if (!canvas) return;
    event.preventDefault();

    const t1 = event.touches[0];
    const t2 = event.touches[1];
    const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const scaleRatio = distance / initialPinchDistance;
    const targetZoom = initialPinchZoom * scaleRatio;

    const rect = canvas.getBoundingClientRect();
    const focusX = (t1.clientX + t2.clientX) / 2 - rect.left;
    const focusY = (t1.clientY + t2.clientY) / 2 - rect.top;
    applyCursorFocusedZoom(targetZoom, focusX, focusY);
  }

  function handlePinchZoomEnd() {
    initialPinchDistance = 0;
  }

  // Unified touch handlers — 1 finger pan (frame or canvas based on start position),
  // 2 fingers = pinch zoom.
  function handleContainerTouchStartUnified(event: TouchEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;

    if (event.touches.length === 2) {
      handlePinchZoomStart(event);
      isPanning = false;
      isResizing = false;
      return;
    }

    if (event.touches.length === 1) {
      // Child elements (frame border / handles) stopPropagation in their own
      // touchstart, so if we reach here the touch is *outside* the frame.
      // That maps to canvas pan (move viewport, keep cropArea in place).
      event.preventDefault();
      const touch = event.touches[0];
      isPanning = true;
      panType = 'canvas';
      isResizing = false;
      lastPanPosition = { x: touch.clientX, y: touch.clientY };
    }
  }

  function handleContainerTouchMoveUnified(event: TouchEvent) {
    if (event.touches.length === 2 && initialPinchDistance > 0) {
      handlePinchZoomMove(event);
      return;
    }
    handleMouseMove(event);
  }

  function handleContainerTouchEndUnified(event: TouchEvent) {
    if (event.touches.length === 0) {
      handleMouseUp();
      handlePinchZoomEnd();
    } else if (event.touches.length === 1 && initialPinchDistance > 0) {
      handlePinchZoomEnd();
    }
  }

  function rotateLeft() {
    if (!onTransformChange) return;
    const newRotation = (transform.rotation - 90 + 360) % 360;
    onTransformChange({ rotation: newRotation });
  }

  function rotateRight() {
    if (!onTransformChange) return;
    const newRotation = (transform.rotation + 90) % 360;
    onTransformChange({ rotation: newRotation });
  }

  function toggleFlipHorizontal() {
    if (!onTransformChange) return;
    onTransformChange({ flipHorizontal: !transform.flipHorizontal });
  }

  function toggleFlipVertical() {
    if (!onTransformChange) return;
    onTransformChange({ flipVertical: !transform.flipVertical });
  }
</script>

<svelte:window
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
  onkeydown={handleKeyDown}
/>

{#if canvasCoords && canvas}
  <div
    bind:this={containerElement}
    class="crop-container"
    class:panning={isPanning}
    onwheel={handleWheel}
    onmousedown={handleContainerMouseDown}
  >
  <svg
    class="crop-overlay"
    style="
      position: absolute;
      left: 0;
      top: 0;
      width: {canvas.width}px;
      height: {canvas.height}px;
      pointer-events: none;
    "
  >
    <!-- Dark overlay outside crop area -->
    <defs>
      <mask id="crop-mask">
        <rect width="100%" height="100%" fill="white" />
        <rect
          x={canvasCoords.x}
          y={canvasCoords.y}
          width={canvasCoords.width}
          height={canvasCoords.height}
          fill="black"
        />
      </mask>
    </defs>
    <rect
      width="100%"
      height="100%"
      fill="var(--tk-overlay-dim)"
      mask="url(#crop-mask)"
      style="pointer-events: none;"
    />

    <!-- Frame border (solid white) — also catches inside drag → pan -->
    <rect
      x={canvasCoords.x}
      y={canvasCoords.y}
      width={canvasCoords.width}
      height={canvasCoords.height}
      fill="transparent"
      stroke="var(--tk-crop-border)"
      stroke-width={frameStrokeWidth}
      style="pointer-events: all; cursor: grab;"
      onmousedown={(e) => handleMouseDown(e)}
      ontouchstart={(e) => handleMouseDown(e)}
    />

    <!-- Grid lines (rule of thirds) — brighter while dragging -->
    <line
      x1={canvasCoords.x + canvasCoords.width / 3}
      y1={canvasCoords.y}
      x2={canvasCoords.x + canvasCoords.width / 3}
      y2={canvasCoords.y + canvasCoords.height}
      stroke={gridStroke}
      stroke-width="1"
      style="pointer-events: none; transition: stroke 0.2s;"
    />
    <line
      x1={canvasCoords.x + (canvasCoords.width * 2) / 3}
      y1={canvasCoords.y}
      x2={canvasCoords.x + (canvasCoords.width * 2) / 3}
      y2={canvasCoords.y + canvasCoords.height}
      stroke={gridStroke}
      stroke-width="1"
      style="pointer-events: none; transition: stroke 0.2s;"
    />
    <line
      x1={canvasCoords.x}
      y1={canvasCoords.y + canvasCoords.height / 3}
      x2={canvasCoords.x + canvasCoords.width}
      y2={canvasCoords.y + canvasCoords.height / 3}
      stroke={gridStroke}
      stroke-width="1"
      style="pointer-events: none; transition: stroke 0.2s;"
    />
    <line
      x1={canvasCoords.x}
      y1={canvasCoords.y + (canvasCoords.height * 2) / 3}
      x2={canvasCoords.x + canvasCoords.width}
      y2={canvasCoords.y + (canvasCoords.height * 2) / 3}
      stroke={gridStroke}
      stroke-width="1"
      style="pointer-events: none; transition: stroke 0.2s;"
    />

    <!-- ─── Edge bars ─── center 1/3 of each edge, fat white line -->
    <!-- Top edge -->
    <rect
      x={canvasCoords.x + edgeOffsetX}
      y={canvasCoords.y - barThickness / 2}
      width={edgeBarLenH}
      height={barThickness}
      rx={barThickness / 2}
      fill="var(--tk-handle-fill)"
      style="pointer-events: all; cursor: n-resize; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));"
      onmousedown={(e) => handleMouseDown(e, 'n')}
      ontouchstart={(e) => handleMouseDown(e, 'n')}
    />
    <!-- Bottom edge -->
    <rect
      x={canvasCoords.x + edgeOffsetX}
      y={canvasCoords.y + canvasCoords.height - barThickness / 2}
      width={edgeBarLenH}
      height={barThickness}
      rx={barThickness / 2}
      fill="var(--tk-handle-fill)"
      style="pointer-events: all; cursor: s-resize; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));"
      onmousedown={(e) => handleMouseDown(e, 's')}
      ontouchstart={(e) => handleMouseDown(e, 's')}
    />
    <!-- Left edge -->
    <rect
      x={canvasCoords.x - barThickness / 2}
      y={canvasCoords.y + edgeOffsetY}
      width={barThickness}
      height={edgeBarLenV}
      rx={barThickness / 2}
      fill="var(--tk-handle-fill)"
      style="pointer-events: all; cursor: w-resize; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));"
      onmousedown={(e) => handleMouseDown(e, 'w')}
      ontouchstart={(e) => handleMouseDown(e, 'w')}
    />
    <!-- Right edge -->
    <rect
      x={canvasCoords.x + canvasCoords.width - barThickness / 2}
      y={canvasCoords.y + edgeOffsetY}
      width={barThickness}
      height={edgeBarLenV}
      rx={barThickness / 2}
      fill="var(--tk-handle-fill)"
      style="pointer-events: all; cursor: e-resize; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));"
      onmousedown={(e) => handleMouseDown(e, 'e')}
      ontouchstart={(e) => handleMouseDown(e, 'e')}
    />

    <!-- ─── Corner L-brackets ─── -->
    <!-- NW corner -->
    <path
      d="M {canvasCoords.x + cornerLen} {canvasCoords.y - cornerThickness / 2 + 0.5} L {canvasCoords.x - cornerThickness / 2 + 0.5} {canvasCoords.y - cornerThickness / 2 + 0.5} L {canvasCoords.x - cornerThickness / 2 + 0.5} {canvasCoords.y + cornerLen}"
      stroke="var(--tk-handle-fill)"
      stroke-width={cornerThickness}
      stroke-linecap="square"
      stroke-linejoin="miter"
      fill="none"
      style="pointer-events: none; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5));"
    />
    <rect
      x={canvasCoords.x - 14}
      y={canvasCoords.y - 14}
      width="28"
      height="28"
      fill="transparent"
      style="pointer-events: all; cursor: nw-resize;"
      onmousedown={(e) => handleMouseDown(e, 'nw')}
      ontouchstart={(e) => handleMouseDown(e, 'nw')}
    />

    <!-- NE corner -->
    <path
      d="M {canvasCoords.x + canvasCoords.width - cornerLen} {canvasCoords.y - cornerThickness / 2 + 0.5} L {canvasCoords.x + canvasCoords.width + cornerThickness / 2 - 0.5} {canvasCoords.y - cornerThickness / 2 + 0.5} L {canvasCoords.x + canvasCoords.width + cornerThickness / 2 - 0.5} {canvasCoords.y + cornerLen}"
      stroke="var(--tk-handle-fill)"
      stroke-width={cornerThickness}
      stroke-linecap="square"
      stroke-linejoin="miter"
      fill="none"
      style="pointer-events: none; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5));"
    />
    <rect
      x={canvasCoords.x + canvasCoords.width - 14}
      y={canvasCoords.y - 14}
      width="28"
      height="28"
      fill="transparent"
      style="pointer-events: all; cursor: ne-resize;"
      onmousedown={(e) => handleMouseDown(e, 'ne')}
      ontouchstart={(e) => handleMouseDown(e, 'ne')}
    />

    <!-- SW corner -->
    <path
      d="M {canvasCoords.x + cornerLen} {canvasCoords.y + canvasCoords.height + cornerThickness / 2 - 0.5} L {canvasCoords.x - cornerThickness / 2 + 0.5} {canvasCoords.y + canvasCoords.height + cornerThickness / 2 - 0.5} L {canvasCoords.x - cornerThickness / 2 + 0.5} {canvasCoords.y + canvasCoords.height - cornerLen}"
      stroke="var(--tk-handle-fill)"
      stroke-width={cornerThickness}
      stroke-linecap="square"
      stroke-linejoin="miter"
      fill="none"
      style="pointer-events: none; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5));"
    />
    <rect
      x={canvasCoords.x - 14}
      y={canvasCoords.y + canvasCoords.height - 14}
      width="28"
      height="28"
      fill="transparent"
      style="pointer-events: all; cursor: sw-resize;"
      onmousedown={(e) => handleMouseDown(e, 'sw')}
      ontouchstart={(e) => handleMouseDown(e, 'sw')}
    />

    <!-- SE corner -->
    <path
      d="M {canvasCoords.x + canvasCoords.width - cornerLen} {canvasCoords.y + canvasCoords.height + cornerThickness / 2 - 0.5} L {canvasCoords.x + canvasCoords.width + cornerThickness / 2 - 0.5} {canvasCoords.y + canvasCoords.height + cornerThickness / 2 - 0.5} L {canvasCoords.x + canvasCoords.width + cornerThickness / 2 - 0.5} {canvasCoords.y + canvasCoords.height - cornerLen}"
      stroke="var(--tk-handle-fill)"
      stroke-width={cornerThickness}
      stroke-linecap="square"
      stroke-linejoin="miter"
      fill="none"
      style="pointer-events: none; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5));"
    />
    <rect
      x={canvasCoords.x + canvasCoords.width - 14}
      y={canvasCoords.y + canvasCoords.height - 14}
      width="28"
      height="28"
      fill="transparent"
      style="pointer-events: all; cursor: se-resize;"
      onmousedown={(e) => handleMouseDown(e, 'se')}
      ontouchstart={(e) => handleMouseDown(e, 'se')}
    />
  </svg>

  <!-- Pixel dimension badge -->
  <div
    class="dim-badge"
    class:active={isInteracting}
    style="left: {canvasCoords.x + canvasCoords.width / 2}px; top: {canvasCoords.y - 12}px;"
  >
    <span class="dim-num">{displayWidth} × {displayHeight}</span>
    {#if displayRatio}
      <span class="dim-ratio">{displayRatio}</span>
    {/if}
  </div>

  <FloatingRail side="right">
    {#snippet top()}
      <RailButton label={$_('editor.cancel')} variant="default" haptics="light" onclick={onCancel}>
        <X size={20} strokeWidth={2.2} />
      </RailButton>
      <RailButton label={$_('editor.apply')} variant="accent" haptics="success" onclick={apply}>
        <Check size={20} strokeWidth={2.4} />
      </RailButton>
    {/snippet}

    {#snippet children()}
      <RailButton label={$_('editor.rotateLeft')} onclick={rotateLeft} haptics="light">
        <RotateCcw size={20} strokeWidth={1.8} />
      </RailButton>
      <RailButton label={$_('editor.rotateRight')} onclick={rotateRight} haptics="light">
        <RotateCw size={20} strokeWidth={1.8} />
      </RailButton>
      <RailButton
        label={$_('editor.flipHorizontal')}
        pressed={transform.flipHorizontal}
        haptics={false}
        onclick={toggleFlipHorizontal}
      >
        <FlipHorizontal size={20} strokeWidth={1.8} />
      </RailButton>
      <RailButton
        label={$_('editor.flipVertical')}
        pressed={transform.flipVertical}
        haptics={false}
        onclick={toggleFlipVertical}
      >
        <FlipVertical size={20} strokeWidth={1.8} />
      </RailButton>

      <span class="rail-divider" aria-hidden="true"></span>

      <button
        bind:this={aspectAnchor}
        type="button"
        class="rail-color-trigger"
        class:open={aspectPopoverOpen}
        aria-label="Aspect ratio"
        title="Aspect ratio"
        onclick={toggleAspectPopover}
      >
        <CropIcon size={20} strokeWidth={1.8} />
      </button>

      <RailButton
        label={aspectLocked ? 'Unlock aspect' : 'Lock aspect'}
        pressed={aspectLocked}
        haptics={false}
        onclick={toggleAspectLock}
      >
        {#if aspectLocked}
          <Lock size={18} strokeWidth={2} />
        {:else}
          <Unlock size={18} strokeWidth={2} />
        {/if}
      </RailButton>

      <RailButton label="Swap orientation" haptics="light" onclick={swapOrientation}>
        <Repeat2 size={20} strokeWidth={1.8} />
      </RailButton>

      <RailButton label="Fit to screen" haptics="light" onclick={fitToScreen}>
        <Maximize2 size={18} strokeWidth={2} />
      </RailButton>
    {/snippet}

    {#snippet bottom()}
      <RailButton label={$_('editor.reset')} variant="default" haptics="warning" onclick={resetCrop}>
        <RotateCcwSquare size={18} strokeWidth={1.8} />
      </RailButton>
    {/snippet}
  </FloatingRail>

  <Popover open={aspectPopoverOpen} onClose={() => (aspectPopoverOpen = false)} side="left" anchor={aspectAnchor}>
    {#snippet children()}
      <div class="popover-title">Aspect ratio</div>
      <div class="aspect-grid">
        <button class="aspect-pop-btn" class:active={!aspectLocked} onclick={() => chooseAspect(null)}>Free</button>
        <button class="aspect-pop-btn" onclick={() => chooseAspect(1 / 1)}>1:1</button>
        <button class="aspect-pop-btn" onclick={() => chooseAspect(4 / 5)}>4:5</button>
        <button class="aspect-pop-btn" onclick={() => chooseAspect(5 / 4)}>5:4</button>
        <button class="aspect-pop-btn" onclick={() => chooseAspect(4 / 3)}>4:3</button>
        <button class="aspect-pop-btn" onclick={() => chooseAspect(3 / 4)}>3:4</button>
        <button class="aspect-pop-btn" onclick={() => chooseAspect(3 / 2)}>3:2</button>
        <button class="aspect-pop-btn" onclick={() => chooseAspect(2 / 3)}>2:3</button>
        <button class="aspect-pop-btn" onclick={() => chooseAspect(16 / 9)}>16:9</button>
        <button class="aspect-pop-btn" onclick={() => chooseAspect(9 / 16)}>9:16</button>
      </div>
    {/snippet}
  </Popover>
  </div>
{/if}

<style lang="postcss">
  :global(.aspect-grid) {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--tk-space-2);
  }

  :global(.aspect-pop-btn) {
    appearance: none;
    background: var(--tk-surface-1);
    border: 1px solid var(--tk-border-subtle);
    color: var(--tk-text-secondary);
    padding: var(--tk-space-2) var(--tk-space-3);
    border-radius: var(--tk-radius-md);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--tk-text-sm);
    font-weight: var(--tk-weight-semibold);
    letter-spacing: var(--tk-tracking-tight);
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring);
    -webkit-tap-highlight-color: transparent;
  }
  :global(.aspect-pop-btn:hover) {
    background: var(--tk-surface-hover);
    color: var(--tk-text-primary);
  }
  :global(.aspect-pop-btn:active) {
    transform: scale(0.94);
  }
  :global(.aspect-pop-btn.active) {
    background: var(--tk-accent-soft);
    border-color: var(--tk-accent);
    color: var(--tk-accent-hover);
  }

  .crop-container {
    position: absolute;
    inset: 0;
    z-index: 10;
    cursor: grab;
    touch-action: none;
  }

  .crop-container.panning {
    cursor: grabbing;
  }

  .crop-overlay {
    pointer-events: none;
    z-index: 10;
  }

  /* ─── Dimension badge ─── */
  .dim-badge {
    position: absolute;
    transform: translate(-50%, -100%);
    display: inline-flex;
    align-items: center;
    gap: var(--tk-space-2);
    padding: 6px 12px;
    background: var(--tk-bg-glass-strong);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--tk-border-subtle);
    border-radius: var(--tk-radius-full);
    color: var(--tk-text-primary);
    font-family: var(--tk-font-mono);
    font-size: var(--tk-text-xs);
    font-weight: var(--tk-weight-semibold);
    letter-spacing: 0.04em;
    pointer-events: none;
    z-index: 11;
    white-space: nowrap;
    opacity: 0.65;
    transition:
      opacity var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-medium) var(--tk-ease-spring);
    will-change: opacity, transform;
  }

  .dim-badge.active {
    opacity: 1;
    transform: translate(-50%, calc(-100% - 4px));
  }

  .dim-num {
    color: var(--tk-text-primary);
    font-variant-numeric: tabular-nums;
  }

  .dim-ratio {
    color: var(--tk-accent-hover);
    padding-left: var(--tk-space-2);
    border-left: 1px solid var(--tk-border-strong);
    text-transform: uppercase;
  }

  /* ─── Floating top controls (transform + aspect ratio) ─── */
  .crop-top-controls {
    position: absolute;
    top: var(--tk-space-3);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    flex-direction: column;
    gap: var(--tk-space-2);
    z-index: 20;
    pointer-events: auto;

    @media (max-width: 767px) {
      top: var(--tk-space-2);
      gap: var(--tk-space-2);
      max-width: 92vw;
    }
  }

  .aspect-ratio-controls,
  .transform-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--tk-space-1);
    padding: var(--tk-space-1) var(--tk-space-2);
    background: var(--tk-bg-glass-strong);
    backdrop-filter: var(--tk-blur-sm);
    -webkit-backdrop-filter: var(--tk-blur-sm);
    border: 1px solid var(--tk-border-default);
    border-radius: var(--tk-radius-full);
    box-shadow: var(--tk-shadow-md);
    width: fit-content;
  }

  .transform-controls {
    gap: var(--tk-space-2);
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: var(--tk-space-1);
  }

  .control-label {
    display: none;
  }

  .button-group {
    display: flex;
    gap: 2px;
  }

  .aspect-btn {
    appearance: none;
    background: transparent;
    color: var(--tk-text-secondary);
    border: none;
    padding: 0 var(--tk-space-3);
    height: 36px;
    border-radius: var(--tk-radius-full);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--tk-text-xs);
    font-weight: var(--tk-weight-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tk-tracking-wide);
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out);
    -webkit-tap-highlight-color: transparent;
  }

  .aspect-btn:hover {
    background: var(--tk-surface-hover);
    color: var(--tk-text-primary);
  }
  .aspect-btn:active {
    background: var(--tk-accent-soft);
    color: var(--tk-accent-hover);
  }

  .transform-btn {
    appearance: none;
    width: 36px;
    height: 36px;
    background: transparent;
    color: var(--tk-text-secondary);
    border: none;
    border-radius: var(--tk-radius-md);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring);
    -webkit-tap-highlight-color: transparent;
  }

  .transform-btn:hover {
    background: var(--tk-surface-hover);
    color: var(--tk-text-primary);
  }
  .transform-btn:active {
    transform: scale(0.92);
  }
  .transform-btn.active {
    background: var(--tk-accent-soft);
    color: var(--tk-accent-hover);
  }

  /* ─── Apply / cancel bar ─── */
  .crop-controls {
    position: absolute;
    bottom: var(--tk-space-4);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: var(--tk-space-2);
    z-index: 20;
    pointer-events: auto;
    padding: var(--tk-space-2);
    background: var(--tk-bg-glass-strong);
    backdrop-filter: var(--tk-blur-sm);
    -webkit-backdrop-filter: var(--tk-blur-sm);
    border: 1px solid var(--tk-border-default);
    border-radius: var(--tk-radius-full);
    box-shadow: var(--tk-shadow-md);

    @media (max-width: 767px) {
      bottom: var(--tk-space-3);
    }
  }

  .btn {
    appearance: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: var(--tk-text-sm);
    font-weight: var(--tk-weight-semibold);
    padding: 0 var(--tk-space-5);
    height: 40px;
    border-radius: var(--tk-radius-full);
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring);
    letter-spacing: var(--tk-tracking-tight);
    -webkit-tap-highlight-color: transparent;
  }

  .btn-primary {
    background: var(--tk-accent);
    color: var(--tk-text-on-accent);
  }
  .btn-primary:hover {
    background: var(--tk-accent-hover);
  }
  .btn-primary:active {
    transform: scale(0.96);
  }

  .btn-secondary {
    background: transparent;
    color: var(--tk-text-secondary);
  }
  .btn-secondary:hover {
    background: var(--tk-surface-hover);
    color: var(--tk-text-primary);
  }
</style>
