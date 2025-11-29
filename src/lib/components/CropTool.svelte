<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { RotateCw, RotateCcw, FlipHorizontal, FlipVertical } from 'lucide-svelte';
  import type { CropArea, Viewport, TransformState } from '../types';
  import { screenToImageCoords, imageToCanvasCoords } from '../utils/canvas';

  interface Props {
    canvas: HTMLCanvasElement | null;
    image: HTMLImageElement | null;
    viewport: Viewport;
    transform: TransformState;
    onApply: (cropArea: CropArea) => void;
    onCancel: () => void;
    onViewportChange?: (viewport: Partial<Viewport>) => void;
    onTransformChange?: (transform: Partial<TransformState>) => void;
  }

  let { canvas, image, viewport, transform, onApply, onCancel, onViewportChange, onTransformChange }: Props = $props();

  // Crop area in image coordinates
  let cropArea = $state<CropArea>({
    x: 0,
    y: 0,
    width: 200,
    height: 200
  });

  let isDragging = $state(false);
  let isResizing = $state(false);
  let dragStart = $state({ x: 0, y: 0 });
  let resizeHandle = $state<string | null>(null);
  let initialCropArea = $state<CropArea | null>(null);

  // Viewport panning state (for dragging outside crop area)
  let isPanning = $state(false);
  let lastPanPosition = $state({ x: 0, y: 0 });

  // Touch pinch zoom state
  let initialPinchDistance = $state(0);
  let initialCropSize = $state<{ width: number; height: number } | null>(null);

  // Helper to get coordinates from mouse or touch event
  function getEventCoords(event: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
    if ('touches' in event && event.touches.length > 0) {
      return { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY };
    } else if ('clientX' in event) {
      return { clientX: event.clientX, clientY: event.clientY };
    }
    return { clientX: 0, clientY: 0 };
  }

  // Canvas coordinates for rendering
  let canvasCoords = $derived.by(() => {
    if (!canvas || !image) return null;

    const topLeft = imageToCanvasCoords(cropArea.x, cropArea.y, canvas, image, viewport);
    const bottomRight = imageToCanvasCoords(
      cropArea.x + cropArea.width,
      cropArea.y + cropArea.height,
      canvas,
      image,
      viewport
    );

    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    };
  });

  $effect(() => {
    if (image) {
      // Initialize crop area to center of image
      const size = Math.min(image.width, image.height, 300);
      cropArea = {
        x: (image.width - size) / 2,
        y: (image.height - size) / 2,
        width: size,
        height: size
      };
    }
  });

  function handleMouseDown(event: MouseEvent | TouchEvent, handle?: string) {
    if (!canvas || !image) return;

    event.preventDefault();
    event.stopPropagation();

    const coords = getEventCoords(event);
    dragStart = { x: coords.clientX, y: coords.clientY };
    initialCropArea = { ...cropArea };

    if (handle) {
      isResizing = true;
      resizeHandle = handle;
    } else {
      isDragging = true;
    }
  }

  function handleContainerMouseDown(event: MouseEvent | TouchEvent) {
    if (!canvas || !canvasCoords) return;

    // Check if it's a mouse event with non-left button
    if ('button' in event && event.button !== 0) return;

    // Check if click is inside crop area
    const rect = canvas.getBoundingClientRect();
    const coords = getEventCoords(event);
    const mouseX = coords.clientX - rect.left;
    const mouseY = coords.clientY - rect.top;

    const isInsideCropArea =
      mouseX >= canvasCoords.x &&
      mouseX <= canvasCoords.x + canvasCoords.width &&
      mouseY >= canvasCoords.y &&
      mouseY <= canvasCoords.y + canvasCoords.height;

    // If inside crop area, let SVG elements handle it
    if (isInsideCropArea) return;

    // If outside crop area, start panning the viewport
    event.preventDefault();
    isPanning = true;
    lastPanPosition = { x: coords.clientX, y: coords.clientY };
  }

  function handleMouseMove(event: MouseEvent | TouchEvent) {
    if (!canvas || !image) return;

    const coords = getEventCoords(event);

    // Handle viewport panning (when dragging outside crop area)
    if (isPanning && onViewportChange) {
      const deltaX = coords.clientX - lastPanPosition.x;
      const deltaY = coords.clientY - lastPanPosition.y;

      // Use original image dimensions (same as Canvas.svelte when not cropped)
      const imgWidth = image.width;
      const imgHeight = image.height;
      const totalScale = viewport.scale * viewport.zoom;
      const scaledWidth = imgWidth * totalScale;
      const scaledHeight = imgHeight * totalScale;

      // Allow 20% overflow outside canvas
      const overflowMargin = 0.2;
      const maxOffsetX = (scaledWidth / 2) - (canvas.width / 2) + (canvas.width * overflowMargin);
      const maxOffsetY = (scaledHeight / 2) - (canvas.height / 2) + (canvas.height * overflowMargin);

      // Apply limits
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

    // Handle crop area dragging and resizing
    if (!initialCropArea) return;

    if (!isDragging && !isResizing) return;

    const deltaX = coords.clientX - dragStart.x;
    const deltaY = coords.clientY - dragStart.y;

    // Convert delta to image coordinates
    const scale = viewport.scale * viewport.zoom;
    const imageDeltaX = deltaX / scale;
    const imageDeltaY = deltaY / scale;

    if (isDragging) {
      // Move crop area
      cropArea.x = Math.max(0, Math.min(
        image.width - cropArea.width,
        initialCropArea.x + imageDeltaX
      ));
      cropArea.y = Math.max(0, Math.min(
        image.height - cropArea.height,
        initialCropArea.y + imageDeltaY
      ));
    } else if (isResizing && resizeHandle) {
      // Resize crop area
      const minSize = 50;

      if (resizeHandle.includes('w')) {
        const newX = Math.max(0, Math.min(
          initialCropArea.x + initialCropArea.width - minSize,
          initialCropArea.x + imageDeltaX
        ));
        cropArea.width = initialCropArea.width + (initialCropArea.x - newX);
        cropArea.x = newX;
      }
      if (resizeHandle.includes('e')) {
        cropArea.width = Math.max(minSize, Math.min(
          image.width - initialCropArea.x,
          initialCropArea.width + imageDeltaX
        ));
      }
      if (resizeHandle.includes('n')) {
        const newY = Math.max(0, Math.min(
          initialCropArea.y + initialCropArea.height - minSize,
          initialCropArea.y + imageDeltaY
        ));
        cropArea.height = initialCropArea.height + (initialCropArea.y - newY);
        cropArea.y = newY;
      }
      if (resizeHandle.includes('s')) {
        cropArea.height = Math.max(minSize, Math.min(
          image.height - initialCropArea.y,
          initialCropArea.height + imageDeltaY
        ));
      }
    }
  }

  function handleMouseUp() {
    isDragging = false;
    isResizing = false;
    isPanning = false;
    resizeHandle = null;
    initialCropArea = null;
  }

  function apply() {
    onApply(cropArea);
  }

  function setAspectRatio(ratio: number) {
    if (!image) return;

    let newWidth: number;
    let newHeight: number;

    // Calculate crop size to fill as much of the image as possible
    const imageAspectRatio = image.width / image.height;

    if (imageAspectRatio > ratio) {
      // Image is wider than the target ratio
      // Use full height, calculate width
      newHeight = image.height;
      newWidth = newHeight * ratio;
    } else {
      // Image is taller than the target ratio
      // Use full width, calculate height
      newWidth = image.width;
      newHeight = newWidth / ratio;
    }

    // Center the crop area
    cropArea = {
      x: (image.width - newWidth) / 2,
      y: (image.height - newHeight) / 2,
      width: newWidth,
      height: newHeight
    };
  }

  function handleWheel(event: WheelEvent) {
    if (!image || !canvas || !canvasCoords) return;

    // Check if cursor is inside crop area
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const isInsideCropArea =
      mouseX >= canvasCoords.x &&
      mouseX <= canvasCoords.x + canvasCoords.width &&
      mouseY >= canvasCoords.y &&
      mouseY <= canvasCoords.y + canvasCoords.height;

    // If outside crop area, let the event bubble to ImageEditor for viewport zoom
    if (!isInsideCropArea) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Calculate zoom delta
    const delta = -event.deltaY * 0.001;
    const zoomFactor = 1 + delta;

    // Calculate new dimensions while maintaining aspect ratio
    const currentAspectRatio = cropArea.width / cropArea.height;
    const centerX = cropArea.x + cropArea.width / 2;
    const centerY = cropArea.y + cropArea.height / 2;

    let newWidth = cropArea.width * zoomFactor;
    let newHeight = cropArea.height * zoomFactor;

    // Limit minimum size
    const minSize = 50;
    if (newWidth < minSize || newHeight < minSize) {
      return;
    }

    // Limit to image bounds
    if (newWidth > image.width) {
      newWidth = image.width;
      newHeight = newWidth / currentAspectRatio;
    }
    if (newHeight > image.height) {
      newHeight = image.height;
      newWidth = newHeight * currentAspectRatio;
    }

    // Calculate new position to keep center in the same place
    let newX = centerX - newWidth / 2;
    let newY = centerY - newHeight / 2;

    // Ensure crop area stays within image bounds
    newX = Math.max(0, Math.min(image.width - newWidth, newX));
    newY = Math.max(0, Math.min(image.height - newHeight, newY));

    cropArea = {
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight
    };

    // Check if crop area fits in canvas, if not, zoom out the viewport
    if (onViewportChange) {
      const totalScale = viewport.scale * viewport.zoom;
      const cropWidthOnCanvas = newWidth * totalScale;
      const cropHeightOnCanvas = newHeight * totalScale;

      // Use 90% of canvas size to add some padding
      const targetWidth = canvas.width * 0.9;
      const targetHeight = canvas.height * 0.9;

      // If crop area is larger than canvas, calculate required zoom
      if (cropWidthOnCanvas > targetWidth || cropHeightOnCanvas > targetHeight) {
        const requiredZoomWidth = targetWidth / (newWidth * viewport.scale);
        const requiredZoomHeight = targetHeight / (newHeight * viewport.scale);
        const requiredZoom = Math.min(requiredZoomWidth, requiredZoomHeight);

        // Only zoom out, never zoom in automatically
        if (requiredZoom < viewport.zoom) {
          onViewportChange({ zoom: requiredZoom });
        }
      }
    }
  }

  function handleTouchStart(event: TouchEvent) {
    if (!canvas || !canvasCoords || event.touches.length !== 2) return;

    const rect = canvas.getBoundingClientRect();
    const touch1 = event.touches[0];
    const touch2 = event.touches[1];

    const touch1X = touch1.clientX - rect.left;
    const touch1Y = touch1.clientY - rect.top;
    const touch2X = touch2.clientX - rect.left;
    const touch2Y = touch2.clientY - rect.top;

    // Check if both touches are inside crop area
    const touch1Inside =
      touch1X >= canvasCoords.x &&
      touch1X <= canvasCoords.x + canvasCoords.width &&
      touch1Y >= canvasCoords.y &&
      touch1Y <= canvasCoords.y + canvasCoords.height;

    const touch2Inside =
      touch2X >= canvasCoords.x &&
      touch2X <= canvasCoords.x + canvasCoords.width &&
      touch2Y >= canvasCoords.y &&
      touch2Y <= canvasCoords.y + canvasCoords.height;

    // If both touches are outside crop area, let event bubble for viewport zoom
    if (!touch1Inside && !touch2Inside) {
      return;
    }

    event.preventDefault();

    const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
    initialPinchDistance = distance;
    initialCropSize = { width: cropArea.width, height: cropArea.height };
  }

  function handleTouchMove(event: TouchEvent) {
    if (!image || !canvas || !canvasCoords || event.touches.length !== 2) return;
    if (initialPinchDistance === 0 || !initialCropSize) return;

    const rect = canvas.getBoundingClientRect();
    const touch1 = event.touches[0];
    const touch2 = event.touches[1];

    const touch1X = touch1.clientX - rect.left;
    const touch1Y = touch1.clientY - rect.top;
    const touch2X = touch2.clientX - rect.left;
    const touch2Y = touch2.clientY - rect.top;

    // Check if both touches are inside crop area
    const touch1Inside =
      touch1X >= canvasCoords.x &&
      touch1X <= canvasCoords.x + canvasCoords.width &&
      touch1Y >= canvasCoords.y &&
      touch1Y <= canvasCoords.y + canvasCoords.height;

    const touch2Inside =
      touch2X >= canvasCoords.x &&
      touch2X <= canvasCoords.x + canvasCoords.width &&
      touch2Y >= canvasCoords.y &&
      touch2Y <= canvasCoords.y + canvasCoords.height;

    // If both touches are outside crop area, let event bubble
    if (!touch1Inside && !touch2Inside) {
      handleTouchEnd();
      return;
    }

    event.preventDefault();

    const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
    const scale = distance / initialPinchDistance;

    const currentAspectRatio = cropArea.width / cropArea.height;
    const centerX = cropArea.x + cropArea.width / 2;
    const centerY = cropArea.y + cropArea.height / 2;

    let newWidth = initialCropSize.width * scale;
    let newHeight = initialCropSize.height * scale;

    // Limit minimum size
    const minSize = 50;
    if (newWidth < minSize || newHeight < minSize) {
      return;
    }

    // Limit to image bounds
    if (newWidth > image.width) {
      newWidth = image.width;
      newHeight = newWidth / currentAspectRatio;
    }
    if (newHeight > image.height) {
      newHeight = image.height;
      newWidth = newHeight * currentAspectRatio;
    }

    // Calculate new position to keep center in the same place
    let newX = centerX - newWidth / 2;
    let newY = centerY - newHeight / 2;

    // Ensure crop area stays within image bounds
    newX = Math.max(0, Math.min(image.width - newWidth, newX));
    newY = Math.max(0, Math.min(image.height - newHeight, newY));

    cropArea = {
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight
    };

    // Check if crop area fits in canvas, adjust viewport if needed
    if (onViewportChange) {
      const totalScale = viewport.scale * viewport.zoom;
      const cropWidthOnCanvas = newWidth * totalScale;
      const cropHeightOnCanvas = newHeight * totalScale;

      const targetWidth = canvas.width * 0.9;
      const targetHeight = canvas.height * 0.9;

      if (cropWidthOnCanvas > targetWidth || cropHeightOnCanvas > targetHeight) {
        const requiredZoomWidth = targetWidth / (newWidth * viewport.scale);
        const requiredZoomHeight = targetHeight / (newHeight * viewport.scale);
        const requiredZoom = Math.min(requiredZoomWidth, requiredZoomHeight);

        if (requiredZoom < viewport.zoom) {
          onViewportChange({ zoom: requiredZoom });
        }
      }
    }
  }

  function handleTouchEnd() {
    initialPinchDistance = 0;
    initialCropSize = null;
  }

  function rotateLeft() {
    if (!onTransformChange) return;
    const newRotation = (transform.rotation - 90 + 360) % 360;
    onTransformChange({ rotation: newRotation });
  }

  function rotateRight() {
    if (!onTransformChange) return;
    const newRotation = (transform.rotation + 90) % 360;
    onTransformChange({ rotation: newRotation });
  }

  function toggleFlipHorizontal() {
    if (!onTransformChange) return;
    onTransformChange({ flipHorizontal: !transform.flipHorizontal });
  }

  function toggleFlipVertical() {
    if (!onTransformChange) return;
    onTransformChange({ flipVertical: !transform.flipVertical });
  }
</script>

<svelte:window
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
/>

{#if canvasCoords && canvas}
  <div
    class="crop-container"
    class:panning={isPanning}
    onwheel={handleWheel}
    onmousedown={handleContainerMouseDown}
    ontouchstart={handleTouchStart}
    ontouchmove={handleTouchMove}
    ontouchend={handleTouchEnd}
  >
  <svg
    class="crop-overlay"
    style="
      position: absolute;
      left: 0;
      top: 0;
      width: {canvas.width}px;
      height: {canvas.height}px;
      pointer-events: none;
    "
  >
    <!-- Dark overlay outside crop area -->
    <defs>
      <mask id="crop-mask">
        <rect width="100%" height="100%" fill="white" />
        <rect
          x={canvasCoords.x}
          y={canvasCoords.y}
          width={canvasCoords.width}
          height={canvasCoords.height}
          fill="black"
        />
      </mask>
    </defs>
    <rect
      width="100%"
      height="100%"
      fill="rgba(0, 0, 0, 0.5)"
      mask="url(#crop-mask)"
      style="pointer-events: none;"
    />

    <!-- Crop area border with dashed line -->
    <rect
      x={canvasCoords.x}
      y={canvasCoords.y}
      width={canvasCoords.width}
      height={canvasCoords.height}
      fill="none"
      stroke="var(--primary-color, #63b97b)"
      stroke-width="2"
      stroke-dasharray="5,5"
      style="pointer-events: all; cursor: move;"
      onmousedown={(e) => handleMouseDown(e)}
      ontouchstart={(e) => handleMouseDown(e)}
    />

    <!-- Grid lines (rule of thirds) -->
    <line
      x1={canvasCoords.x + canvasCoords.width / 3}
      y1={canvasCoords.y}
      x2={canvasCoords.x + canvasCoords.width / 3}
      y2={canvasCoords.y + canvasCoords.height}
      stroke="rgba(255, 255, 255, 0.3)"
      stroke-width="1"
      style="pointer-events: none;"
    />
    <line
      x1={canvasCoords.x + (canvasCoords.width * 2) / 3}
      y1={canvasCoords.y}
      x2={canvasCoords.x + (canvasCoords.width * 2) / 3}
      y2={canvasCoords.y + canvasCoords.height}
      stroke="rgba(255, 255, 255, 0.3)"
      stroke-width="1"
      style="pointer-events: none;"
    />
    <line
      x1={canvasCoords.x}
      y1={canvasCoords.y + canvasCoords.height / 3}
      x2={canvasCoords.x + canvasCoords.width}
      y2={canvasCoords.y + canvasCoords.height / 3}
      stroke="rgba(255, 255, 255, 0.3)"
      stroke-width="1"
      style="pointer-events: none;"
    />
    <line
      x1={canvasCoords.x}
      y1={canvasCoords.y + (canvasCoords.height * 2) / 3}
      x2={canvasCoords.x + canvasCoords.width}
      y2={canvasCoords.y + (canvasCoords.height * 2) / 3}
      stroke="rgba(255, 255, 255, 0.3)"
      stroke-width="1"
      style="pointer-events: none;"
    />

    <!-- Resize handles -->
    <!-- Corners -->
    <circle
      cx={canvasCoords.x}
      cy={canvasCoords.y}
      r="6"
      fill="var(--primary-color, #63b97b)"
      stroke="white"
      stroke-width="2"
      style="pointer-events: all; cursor: nw-resize;"
      onmousedown={(e) => handleMouseDown(e, 'nw')}
      ontouchstart={(e) => handleMouseDown(e, 'nw')}
    />
    <circle
      cx={canvasCoords.x + canvasCoords.width}
      cy={canvasCoords.y}
      r="6"
      fill="var(--primary-color, #63b97b)"
      stroke="white"
      stroke-width="2"
      style="pointer-events: all; cursor: ne-resize;"
      onmousedown={(e) => handleMouseDown(e, 'ne')}
      ontouchstart={(e) => handleMouseDown(e, 'ne')}
    />
    <circle
      cx={canvasCoords.x}
      cy={canvasCoords.y + canvasCoords.height}
      r="6"
      fill="var(--primary-color, #63b97b)"
      stroke="white"
      stroke-width="2"
      style="pointer-events: all; cursor: sw-resize;"
      onmousedown={(e) => handleMouseDown(e, 'sw')}
      ontouchstart={(e) => handleMouseDown(e, 'sw')}
    />
    <circle
      cx={canvasCoords.x + canvasCoords.width}
      cy={canvasCoords.y + canvasCoords.height}
      r="6"
      fill="var(--primary-color, #63b97b)"
      stroke="white"
      stroke-width="2"
      style="pointer-events: all; cursor: se-resize;"
      onmousedown={(e) => handleMouseDown(e, 'se')}
      ontouchstart={(e) => handleMouseDown(e, 'se')}
    />

    <!-- Edges -->
    <circle
      cx={canvasCoords.x + canvasCoords.width / 2}
      cy={canvasCoords.y}
      r="6"
      fill="var(--primary-color, #63b97b)"
      stroke="white"
      stroke-width="2"
      style="pointer-events: all; cursor: n-resize;"
      onmousedown={(e) => handleMouseDown(e, 'n')}
      ontouchstart={(e) => handleMouseDown(e, 'n')}
    />
    <circle
      cx={canvasCoords.x + canvasCoords.width}
      cy={canvasCoords.y + canvasCoords.height / 2}
      r="6"
      fill="var(--primary-color, #63b97b)"
      stroke="white"
      stroke-width="2"
      style="pointer-events: all; cursor: e-resize;"
      onmousedown={(e) => handleMouseDown(e, 'e')}
      ontouchstart={(e) => handleMouseDown(e, 'e')}
    />
    <circle
      cx={canvasCoords.x + canvasCoords.width / 2}
      cy={canvasCoords.y + canvasCoords.height}
      r="6"
      fill="var(--primary-color, #63b97b)"
      stroke="white"
      stroke-width="2"
      style="pointer-events: all; cursor: s-resize;"
      onmousedown={(e) => handleMouseDown(e, 's')}
      ontouchstart={(e) => handleMouseDown(e, 's')}
    />
    <circle
      cx={canvasCoords.x}
      cy={canvasCoords.y + canvasCoords.height / 2}
      r="6"
      fill="var(--primary-color, #63b97b)"
      stroke="white"
      stroke-width="2"
      style="pointer-events: all; cursor: w-resize;"
      onmousedown={(e) => handleMouseDown(e, 'w')}
      ontouchstart={(e) => handleMouseDown(e, 'w')}
    />
  </svg>

  <!-- Aspect ratio and transform controls -->
  <div class="crop-top-controls">
    <div class="transform-controls">
      <div class="control-group">
        <div class="control-label">{$_('editor.rotate')}</div>
        <div class="button-group">
          <button class="transform-btn" onclick={rotateLeft} title={$_('editor.rotateLeft')}>
            <RotateCcw size={18} />
          </button>
          <button class="transform-btn" onclick={rotateRight} title={$_('editor.rotateRight')}>
            <RotateCw size={18} />
          </button>
        </div>
      </div>

      <div class="control-group">
        <div class="control-label">{$_('editor.flip')}</div>
        <div class="button-group">
          <button
            class="transform-btn"
            class:active={transform.flipHorizontal}
            onclick={toggleFlipHorizontal}
            title={$_('editor.flipHorizontal')}
          >
            <FlipHorizontal size={18} />
          </button>
          <button
            class="transform-btn"
            class:active={transform.flipVertical}
            onclick={toggleFlipVertical}
            title={$_('editor.flipVertical')}
          >
            <FlipVertical size={18} />
          </button>
        </div>
      </div>
    </div>

    <div class="aspect-ratio-controls">
      <button class="aspect-btn" onclick={() => setAspectRatio(16/9)}>
        16:9
      </button>
      <button class="aspect-btn" onclick={() => setAspectRatio(3/2)}>
        3:2
      </button>
      <button class="aspect-btn" onclick={() => setAspectRatio(1/1)}>
        1:1
      </button>
    </div>
  </div>

  <!-- Control buttons -->
  <div class="crop-controls">
    <button class="btn btn-primary" onclick={apply}>
      {$_('editor.apply')}
    </button>
    <button class="btn btn-secondary" onclick={onCancel}>
      {$_('editor.cancel')}
    </button>
  </div>
  </div>
{/if}

<style lang="postcss">
  .crop-container {
    position: absolute;
    inset: 0;
    z-index: 10;
    cursor: grab;
  }

  .crop-container.panning {
    cursor: grabbing;
  }

  .crop-overlay {
    pointer-events: none;
    z-index: 10;
  }

  .crop-top-controls {
    position: absolute;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    flex-direction: column;
    gap: 0.75rem;
    z-index: 20;

    @media (max-width: 767px) {
      top: 0.5rem;
      gap: 0.5rem;
      max-width: 90vw;
    }
  }

  .aspect-ratio-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: rgba(0, 0, 0, 0.8);
    border-radius: 4px;
    width: fit-content;

    @media (max-width: 767px) {
      padding: 0.4rem 0.6rem;
      gap: 0.3rem;
    }
  }

  .transform-controls {
    display: flex;
    gap: 1rem;
    padding: 0.5rem 1rem;
    background: rgba(0, 0, 0, 0.8);
    border-radius: 4px;

    @media (max-width: 767px) {
      gap: 0.5rem;
      padding: 0.4rem 0.6rem;
    }
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .control-label {
    font-size: 0.85rem;
    color: #ccc;
    margin-right: 0.25rem;

    @media (max-width: 767px) {
      font-size: 0.7rem;
      display: none;
    }
  }

  .button-group {
    display: flex;
    gap: 0.25rem;

    @media (max-width: 767px) {
      gap: 0.2rem;
    }
  }

  .aspect-btn {
    padding: 0.4rem 0.8rem;
    background: #333;
    color: #fff;
    border: 1px solid #555;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s;

    @media (max-width: 767px) {
      padding: 0.3rem 0.6rem;
      font-size: 0.75rem;
    }
  }

  .aspect-btn:hover {
    background: var(--primary-color, #63b97b);
    border-color: var(--primary-color, #63b97b);
  }

  .transform-btn {
    padding: 0.4rem 0.6rem;
    background: #333;
    color: #fff;
    border: 1px solid #555;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;

    @media (max-width: 767px) {
      padding: 0.3rem 0.5rem;
    }
  }

  .transform-btn:hover {
    background: #444;
    border-color: #666;
  }

  .transform-btn.active {
    background: var(--primary-color, #63b97b);
    border-color: var(--primary-color, #63b97b);
  }

  .crop-controls {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.5rem;
    z-index: 20;

    @media (max-width: 767px) {
      bottom: 0.5rem;
      left: 1rem;
      right: 1rem;
      transform: none;
      width: calc(100% - 2rem);
      justify-content: stretch;
    }
  }

  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;

    @media (max-width: 767px) {
      flex: 1;
      padding: 0.75rem 1rem;
      font-size: 1rem;
    }
  }

  .btn-primary {
    background: var(--primary-color, #63b97b);
    color: #fff;
  }

  .btn-primary:hover {
    background: var(--primary-color, #63b97b);
  }

  .btn-secondary {
    background: #666;
    color: #fff;
  }

  .btn-secondary:hover {
    background: #777;
  }
</style>
