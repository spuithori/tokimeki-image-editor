<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { drawImage, preloadStampImage, applyStamps } from '../utils/canvas';
  import { initWebGPUCanvas, uploadImageToGPU, renderWithAdjustments, cleanupWebGPU, isWebGPUInitialized } from '../utils/webgpu-render';
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
    onViewportChange?: (viewportUpdate: Partial<Viewport>) => void;
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
    onZoom,
    onViewportChange
  }: Props = $props();

  // Constants
  const PAN_OVERFLOW_MARGIN = 0.2; // Allow 20% overflow when panning

  // State
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let overlayCanvasElement = $state<HTMLCanvasElement | null>(null);
  let isInitializing = $state(true);  // Prevent 2D rendering before WebGPU check
  let useWebGPU = $state(false);
  let webgpuReady = $state(false);
  let currentImage: HTMLImageElement | null = null;

  // 2D Canvas fallback state
  let isPanning = $state(false);
  let lastPanPosition = $state({ x: 0, y: 0 });
  let imageLoadCounter = $state(0); // Incremented to trigger re-render when stamp images load
  let initialPinchDistance = $state(0);
  let initialZoom = $state(1);
  let renderRequested = $state(false);
  let pendingRenderFrame: number | null = null;
  let needsAnotherRender = $state(false);

  // Helper functions
  function ensureCanvasSize(canvas: HTMLCanvasElement, w: number, h: number): void {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function calculatePanOffset(
    deltaX: number,
    deltaY: number
  ): { clampedOffsetX: number; clampedOffsetY: number } | null {
    if (!image || !canvasElement) return null;

    const imgWidth = cropArea ? cropArea.width : image.width;
    const imgHeight = cropArea ? cropArea.height : image.height;
    const totalScale = viewport.scale * viewport.zoom;
    const scaledWidth = imgWidth * totalScale;
    const scaledHeight = imgHeight * totalScale;

    const maxOffsetX = (scaledWidth / 2) - (canvasElement.width / 2) + (canvasElement.width * PAN_OVERFLOW_MARGIN);
    const maxOffsetY = (scaledHeight / 2) - (canvasElement.height / 2) + (canvasElement.height * PAN_OVERFLOW_MARGIN);

    const newOffsetX = viewport.offsetX + deltaX;
    const newOffsetY = viewport.offsetY + deltaY;

    const clampedOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, newOffsetX));
    const clampedOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, newOffsetY));

    return { clampedOffsetX, clampedOffsetY };
  }

  onMount(async () => {
    if (!canvasElement) return;

    canvas = canvasElement;

    // Try WebGPU first
    if (navigator.gpu) {
      console.log('Attempting WebGPU initialization...');
      const success = await initWebGPUCanvas(canvasElement);
      if (success) {
        useWebGPU = true;
        webgpuReady = true;
        console.log('✅ Using WebGPU rendering');
      } else {
        console.log('⚠️ WebGPU not available, using 2D Canvas fallback');
        useWebGPU = false;
      }
    } else {
      console.log('⚠️ WebGPU not available, using 2D Canvas fallback');
      useWebGPU = false;
    }

    isInitializing = false;

    // Setup touch event listeners (common for both modes)
    canvasElement.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvasElement.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvasElement.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      if (canvasElement) {
        canvasElement.removeEventListener('touchstart', handleTouchStart);
        canvasElement.removeEventListener('touchmove', handleTouchMove);
        canvasElement.removeEventListener('touchend', handleTouchEnd);
      }
    };
  });

  onDestroy(() => {
    if (useWebGPU) {
      cleanupWebGPU();
    }
  });

  // WebGPU: Upload image when it changes
  $effect(() => {
    if (useWebGPU && webgpuReady && image && image !== currentImage) {
      currentImage = image;
      uploadImageToGPU(image).then((success) => {
        if (success) {
          renderWebGPU();
        }
      });
    }
  });

  // WebGPU: Render when parameters change
  $effect(() => {
    if (useWebGPU && webgpuReady && currentImage && canvasElement) {
      renderWebGPU();
    }
    // Track object properties explicitly for reactivity
    adjustments.brightness;
    adjustments.contrast;
    adjustments.saturation;
    viewport.offsetX;
    viewport.offsetY;
    viewport.zoom;
    viewport.scale;
    transform.rotation;
    transform.flipHorizontal;
    transform.flipVertical;
    transform.scale;
    // Track cropArea object itself and its properties
    cropArea;
    cropArea?.x;
    cropArea?.y;
    cropArea?.width;
    cropArea?.height;
    blurAreas;
    stampAreas;
    width;
    height;
  });

  // 2D Canvas: Render when parameters change
  $effect(() => {
    if (!isInitializing && !useWebGPU && canvasElement && image) {
      requestRender();
    }
    // Dependencies
    width;
    height;
    viewport;
    transform;
    adjustments;
    cropArea;
    blurAreas;
    stampAreas;
    imageLoadCounter;
  });

  // Preload stamp images
  $effect(() => {
    if (stampAreas) {
      stampAreas.forEach(stamp => {
        if (stamp.stampType === 'image' || stamp.stampType === 'svg') {
          preloadStampImage(stamp.stampContent).then(() => {
            if (!useWebGPU) {
              imageLoadCounter++;
            } else {
              // Trigger re-render for WebGPU mode
              renderWebGPU();
            }
          }).catch(console.error);
        }
      });
    }
  });

  function renderWebGPU() {
    if (!canvasElement || !webgpuReady || !currentImage) return;

    ensureCanvasSize(canvasElement, width, height);

    renderWithAdjustments(
      adjustments,
      viewport,
      transform,
      width,
      height,
      currentImage.width,
      currentImage.height,
      cropArea,
      blurAreas
    );

    // Render stamps on overlay canvas
    if (overlayCanvasElement && stampAreas.length > 0) {
      ensureCanvasSize(overlayCanvasElement, width, height);

      // Clear overlay canvas
      const ctx = overlayCanvasElement.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        applyStamps(overlayCanvasElement, currentImage, viewport, stampAreas, cropArea);
      }
    } else if (overlayCanvasElement) {
      // Clear overlay if no stamps
      const ctx = overlayCanvasElement.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    }
  }

  // === 2D Canvas Fallback Implementation ===

  function requestRender() {
    if (renderRequested) {
      needsAnotherRender = true;
      return;
    }

    renderRequested = true;
    needsAnotherRender = false;
    if (pendingRenderFrame !== null) {
      cancelAnimationFrame(pendingRenderFrame);
    }

    pendingRenderFrame = requestAnimationFrame(() => {
      performRender()
        .catch(error => {
          console.error('Render error:', error);
        })
        .finally(() => {
          renderRequested = false;
          pendingRenderFrame = null;

          if (needsAnotherRender) {
            needsAnotherRender = false;
            requestRender();
          }
        });
    });
  }

  async function performRender() {
    if (!canvasElement || !image) return;

    canvasElement.width = width;
    canvasElement.height = height;

    await drawImage(
      canvasElement,
      image,
      viewport,
      transform,
      adjustments,
      cropArea,
      blurAreas,
      stampAreas
    );
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button === 0 || e.button === 1) {
      isPanning = true;
      lastPanPosition = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (isPanning) {
      const deltaX = e.clientX - lastPanPosition.x;
      const deltaY = e.clientY - lastPanPosition.y;

      const result = calculatePanOffset(deltaX, deltaY);
      if (result && onViewportChange) {
        onViewportChange({ offsetX: result.clampedOffsetX, offsetY: result.clampedOffsetY });
      }

      lastPanPosition = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }

  function handleMouseUp() {
    isPanning = false;
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      isPanning = true;
      lastPanPosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      e.preventDefault();
    } else if (e.touches.length === 2) {
      isPanning = false;
      e.preventDefault();
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (e.touches.length === 1 && isPanning) {
      e.preventDefault();

      const touch = e.touches[0];
      const deltaX = touch.clientX - lastPanPosition.x;
      const deltaY = touch.clientY - lastPanPosition.y;

      const result = calculatePanOffset(deltaX, deltaY);
      if (result && onViewportChange) {
        onViewportChange({ offsetX: result.clampedOffsetX, offsetY: result.clampedOffsetY });
      }

      lastPanPosition = { x: touch.clientX, y: touch.clientY };
    } else if (e.touches.length === 2) {
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

<div class="canvas-container">
  <canvas
    bind:this={canvasElement}
    width={width}
    height={height}
    class="editor-canvas"
    class:panning={isPanning}
    style="max-width: 100%; max-height: {height}px;"
    onmousedown={handleMouseDown}
  ></canvas>

  {#if useWebGPU}
    <canvas
      bind:this={overlayCanvasElement}
      width={width}
      height={height}
      class="overlay-canvas"
      style="max-width: 100%; max-height: {height}px; pointer-events: none;"
    ></canvas>
  {/if}

  {#if useWebGPU && webgpuReady}
    <div class="gpu-indicator">
      <span class="gpu-badge">WebGPU</span>
    </div>
  {/if}
</div>

<style lang="postcss">
  .canvas-container {
    position: relative;
    display: inline-block;
  }

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

  .overlay-canvas {
    position: absolute;
    top: 0;
    left: 0;
    display: block;
    pointer-events: none;
  }

  .gpu-indicator {
    position: absolute;
    top: 10px;
    right: 10px;
    pointer-events: none;
    z-index: 10;
  }

  .gpu-badge {
    display: inline-block;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
    text-transform: uppercase;
  }
</style>
