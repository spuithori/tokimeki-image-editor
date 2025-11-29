<script lang="ts">
  import { onMount } from 'svelte';
  import { drawImage, preloadStampImage } from '../utils/canvas';
  import type { Viewport, TransformState, CropArea, AdjustmentsState, BlurArea, StampArea } from '../types';

  interface Props {
    canvas?: HTMLCanvasElement | null;
    width: number;
    height: number;
    image: HTMLImageElement | null;
    viewport: Viewport;
    transform: TransformState;
    adjustments: AdjustmentsState;
    cropArea?: CropArea | null;
    blurAreas?: BlurArea[];
    stampAreas?: StampArea[];
    onZoom?: (delta: number, centerX?: number, centerY?: number) => void;
  }

  let {
    canvas = $bindable(null),
    width,
    height,
    image,
    viewport,
    transform,
    adjustments,
    cropArea = null,
    blurAreas = [],
    stampAreas = [],
    onZoom
  }: Props = $props();

  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let isPanning = $state(false);
  let lastPanPosition = $state({ x: 0, y: 0 });
  let imageLoadCounter = $state(0); // Trigger redraw when images load
  let initialPinchDistance = $state(0);
  let initialZoom = $state(1);

  onMount(() => {
    if (canvasElement) {
      canvas = canvasElement;

      // Add touch event listeners with passive: false to allow preventDefault
      canvasElement.addEventListener('touchstart', handleTouchStart, { passive: false });
      canvasElement.addEventListener('touchmove', handleTouchMove, { passive: false });
      canvasElement.addEventListener('touchend', handleTouchEnd, { passive: false });
    }

    return () => {
      // Cleanup event listeners
      if (canvasElement) {
        canvasElement.removeEventListener('touchstart', handleTouchStart);
        canvasElement.removeEventListener('touchmove', handleTouchMove);
        canvasElement.removeEventListener('touchend', handleTouchEnd);
      }
    };
  });

  // Preload stamp images
  $effect(() => {
    if (!stampAreas) return;

    stampAreas.forEach(stamp => {
      if (stamp.stampType === 'image' || stamp.stampType === 'svg') {
        preloadStampImage(stamp.stampContent).then(() => {
          // Trigger redraw when image loads
          imageLoadCounter++;
        }).catch(console.error);
      }
    });
  });

  // Draw canvas
  $effect(() => {
    if (canvasElement && image) {
      canvasElement.width = width;
      canvasElement.height = height;
      drawImage(canvasElement, image, viewport, transform, adjustments, cropArea, blurAreas, stampAreas);
    }
    // Include imageLoadCounter as dependency to redraw when images load
    imageLoadCounter;
  });

  function handleMouseDown(e: MouseEvent) {
    // Left mouse button (0) or Middle mouse button (1) for panning
    if (e.button === 0 || e.button === 1) {
      isPanning = true;
      lastPanPosition = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (isPanning && image && canvasElement) {
      const deltaX = e.clientX - lastPanPosition.x;
      const deltaY = e.clientY - lastPanPosition.y;

      // Calculate actual image dimensions after crop and scale
      const imgWidth = cropArea ? cropArea.width : image.width;
      const imgHeight = cropArea ? cropArea.height : image.height;
      const totalScale = viewport.scale * viewport.zoom;
      const scaledWidth = imgWidth * totalScale;
      const scaledHeight = imgHeight * totalScale;

      // Allow 20% overflow outside canvas
      const overflowMargin = 0.2;
      const maxOffsetX = (scaledWidth / 2) - (canvasElement.width / 2) + (canvasElement.width * overflowMargin);
      const maxOffsetY = (scaledHeight / 2) - (canvasElement.height / 2) + (canvasElement.height * overflowMargin);

      // Apply limits
      const newOffsetX = viewport.offsetX + deltaX;
      const newOffsetY = viewport.offsetY + deltaY;

      viewport.offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, newOffsetX));
      viewport.offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, newOffsetY));

      lastPanPosition = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }

  function handleMouseUp() {
    isPanning = false;
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      // Single finger panning
      isPanning = true;
      lastPanPosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      e.preventDefault();
    } else if (e.touches.length === 2) {
      // Pinch zoom - stop panning
      isPanning = false;
      e.preventDefault();
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (e.touches.length === 1 && isPanning && image && canvasElement) {
      // Single finger panning
      e.preventDefault();

      const touch = e.touches[0];
      const deltaX = touch.clientX - lastPanPosition.x;
      const deltaY = touch.clientY - lastPanPosition.y;

      // Calculate actual image dimensions after crop and scale
      const imgWidth = cropArea ? cropArea.width : image.width;
      const imgHeight = cropArea ? cropArea.height : image.height;
      const totalScale = viewport.scale * viewport.zoom;
      const scaledWidth = imgWidth * totalScale;
      const scaledHeight = imgHeight * totalScale;

      // Allow 20% overflow outside canvas
      const overflowMargin = 0.2;
      const maxOffsetX = (scaledWidth / 2) - (canvasElement.width / 2) + (canvasElement.width * overflowMargin);
      const maxOffsetY = (scaledHeight / 2) - (canvasElement.height / 2) + (canvasElement.height * overflowMargin);

      // Apply limits
      const newOffsetX = viewport.offsetX + deltaX;
      const newOffsetY = viewport.offsetY + deltaY;

      viewport.offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, newOffsetX));
      viewport.offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, newOffsetY));

      lastPanPosition = { x: touch.clientX, y: touch.clientY };
    } else if (e.touches.length === 2) {
      // Pinch zoom
      e.preventDefault();

      const touch1 = e.touches[0];
      const touch2 = e.touches[1];

      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      if (initialPinchDistance === 0) {
        initialPinchDistance = distance;
        initialZoom = viewport.zoom;
      } else {
        const scale = distance / initialPinchDistance;
        const newZoom = Math.max(0.1, Math.min(5, initialZoom * scale));
        const delta = newZoom - viewport.zoom;

        const centerX = (touch1.clientX + touch2.clientX) / 2;
        const centerY = (touch1.clientY + touch2.clientY) / 2;

        if (onZoom) {
          onZoom(delta, centerX, centerY);
        }
      }
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (e.touches.length === 0) {
      isPanning = false;
      initialPinchDistance = 0;
    } else if (e.touches.length === 1) {
      // Switched from pinch to pan
      initialPinchDistance = 0;
      isPanning = true;
      lastPanPosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }
</script>

<svelte:window
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
/>

<canvas
  bind:this={canvasElement}
  class="editor-canvas"
  class:panning={isPanning}
  style="max-width: 100%; max-height: {height}px;"
  onmousedown={handleMouseDown}
></canvas>

<style lang="postcss">
  .editor-canvas {
    display: block;
    background: #000;
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .editor-canvas.panning {
    cursor: grabbing;
  }
</style>
