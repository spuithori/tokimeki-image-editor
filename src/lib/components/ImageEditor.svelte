<script lang="ts">
  import '$lib/i18n';
  import '../styles/tokens.css';
  import { _ } from 'svelte-i18n';
  import { Redo2, Undo2, RotateCcw, ImagePlus, Check, Sparkles, Download } from 'lucide-svelte';
  import type {
    EditorMode,
    EditorState,
    CropArea,
    TransformState,
    Viewport,
    AdjustmentsState,
    BlurArea,
    StampArea,
    Annotation
  } from '../types';
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
  import { calculateFitScale } from '../utils/canvas';
  import { haptic } from '../utils/haptics';
  import BottomDock from './BottomDock.svelte';
  import IconButton from './IconButton.svelte';
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
    onComplete?: (dataUrl: string, blobObj: { blob: Blob; width: number; height: number }) => void;
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
  let stageEl = $state<HTMLDivElement | null>(null);
  let adjustmentThrottleTimer: number | null = null;
  let pendingAdjustments: Partial<AdjustmentsState> | null = null;
  let lastInitialImage = $state<File | string | undefined>(undefined);
  let stageWidth = $state<number | undefined>(undefined);
  let stageHeight = $state<number | undefined>(undefined);
  let isHovering = $state(false);

  // Load initial image when provided
  $effect(() => {
    if (initialImage && initialImage !== lastInitialImage) {
      lastInitialImage = initialImage;
      if (typeof initialImage === 'string') {
        loadImageFromUrl(initialImage, width, height)
          .then((result) => {
            state = { ...state, ...applyImageToState(result, initialMode) };
            state = coreSaveToHistory(state);
          })
          .catch((error) => console.error('Failed to load initial image:', error));
      } else {
        handleFileUpload(initialImage);
      }
    }
  });

  // Recalculate viewport.scale when canvas container size changes OR when the mode
  // toggles crop ↔ non-crop. In crop mode we show the *original* image (not the
  // cropped view), so the fit-to-stage calculation must use original dimensions.
  // Approximate pixel height the floating dock covers at the bottom of the stage.
  // Used only when entering crop mode to fit the image above the dock.
  const DOCK_VISUAL_HEIGHT = 100;

  $effect(() => {
    if (state.imageData.original && stageWidth && stageHeight) {
      const useOriginal = state.mode === 'crop';
      const sourceWidth = useOriginal
        ? state.imageData.original.width
        : state.cropArea
          ? state.cropArea.width
          : state.imageData.original.width;
      const sourceHeight = useOriginal
        ? state.imageData.original.height
        : state.cropArea
          ? state.cropArea.height
          : state.imageData.original.height;
      // In crop mode, cap the image at ~75% of the stage so there's comfortable
      // room around the frame for handles, the dock, and visual breathing space.
      const fitWidth = state.mode === 'crop' ? stageWidth * 0.75 : stageWidth;
      const fitHeight = state.mode === 'crop'
        ? (stageHeight - DOCK_VISUAL_HEIGHT) * 0.75
        : stageHeight;
      const newScale = calculateFitScale(sourceWidth, sourceHeight, fitWidth, fitHeight);
      if (Math.abs(state.viewport.scale - newScale) > 0.001) {
        state = setViewport(state, { scale: newScale });
      }
    }
  });

  async function handleFileUpload(file: File) {
    try {
      const result = await loadImageFromFile(file, width, height);
      state = { ...state, ...applyImageToState(result, initialMode) };
      state = coreSaveToHistory(state);
      haptic('success');
    } catch (error) {
      console.error('Failed to load image:', error);
      haptic('error');
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isHovering = false;
    const file = getDroppedFile(event);
    if (file) handleFileUpload(file);
  }

  function handleDragEnter(event: DragEvent) {
    event.preventDefault();
    isHovering = true;
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    if (event.currentTarget === event.target) isHovering = false;
  }

  function handleFileInputChange(event: Event) {
    const file = getInputFile(event);
    if (file) handleFileUpload(file);
  }

  function handleModeChange(mode: EditorMode) {
    const prevMode = state.mode;
    state = setMode(state, mode);
    // Reset zoom & offset whenever we enter or leave crop mode.
    if (mode === 'crop' || prevMode === 'crop') {
      // When entering crop, nudge the image upward by half the dock height
      // so it sits centred between topbar and dock, not behind the dock.
      const offsetY = mode === 'crop' ? -(DOCK_VISUAL_HEIGHT / 2) : 0;
      state = setViewport(state, { zoom: 1, offsetX: 0, offsetY });
    }
  }

  function handleCropApply(cropArea: CropArea) {
    if (!canvasElement || !state.imageData.original) return;
    state = applyCrop(state, cropArea, stageWidth || width, stageHeight || height);
    state = coreSaveToHistory(state);
    haptic('success');
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
    haptic('success');
    await downloadExportedImage(state);
    const result = await exportImage(state);
    if (result && onExport) onExport(result.dataUrl);
  }

  async function handleComplete() {
    if (!onComplete) return;
    haptic('success');
    const result = await exportImage(state);
    if (result) onComplete(result.dataUrl, { blob: result.blob, width: result.width, height: result.height });
  }

  function handleCancel() {
    haptic('light');
    onCancel?.();
  }

  function handleReset() {
    haptic('warning');
    state = resetState(state, width, height);
  }

  function handleZoom(delta: number, centerX?: number, centerY?: number) {
    const canvasRect = canvasElement?.getBoundingClientRect();
    state = coreHandleZoom(state, delta, width, height, centerX, centerY, canvasRect);
  }

  function handleUndo() {
    if (!canUndo(state)) return;
    haptic('light');
    state = coreHandleUndo(state);
  }

  function handleRedo() {
    if (!canRedo(state)) return;
    haptic('light');
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
    if (action) haptic('light');
    state = applyKeyboardAction(state, action);
  }

  // Modes that float a Sheet (panel-style controls)
  let panelMode = $derived(state.mode);
  let hasImage = $derived(!!state.imageData.original);
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="tokimeki-editor editor" class:standalone={isStandalone} class:embedded={!isStandalone}>
  <!-- Topbar — actions & history -->
  <header class="topbar">
    <div class="topbar-left">
      {#if !isStandalone && hasImage}
        <button type="button" class="ghost-link" onclick={handleCancel}>
          {$_('editor.cancel')}
        </button>
      {:else if isStandalone}
        <div class="brand">
          <span class="brand-mark"><Sparkles size={16} strokeWidth={2.4} /></span>
          <span class="brand-name">TOKIMEKI</span>
        </div>
      {/if}
    </div>

    <div class="topbar-center">
      {#if hasImage}
        <div class="history-cluster">
          <IconButton
            label={$_('toolbar.undo')}
            size="md"
            variant="ghost"
            disabled={!canUndo(state)}
            onclick={handleUndo}
          >
            <Undo2 size={18} strokeWidth={2.2} />
          </IconButton>
          <span class="history-divider"></span>
          <IconButton
            label={$_('toolbar.redo')}
            size="md"
            variant="ghost"
            disabled={!canRedo(state)}
            onclick={handleRedo}
          >
            <Redo2 size={18} strokeWidth={2.2} />
          </IconButton>
          <span class="history-divider"></span>
          <IconButton
            label={$_('editor.reset')}
            size="md"
            variant="ghost"
            disabled={!hasImage}
            onclick={handleReset}
            haptics="warning"
          >
            <RotateCcw size={18} strokeWidth={2.2} />
          </IconButton>
        </div>
      {/if}
    </div>

    <div class="topbar-right">
      {#if hasImage}
        {#if !isStandalone}
          <button type="button" class="primary-link" onclick={handleComplete}>
            <Check size={16} strokeWidth={2.6} />
            <span>{$_('editor.apply')}</span>
          </button>
        {:else}
          <button type="button" class="primary-link" onclick={() => handleModeChange('export')}>
            <Download size={16} strokeWidth={2.4} />
            <span>{$_('editor.export')}</span>
          </button>
        {/if}
      {/if}
    </div>
  </header>

  <!-- Stage — image canvas -->
  <main
    bind:this={stageEl}
    class="stage"
    class:has-image={hasImage}
    bind:clientWidth={stageWidth}
    bind:clientHeight={stageHeight}
  >
    {#if !hasImage && isStandalone}
      <div
        class="upload-hero"
        class:hover={isHovering}
        role="button"
        tabindex="0"
        aria-label={$_('editor.openImage')}
        ondrop={handleDrop}
        ondragenter={handleDragEnter}
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
        onclick={openFileDialog}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openFileDialog()}
      >
        <div class="upload-glow"></div>
        <div class="upload-card">
          <div class="upload-icon">
            <ImagePlus size={32} strokeWidth={1.6} />
          </div>
          <h2 class="upload-title">{$_('editor.dropImageHere')}</h2>
          <p class="upload-meta">{$_('editor.acceptedFormats')}</p>
        </div>
        <input
          bind:this={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          onchange={handleFileInputChange}
          hidden
        />
      </div>
    {:else if !hasImage && !isStandalone}
      <div class="empty-embedded">
        <div class="empty-icon">
          <ImagePlus size={28} strokeWidth={1.6} />
        </div>
        <p>{$_('editor.noImage')}</p>
      </div>
    {:else}
      <div
        class="canvas-stage"
        onwheel={(e) => {
          e.preventDefault();
          handleZoom(-e.deltaY * 0.001, e.clientX, e.clientY);
        }}
      >
        <Canvas
          bind:canvas={canvasElement}
          width={stageWidth || width}
          height={stageHeight || height}
          image={state.imageData.original}
          viewport={state.viewport}
          transform={state.transform}
          adjustments={state.adjustments}
          cropArea={state.mode === 'crop' ? null : state.cropArea}
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
            seedCropArea={state.cropArea}
            onApply={handleCropApply}
            onCancel={() => handleModeChange(null)}
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
            onClose={() => (state.mode = null)}
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
            onClose={() => (state.mode = null)}
            onViewportChange={handleViewportChange}
          />
        {:else if state.mode === 'annotate'}
          <AnnotationTool
            canvas={canvasElement}
            image={state.imageData.original}
            viewport={state.viewport}
            transform={state.transform}
            annotations={state.annotations}
            stampAreas={state.stampAreas}
            cropArea={state.cropArea}
            {initialTool}
            {initialStrokeWidth}
            {initialColor}
            onUpdate={handleAnnotationsChange}
            onClose={() => (state.mode = null)}
            onViewportChange={handleViewportChange}
          />
        {/if}

        {#if state.mode === 'adjust'}
          <AdjustTool
            adjustments={state.adjustments}
            onChange={handleAdjustmentsChange}
            onClose={() => (state.mode = null)}
          />
        {:else if state.mode === 'filter'}
          <FilterTool
            image={state.imageData.original}
            adjustments={state.adjustments}
            transform={state.transform}
            cropArea={state.cropArea}
            onChange={handleFilterApply}
            onClose={() => (state.mode = null)}
          />
        {:else if state.mode === 'export' && isStandalone}
          <ExportTool
            options={state.exportOptions}
            onChange={(options) => (state.exportOptions = { ...state.exportOptions, ...options })}
            onExport={handleExport}
            onClose={() => (state.mode = null)}
          />
        {/if}
      </div>
    {/if}
  </main>

  <!-- Bottom dock — primary tool nav -->
  {#if hasImage}
    <div class="dock-host" class:hide-mobile={state.mode === 'crop' || state.mode === 'blur' || state.mode === 'stamp' || state.mode === 'annotate'}>
      <BottomDock
        mode={state.mode}
        hasImage={hasImage}
        isStandalone={isStandalone}
        onModeChange={handleModeChange}
      />
    </div>
  {/if}
</div>

<style lang="postcss">
  .editor {
    display: grid;
    grid-template-rows: 1fr;
    width: 100%;
    height: 100%;
    min-height: 480px;
    background: var(--tk-bg-base);
    color: var(--tk-text-primary);
    font-family: var(--tk-font-sans);
    border-radius: var(--tk-radius-2xl);
    overflow: hidden;
    position: relative;
    isolation: isolate;
  }

  .editor.standalone {
    min-height: 100dvh;
    border-radius: 0;
  }

  /* ──────────────────────────────────────────────
   *  Topbar
   * ────────────────────────────────────────────── */
  .topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--tk-space-3);
    padding: var(--tk-space-3) var(--tk-space-4);
    padding-top: max(var(--tk-space-3), env(safe-area-inset-top));
    background: transparent;
    z-index: var(--tk-z-overlay);
    pointer-events: none;
  }
  .topbar > * {
    pointer-events: auto;
  }

  .topbar-left {
    display: flex;
    align-items: center;
    gap: var(--tk-space-2);
  }
  .topbar-center {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .topbar-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--tk-space-2);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--tk-space-2);
    font-weight: var(--tk-weight-semibold);
    letter-spacing: var(--tk-tracking-wider);
    font-size: var(--tk-text-sm);
    color: var(--tk-text-primary);
    text-transform: uppercase;
  }
  .brand-mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--tk-radius-md);
    background: linear-gradient(135deg, #66b7ea 0%, #e07eed 100%);
    color: #0b0b0d;
  }

  .history-cluster {
    display: flex;
    align-items: center;
    gap: var(--tk-space-1);
    padding: var(--tk-space-1);
    border-radius: var(--tk-radius-lg);
    background: var(--tk-surface-1);
    border: 1px solid var(--tk-border-subtle);
  }
  .history-divider {
    width: 1px;
    height: 18px;
    background: var(--tk-border-default);
  }

  .ghost-link,
  .primary-link {
    display: inline-flex;
    align-items: center;
    gap: var(--tk-space-2);
    height: var(--tk-touch-min);
    padding: 0 var(--tk-space-4);
    border: none;
    border-radius: var(--tk-radius-full);
    font-family: inherit;
    font-size: var(--tk-text-md);
    font-weight: var(--tk-weight-semibold);
    letter-spacing: var(--tk-tracking-tight);
    cursor: pointer;
    transition: all var(--tk-dur-quick) var(--tk-ease-out);
    -webkit-tap-highlight-color: transparent;
  }

  .ghost-link {
    background: var(--tk-bg-glass);
    backdrop-filter: var(--tk-blur-sm);
    -webkit-backdrop-filter: var(--tk-blur-sm);
    border: 1px solid var(--tk-border-default);
    color: var(--tk-text-secondary);
  }
  .ghost-link:hover {
    color: var(--tk-text-primary);
    background: var(--tk-bg-glass-strong);
  }

  .primary-link {
    background: var(--tk-accent);
    color: var(--tk-text-on-accent);
    box-shadow: 0 2px 12px rgba(10, 132, 255, 0.32);
  }
  .primary-link:hover {
    background: var(--tk-accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 18px rgba(10, 132, 255, 0.4);
  }
  .primary-link:active {
    transform: translateY(0);
  }

  /* ──────────────────────────────────────────────
   *  Stage — fills everything under the topbar. The dock floats above it.
   * ────────────────────────────────────────────── */
  .stage {
    min-height: 0;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      radial-gradient(ellipse at top, rgba(255, 255, 255, 0.04), transparent 60%),
      var(--tk-bg-canvas);
    overflow: hidden;
  }

  .canvas-stage {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ──────────────────────────────────────────────
   *  Upload hero
   * ────────────────────────────────────────────── */
  .upload-hero {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: min(560px, 90%);
    aspect-ratio: 4 / 3;
    cursor: pointer;
    isolation: isolate;
  }

  .upload-glow {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 30% 20%, rgba(102, 183, 234, 0.22), transparent 50%),
      radial-gradient(circle at 70% 80%, rgba(224, 126, 237, 0.2), transparent 55%);
    filter: blur(40px);
    z-index: -1;
    transition: opacity var(--tk-dur-long) var(--tk-ease-out);
    opacity: 0.6;
  }

  .upload-hero:hover .upload-glow,
  .upload-hero.hover .upload-glow {
    opacity: 1;
  }

  .upload-card {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--tk-space-4);
    padding: var(--tk-space-8);
    background: var(--tk-bg-glass);
    backdrop-filter: var(--tk-blur-md);
    -webkit-backdrop-filter: var(--tk-blur-md);
    border: 1.5px dashed var(--tk-border-strong);
    border-radius: var(--tk-radius-3xl);
    transition:
      border-color var(--tk-dur-medium) var(--tk-ease-out),
      transform var(--tk-dur-medium) var(--tk-ease-spring),
      background var(--tk-dur-medium) var(--tk-ease-out);
  }

  .upload-hero:hover .upload-card,
  .upload-hero.hover .upload-card {
    border-color: var(--tk-accent);
    background: var(--tk-bg-glass-strong);
    transform: scale(1.01);
  }

  .upload-icon {
    width: 72px;
    height: 72px;
    display: grid;
    place-items: center;
    border-radius: var(--tk-radius-2xl);
    background: var(--tk-accent-soft);
    color: var(--tk-accent);
  }

  .upload-title {
    margin: 0;
    font-size: var(--tk-text-lg);
    font-weight: var(--tk-weight-semibold);
    letter-spacing: var(--tk-tracking-tight);
    color: var(--tk-text-primary);
    text-align: center;
  }
  .upload-meta {
    margin: 0;
    font-size: var(--tk-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tk-tracking-wider);
    color: var(--tk-text-tertiary);
  }

  .empty-embedded {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--tk-space-3);
    color: var(--tk-text-tertiary);
    font-size: var(--tk-text-md);
  }
  .empty-icon {
    width: 56px;
    height: 56px;
    border-radius: var(--tk-radius-2xl);
    background: var(--tk-surface-1);
    display: grid;
    place-items: center;
    color: var(--tk-text-secondary);
  }

  /* ──────────────────────────────────────────────
   *  Bottom dock host — absolutely positioned, fully transparent.
   *  The rail floats above the stage without displacing canvas layout.
   * ────────────────────────────────────────────── */
  .dock-host {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--tk-z-dock);
    padding: var(--tk-space-3) var(--tk-space-4);
    padding-bottom: max(var(--tk-space-3), env(safe-area-inset-bottom));
    display: flex;
    justify-content: center;
    background: transparent;
    pointer-events: none;
  }
  .dock-host > :global(*) {
    pointer-events: auto;
  }

  @media (max-width: 767px) {
    .dock-host.hide-mobile {
      display: none;
    }
  }

  /* ──────────────────────────────────────────────
   *  Mobile
   * ────────────────────────────────────────────── */
  @media (max-width: 767px) {
    .editor {
      min-height: 0;
      border-radius: 0;
      height: 100dvh;
    }

    .topbar {
      padding: var(--tk-space-2) var(--tk-space-3);
      padding-top: max(var(--tk-space-2), env(safe-area-inset-top));
      gap: var(--tk-space-2);
    }

    .brand-name {
      display: none;
    }

    .ghost-link,
    .primary-link {
      height: 38px;
      padding: 0 var(--tk-space-3);
      font-size: var(--tk-text-sm);
    }

    .history-cluster {
      gap: 0;
    }

    .upload-hero {
      width: 92%;
      aspect-ratio: 5 / 4;
    }
    .upload-card {
      padding: var(--tk-space-5);
      gap: var(--tk-space-3);
    }
    .upload-icon {
      width: 56px;
      height: 56px;
    }
    .upload-title {
      font-size: var(--tk-text-md);
    }

    .dock-host {
      padding: var(--tk-space-2) var(--tk-space-2);
      padding-bottom: max(var(--tk-space-2), env(safe-area-inset-bottom));
    }
  }
</style>
