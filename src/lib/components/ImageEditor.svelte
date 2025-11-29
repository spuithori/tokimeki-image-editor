<script lang="ts">
  import '$lib/i18n';
  import { _ } from 'svelte-i18n';
  import { Redo2, RotateCcw, Undo2 } from 'lucide-svelte';
  import type { EditorMode, EditorState, CropArea, TransformState, Viewport, AdjustmentsState, BlurArea } from '../types';
  import { loadImage, calculateFitScale, exportCanvas, downloadImage, applyTransform } from '../utils/canvas';
  import { createEmptyHistory, createSnapshot, addToHistory, undo, redo, canUndo, canRedo } from '../utils/history';
  import { createDefaultAdjustments } from '../utils/adjustments';
  import Toolbar from './Toolbar.svelte';
  import Canvas from './Canvas.svelte';
  import CropTool from './CropTool.svelte';
  import AdjustTool from './AdjustTool.svelte';
  import FilterTool from './FilterTool.svelte';
  import BlurTool from './BlurTool.svelte';
  import StampTool from './StampTool.svelte';
  import ExportTool from './ExportTool.svelte';

  interface Props {
    initialImage?: File | string;
    width?: number;
    height?: number;
    isStandalone?: boolean;
    onComplete?: (dataUrl: string, blobObj: {blob: Blob, width: number, height: number}) => void;
    onCancel?: () => void;
    onExport?: (dataUrl: string) => void;
  }

  let {
    initialImage,
    width = 800,
    height = 600,
    isStandalone = false,
    onComplete,
    onCancel,
    onExport
  }: Props = $props();

  let state = $state<EditorState>({
    mode: null,
    imageData: {
      original: null,
      current: null,
      width: 0,
      height: 0
    },
    cropArea: null,
    transform: {
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      scale: 1
    },
    adjustments: createDefaultAdjustments(),
    exportOptions: {
      format: 'png',
      quality: 0.9
    },
    viewport: {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      scale: 1
    },
    history: createEmptyHistory(),
    blurAreas: [],
    stampAreas: []
  });

  let canvasElement = $state<HTMLCanvasElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let adjustmentThrottleTimer: number | null = null;
  let pendingAdjustments: Partial<AdjustmentsState> | null = null;
  let lastInitialImage = $state<File | string | undefined>(undefined);

  let clientWidth = $state<number | undefined>(undefined);
  let clientHeight = $state<number | undefined>(undefined);

  // Load initial image when provided
  $effect(() => {
    if (initialImage && initialImage !== lastInitialImage) {
      lastInitialImage = initialImage;

      if (typeof initialImage === 'string') {
        // URL or Data URL
        const img = new Image();
        img.onload = () => {
          state.imageData.original = img;
          state.imageData.current = img;
          state.imageData.width = img.width;
          state.imageData.height = img.height;

          // Calculate fit scale
          const fitScale = calculateFitScale(img.width, img.height, width, height);

          // Reset state
          state.cropArea = null;
          state.transform = {
            rotation: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1
          };
          state.viewport = {
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
            scale: fitScale
          };
          state.blurAreas = [];
          state.stampAreas = [];

          // Reset history and save initial state
          state.history = createEmptyHistory();
          saveToHistory();
        };
        img.onerror = (error) => {
          console.error('Failed to load initial image:', error);
        };
        img.src = initialImage;
      } else {
        // File object
        handleFileUpload(initialImage);
      }
    }
  });

  async function handleFileUpload(file: File) {
    try {
      const img = await loadImage(file);
      state.imageData.original = img;
      state.imageData.current = img;
      state.imageData.width = img.width;
      state.imageData.height = img.height;

      // Calculate fit scale
      const fitScale = calculateFitScale(img.width, img.height, width, height);

      // Reset state
      state.cropArea = null;
      state.transform = {
        rotation: 0,
        flipHorizontal: false,
        flipVertical: false,
        scale: 1
      };
      state.viewport = {
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        scale: fitScale
      };
      state.blurAreas = [];

      // Reset history and save initial state
      state.history = createEmptyHistory();
      saveToHistory();
    } catch (error) {
      console.error('Failed to load image:', error);
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
  }

  function handleFileInputChange(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      handleFileUpload(target.files[0]);
    }
  }

  function handleModeChange(mode: EditorMode) {
    state.mode = mode;
  }

  function handleCropApply(cropArea: CropArea) {
    if (!canvasElement || !state.imageData.original) return;

    state.cropArea = cropArea;
    state.mode = null;

    // Calculate scale to fit cropped area to canvas (fill canvas width/height)
    const fitScale = calculateFitScale(cropArea.width, cropArea.height, width, height);

    // Reset viewport to fit the cropped area
    state.viewport = {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      scale: fitScale
    };

    // Save to history
    saveToHistory();
  }

  function handleTransformChange(transform: Partial<TransformState>) {
    state.transform = { ...state.transform, ...transform };

    // Save to history
    saveToHistory();
  }

  function handleAdjustmentsChange(adjustments: Partial<AdjustmentsState>) {
    // Immediately update state for responsive UI
    state.adjustments = { ...state.adjustments, ...adjustments };

    // Store pending adjustments for history
    pendingAdjustments = { ...pendingAdjustments, ...adjustments };

    // Clear existing timer
    if (adjustmentThrottleTimer !== null) {
      clearTimeout(adjustmentThrottleTimer);
    }

    // Only save to history after user stops adjusting (300ms delay)
    adjustmentThrottleTimer = window.setTimeout(() => {
      if (pendingAdjustments !== null) {
        saveToHistory();
        pendingAdjustments = null;
      }
      adjustmentThrottleTimer = null;
    }, 300);
  }

  function handleFilterApply(adjustments: AdjustmentsState) {
    // Replace all adjustments with filter preset
    state.adjustments = adjustments;

    // Save to history immediately for filter changes
    saveToHistory();
  }

  function handleBlurAreasChange(blurAreas: BlurArea[]) {
    state.blurAreas = blurAreas;
    saveToHistory();
  }

  function handleStampAreasChange(stampAreas: StampArea[]) {
    state.stampAreas = stampAreas;
    saveToHistory();
  }

  function handleExport() {
    if (!state.imageData.original) return;

    const exportCanvas = applyTransform(
      state.imageData.original,
      state.transform,
      state.adjustments,
      state.cropArea,
      state.blurAreas,
      state.stampAreas
    );

    const dataUrl = exportCanvas.toDataURL(
      state.exportOptions.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      state.exportOptions.quality
    );
    const filename = `edited-image-${Date.now()}.${state.exportOptions.format}`;

    downloadImage(dataUrl, filename);

    if (onExport) {
      onExport(dataUrl);
    }
  }

  function handleComplete() {
    if (!state.imageData.original || !onComplete) return;

    const exportCanvas = applyTransform(
      state.imageData.original,
      state.transform,
      state.adjustments,
      state.cropArea,
      state.blurAreas,
      state.stampAreas
    );

    const format = state.exportOptions.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = exportCanvas.toDataURL(
      state.exportOptions.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      state.exportOptions.quality
    );

    // Convert to blob
    exportCanvas.toBlob((blob) => {
      if (blob) {
        createImageBitmap(blob).then((bitmap) => {
          onComplete(dataUrl, {
            blob: blob,
            width: bitmap.width,
            height: bitmap.height
          });

          bitmap.close();
        });
      }
    }, format, state.exportOptions.quality);
  }

  function handleCancel() {
    if (onCancel) {
      onCancel();
    }
  }

  function handleReset() {
    if (!state.imageData.original) return;

    const fitScale = calculateFitScale(
      state.imageData.original.width,
      state.imageData.original.height,
      width,
      height
    );

    state.cropArea = null;
    state.transform = {
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      scale: 1
    };
    state.viewport = {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      scale: fitScale
    };
  }

  function handleZoom(delta: number, centerX?: number, centerY?: number) {
    const oldZoom = state.viewport.zoom;
    const newZoom = Math.max(0.1, Math.min(5, oldZoom + delta));

    if (centerX !== undefined && centerY !== undefined && canvasElement) {
      // Zoom towards cursor position
      const rect = canvasElement.getBoundingClientRect();
      const x = centerX - rect.left - width / 2;
      const y = centerY - rect.top - height / 2;

      const zoomRatio = newZoom / oldZoom;
      state.viewport.offsetX = x - (x - state.viewport.offsetX) * zoomRatio;
      state.viewport.offsetY = y - (y - state.viewport.offsetY) * zoomRatio;
    }

    state.viewport.zoom = newZoom;
  }

  function saveToHistory() {
    const snapshot = createSnapshot(state.cropArea, state.transform, state.adjustments, state.viewport, state.blurAreas, state.stampAreas);
    state.history = addToHistory(state.history, snapshot);
  }

  function applySnapshot(snapshot: any) {
    if (!snapshot) return;
    state.cropArea = snapshot.cropArea ? { ...snapshot.cropArea } : null;
    state.transform = { ...snapshot.transform };
    state.adjustments = { ...snapshot.adjustments };
    state.viewport = { ...snapshot.viewport };
    state.blurAreas = snapshot.blurAreas ? snapshot.blurAreas.map((area: any) => ({ ...area })) : [];
    state.stampAreas = snapshot.stampAreas ? snapshot.stampAreas.map((area: any) => ({ ...area })) : [];
  }

  function handleUndo() {
    const result = undo(state.history);
    if (result.snapshot) {
      state.history = result.history;
      applySnapshot(result.snapshot);
    }
  }

  function handleRedo() {
    const result = redo(state.history);
    if (result.snapshot) {
      state.history = result.history;
      applySnapshot(result.snapshot);
    }
  }

  function openFileDialog() {
    fileInput?.click();
  }

  function handleViewportChange(viewportUpdate: Partial<Viewport>) {
    state.viewport = { ...state.viewport, ...viewportUpdate };
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Check if input/textarea is focused
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }

    // Ctrl+Z or Cmd+Z for undo
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      handleUndo();
    }

    // Ctrl+Shift+Z or Cmd+Shift+Z for redo
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) {
      event.preventDefault();
      handleRedo();
    }

    // Also support Ctrl+Y for redo
    if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
      event.preventDefault();
      handleRedo();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="image-editor" style="width: {width}px;">
  {#if !isStandalone && state.imageData.original}
    <div class="embedded-controls">
      <button class="embedded-btn embedded-btn-cancel" onclick={handleCancel}>
        {$_('editor.cancel')}
      </button>
      <button class="embedded-btn embedded-btn-apply" onclick={handleComplete}>
        {$_('editor.apply')}
      </button>

      <div class="editor-history-controls">
        <button
                class="editor-history-btn"
                disabled={!canUndo(state.history)}
                onclick={handleUndo}
                title={$_('toolbar.undo')}
        >
          <Undo2 size={20} />
        </button>

        <button
                class="editor-history-btn"
                disabled={!canRedo(state.history)}
                onclick={handleRedo}
                title={$_('toolbar.redo')}
        >
          <Redo2 size={20} />
        </button>

        <button
                class="editor-history-btn"
                disabled={!!state.imageData.original}
                onclick={handleReset}
                title={$_('editor.reset')}
        >
          <RotateCcw size={20} />
        </button>
      </div>
    </div>
  {/if}

  <div class="editor-body">
    {#if !state.imageData.original && isStandalone}
      <div
        class="upload-area"
        role="button"
        tabindex="0"
        ondrop={handleDrop}
        ondragover={handleDragOver}
        onclick={openFileDialog}
        onkeydown={(e) => e.key === 'Enter' && openFileDialog()}
      >
        <p>{$_('editor.dropImageHere')}</p>
        <input
          bind:this={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          onchange={handleFileInputChange}
          style="display: none;"
        />
      </div>
    {:else if !state.imageData.original && !isStandalone}
      <div class="no-image-message">
        <p>{$_('editor.noImage')}</p>
      </div>
    {:else}
      <div
        class="canvas-container"
        onwheel={(e) => {
          e.preventDefault();
          const delta = -e.deltaY * 0.001;
          handleZoom(delta, e.clientX, e.clientY);
        }}
        bind:clientWidth
        bind:clientHeight
      >
        <Canvas
          bind:canvas={canvasElement}
          width={clientWidth || width}
          height={clientHeight || height}
          image={state.imageData.original}
          viewport={state.viewport}
          transform={state.transform}
          adjustments={state.adjustments}
          cropArea={state.cropArea}
          blurAreas={state.blurAreas}
          stampAreas={state.stampAreas}
          onZoom={handleZoom}
        />

        {#if state.mode === 'crop'}
          <CropTool
            canvas={canvasElement}
            image={state.imageData.original}
            viewport={state.viewport}
            transform={state.transform}
            onApply={handleCropApply}
            onCancel={() => state.mode = null}
            onViewportChange={handleViewportChange}
            onTransformChange={handleTransformChange}
          />
        {:else if state.mode === 'blur'}
          <BlurTool
            canvas={canvasElement}
            image={state.imageData.original}
            viewport={state.viewport}
            transform={state.transform}
            blurAreas={state.blurAreas}
            cropArea={state.cropArea}
            onUpdate={handleBlurAreasChange}
            onClose={() => state.mode = null}
            onViewportChange={handleViewportChange}
          />
        {:else if state.mode === 'stamp'}
          <StampTool
            canvas={canvasElement}
            image={state.imageData.original}
            viewport={state.viewport}
            transform={state.transform}
            stampAreas={state.stampAreas}
            cropArea={state.cropArea}
            onUpdate={handleStampAreasChange}
            onClose={() => state.mode = null}
            onViewportChange={handleViewportChange}
          />
        {/if}

        {#if state.mode === 'adjust'}
          <div class="tools-panel">
            <AdjustTool
              adjustments={state.adjustments}
              onChange={handleAdjustmentsChange}
              onClose={() => state.mode = null}
            />
          </div>
        {:else if state.mode === 'filter'}
          <div class="tools-panel">
            <FilterTool
              image={state.imageData.original}
              adjustments={state.adjustments}
              transform={state.transform}
              cropArea={state.cropArea}
              onChange={handleFilterApply}
              onClose={() => state.mode = null}
            />
          </div>
        {:else if state.mode === 'export' && isStandalone}
          <div class="tools-panel">
            <ExportTool
              options={state.exportOptions}
              onChange={(options) => state.exportOptions = { ...state.exportOptions, ...options }}
              onExport={handleExport}
              onClose={() => state.mode = null}
            />
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="editor-header">
    <Toolbar
      mode={state.mode}
      hasImage={!!state.imageData.original}
      canUndo={canUndo(state.history)}
      canRedo={canRedo(state.history)}
      isStandalone={isStandalone}
      onModeChange={handleModeChange}
      onReset={handleReset}
      onUndo={handleUndo}
      onRedo={handleRedo}
    />
  </div>
</div>

<style lang="postcss">
  :global {
    input[type='range'] {
      appearance: none;
    }
  }

  .image-editor {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: #1a1a1a;
    border-radius: 8px;
    color: #fff;

    @media (max-width: 767px) {
      width: 100% !important;
      height: 90vh;
    }
  }

  .editor-header {
    display: flex;
    align-items: center;
    width: 100%;
  }

  .editor-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;

    @media (max-width: 767px) {
      flex: 1;
      justify-content: center;
    }
  }

  .upload-area {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    border: 2px dashed #666;
    border-radius: 8px;
    background: #2a2a2a;
    cursor: pointer;
    transition: all 0.2s;
  }

  .upload-area:hover {
    border-color: #888;
    background: #333;
  }

  .upload-area p {
    margin: 0;
    font-size: 1.1rem;
    color: #999;

    @media (max-width: 767px) {
      font-size: .75rem;
    }
  }

  .canvas-container {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #2a2a2a;
    border-radius: 8px;
    overflow: hidden;

    @media (max-width: 767px) {
      flex: 1;
      min-height: 0;
    }
  }

  .tools-panel {
    padding: 1rem;
    background: #2a2a2a;
    border-radius: 8px;
    position: absolute;
    width: min-content;
    right: 1rem;
    top: 1rem;
    bottom: 1rem;
    overflow-y: auto;
    scrollbar-width: thin;

    @media (max-width: 767px) {
      position: absolute;
      left: 0;
      right: 0;
      top: auto;
      bottom: 0;
      width: auto;
      max-height: 50vh;
      border-radius: 16px 16px 0 0;
      z-index: 1001;
    }
  }

  .no-image-message {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    background: #2a2a2a;
    border-radius: 8px;
  }

  .no-image-message p {
    margin: 0;
    font-size: 1.1rem;
    color: #999;
  }

  .embedded-controls {
    position: relative;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    z-index: 1000;

    @media (max-width: 767px) {

    }
  }

  .embedded-btn {
    padding: 0 1rem;
    border: none;
    font-size: .9rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border-radius: 4px;
    height: 36px;

    &:hover {
      opacity: .8;
    }

    @media (max-width: 767px) {
      padding: 0;
      font-size: .75rem;
      min-width: 80px;
    }
  }

  .embedded-btn-cancel {
    background: #666;
    color: #fff;
  }

  .embedded-btn-apply {
    background: var(--primary-color, #63b97b);
    color: #fff;
  }

  .experimental {
    padding: 0 1rem;
    background: var(--primary-color, #63b97b);
    opacity: .7;
    color: #fff;
    height: 40px;
    border-radius: 20px;
    letter-spacing: .05em;
    font-size: 16px;
    font-weight: bold;
    display: flex;
    align-items: center;
    margin: 0 auto 0 0;
  }

  .editor-history-controls {
    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    margin: auto;
    width: fit-content;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid #444;
    box-sizing: border-box;
  }

  .editor-history-btn {
    appearance: none;
    box-shadow: none;
    border: none;
    background: #333;
    width: 36px;
    height: 36px;
    display: grid;
    place-content: center;
    color: #fff;
    cursor: pointer;
    transition: all .3s ease-in-out;
    border-right: 1px solid #444;

    &:last-child {
      border-right: none;
    }

    &:hover {
      opacity: .7;
    }

    &:disabled {
      background: #222;
      color: #333;
      cursor: not-allowed;
    }
  }
</style>
