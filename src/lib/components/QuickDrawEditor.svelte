<script lang="ts">
  import { onMount } from 'svelte';
  import type { TransformState, AdjustmentsState, Viewport } from '../types';
  import { createDefaultAdjustments } from '../utils/adjustments';
  import { imagePointsToCanvasCoords, getTotalScale, type CoordinateContext } from '../utils/coordinates';
  import { generateSmoothPath, generateBrushPath } from '../utils/drawing';
  import { shouldPan, type EditorContext } from '../utils/editor-interaction';
  import {
    loadImageFromFile,
    loadImageFromUrl,
    createBlankImage,
    createQuickDrawState,
    applyQuickDrawImage,
    handleQuickDrawKeyDown,
    handleQuickDrawKeyUp,
    handleQuickDrawMouseDown,
    handleQuickDrawMouseMove,
    handleQuickDrawMouseUp,
    handleQuickDrawTouchStart,
    handleQuickDrawTouchMove,
    handleQuickDrawTouchEnd,
    handleQuickDrawWheel,
    handleQuickDrawViewportChange,
    handleQuickDrawZoom,
    quickDrawUndo,
    exportQuickDraw,
    type QuickDrawState
  } from '../utils/editor-core';
  import { DEFAULT_COLOR_PRESETS, DEFAULT_STROKE_WIDTH } from '../utils/colors';
  import Canvas from './Canvas.svelte';
  import { Pencil, Brush } from 'lucide-svelte';

  interface Props {
    width?: number;
    initialImage?: File | string;
    colorPresets?: string[];
    onComplete: (dataUrl: string, blobObj: { blob: Blob; width: number; height: number }) => void;
    onCancel?: () => void;
  }

  let {
    width = 400,
    initialImage,
    colorPresets = DEFAULT_COLOR_PRESETS as unknown as string[],
    onComplete,
    onCancel
  }: Props = $props();

  // Canvas reference
  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let overlayElement = $state<HTMLDivElement | null>(null);

  // Canvas dimensions - always square (1:1 aspect ratio)
  let canvasSize = $derived(width);

  // Tool settings (UI-specific state)
  let currentTool = $state<'pen' | 'brush'>('pen');
  let currentColor = $state(colorPresets[0]);
  let strokeWidth = $state(DEFAULT_STROKE_WIDTH);
  let showStrokePopup = $state(false);

  // Main state (using single state variable pattern like ImageEditor)
  let state = $state<QuickDrawState>(createQuickDrawState());

  // Transform and adjustments (constants)
  const transform: TransformState = { rotation: 0, flipHorizontal: false, flipVertical: false, scale: 1 };
  const adjustments: AdjustmentsState = createDefaultAdjustments();

  // Editor context for shared handlers
  let editorContext = $derived<EditorContext>({
    canvas: canvasElement,
    image: state.image,
    viewport: state.viewport,
    cropArea: null
  });

  // Coordinate context for SVG rendering
  let coordContext = $derived<CoordinateContext | null>(
    canvasElement && state.image
      ? { canvas: canvasElement, image: state.image, viewport: state.viewport, cropArea: null }
      : null
  );

  // Combined annotations for display
  let displayAnnotations = $derived(
    state.interactionState.currentAnnotation
      ? [...state.annotations, state.interactionState.currentAnnotation]
      : state.annotations
  );

  // Load background image (canvas is always square)
  async function loadBackgroundImage(): Promise<{ image: HTMLImageElement; fitScale: number }> {
    if (initialImage) {
      if (typeof initialImage === 'string') {
        const result = await loadImageFromUrl(initialImage, canvasSize, canvasSize);
        return { image: result.image, fitScale: result.fitScale };
      } else {
        const result = await loadImageFromFile(initialImage, canvasSize, canvasSize);
        return { image: result.image, fitScale: result.fitScale };
      }
    } else {
      // Blank image is also square
      const result = await createBlankImage(canvasSize, canvasSize);
      return { image: result.image, fitScale: result.fitScale };
    }
  }

  // Event handlers - simplified using state = function(state, ...) pattern
  function handleKeyDown(event: KeyboardEvent) {
    state = handleQuickDrawKeyDown(state, event);
  }

  function handleKeyUp(event: KeyboardEvent) {
    state = handleQuickDrawKeyUp(state, event);
  }

  function handleMouseDown(event: MouseEvent) {
    state = handleQuickDrawMouseDown(state, event, editorContext, currentTool, currentColor, strokeWidth);
  }

  function handleMouseMove(event: MouseEvent) {
    state = handleQuickDrawMouseMove(state, event, editorContext, currentTool, strokeWidth);
  }

  function handleMouseUp() {
    state = handleQuickDrawMouseUp(state, currentTool);
  }

  function handleTouchStart(event: TouchEvent) {
    state = handleQuickDrawTouchStart(state, event, editorContext, currentTool, currentColor, strokeWidth);
  }

  function handleTouchMove(event: TouchEvent) {
    const canvasRect = canvasElement?.getBoundingClientRect() ?? null;
    state = handleQuickDrawTouchMove(state, event, editorContext, currentTool, strokeWidth, canvasSize, canvasSize, canvasRect);
  }

  function handleTouchEnd(event: TouchEvent) {
    state = handleQuickDrawTouchEnd(state, event, currentTool);
  }

  function handleWheel(event: WheelEvent) {
    if (!canvasElement) return;
    state = handleQuickDrawWheel(state, event, canvasSize, canvasSize, canvasElement.getBoundingClientRect());
  }

  function handleViewportChange(viewportUpdate: Partial<Viewport>) {
    state = handleQuickDrawViewportChange(state, viewportUpdate);
  }

  function handleZoom(delta: number, centerX?: number, centerY?: number) {
    if (!canvasElement) return;
    state = handleQuickDrawZoom(state, delta, canvasSize, canvasSize, canvasElement.getBoundingClientRect(), centerX, centerY);
  }

  async function handlePost() {
    const result = await exportQuickDraw(state);
    if (!result) return;
    onComplete(result.dataUrl, { blob: result.blob, width: result.width, height: result.height });
  }

  function handleUndo() {
    state = quickDrawUndo(state);
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (showStrokePopup && !target.closest('.stroke-control')) {
      showStrokePopup = false;
    }
  }

  onMount(async () => {
    try {
      const result = await loadBackgroundImage();
      state = applyQuickDrawImage(state, result.image, result.fitScale);
    } catch (error) {
      console.error('Failed to load background image:', error);
    }

    if (overlayElement) {
      overlayElement.addEventListener('touchstart', handleTouchStart as any, { passive: false });
      overlayElement.addEventListener('touchmove', handleTouchMove as any, { passive: false });
      overlayElement.addEventListener('touchend', handleTouchEnd as any, { passive: false });
    }
    return () => {
      if (overlayElement) {
        overlayElement.removeEventListener('touchstart', handleTouchStart as any);
        overlayElement.removeEventListener('touchmove', handleTouchMove as any);
        overlayElement.removeEventListener('touchend', handleTouchEnd as any);
      }
    };
  });
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} onmousemove={handleMouseMove} onmouseup={handleMouseUp} onclick={handleClickOutside} />

