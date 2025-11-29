<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { BlurArea, Viewport, TransformState, CropArea } from '../types';
  import { screenToImageCoords, imageToCanvasCoords } from '../utils/canvas';
  import { X } from 'lucide-svelte';

  interface Props {
    canvas: HTMLCanvasElement | null;
    image: HTMLImageElement | null;
    viewport: Viewport;
    transform: TransformState;
    blurAreas: BlurArea[];
    cropArea?: CropArea | null;
    onUpdate: (blurAreas: BlurArea[]) => void;
    onClose: () => void;
    onViewportChange?: (viewport: Partial<Viewport>) => void;
  }

  let { canvas, image, viewport, transform, blurAreas, cropArea, onUpdate, onClose, onViewportChange }: Props = $props();

  // States for creating new blur area
  let isCreating = $state(false);
  let createStart = $state<{ x: number; y: number } | null>(null);
  let createEnd = $state<{ x: number; y: number } | null>(null);

  // States for editing existing blur area
  let selectedAreaId = $state<string | null>(null);
  let isDragging = $state(false);
  let isResizing = $state(false);
  let dragStart = $state({ x: 0, y: 0 });
  let resizeHandle = $state<string | null>(null);
  let initialArea = $state<BlurArea | null>(null);

  // Viewport panning
  let isPanning = $state(false);
  let lastPanPosition = $state({ x: 0, y: 0 });

  // Convert blur areas to canvas coordinates for rendering
  let canvasBlurAreas = $derived.by(() => {
    if (!canvas || !image) return [];

    return blurAreas.map(area => {
      // Determine source dimensions and offset based on crop area
      const sourceWidth = cropArea ? cropArea.width : image.width;
      const sourceHeight = cropArea ? cropArea.height : image.height;
      const offsetX = cropArea ? cropArea.x : 0;
      const offsetY = cropArea ? cropArea.y : 0;

      // Convert to crop-relative coordinates (or image-relative if no crop)
      const adjustedX = area.x - offsetX;
      const adjustedY = area.y - offsetY;

      // Calculate canvas coordinates
      const totalScale = viewport.scale * viewport.zoom;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      const canvasX = (adjustedX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX;
      const canvasY = (adjustedY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY;
      const canvasWidth = area.width * totalScale;
      const canvasHeight = area.height * totalScale;

      return {
        ...area,
        canvasX,
        canvasY,
        canvasWidth,
        canvasHeight
      };
    });
  });

  // Creating rect in canvas coordinates
  let creatingRect = $derived.by(() => {
    if (!isCreating || !createStart || !createEnd) return null;

    const x = Math.min(createStart.x, createEnd.x);
    const y = Math.min(createStart.y, createEnd.y);
    const width = Math.abs(createEnd.x - createStart.x);
    const height = Math.abs(createEnd.y - createStart.y);

    return { x, y, width, height };
  });

  function handleContainerMouseDown(event: MouseEvent) {
    if (!canvas || !image || event.button !== 0) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Check if clicking on an existing blur area
    for (let i = canvasBlurAreas.length - 1; i >= 0; i--) {
      const area = canvasBlurAreas[i];
      if (
        mouseX >= area.canvasX &&
        mouseX <= area.canvasX + area.canvasWidth &&
        mouseY >= area.canvasY &&
        mouseY <= area.canvasY + area.canvasHeight
      ) {
        selectedAreaId = area.id;
        return;
      }
    }

    // Not clicking on any existing area - start creating new area
    selectedAreaId = null;
    isCreating = true;
    createStart = { x: mouseX, y: mouseY };
    createEnd = { x: mouseX, y: mouseY };
    event.preventDefault();
  }

  function handleMouseMove(event: MouseEvent) {
    if (!canvas || !image) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Handle viewport panning
    if (isPanning && onViewportChange) {
      const deltaX = event.clientX - lastPanPosition.x;
      const deltaY = event.clientY - lastPanPosition.y;

      const imgWidth = image.width;
      const imgHeight = image.height;
      const totalScale = viewport.scale * viewport.zoom;
      const scaledWidth = imgWidth * totalScale;
      const scaledHeight = imgHeight * totalScale;

      const overflowMargin = 0.2;
      const maxOffsetX = (scaledWidth / 2) - (canvas.width / 2) + (canvas.width * overflowMargin);
      const maxOffsetY = (scaledHeight / 2) - (canvas.height / 2) + (canvas.height * overflowMargin);

      const newOffsetX = viewport.offsetX + deltaX;
      const newOffsetY = viewport.offsetY + deltaY;

      const clampedOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, newOffsetX));
      const clampedOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, newOffsetY));

      onViewportChange({
        offsetX: clampedOffsetX,
        offsetY: clampedOffsetY
      });

      lastPanPosition = { x: event.clientX, y: event.clientY };
      event.preventDefault();
      return;
    }

    // Handle creating new blur area
    if (isCreating && createStart) {
      createEnd = { x: mouseX, y: mouseY };
      event.preventDefault();
      return;
    }

    // Handle dragging selected area
    if (isDragging && initialArea && selectedAreaId) {
      const deltaX = event.clientX - dragStart.x;
      const deltaY = event.clientY - dragStart.y;

      // Convert delta to image coordinates
      const totalScale = viewport.scale * viewport.zoom;
      const imgDeltaX = deltaX / totalScale;
      const imgDeltaY = deltaY / totalScale;

      // Allow blur areas to extend outside image bounds
      const newX = initialArea.x + imgDeltaX;
      const newY = initialArea.y + imgDeltaY;

      const updatedAreas = blurAreas.map(area =>
        area.id === selectedAreaId
          ? { ...area, x: newX, y: newY }
          : area
      );
      onUpdate(updatedAreas);
      event.preventDefault();
      return;
    }

    // Handle resizing selected area
    if (isResizing && initialArea && resizeHandle && selectedAreaId) {
      const deltaX = event.clientX - dragStart.x;
      const deltaY = event.clientY - dragStart.y;

      const totalScale = viewport.scale * viewport.zoom;
      const imgDeltaX = deltaX / totalScale;
      const imgDeltaY = deltaY / totalScale;

      let newArea = { ...initialArea };

      switch (resizeHandle) {
        case 'nw':
          newArea.x = initialArea.x + imgDeltaX;
          newArea.y = initialArea.y + imgDeltaY;
          newArea.width = initialArea.width - imgDeltaX;
          newArea.height = initialArea.height - imgDeltaY;
          break;
        case 'n':
          newArea.y = initialArea.y + imgDeltaY;
          newArea.height = initialArea.height - imgDeltaY;
          break;
        case 'ne':
          newArea.y = initialArea.y + imgDeltaY;
          newArea.width = initialArea.width + imgDeltaX;
          newArea.height = initialArea.height - imgDeltaY;
          break;
        case 'w':
          newArea.x = initialArea.x + imgDeltaX;
          newArea.width = initialArea.width - imgDeltaX;
          break;
        case 'e':
          newArea.width = initialArea.width + imgDeltaX;
          break;
        case 'sw':
          newArea.x = initialArea.x + imgDeltaX;
          newArea.width = initialArea.width - imgDeltaX;
          newArea.height = initialArea.height + imgDeltaY;
          break;
        case 's':
          newArea.height = initialArea.height + imgDeltaY;
          break;
        case 'se':
          newArea.width = initialArea.width + imgDeltaX;
          newArea.height = initialArea.height + imgDeltaY;
          break;
      }

      // Enforce minimum size (allow areas to extend outside image bounds)
      if (newArea.width >= 20 && newArea.height >= 20) {
        const updatedAreas = blurAreas.map(area =>
          area.id === selectedAreaId ? newArea : area
        );
        onUpdate(updatedAreas);
      }
      event.preventDefault();
    }
  }

  function handleMouseUp(event: MouseEvent) {
    if (!canvas || !image) return;

    // Finish creating new blur area
    if (isCreating && createStart && createEnd && creatingRect) {
      // Only create if area is large enough
      if (creatingRect.width > 10 && creatingRect.height > 10) {
        // Convert canvas coordinates to image coordinates
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const totalScale = viewport.scale * viewport.zoom;

        // Determine source dimensions (crop-aware)
        const sourceWidth = cropArea ? cropArea.width : image.width;
        const sourceHeight = cropArea ? cropArea.height : image.height;

        // Top-left corner (crop-relative coordinates)
        const topLeftX = (creatingRect.x - centerX - viewport.offsetX) / totalScale + sourceWidth / 2;
        const topLeftY = (creatingRect.y - centerY - viewport.offsetY) / totalScale + sourceHeight / 2;

        // Bottom-right corner (crop-relative coordinates)
        const bottomRightX = (creatingRect.x + creatingRect.width - centerX - viewport.offsetX) / totalScale + sourceWidth / 2;
        const bottomRightY = (creatingRect.y + creatingRect.height - centerY - viewport.offsetY) / totalScale + sourceHeight / 2;

        // Convert to absolute image coordinates
        const absoluteX = cropArea ? topLeftX + cropArea.x : topLeftX;
        const absoluteY = cropArea ? topLeftY + cropArea.y : topLeftY;

        const newArea: BlurArea = {
          id: `blur-${Date.now()}`,
          x: absoluteX,
          y: absoluteY,
          width: bottomRightX - topLeftX,
          height: bottomRightY - topLeftY,
          blurStrength: 20 // Default blur strength
        };

        onUpdate([...blurAreas, newArea]);
        selectedAreaId = newArea.id;
      }

      isCreating = false;
      createStart = null;
      createEnd = null;
      event.preventDefault();
      return;
    }

    isDragging = false;
    isResizing = false;
    isPanning = false;
    resizeHandle = null;
    initialArea = null;
  }

  function handleAreaMouseDown(event: MouseEvent, areaId: string) {
    if (!canvas || !image) return;

    event.preventDefault();
    event.stopPropagation();

    selectedAreaId = areaId;
    isDragging = true;
    dragStart = { x: event.clientX, y: event.clientY };
    initialArea = blurAreas.find(a => a.id === areaId) || null;
  }

  function handleHandleMouseDown(event: MouseEvent, areaId: string, handle: string) {
    if (!canvas || !image) return;

    event.preventDefault();
    event.stopPropagation();

    selectedAreaId = areaId;
    isResizing = true;
    resizeHandle = handle;
    dragStart = { x: event.clientX, y: event.clientY };
    initialArea = blurAreas.find(a => a.id === areaId) || null;
  }

  function handleDeleteArea() {
    if (!selectedAreaId) return;
    const updatedAreas = blurAreas.filter(area => area.id !== selectedAreaId);
    onUpdate(updatedAreas);
    selectedAreaId = null;
  }

  function handleBlurStrengthChange(value: number) {
    if (!selectedAreaId) return;
    const updatedAreas = blurAreas.map(area =>
      area.id === selectedAreaId
        ? { ...area, blurStrength: value }
        : area
    );
    onUpdate(updatedAreas);
  }

  const selectedArea = $derived(
    blurAreas.find(area => area.id === selectedAreaId)
  );
