<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { drawImage, preloadStampImage, applyStamps, applyAnnotations } from '../utils/canvas';
  import { initWebGPUCanvas, uploadImageToGPU, renderWithAdjustments, cleanupWebGPU } from '../utils/webgpu-render';
  import {
    createEditorInteractionState,
    handlePureMouseDown,
    handlePureMouseMove,
    handlePureMouseUp,
    handlePureTouchStart,
    handlePureTouchMove,
    handlePureTouchEnd,
    calculateZoomViewport,
    type EditorInteractionState,
    type EditorContext
  } from '../utils/editor-interaction';
  import type { Viewport, TransformState, CropArea, AdjustmentsState, BlurArea, StampArea, Annotation } from '../types';

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
    annotations?: Annotation[];
    skipAnnotations?: boolean;
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
    annotations = [],
    skipAnnotations = false,
    onZoom,
    onViewportChange
  }: Props = $props();

  // State
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let overlayCanvasElement = $state<HTMLCanvasElement | null>(null);
  let isInitializing = $state(true);
  let useWebGPU = $state(false);
  let webgpuReady = $state(false);
  let currentImage: HTMLImageElement | null = null;
  let imageLoadCounter = $state(0);
  let renderRequested = $state(false);
  let pendingRenderFrame: number | null = null;
  let needsAnotherRender = $state(false);

  // Interaction state (using shared utility)
  let interactionState = $state<EditorInteractionState>(createEditorInteractionState());

  // Editor context for shared handlers
  let editorContext = $derived<EditorContext>({
    canvas: canvasElement,
    image,
    viewport,
    cropArea
  });

  function ensureCanvasSize(canvas: HTMLCanvasElement, w: number, h: number): void {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  onMount(async () => {
    if (!canvasElement) return;

    canvas = canvasElement;

    if (navigator.gpu) {
      const success = await initWebGPUCanvas(canvasElement);
      if (success) {
        useWebGPU = true;
        webgpuReady = true;
      }
    }

    isInitializing = false;

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
        if (success) renderWebGPU();
      });
    }
  });

  // WebGPU: Render when parameters change
  $effect(() => {
    if (useWebGPU && webgpuReady && currentImage && canvasElement) {
      renderWebGPU();
    }
    adjustments.brightness; adjustments.contrast; adjustments.saturation;
    viewport.offsetX; viewport.offsetY; viewport.zoom; viewport.scale;
    transform.rotation; transform.flipHorizontal; transform.flipVertical; transform.scale;
    cropArea; cropArea?.x; cropArea?.y; cropArea?.width; cropArea?.height;
    blurAreas; stampAreas; annotations; width; height;
  });

  // 2D Canvas: Render when parameters change
  $effect(() => {
    if (!isInitializing && !useWebGPU && canvasElement && image) {
      requestRender();
    }
    width; height; viewport; transform; adjustments; cropArea;
    blurAreas; stampAreas; annotations; imageLoadCounter;
  });

  // Preload stamp images
  $effect(() => {
    if (stampAreas) {
      stampAreas.forEach(stamp => {
        if (stamp.stampType === 'image' || stamp.stampType === 'svg') {
          preloadStampImage(stamp.stampContent).then(() => {
            if (!useWebGPU) imageLoadCounter++;
            else renderWebGPU();
          }).catch(console.error);
        }
      });
    }
  });

  function renderWebGPU() {
    if (!canvasElement || !webgpuReady || !currentImage) return;
    ensureCanvasSize(canvasElement, width, height);
    renderWithAdjustments(adjustments, viewport, transform, width, height,
      currentImage.width, currentImage.height, cropArea, blurAreas);

    const shouldRenderAnnotations = !skipAnnotations && annotations.length > 0;
    if (overlayCanvasElement && (stampAreas.length > 0 || shouldRenderAnnotations)) {
      ensureCanvasSize(overlayCanvasElement, width, height);
      const ctx = overlayCanvasElement.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        if (stampAreas.length > 0) applyStamps(overlayCanvasElement, currentImage, viewport, stampAreas, cropArea);
        if (shouldRenderAnnotations) applyAnnotations(overlayCanvasElement, currentImage, viewport, annotations, cropArea);
      }
    } else if (overlayCanvasElement) {
      const ctx = overlayCanvasElement.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, width, height);
    }
  }

  function requestRender() {
    if (renderRequested) { needsAnotherRender = true; return; }
    renderRequested = true;
    needsAnotherRender = false;
    if (pendingRenderFrame !== null) cancelAnimationFrame(pendingRenderFrame);

    pendingRenderFrame = requestAnimationFrame(() => {
      performRender()
        .catch(error => console.error('Render error:', error))
        .finally(() => {
          renderRequested = false;
          pendingRenderFrame = null;
          if (needsAnotherRender) { needsAnotherRender = false; requestRender(); }
        });
    });
  }

  async function performRender() {
    if (!canvasElement || !image) return;
    canvasElement.width = width;
    canvasElement.height = height;
    await drawImage(canvasElement, image, viewport, transform, adjustments, cropArea, blurAreas, stampAreas, skipAnnotations ? [] : annotations);
  }

  // Event handlers using shared utilities directly
  function handleMouseDown(e: MouseEvent) {
    const newState = handlePureMouseDown(e, interactionState);
    if (newState) interactionState = newState;
  }

  function handleMouseMove(e: MouseEvent) {
    const result = handlePureMouseMove(e, interactionState, editorContext);
    if (result) {
      interactionState = result.state;
      if (onViewportChange) onViewportChange(result.viewportUpdate);
    }
  }

  function handleMouseUp() {
    interactionState = handlePureMouseUp(interactionState);
  }

  function handleTouchStart(e: TouchEvent) {
    interactionState = handlePureTouchStart(e, interactionState, viewport);
  }

  function handleTouchMove(e: TouchEvent) {
    const result = handlePureTouchMove(e, interactionState, editorContext);
    if (result) {
      interactionState = result.state;
      if (result.viewportUpdate && onViewportChange) onViewportChange(result.viewportUpdate);
      if (result.zoomInfo && onZoom) onZoom(result.zoomInfo.delta, result.zoomInfo.centerX, result.zoomInfo.centerY);
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    interactionState = handlePureTouchEnd(e, interactionState);
  }
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

<div class="canvas-container">
  <canvas
    bind:this={canvasElement}
    {width} {height}
    class="editor-canvas"
    class:panning={interactionState.isPanning}
    style="max-width: 100%; max-height: {height}px;"
    onmousedown={handleMouseDown}
  ></canvas>

  {#if useWebGPU}
    <canvas
      bind:this={overlayCanvasElement}
      {width} {height}
      class="overlay-canvas"
      style="max-width: 100%; max-height: {height}px; pointer-events: none;"
    ></canvas>
  {/if}

  {#if useWebGPU && webgpuReady}
    <div class="gpu-indicator"><span class="gpu-badge">WebGPU</span></div>
  {/if}
</div>

<style lang="postcss">
  .canvas-container { position: relative; display: inline-block; }
  .editor-canvas { display: block; background: #000; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
  .editor-canvas.panning { cursor: grabbing; }
  .overlay-canvas { position: absolute; top: 0; left: 0; display: block; pointer-events: none; }
  .gpu-indicator { position: absolute; top: 10px; right: 10px; pointer-events: none; z-index: 10; }
  .gpu-badge { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3); text-transform: uppercase; }
</style>
