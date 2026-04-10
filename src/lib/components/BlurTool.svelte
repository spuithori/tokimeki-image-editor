<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { X, Trash2, Droplet, Info } from 'lucide-svelte';
  import type { BlurArea, Viewport, TransformState, CropArea } from '../types';
  import { screenToImageCoords, imageToCanvasCoords } from '../utils/canvas';
  import FloatingRail from './FloatingRail.svelte';
  import RailButton from './RailButton.svelte';
  import Popover from './Popover.svelte';
  import Slider from './Slider.svelte';
  import { haptic } from '../utils/haptics';

  // Popover state for blur-strength control
  let strengthPopoverOpen = $state(false);
  let strengthAnchor = $state<HTMLElement | null>(null);
  let hintPopoverOpen = $state(false);
  let hintAnchor = $state<HTMLElement | null>(null);

  function toggleStrengthPopover() {
    strengthPopoverOpen = !strengthPopoverOpen;
    hintPopoverOpen = false;
  }
  function toggleHintPopover() {
    hintPopoverOpen = !hintPopoverOpen;
    strengthPopoverOpen = false;
  }

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

  let containerElement = $state<HTMLDivElement | null>(null);

  // Helper to get coordinates from mouse or touch event
  function getEventCoords(event: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
    if ('touches' in event && event.touches.length > 0) {
      return { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY };
    } else if ('clientX' in event) {
      return { clientX: event.clientX, clientY: event.clientY };
    }
    return { clientX: 0, clientY: 0 };
  }

  onMount(() => {
    if (containerElement) {
      // Add touch event listeners with passive: false to allow preventDefault
      containerElement.addEventListener('touchstart', handleContainerTouchStart as any, { passive: false });
      containerElement.addEventListener('touchmove', handleTouchMove as any, { passive: false });
      containerElement.addEventListener('touchend', handleTouchEnd as any, { passive: false });
    }

    return () => {
      if (containerElement) {
        containerElement.removeEventListener('touchstart', handleContainerTouchStart as any);
        containerElement.removeEventListener('touchmove', handleTouchMove as any);
        containerElement.removeEventListener('touchend', handleTouchEnd as any);
      }
    };
  });

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

  function handleContainerMouseDown(event: MouseEvent | TouchEvent) {
    if (!canvas || !image) return;

    // Check if it's a mouse event with non-left button
    if ('button' in event && event.button !== 0) return;

    const coords = getEventCoords(event);
    const rect = canvas.getBoundingClientRect();
    const mouseX = coords.clientX - rect.left;
    const mouseY = coords.clientY - rect.top;

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

  function handleMouseMove(event: MouseEvent | TouchEvent) {
    if (!canvas || !image) return;

    const coords = getEventCoords(event);
    const rect = canvas.getBoundingClientRect();
    const mouseX = coords.clientX - rect.left;
    const mouseY = coords.clientY - rect.top;

    // Handle viewport panning
    if (isPanning && onViewportChange) {
      const deltaX = coords.clientX - lastPanPosition.x;
      const deltaY = coords.clientY - lastPanPosition.y;

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

      lastPanPosition = { x: coords.clientX, y: coords.clientY };
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
      const deltaX = coords.clientX - dragStart.x;
      const deltaY = coords.clientY - dragStart.y;

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
      const deltaX = coords.clientX - dragStart.x;
      const deltaY = coords.clientY - dragStart.y;

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

  function handleMouseUp(event?: MouseEvent | TouchEvent) {
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

  function handleAreaMouseDown(event: MouseEvent | TouchEvent, areaId: string) {
    if (!canvas || !image) return;

    event.preventDefault();
    event.stopPropagation();

    const coords = getEventCoords(event);
    selectedAreaId = areaId;
    isDragging = true;
    dragStart = { x: coords.clientX, y: coords.clientY };
    initialArea = blurAreas.find(a => a.id === areaId) || null;
  }

  function handleHandleMouseDown(event: MouseEvent | TouchEvent, areaId: string, handle: string) {
    if (!canvas || !image) return;

    event.preventDefault();
    event.stopPropagation();

    const coords = getEventCoords(event);
    selectedAreaId = areaId;
    isResizing = true;
    resizeHandle = handle;
    dragStart = { x: coords.clientX, y: coords.clientY };
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

  // Unified touch handlers
  const handleContainerTouchStart = handleContainerMouseDown;
  const handleTouchMove = handleMouseMove;

  function handleTouchEnd(event: TouchEvent) {
    if (event.touches.length === 0) {
      handleMouseUp();
    }
  }
</script>

<svelte:window
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
/>

<!-- Overlay -->
<div
  bind:this={containerElement}
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
        fill="rgba(10, 132, 255, 0.18)"
        stroke="#0a84ff"
        stroke-width="2"
        stroke-dasharray="6,4"
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
          fill={isSelected ? "rgba(10, 132, 255, 0.12)" : "rgba(255, 255, 255, 0.06)"}
          stroke={isSelected ? "#0a84ff" : "rgba(255, 255, 255, 0.6)"}
          stroke-width={isSelected ? "2.5" : "1.5"}
          stroke-dasharray={isSelected ? "0" : "6,4"}
          onmousedown={(e) => handleAreaMouseDown(e, area.id)}
          ontouchstart={(e) => handleAreaMouseDown(e, area.id)}
          style="cursor: move;"
        />

        <!-- Resize handles (only for selected area) -->
        {#if isSelected}
          {#each ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as handle}
            {@const handleSize = 22}
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

            <circle
              cx={handleX + handleSize / 2}
              cy={handleY + handleSize / 2}
              r={handleSize / 2}
              fill="#fff"
              stroke="#0a84ff"
              stroke-width="3"
              onmousedown={(e) => handleHandleMouseDown(e, area.id, handle)}
              ontouchstart={(e) => handleHandleMouseDown(e, area.id, handle)}
              style="cursor: {cursor}; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.3));"
            />
          {/each}
        {/if}
      </g>
    {/each}
  </svg>
</div>

<!-- Floating tool rail -->
<FloatingRail side="right">
  {#snippet top()}
    <RailButton label={$_('editor.close')} variant="default" haptics="light" onclick={onClose}>
      <X size={20} strokeWidth={2.2} />
    </RailButton>
  {/snippet}

  {#snippet children()}
    <button
      bind:this={strengthAnchor}
      type="button"
      class="rail-color-trigger"
      class:open={strengthPopoverOpen}
      class:disabled={!selectedArea}
      aria-label={$_('blur.strength')}
      title={$_('blur.strength')}
      disabled={!selectedArea}
      onclick={toggleStrengthPopover}
    >
      <Droplet size={20} strokeWidth={1.8} />
    </button>

    <button
      bind:this={hintAnchor}
      type="button"
      class="rail-color-trigger"
      class:open={hintPopoverOpen}
      aria-label="Help"
      title="Help"
      onclick={toggleHintPopover}
    >
      <Info size={18} strokeWidth={1.8} />
    </button>
  {/snippet}

  {#snippet bottom()}
    <RailButton
      label={$_('editor.delete')}
      variant="danger"
      disabled={!selectedArea}
      haptics="warning"
      onclick={handleDeleteArea}
    >
      <Trash2 size={18} strokeWidth={1.8} />
    </RailButton>
  {/snippet}
</FloatingRail>

<Popover open={strengthPopoverOpen && !!selectedArea} onClose={() => (strengthPopoverOpen = false)} side="left" anchor={strengthAnchor}>
  {#snippet children()}
    {#if selectedArea}
      <Slider
        label={$_('blur.strength')}
        value={selectedArea.blurStrength}
        min={0}
        max={100}
        suffix="%"
        onInput={handleBlurStrengthChange}
      />
    {/if}
  {/snippet}
</Popover>

<Popover open={hintPopoverOpen} onClose={() => (hintPopoverOpen = false)} side="left" anchor={hintAnchor}>
  {#snippet children()}
    <p class="popover-hint">{$_('blur.hint')}</p>
  {/snippet}
</Popover>

<style lang="postcss">
  :global(.popover-hint) {
    margin: 0;
    font-size: var(--tk-text-sm);
    line-height: var(--tk-leading-snug);
    color: var(--tk-text-secondary);
    max-width: 240px;
  }

  :global(.rail-color-trigger.disabled) {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .blur-tool-overlay {
    position: absolute;
    inset: 0;
    cursor: crosshair;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .blur-tool-svg {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .blur-tool-svg rect,
  .blur-tool-svg circle {
    pointer-events: all;
  }

  .panel-hint {
    padding: var(--tk-space-3) var(--tk-space-4);
    background: var(--tk-surface-1);
    border-radius: var(--tk-radius-md);
    color: var(--tk-text-secondary);
    font-size: var(--tk-text-sm);
    line-height: var(--tk-leading-snug);
  }

  .panel-hint p {
    margin: 0;
  }

  .btn {
    appearance: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: var(--tk-text-sm);
    font-weight: var(--tk-weight-semibold);
    padding: 0 var(--tk-space-4);
    height: var(--tk-touch-min);
    border-radius: var(--tk-radius-full);
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring);
  }

  .btn-danger {
    background: var(--tk-danger-soft);
    color: var(--tk-danger);
  }

  .btn-danger:hover {
    background: var(--tk-danger);
    color: var(--tk-text-on-accent);
  }
  .btn-danger:active {
    transform: scale(0.96);
  }
</style>
