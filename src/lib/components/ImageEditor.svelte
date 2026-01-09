<script lang="ts">
  import '$lib/i18n';
  import { _ } from 'svelte-i18n';
  import { Redo2, RotateCcw, Undo2 } from 'lucide-svelte';
  import type { EditorMode, EditorState, CropArea, TransformState, Viewport, AdjustmentsState, BlurArea, Annotation } from '../types';
  import {
    createEditorState,
    loadImageFromFile,
    loadImageFromUrl,
    applyImageToState,
    setMode,
    applyCrop,
    applyTransformUpdate,
    applyAdjustmentsUpdate,
    applyFilter,
    setBlurAreas,
    setStampAreas,
    setAnnotations,
    setViewport,
    setExportOptions,
    resetState,
    handleZoom as coreHandleZoom,
    saveToHistory as coreSaveToHistory,
    handleUndo as coreHandleUndo,
    handleRedo as coreHandleRedo,
    canUndo,
    canRedo,
    getKeyboardAction,
    applyKeyboardAction,
    exportImage,
    downloadExportedImage,
    getDroppedFile,
    getInputFile,
    handleDragOver
  } from '../utils/editor-core';
  import Toolbar from './Toolbar.svelte';
  import Canvas from './Canvas.svelte';
  import CropTool from './CropTool.svelte';
  import AdjustTool from './AdjustTool.svelte';
  import FilterTool from './FilterTool.svelte';
  import BlurTool from './BlurTool.svelte';
  import StampTool from './StampTool.svelte';
  import AnnotationTool from './AnnotationTool.svelte';
  import ExportTool from './ExportTool.svelte';

  interface Props {
    initialImage?: File | string;
    initialMode?: EditorMode;
    initialTool?: 'pen' | 'brush' | 'arrow' | 'rectangle' | 'eraser';
    initialStrokeWidth?: number;
    initialColor?: string;
    width?: number;
    height?: number;
    isStandalone?: boolean;
    onComplete?: (dataUrl: string, blobObj: {blob: Blob, width: number, height: number}) => void;
    onCancel?: () => void;
    onExport?: (dataUrl: string) => void;
  }

  let {
    initialImage,
    initialMode = null,
    initialTool,
    initialStrokeWidth,
    initialColor,
    width = 800,
    height = 600,
    isStandalone = false,
    onComplete,
    onCancel,
    onExport
  }: Props = $props();

  let state = $state<EditorState>(createEditorState());
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
        loadImageFromUrl(initialImage, width, height)
          .then(result => {
            state = { ...state, ...applyImageToState(result, initialMode) };
            state = coreSaveToHistory(state);
          })
          .catch(error => console.error('Failed to load initial image:', error));
      } else {
        handleFileUpload(initialImage);
      }
    }
  });

  async function handleFileUpload(file: File) {
    try {
      const result = await loadImageFromFile(file, width, height);
      state = { ...state, ...applyImageToState(result, initialMode) };
      state = coreSaveToHistory(state);
    } catch (error) {
      console.error('Failed to load image:', error);
    }
  }

  function handleDrop(event: DragEvent) {
    const file = getDroppedFile(event);
    if (file) handleFileUpload(file);
  }

  function handleFileInputChange(event: Event) {
    const file = getInputFile(event);
    if (file) handleFileUpload(file);
  }

  function handleModeChange(mode: EditorMode) {
    state = setMode(state, mode);
  }

  function handleCropApply(cropArea: CropArea) {
    if (!canvasElement || !state.imageData.original) return;
    state = applyCrop(state, cropArea, width, height);
    state = coreSaveToHistory(state);
  }

  function handleTransformChange(transform: Partial<TransformState>) {
    state = applyTransformUpdate(state, transform);
    state = coreSaveToHistory(state);
  }

  function handleAdjustmentsChange(adjustments: Partial<AdjustmentsState>) {
    state = applyAdjustmentsUpdate(state, adjustments);
    pendingAdjustments = { ...pendingAdjustments, ...adjustments };

    if (adjustmentThrottleTimer !== null) clearTimeout(adjustmentThrottleTimer);
    adjustmentThrottleTimer = window.setTimeout(() => {
      if (pendingAdjustments !== null) {
        state = coreSaveToHistory(state);
        pendingAdjustments = null;
      }
      adjustmentThrottleTimer = null;
    }, 300);
  }

  function handleFilterApply(adjustments: AdjustmentsState) {
    state = applyFilter(state, adjustments);
    state = coreSaveToHistory(state);
  }

  function handleBlurAreasChange(blurAreas: BlurArea[]) {
    state = setBlurAreas(state, blurAreas);
    state = coreSaveToHistory(state);
  }

  function handleStampAreasChange(stampAreas: StampArea[]) {
    state = setStampAreas(state, stampAreas);
    state = coreSaveToHistory(state);
  }

  function handleAnnotationsChange(annotations: Annotation[]) {
    state = setAnnotations(state, annotations);
    state = coreSaveToHistory(state);
  }

  async function handleExport() {
    await downloadExportedImage(state);
    const result = await exportImage(state);
    if (result && onExport) onExport(result.dataUrl);
  }

  async function handleComplete() {
    if (!onComplete) return;
    const result = await exportImage(state);
    if (result) onComplete(result.dataUrl, { blob: result.blob, width: result.width, height: result.height });
  }

  function handleCancel() {
    onCancel?.();
  }

  function handleReset() {
    state = resetState(state, width, height);
  }

  function handleZoom(delta: number, centerX?: number, centerY?: number) {
    const canvasRect = canvasElement?.getBoundingClientRect();
    state = coreHandleZoom(state, delta, width, height, centerX, centerY, canvasRect);
  }

  function handleUndo() {
    state = coreHandleUndo(state);
  }

  function handleRedo() {
    state = coreHandleRedo(state);
  }

  function openFileDialog() {
    fileInput?.click();
  }

  function handleViewportChange(viewportUpdate: Partial<Viewport>) {
    state = setViewport(state, viewportUpdate);
  }

  function handleKeyDown(event: KeyboardEvent) {
    const action = getKeyboardAction(event);
    state = applyKeyboardAction(state, action);
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
                disabled={!canUndo(state)}
                onclick={handleUndo}
                title={$_('toolbar.undo')}
        >
          <Undo2 size={20} />
        </button>

        <button
                class="editor-history-btn"
                disabled={!canRedo(state)}
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
          annotations={state.annotations}
          skipAnnotations={state.mode === 'annotate'}
          onZoom={handleZoom}
          onViewportChange={handleViewportChange}
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
        {:else if state.mode === 'annotate'}
          <AnnotationTool
            canvas={canvasElement}
            image={state.imageData.original}
            viewport={state.viewport}
            transform={state.transform}
            annotations={state.annotations}
            cropArea={state.cropArea}
            {initialTool}
            {initialStrokeWidth}
            {initialColor}
            onUpdate={handleAnnotationsChange}
            onClose={() => state.mode = null}
            onViewportChange={handleViewportChange}
          />
        {/if}

        {#if state.mode === 'adjust'}
          <AdjustTool
            adjustments={state.adjustments}
            onChange={handleAdjustmentsChange}
            onClose={() => state.mode = null}
          />
        {:else if state.mode === 'filter'}
          <FilterTool
            image={state.imageData.original}
            adjustments={state.adjustments}
            transform={state.transform}
            cropArea={state.cropArea}
            onChange={handleFilterApply}
            onClose={() => state.mode = null}
          />
        {:else if state.mode === 'export' && isStandalone}
          <ExportTool
            options={state.exportOptions}
            onChange={(options) => state.exportOptions = { ...state.exportOptions, ...options }}
            onExport={handleExport}
            onClose={() => state.mode = null}
          />
        {/if}
      </div>
    {/if}
  </div>

  <div class="editor-header">
    <Toolbar
      mode={state.mode}
      hasImage={!!state.imageData.original}
      canUndo={canUndo(state)}
      canRedo={canRedo(state)}
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
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
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
