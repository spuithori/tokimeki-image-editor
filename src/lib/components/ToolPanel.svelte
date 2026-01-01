<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { X } from 'lucide-svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    onClose: () => void;
    children: Snippet;
    actions?: Snippet;
  }

  let { title, onClose, children, actions }: Props = $props();

  // Bottom sheet state (mobile) - using transform for GPU acceleration
  const SHEET_MAX_HEIGHT = 400;
  const SHEET_MIN_VISIBLE = 60;
  let sheetOffset = $state(SHEET_MAX_HEIGHT - 180); // How much to hide (0 = fully shown)
  let isSheetDragging = $state(false);
  let sheetDragStart = $state<{ y: number; offset: number } | null>(null);
  let panelElement = $state<HTMLDivElement | null>(null);

  function getEventCoords(event: MouseEvent | TouchEvent): { clientY: number } {
    if ('touches' in event && event.touches.length > 0) {
      return { clientY: event.touches[0].clientY };
    } else if ('clientY' in event) {
      return { clientY: event.clientY };
    }
    return { clientY: 0 };
  }

  function handleSheetDragStart(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    event.stopPropagation();
    const coords = getEventCoords(event);
    isSheetDragging = true;
    sheetDragStart = { y: coords.clientY, offset: sheetOffset };
  }

  function handleSheetDragMove(event: MouseEvent | TouchEvent) {
    if (!isSheetDragging || !sheetDragStart) return;
    event.preventDefault();
    const coords = getEventCoords(event);
    const deltaY = coords.clientY - sheetDragStart.y;
    // Clamp offset: 0 (fully visible) to (SHEET_MAX_HEIGHT - SHEET_MIN_VISIBLE)
    const maxOffset = SHEET_MAX_HEIGHT - SHEET_MIN_VISIBLE;
    const newOffset = Math.max(0, Math.min(maxOffset, sheetDragStart.offset + deltaY));
    sheetOffset = newOffset;
  }

  function handleSheetDragEnd() {
    isSheetDragging = false;
    sheetDragStart = null;
  }
</script>

<svelte:window
  onmousemove={handleSheetDragMove}
  onmouseup={handleSheetDragEnd}
  ontouchmove={handleSheetDragMove}
  ontouchend={handleSheetDragEnd}
/>

<div
  bind:this={panelElement}
  class="tool-panel"
  style="--sheet-offset: {sheetOffset}px; --sheet-max-height: {SHEET_MAX_HEIGHT}px; --sheet-visible-height: {SHEET_MAX_HEIGHT - sheetOffset}px"
>
  <!-- Drag handle for mobile bottom sheet -->
  <div
    class="sheet-drag-handle"
    onmousedown={handleSheetDragStart}
    ontouchstart={handleSheetDragStart}
    role="slider"
    aria-label="Resize panel"
    tabindex="-1"
  >
    <div class="drag-indicator"></div>
  </div>

  <div class="panel-header">
    <h3>{title}</h3>
    <button class="close-btn" onclick={onClose} title={$_('editor.close')}>
      <X size={20} />
    </button>
  </div>

  <div class="panel-content">
    {@render children()}
  </div>

  {#if actions}
    <div class="panel-actions">
      {@render actions()}
    </div>
  {/if}
</div>

<style lang="postcss">
  .tool-panel {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: min-content;
    min-width: 250px;
    max-height: calc(100% - 2rem);
    overflow-y: auto;
    background: rgba(30, 30, 30, 0.95);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 1rem;
    backdrop-filter: blur(10px);
    z-index: 100;
    scrollbar-width: thin;

    @media (max-width: 767px) {
      position: fixed;
      left: 0;
      right: 0;
      top: auto;
      bottom: 0;
      width: auto;
      min-width: auto;
      height: var(--sheet-max-height, 400px);
      border-radius: 16px 16px 0 0;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding-top: 0;
      padding-bottom: 1.5rem;
      transform: translateY(var(--sheet-offset, 0px));
      will-change: transform;
      backdrop-filter: none;
    }
  }

  .sheet-drag-handle {
    display: none;

    @media (max-width: 767px) {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 12px 0 8px;
      cursor: grab;
      touch-action: pan-x;
      user-select: none;
      -webkit-user-select: none;
      flex-shrink: 0;

      &:active {
        cursor: grabbing;
      }
    }
  }

  .drag-indicator {
    width: 40px;
    height: 4px;
    background: #666;
    border-radius: 2px;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;

    @media (max-width: 767px) {
      margin-bottom: 0.5rem;
      flex-shrink: 0;
    }
  }

  .panel-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: #fff;

    @media (max-width: 767px) {
      font-size: 0.95rem;
    }
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

    @media (max-width: 767px) {
      gap: 0.75rem;
      flex: 1;
      overflow-y: auto;
      overscroll-behavior: contain;
      min-height: 0;
      /* Calculate max height: visible area - header (~40px) - padding - actions (~50px) - drag handle (~32px) */
      max-height: calc(var(--sheet-visible-height, 400px) - 130px);
    }
  }

  .panel-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;

    @media (max-width: 767px) {
      margin-top: 0.5rem;
      flex-shrink: 0;
    }
  }
</style>
