<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import type { StampArea, Viewport, TransformState, CropArea, StampAsset } from '../types';
  import { STAMP_ASSETS } from '../config/stamps';
  import { preloadStampImage } from '../utils/canvas';
  import { RotateCw, Trash2, X, Sticker } from 'lucide-svelte';
  import FloatingRail from './FloatingRail.svelte';
  import RailButton from './RailButton.svelte';
  import Popover from './Popover.svelte';
  import { haptic } from '../utils/haptics';

  // Stamp picker popover state
  let pickerOpen = $state(false);
  let pickerAnchor = $state<HTMLElement | null>(null);
  function togglePicker() {
    pickerOpen = !pickerOpen;
  }

  interface Props {
    canvas: HTMLCanvasElement | null;
    image: HTMLImageElement | null;
    viewport: Viewport;
    transform: TransformState;
    stampAreas: StampArea[];
    cropArea?: CropArea | null;
    onUpdate: (stampAreas: StampArea[]) => void;
    onClose: () => void;
    onViewportChange?: (viewport: Partial<Viewport>) => void;
  }

  let { canvas, image, viewport, transform, stampAreas, cropArea, onUpdate, onClose, onViewportChange }: Props = $props();

  let overlayElement = $state<HTMLDivElement | null>(null);

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
    if (overlayElement) {
      // Add touch event listeners with passive: false to allow preventDefault
      overlayElement.addEventListener('touchstart', handleCanvasTouchStart as any, { passive: false });
      overlayElement.addEventListener('touchmove', handleTouchMove as any, { passive: false });
      overlayElement.addEventListener('touchend', handleTouchEnd as any, { passive: false });
    }

    return () => {
      if (overlayElement) {
        overlayElement.removeEventListener('touchstart', handleCanvasTouchStart as any);
        overlayElement.removeEventListener('touchmove', handleTouchMove as any);
        overlayElement.removeEventListener('touchend', handleTouchEnd as any);
      }
    };
  });

  // Default stamp size as percentage of the smaller dimension of the image
  const DEFAULT_STAMP_SIZE_PERCENT = 0.1; // 10%

  let selectedStampAsset = $state<StampAsset | null>(null);
  let selectedStampId = $state<string | null>(null);
  let isDragging = $state(false);
  let isResizing = $state(false);
  let isRotating = $state(false);
  let resizeHandle = $state<string | null>(null);
  let dragStart = $state({ x: 0, y: 0 });
  let initialStamp = $state<StampArea | null>(null);
  let initialRotation = $state(0);
  let initialAngle = $state(0);
  let rotationCenter = $state({ x: 0, y: 0 });

  // Viewport panning
  let isPanning = $state(false);
  let lastPanPosition = $state({ x: 0, y: 0 });

  // Convert stamp areas to canvas coordinates for rendering
  let canvasStampAreas = $derived.by(() => {
    if (!canvas || !image) return [];

    return stampAreas.map(area => {
      const sourceWidth = cropArea ? cropArea.width : image.width;
      const sourceHeight = cropArea ? cropArea.height : image.height;
      const offsetX = cropArea ? cropArea.x : 0;
      const offsetY = cropArea ? cropArea.y : 0;

      const relativeX = area.x - offsetX;
      const relativeY = area.y - offsetY;

      const totalScale = viewport.scale * viewport.zoom;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      const canvasCenterX = (relativeX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX;
      const canvasCenterY = (relativeY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY;
      const canvasWidth = area.width * totalScale;
      const canvasHeight = area.height * totalScale;

      return {
        ...area,
        canvasCenterX,
        canvasCenterY,
        canvasWidth,
        canvasHeight
      };
    });
  });

  function handleCanvasMouseDown(event: MouseEvent | TouchEvent) {
    if (!canvas || !image) return;

    const coords = getEventCoords(event);
    const rect = canvas.getBoundingClientRect();
    const mouseX = coords.clientX - rect.left;
    const mouseY = coords.clientY - rect.top;

    // Check if clicking on rotation handle (se corner)
    for (const canvasStamp of canvasStampAreas) {
      const stamp = stampAreas.find(s => s.id === canvasStamp.id);
      if (!stamp) continue;

      const rotHandle = getRotationHandlePosition(canvasStamp);
      const dist = Math.hypot(mouseX - rotHandle.x, mouseY - rotHandle.y);
      if (dist <= 10) {
        isRotating = true;
        selectedStampId = stamp.id;
        dragStart = { x: coords.clientX, y: coords.clientY };
        initialStamp = { ...stamp };
        initialRotation = stamp.rotation || 0;
        rotationCenter = { x: canvasStamp.canvasCenterX, y: canvasStamp.canvasCenterY };
        // Calculate initial angle from center to mouse position
        initialAngle = Math.atan2(mouseY - rotationCenter.y, mouseX - rotationCenter.x) * (180 / Math.PI);
        event.preventDefault();
        return;
      }
    }

    // Check if clicking on resize handle (nw, ne, sw corners only)
    for (const canvasStamp of canvasStampAreas) {
      const stamp = stampAreas.find(s => s.id === canvasStamp.id);
      if (!stamp) continue;

      const handle = getResizeHandle(mouseX, mouseY, canvasStamp);
      if (handle) {
        isResizing = true;
        resizeHandle = handle;
        selectedStampId = stamp.id;
        dragStart = { x: coords.clientX, y: coords.clientY };
        initialStamp = { ...stamp };
        event.preventDefault();
        return;
      }
    }

    // Check if clicking on a stamp
    for (const canvasStamp of canvasStampAreas) {
      if (isPointInStamp(mouseX, mouseY, canvasStamp)) {
        const stamp = stampAreas.find(s => s.id === canvasStamp.id);
        if (stamp) {
          selectedStampId = stamp.id;
          isDragging = true;
          dragStart = { x: coords.clientX, y: coords.clientY };
          initialStamp = { ...stamp };
          event.preventDefault();
          return;
        }
      }
    }

    // If clicking outside any stamp, deselect and start panning
    selectedStampId = null;
    isPanning = true;
    lastPanPosition = { x: coords.clientX, y: coords.clientY };
    event.preventDefault();
  }

  function handleMouseMove(event: MouseEvent | TouchEvent) {
    if (!canvas || !image) return;

    const coords = getEventCoords(event);

    // Handle panning
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

    // Handle dragging
    if (isDragging && initialStamp && selectedStampId) {
      const deltaX = coords.clientX - dragStart.x;
      const deltaY = coords.clientY - dragStart.y;

      const totalScale = viewport.scale * viewport.zoom;
      const imgDeltaX = deltaX / totalScale;
      const imgDeltaY = deltaY / totalScale;

      const newX = initialStamp.x + imgDeltaX;
      const newY = initialStamp.y + imgDeltaY;

      const updatedAreas = stampAreas.map(area =>
        area.id === selectedStampId
          ? { ...area, x: newX, y: newY }
          : area
      );
      onUpdate(updatedAreas);
      event.preventDefault();
      return;
    }

    // Handle resizing
    if (isResizing && initialStamp && resizeHandle && selectedStampId) {
      const deltaX = coords.clientX - dragStart.x;
      const deltaY = coords.clientY - dragStart.y;

      const totalScale = viewport.scale * viewport.zoom;
      const imgDeltaX = deltaX / totalScale;
      const imgDeltaY = deltaY / totalScale;

      // Calculate new size maintaining aspect ratio
      const aspectRatio = initialStamp.width / initialStamp.height;

      // Determine resize direction based on handle
      let sizeDelta = 0;
      switch (resizeHandle) {
        case 'nw':
          // Resize from top-left corner (inverse)
          sizeDelta = -(imgDeltaX + imgDeltaY) / 2;
          break;
        case 'ne':
          // Resize from top-right corner
          sizeDelta = (imgDeltaX - imgDeltaY) / 2;
          break;
        case 'sw':
          // Resize from bottom-left corner
          sizeDelta = (-imgDeltaX + imgDeltaY) / 2;
          break;
      }

      let newWidth = initialStamp.width + sizeDelta;
      let newHeight = newWidth / aspectRatio;

      // Enforce minimum size
      if (newWidth >= 20 && newHeight >= 20) {
        const updatedAreas = stampAreas.map(area =>
          area.id === selectedStampId
            ? { ...area, width: newWidth, height: newHeight }
            : area
        );
        onUpdate(updatedAreas);
      }
      event.preventDefault();
      return;
    }

    // Handle rotation
    if (isRotating && initialStamp && selectedStampId) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = coords.clientX - rect.left;
      const mouseY = coords.clientY - rect.top;

      // Calculate current angle from center to mouse position
      const currentAngle = Math.atan2(mouseY - rotationCenter.y, mouseX - rotationCenter.x) * (180 / Math.PI);

      // Calculate angle delta and apply to initial rotation
      const angleDelta = currentAngle - initialAngle;
      const newRotation = initialRotation + angleDelta;

      const updatedAreas = stampAreas.map(area =>
        area.id === selectedStampId
          ? { ...area, rotation: newRotation }
          : area
      );
      onUpdate(updatedAreas);
      event.preventDefault();
      return;
    }
  }

  function handleMouseUp(event?: MouseEvent | TouchEvent) {
    isDragging = false;
    isResizing = false;
    isRotating = false;
    isPanning = false;
    resizeHandle = null;
    initialStamp = null;
  }

  // Unified touch handlers
  const handleCanvasTouchStart = handleCanvasMouseDown;
  const handleTouchMove = handleMouseMove;

  function handleTouchEnd(event: TouchEvent) {
    if (event.touches.length === 0) {
      handleMouseUp();
    }
  }

  function getResizeHandle(mouseX: number, mouseY: number, canvasStamp: any): string | null {
    const handles = getResizeHandles(canvasStamp);
    for (const [handle, pos] of Object.entries(handles)) {
      const dist = Math.hypot(mouseX - pos.x, mouseY - pos.y);
      if (dist <= 8) return handle;
    }
    return null;
  }

  function getResizeHandles(canvasStamp: any) {
    const { canvasCenterX, canvasCenterY, canvasWidth, canvasHeight, rotation } = canvasStamp;
    const hw = canvasWidth / 2;
    const hh = canvasHeight / 2;
    const rad = (rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotate = (x: number, y: number) => ({
      x: canvasCenterX + x * cos - y * sin,
      y: canvasCenterY + x * sin + y * cos
    });

    // Only return corner handles (4 corners)
    return {
      nw: rotate(-hw, -hh),
      ne: rotate(hw, -hh),
      sw: rotate(-hw, hh),
      se: rotate(hw, hh)
    };
  }

  function getRotationHandlePosition(canvasStamp: any) {
    const handles = getResizeHandles(canvasStamp);
    return {
      x: handles.se.x,
      y: handles.se.y
    };
  }

  function isPointInStamp(mouseX: number, mouseY: number, canvasStamp: any): boolean {
    const { canvasCenterX, canvasCenterY, canvasWidth, canvasHeight, rotation } = canvasStamp;
    const rad = -(rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const dx = mouseX - canvasCenterX;
    const dy = mouseY - canvasCenterY;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    return Math.abs(localX) <= canvasWidth / 2 && Math.abs(localY) <= canvasHeight / 2;
  }

  function handleDeleteStamp() {
    if (selectedStampId) {
      const updatedAreas = stampAreas.filter(area => area.id !== selectedStampId);
      onUpdate(updatedAreas);
      selectedStampId = null;
    }
  }

  function selectStampAsset(asset: StampAsset) {
    if (!canvas || !image) return;

    selectedStampAsset = asset;

    // Calculate center position in image coordinates
    const sourceWidth = cropArea ? cropArea.width : image.width;
    const sourceHeight = cropArea ? cropArea.height : image.height;
    const offsetX = cropArea ? cropArea.x : 0;
    const offsetY = cropArea ? cropArea.y : 0;

    // Center of the visible area (in image coordinates)
    const centerX = sourceWidth / 2 + offsetX;
    const centerY = sourceHeight / 2 + offsetY;

    // Default size: based on the smaller dimension of the image
    const minDimension = Math.min(sourceWidth, sourceHeight);
    const defaultSize = minDimension * DEFAULT_STAMP_SIZE_PERCENT;

    // For emojis, use 1:1 aspect ratio
    if (asset.type === 'emoji') {
      const aspectRatio = 1;

      const newStamp: StampArea = {
        id: `stamp-${Date.now()}`,
        x: centerX,
        y: centerY,
        width: defaultSize,
        height: defaultSize / aspectRatio,
        rotation: 0,
        stampAssetId: asset.id,
        stampType: asset.type,
        stampContent: asset.content
      };

      onUpdate([...stampAreas, newStamp]);
      selectedStampId = newStamp.id;
    } else {
      // For images and SVGs, load the image first to get actual aspect ratio
      preloadStampImage(asset.content).then((img) => {
        const aspectRatio = img.width / img.height;

        // Calculate width and height based on aspect ratio
        // Use defaultSize as the width for landscape, height for portrait
        let width: number, height: number;
        if (aspectRatio >= 1) {
          // Landscape or square
          width = defaultSize;
          height = width / aspectRatio;
        } else {
          // Portrait
          height = defaultSize;
          width = height * aspectRatio;
        }

        const newStamp: StampArea = {
          id: `stamp-${Date.now()}`,
          x: centerX,
          y: centerY,
          width,
          height,
          rotation: 0,
          stampAssetId: asset.id,
          stampType: asset.type,
          stampContent: asset.content
        };

        onUpdate([...stampAreas, newStamp]);
        selectedStampId = newStamp.id;
      }).catch((error) => {
        console.error('Failed to load stamp image:', error);
        // Fallback to square aspect ratio on error
        const aspectRatio = 1;

        const newStamp: StampArea = {
          id: `stamp-${Date.now()}`,
          x: centerX,
          y: centerY,
          width: defaultSize,
          height: defaultSize / aspectRatio,
          rotation: 0,
          stampAssetId: asset.id,
          stampType: asset.type,
          stampContent: asset.content
        };

        onUpdate([...stampAreas, newStamp]);
        selectedStampId = newStamp.id;
      });
    }
  }
</script>

<svelte:window
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
/>

<div class="stamp-tool">
  <div
    bind:this={overlayElement}
    class="stamp-canvas-overlay"
    onmousedown={handleCanvasMouseDown}
    role="button"
    tabindex="-1"
  >

    <!-- Render stamp selection boxes -->
    {#if canvas}
      <svg class="stamp-svg">
        {#each canvasStampAreas as canvasStamp}
          {@const isSelected = selectedStampId === canvasStamp.id}
          {@const handles = getResizeHandles(canvasStamp)}
          {@const rotHandle = getRotationHandlePosition(canvasStamp)}

          <g transform="rotate({canvasStamp.rotation || 0} {canvasStamp.canvasCenterX} {canvasStamp.canvasCenterY})">
            <rect
              x={canvasStamp.canvasCenterX - canvasStamp.canvasWidth / 2}
              y={canvasStamp.canvasCenterY - canvasStamp.canvasHeight / 2}
              width={canvasStamp.canvasWidth}
              height={canvasStamp.canvasHeight}
              fill="none"
              stroke={isSelected ? 'var(--tk-accent)' : 'var(--tk-stamp-stroke-default)'}
              stroke-width={isSelected ? '2.5' : '1.5'}
              stroke-dasharray={isSelected ? '0' : '6,4'}
            />
          </g>

          {#if isSelected}
            <!-- Resize handles (nw, ne, sw only - se is for rotation) -->
            {#each ['nw', 'ne', 'sw'] as handleKey}
              {@const handle = handles[handleKey]}
              {@const cursor = handleKey === 'nw' ? 'nwse-resize' : 'nesw-resize'}
              <circle
                cx={handle.x}
                cy={handle.y}
                r="11"
                fill="var(--tk-handle-fill)"
                stroke="var(--tk-handle-stroke)"
                stroke-width="3"
                style="pointer-events: all; cursor: {cursor}; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.35));"
              />
            {/each}

            <!-- Rotation handle (se corner) -->
            <circle
              cx={rotHandle.x}
              cy={rotHandle.y}
              r="14"
              fill="var(--tk-accent)"
              stroke="var(--tk-handle-fill)"
              stroke-width="3"
              style="pointer-events: all; cursor: grab; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.35));"
            />
            <g transform="translate({rotHandle.x}, {rotHandle.y})">
              <foreignObject x="-9" y="-9" width="18" height="18" style="pointer-events: none;">
                <div style="color: white; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;">
                  <RotateCw size={13} strokeWidth={2.4} />
                </div>
              </foreignObject>
            </g>
          {/if}
        {/each}
      </svg>
    {/if}
  </div>

  <FloatingRail side="right">
    {#snippet top()}
      <RailButton label={$_('editor.close')} variant="default" haptics="light" onclick={onClose}>
        <X size={20} strokeWidth={2.2} />
      </RailButton>
    {/snippet}

    {#snippet children()}
      <button
        bind:this={pickerAnchor}
        type="button"
        class="rail-color-trigger"
        class:open={pickerOpen}
        aria-label={$_('editor.selectStamp')}
        title={$_('editor.selectStamp')}
        onclick={togglePicker}
      >
        <Sticker size={20} strokeWidth={1.8} />
      </button>
    {/snippet}

    {#snippet bottom()}
      <RailButton
        label={$_('editor.delete')}
        variant="danger"
        disabled={!selectedStampId}
        haptics="warning"
        onclick={handleDeleteStamp}
      >
        <Trash2 size={18} strokeWidth={1.8} />
      </RailButton>
    {/snippet}
  </FloatingRail>

  <Popover open={pickerOpen} onClose={() => (pickerOpen = false)} side="left" anchor={pickerAnchor}>
    {#snippet children()}
      <div class="popover-title">{$_('editor.selectStamp')}</div>
      <div class="stamp-grid-pop">
        {#each STAMP_ASSETS as asset}
          <button
            class="stamp-item-pop"
            class:selected={selectedStampAsset?.id === asset.id}
            onclick={() => { haptic('selection'); selectStampAsset(asset); pickerOpen = false; }}
            title={asset.id}
            aria-label={`Stamp ${asset.id}`}
            aria-pressed={selectedStampAsset?.id === asset.id}
          >
            {#if asset.type === 'emoji'}
              <span class="emoji">{asset.content}</span>
            {:else}
              <img src={asset.preview || asset.content} alt={asset.id} />
            {/if}
          </button>
        {/each}
      </div>
    {/snippet}
  </Popover>
</div>

<style lang="postcss">
  .stamp-tool {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  :global(.stamp-grid-pop) {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--tk-space-2);
    max-height: 60dvh;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--tk-surface-3) transparent;
  }

  :global(.stamp-item-pop) {
    appearance: none;
    width: 56px;
    height: 56px;
    background: var(--tk-surface-1);
    border: 1.5px solid var(--tk-border-subtle);
    border-radius: var(--tk-radius-lg);
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0;
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      border-color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring);
    -webkit-tap-highlight-color: transparent;
  }

  :global(.stamp-item-pop:hover) {
    background: var(--tk-surface-2);
    border-color: var(--tk-border-strong);
  }
  :global(.stamp-item-pop:active) {
    transform: scale(0.94);
  }
  :global(.stamp-item-pop.selected) {
    background: var(--tk-accent-soft);
    border-color: var(--tk-accent);
  }
  :global(.stamp-item-pop .emoji) {
    font-size: 32px;
    line-height: 1;
  }
  :global(.stamp-item-pop img) {
    max-width: 80%;
    max-height: 80%;
  }

  .stamp-canvas-overlay {
    position: absolute;
    inset: 0;
    pointer-events: all;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
    touch-action: none;
  }

  .stamp-canvas-overlay:active {
    cursor: grabbing;
  }

  .stamp-svg {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .stamp-svg circle,
  .stamp-svg rect {
    pointer-events: all;
  }
</style>
