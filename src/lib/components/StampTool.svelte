<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { StampArea, Viewport, TransformState, CropArea, StampAsset } from '../types';
  import { STAMP_ASSETS } from '../config/stamps';
  import { preloadStampImage } from '../utils/canvas';
  import { RotateCw, Trash2 } from 'lucide-svelte';

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

  function handleCanvasMouseDown(event: MouseEvent) {
    if (!canvas || !image) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Check if clicking on rotation handle (se corner)
    for (const canvasStamp of canvasStampAreas) {
      const stamp = stampAreas.find(s => s.id === canvasStamp.id);
      if (!stamp) continue;

      const rotHandle = getRotationHandlePosition(canvasStamp);
      const dist = Math.hypot(mouseX - rotHandle.x, mouseY - rotHandle.y);
      if (dist <= 10) {
        isRotating = true;
        selectedStampId = stamp.id;
        dragStart = { x: event.clientX, y: event.clientY };
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
        dragStart = { x: event.clientX, y: event.clientY };
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
          dragStart = { x: event.clientX, y: event.clientY };
          initialStamp = { ...stamp };
          event.preventDefault();
          return;
        }
      }
    }

    // Deselect if clicking on empty area
    selectedStampId = null;
  }

  function handleMouseMove(event: MouseEvent) {
    if (!canvas || !image) return;

    // Handle panning
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

    // Handle dragging
    if (isDragging && initialStamp && selectedStampId) {
      const deltaX = event.clientX - dragStart.x;
      const deltaY = event.clientY - dragStart.y;

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
      const deltaX = event.clientX - dragStart.x;
      const deltaY = event.clientY - dragStart.y;

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
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

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

  function handleMouseUp(event: MouseEvent) {
    isDragging = false;
    isResizing = false;
    isRotating = false;
    isPanning = false;
    resizeHandle = null;
    initialStamp = null;
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
  <div class="stamp-palette">
    <h3>{$_('editor.selectStamp') || 'Select Stamp'}</h3>
    <div class="stamp-grid">
      {#each STAMP_ASSETS as asset}
        <button
          class="stamp-item"
          class:selected={selectedStampAsset?.id === asset.id}
          onclick={() => selectStampAsset(asset)}
          title={asset.id}
        >
          {#if asset.type === 'emoji'}
            <span class="emoji">{asset.content}</span>
          {:else}
            <img src={asset.preview || asset.content} alt={asset.id} />
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div
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
              stroke={isSelected ? '#0066cc' : '#ffffff'}
              stroke-width="2"
              stroke-dasharray={isSelected ? '0' : '5,5'}
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
                r="6"
                fill="#0066cc"
                stroke="#fff"
                stroke-width="2"
                style="pointer-events: all; cursor: {cursor};"
              />
            {/each}

            <!-- Rotation handle (se corner) -->
            <circle
              cx={rotHandle.x}
              cy={rotHandle.y}
              r="8"
              fill="#00cc00"
              stroke="#fff"
              stroke-width="2"
              style="pointer-events: all; cursor: grab;"
            />
            <g transform="translate({rotHandle.x}, {rotHandle.y})">
              <foreignObject x="-8" y="-8" width="16" height="16" style="pointer-events: none;">
                <div style="color: white; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;">
                  <RotateCw size={12} />
                </div>
              </foreignObject>
            </g>
          {/if}
        {/each}
      </svg>
    {/if}
  </div>

  <div class="stamp-controls">
    {#if selectedStampId}
      <button class="control-btn delete" onclick={handleDeleteStamp}>
        <Trash2 size={16} />
        <span>{$_('editor.delete')}</span>
      </button>
    {/if}
    <button class="control-btn" onclick={onClose}>
      {$_('editor.close')}
    </button>
  </div>
</div>

<style lang="postcss">
  .stamp-tool {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .stamp-palette {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: rgba(30, 30, 30, 0.95);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 1rem;
    width: 280px;
    max-height: 400px;
    overflow-y: auto;
    pointer-events: all;
    backdrop-filter: blur(10px);
    z-index: 1;
  }

  .stamp-palette h3 {
    margin: 0 0 1rem 0;
    font-size: 1rem;
    color: #fff;
  }

  .stamp-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }

  .stamp-item {
    width: 60px;
    height: 60px;
    background: #333;
    border: 2px solid #444;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .stamp-item:hover {
    background: #444;
    border-color: #666;
  }

  .stamp-item.selected {
    background: #0066cc;
    border-color: #0077dd;
  }

  .stamp-item .emoji {
    font-size: 2rem;
  }

  .stamp-item img {
    max-width: 90%;
    max-height: 90%;
  }

  .stamp-canvas-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: all;
    user-select: none;
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

  .stamp-controls {
    position: absolute;
    bottom: 20px;
    right: 20px;
    display: flex;
    gap: 0.5rem;
    pointer-events: all;
  }

  .control-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: #333;
    color: #fff;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .control-btn:hover {
    background: #444;
    border-color: #555;
  }

  .control-btn.delete {
    background: #cc0000;
    border-color: #dd0000;
  }

  .control-btn.delete:hover {
    background: #dd0000;
    border-color: #ee0000;
  }
</style>