</script>

<svelte:window
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
/>

<!-- Overlay -->
<div
  class="blur-tool-overlay"
  onmousedown={handleContainerMouseDown}
  role="button"
  tabindex="-1"
>
  <svg class="blur-tool-svg">
    <defs>
      <pattern id="blur-grid" width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255, 255, 255, 0.2)" stroke-width="1"/>
      </pattern>
    </defs>

    <!-- Render creating rectangle -->
    {#if creatingRect}
      <rect
        x={creatingRect.x}
        y={creatingRect.y}
        width={creatingRect.width}
        height={creatingRect.height}
        fill="rgba(100, 150, 255, 0.2)"
        stroke="rgba(100, 150, 255, 0.8)"
        stroke-width="2"
        stroke-dasharray="5,5"
      />
    {/if}

    <!-- Render existing blur areas -->
    {#each canvasBlurAreas as area (area.id)}
      {@const isSelected = area.id === selectedAreaId}

      <g>
        <!-- Rectangle -->
        <rect
          x={area.canvasX}
          y={area.canvasY}
          width={area.canvasWidth}
          height={area.canvasHeight}
          fill={isSelected ? "rgba(100, 150, 255, 0.15)" : "rgba(255, 255, 255, 0.1)"}
          stroke={isSelected ? "rgba(100, 150, 255, 0.9)" : "rgba(255, 255, 255, 0.5)"}
          stroke-width={isSelected ? "3" : "2"}
          stroke-dasharray="5,5"
          onmousedown={(e) => handleAreaMouseDown(e, area.id)}
          style="cursor: move;"
        />

        <!-- Resize handles (only for selected area) -->
        {#if isSelected}
          {#each ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as handle}
            {@const handleSize = 10}
            {@const handleX = handle.includes('w') ? area.canvasX - handleSize/2
                            : handle.includes('e') ? area.canvasX + area.canvasWidth - handleSize/2
                            : area.canvasX + area.canvasWidth/2 - handleSize/2}
            {@const handleY = handle.includes('n') ? area.canvasY - handleSize/2
                            : handle.includes('s') ? area.canvasY + area.canvasHeight - handleSize/2
                            : area.canvasY + area.canvasHeight/2 - handleSize/2}
            {@const cursor = handle === 'n' || handle === 's' ? 'ns-resize'
                           : handle === 'w' || handle === 'e' ? 'ew-resize'
                           : handle === 'nw' || handle === 'se' ? 'nwse-resize'
                           : 'nesw-resize'}

            <rect
              x={handleX}
              y={handleY}
              width={handleSize}
              height={handleSize}
              fill="rgba(100, 150, 255, 0.9)"
              stroke="#fff"
              stroke-width="2"
              onmousedown={(e) => handleHandleMouseDown(e, area.id, handle)}
              style="cursor: {cursor};"
            />
          {/each}
        {/if}
      </g>
    {/each}
  </svg>
</div>

<!-- Control panel -->
<div class="blur-tool-panel">
  <div class="panel-header">
    <h3>{$_('editor.blur')}</h3>
    <button class="close-btn" onclick={onClose} title={$_('editor.close')}>
      <X size={20} />
    </button>
  </div>

  {#if selectedArea}
    <div class="panel-content">
      <div class="control-group">
        <label for="blur-strength">
          <span>{$_('blur.strength')}</span>
          <span class="value">{selectedArea.blurStrength}</span>
        </label>
        <input
          id="blur-strength"
          type="range"
          min="0"
          max="100"
          value={selectedArea.blurStrength}
          oninput={(e) => handleBlurStrengthChange(Number(e.currentTarget.value))}
        />
      </div>

      <div class="panel-actions">
        <button class="btn btn-danger" onclick={handleDeleteArea}>
          {$_('editor.delete')}
        </button>
      </div>
    </div>
  {:else}
    <div class="panel-hint">
      <p>{$_('blur.hint')}</p>
    </div>
  {/if}
</div>

<style lang="postcss">
  .blur-tool-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    cursor: crosshair;
    user-select: none;
  }

  .blur-tool-svg {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .blur-tool-svg rect {
    pointer-events: all;
  }

  .blur-tool-panel {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: rgba(30, 30, 30, 0.95);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 1rem;
    min-width: 250px;
    backdrop-filter: blur(10px);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: #fff;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    background: transparent;
    border: none;
    color: #999;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: #444;
    color: #fff;
  }

  .panel-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .control-group label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9rem;
    color: #ccc;
  }

  .control-group .value {
    color: #6496ff;
    font-weight: 600;
  }

  .control-group input[type='range'] {
    width: 100%;
    height: 6px;
    background: #444;
    border-radius: 3px;
    outline: none;
    cursor: pointer;
  }

  .control-group input[type='range']::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    background: #6496ff;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
  }

  .control-group input[type='range']::-webkit-slider-thumb:hover {
    background: #7aa7ff;
    transform: scale(1.1);
  }

  .control-group input[type='range']::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: #6496ff;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
  }

  .control-group input[type='range']::-moz-range-thumb:hover {
    background: #7aa7ff;
    transform: scale(1.1);
  }

  .panel-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
  }

  .btn-danger {
    background: #cc3333;
    color: #fff;
  }

  .btn-danger:hover {
    background: #dd4444;
  }

  .panel-hint {
    padding: 1rem;
    background: #2a2a2a;
    border-radius: 4px;
    color: #999;
    font-size: 0.9rem;
  }

  .panel-hint p {
    margin: 0;
  }
</style>