<div class="quick-draw-editor" style="width: {canvasSize}px;">
  <div class="canvas-wrapper" onwheel={handleWheel}>
    <Canvas
      bind:canvas={canvasElement}
      width={canvasSize}
      height={canvasSize}
      image={state.image}
      viewport={state.viewport}
      {transform}
      {adjustments}
      annotations={displayAnnotations}
      skipAnnotations={true}
      onViewportChange={handleViewportChange}
      onZoom={handleZoom}
    />

    <div
      bind:this={overlayElement}
      class="drawing-overlay"
      class:panning={shouldPan(state.interactionState) || state.interactionState.isPanning}
      onmousedown={handleMouseDown}
      role="button"
      tabindex="-1"
    >
      <svg class="annotation-svg">
        {#each state.annotations as annotation (annotation.id)}
          {#if coordContext}
            {@const canvasPoints = imagePointsToCanvasCoords(annotation.points, coordContext)}
            {@const totalScale = getTotalScale(state.viewport)}
            {#if annotation.type === 'pen' && canvasPoints.length > 0}
              {#if canvasPoints.length === 1}
                <circle cx={canvasPoints[0].x} cy={canvasPoints[0].y} r={annotation.strokeWidth * totalScale / 2} fill={annotation.color} />
              {:else}
                <path d={generateSmoothPath(canvasPoints)} fill="none" stroke={annotation.color} stroke-width={annotation.strokeWidth * totalScale} stroke-linecap="round" stroke-linejoin="round" />
              {/if}
            {:else if annotation.type === 'brush' && canvasPoints.length >= 1}
              <path d={generateBrushPath(canvasPoints, annotation.strokeWidth, totalScale)} fill={annotation.color} stroke="none" />
            {/if}
          {/if}
        {/each}

        {#if state.interactionState.currentAnnotation && coordContext}
          {@const canvasPoints = imagePointsToCanvasCoords(state.interactionState.currentAnnotation.points, coordContext)}
          {@const totalScale = getTotalScale(state.viewport)}
          {#if state.interactionState.currentAnnotation.type === 'pen' && canvasPoints.length > 0}
            {#if canvasPoints.length === 1}
              <circle cx={canvasPoints[0].x} cy={canvasPoints[0].y} r={state.interactionState.currentAnnotation.strokeWidth * totalScale / 2} fill={state.interactionState.currentAnnotation.color} />
            {:else}
              <path d={generateSmoothPath(canvasPoints)} fill="none" stroke={state.interactionState.currentAnnotation.color} stroke-width={state.interactionState.currentAnnotation.strokeWidth * totalScale} stroke-linecap="round" stroke-linejoin="round" />
            {/if}
          {:else if state.interactionState.currentAnnotation.type === 'brush' && canvasPoints.length >= 1}
            <path d={generateBrushPath(canvasPoints, state.interactionState.currentAnnotation.strokeWidth, totalScale)} fill={state.interactionState.currentAnnotation.color} stroke="none" />
          {/if}
        {/if}
      </svg>
    </div>
  </div>

  <div class="toolbar">
    <div class="tool-group">
      <button class="tool-btn" class:active={currentTool === 'pen'} onclick={() => currentTool = 'pen'} title="Pen"><Pencil size={18} /></button>
      <button class="tool-btn" class:active={currentTool === 'brush'} onclick={() => currentTool = 'brush'} title="Brush"><Brush size={18} /></button>
    </div>
    <div class="stroke-control">
      <button
        class="stroke-trigger"
        onclick={() => showStrokePopup = !showStrokePopup}
        title="Stroke width ({strokeWidth}px)"
      >
        <span class="stroke-indicator" style="height: {Math.min(strokeWidth, 12)}px;"></span>
      </button>
      {#if showStrokePopup}
        <div class="stroke-popup">
          <input
            type="range"
            class="stroke-slider"
            min="2"
            max="32"
            bind:value={strokeWidth}
          />
          <span class="stroke-value">{strokeWidth}px</span>
        </div>
      {/if}
    </div>
    <div class="color-group">
      {#each colorPresets.slice(0, 3) as color}
        <button class="color-btn" class:active={currentColor === color} style="background-color: {color}" onclick={() => currentColor = color} title={color}></button>
      {/each}
      <input
        type="color"
        class="color-picker"
        value={currentColor}
        oninput={(e) => currentColor = e.currentTarget.value}
      />
    </div>
    <div class="action-group">
      <button class="undo-btn" onclick={handleUndo} disabled={state.annotations.length === 0} title="Undo">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>
      </button>
      <button class="post-btn" onclick={handlePost} disabled={state.annotations.length === 0}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>
      </button>
    </div>
  </div>
</div>

<style>
    .quick-draw-editor {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .canvas-wrapper {
        position: relative;
        border-radius: 12px;
        overflow: hidden;
    }

    .canvas-wrapper :global(.canvas-container) {
        display: block;
    }

    .canvas-wrapper :global(.editor-canvas) {
        max-width: none !important;
        max-height: none !important;
        pointer-events: none;
    }

    .canvas-wrapper :global(.overlay-canvas) {
        max-width: none !important;
        max-height: none !important;
    }

    .canvas-wrapper :global(.gpu-indicator) {
        display: none;
    }

    .drawing-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        cursor: crosshair;
        user-select: none;
        touch-action: none;
    }

    .drawing-overlay.panning {
        cursor: grab;
    }

    .drawing-overlay.panning:active {
        cursor: grabbing;
    }

    .annotation-svg {
        width: 100%;
        height: 100%;
        pointer-events: none;
    }

    .toolbar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 8px 12px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
        width: 100%;
        box-sizing: border-box;
    }

    .tool-group {
        display: flex;
        gap: 4px;
    }

    .tool-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: #64748b;
        cursor: pointer;
        transition: all 0.15s;
    }

    .tool-btn:hover {
        background: #f1f5f9;
        color: #334155;
    }

    .tool-btn.active {
        background: #e0e7ff;
        color: #4f46e5;
    }

    .stroke-control {
        position: relative;
    }

    .stroke-trigger {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 8px;
        background: #f1f5f9;
        cursor: pointer;
        transition: all 0.15s;
    }

    .stroke-trigger:hover {
        background: #e2e8f0;
    }

    .stroke-indicator {
        width: 16px;
        background: #64748b;
        border-radius: 2px;
    }

    .stroke-popup {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        z-index: 10;
    }

    .stroke-slider {
        width: 80px;
        height: 4px;
        background: #e2e8f0;
        border-radius: 2px;
        outline: none;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
    }

    .stroke-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        background: #4f46e5;
        border-radius: 50%;
        cursor: pointer;
        transition: transform 0.15s;
    }

    .stroke-slider::-webkit-slider-thumb:hover {
        transform: scale(1.15);
    }

    .stroke-slider::-moz-range-thumb {
        width: 14px;
        height: 14px;
        background: #4f46e5;
        border: none;
        border-radius: 50%;
        cursor: pointer;
    }

    .stroke-value {
        font-size: 11px;
        color: #64748b;
        font-weight: 500;
        min-width: 28px;
        text-align: right;
    }

    .color-group {
        display: flex;
        gap: 6px;
        padding: 0 8px;
        border-left: 1px solid #e2e8f0;
        border-right: 1px solid #e2e8f0;
    }

    .color-btn {
        width: 24px;
        height: 24px;
        border: 2px solid transparent;
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.15s;
    }

    .color-btn:hover {
        transform: scale(1.1);
    }

    .color-btn.active {
        border-color: #1e293b;
        box-shadow: 0 0 0 2px white, 0 0 0 4px currentColor;
    }

    .color-picker {
        width: 24px;
        height: 24px;
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
        border: 1px solid #e2e8f0;
    }

    .action-group {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .undo-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 8px;
        background: #f1f5f9;
        color: #64748b;
        cursor: pointer;
        transition: all 0.15s;
    }

    .undo-btn:hover:not(:disabled) {
        background: #e2e8f0;
        color: #334155;
    }

    .undo-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .post-btn {
        width: 32px;
        height: 32px;
        display: grid;
        place-content: center;
        border: none;
        border-radius: 50%;
        background: var(--primary-color, #000);
        color: white;
        cursor: pointer;
        transition: all 0.15s;
    }

    .post-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
    }

    .post-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>
