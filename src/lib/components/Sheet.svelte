<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { X } from 'lucide-svelte';
  import type { Snippet } from 'svelte';
  import IconButton from './IconButton.svelte';
  import { haptic } from '../utils/haptics';

  interface Props {
    title: string;
    onClose: () => void;
    children: Snippet;
    actions?: Snippet;
    /** Allow user to drag the sheet down to a smaller "peek" size on mobile */
    collapsible?: boolean;
    /** Hide the title row entirely (compact tools) */
    minimal?: boolean;
  }

  let { title, onClose, children, actions, collapsible = true, minimal = false }: Props = $props();

  // Sheet drag state — only used on mobile bottom sheet layout.
  let sheetEl = $state<HTMLDivElement | null>(null);
  let dragging = $state(false);
  let dragStartY = $state(0);
  let startOffset = $state(0);
  let offset = $state(0); // px from natural position; positive = pushed down
  let dismissing = $state(false);

  const PEEK_OFFSET = 220; // collapsed offset on mobile
  const DISMISS_THRESHOLD = 140;
  const VELOCITY_DISMISS = 0.6;
  let lastMoveTime = 0;
  let lastMoveY = 0;
  let velocity = 0;

  function startDrag(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    dragStartY = e.clientY;
    startOffset = offset;
    lastMoveTime = performance.now();
    lastMoveY = e.clientY;
    velocity = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    haptic('swipeStart');
  }

  function moveDrag(e: PointerEvent) {
    if (!dragging) return;
    const dy = e.clientY - dragStartY;
    const next = Math.max(-40, startOffset + dy);
    // Rubber band when pulling up beyond natural
    offset = next < 0 ? next * 0.35 : next;

    const now = performance.now();
    const dt = now - lastMoveTime;
    if (dt > 0) {
      velocity = (e.clientY - lastMoveY) / dt;
    }
    lastMoveTime = now;
    lastMoveY = e.clientY;
  }

  function endDrag(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    // Decide snap target.
    if (offset > DISMISS_THRESHOLD || velocity > VELOCITY_DISMISS) {
      dismiss();
      return;
    }
    if (collapsible && (offset > 70 || velocity > 0.25)) {
      offset = PEEK_OFFSET;
      haptic('swipeEnd');
      return;
    }
    offset = 0;
    haptic('swipeEnd');
  }

  function dismiss() {
    dismissing = true;
    haptic('light');
    setTimeout(() => onClose(), 220);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div
  bind:this={sheetEl}
  class="sheet"
  class:dragging
  class:dismissing
  class:minimal
  style="--sheet-offset: {offset}px"
  role="dialog"
  aria-label={title}
>
  {#if collapsible}
    <div
      class="grabber"
      onpointerdown={startDrag}
      onpointermove={moveDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      role="presentation"
    >
      <span class="grabber-bar"></span>
    </div>
  {/if}

  {#if !minimal}
    <header class="sheet-head">
      <h3>{title}</h3>
      <IconButton label={$_('editor.close')} size="sm" variant="ghost" onclick={dismiss}>
        <X size={18} />
      </IconButton>
    </header>
  {:else}
    <IconButton label={$_('editor.close')} size="sm" variant="ghost" onclick={dismiss}>
      <X size={18} />
    </IconButton>
  {/if}

  <div class="sheet-body">
    {@render children()}
  </div>

  {#if actions}
    <footer class="sheet-foot">
      {@render actions()}
    </footer>
  {/if}
</div>

<style lang="postcss">
  .sheet {
    /* Desktop default — floating glass card pinned to right */
    position: absolute;
    top: var(--tk-space-4);
    right: var(--tk-space-4);
    width: clamp(280px, 30vw, 360px);
    max-height: calc(100% - var(--tk-space-8));
    display: flex;
    flex-direction: column;
    background: var(--tk-bg-glass);
    backdrop-filter: var(--tk-blur-md);
    -webkit-backdrop-filter: var(--tk-blur-md);
    border: 1px solid var(--tk-border-default);
    border-radius: var(--tk-radius-2xl);
    box-shadow: var(--tk-shadow-glass);
    z-index: var(--tk-z-sheet);
    color: var(--tk-text-primary);
    transform: translateY(0);
    opacity: 1;
    animation: sheet-in var(--tk-dur-medium) var(--tk-ease-out);
  }

  .sheet.dismissing {
    transform: translateY(20px);
    opacity: 0;
    transition:
      transform var(--tk-dur-medium) var(--tk-ease-out),
      opacity var(--tk-dur-medium) var(--tk-ease-out);
  }

  .grabber {
    display: none;
  }

  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--tk-space-4) var(--tk-space-5) var(--tk-space-2);
    flex-shrink: 0;
  }

  .sheet-head h3 {
    margin: 0;
    font-size: var(--tk-text-md);
    font-weight: var(--tk-weight-semibold);
    letter-spacing: var(--tk-tracking-tight);
    color: var(--tk-text-primary);
  }

  .sheet-body {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--tk-space-2) var(--tk-space-5) var(--tk-space-4);
    scrollbar-width: thin;
    scrollbar-color: var(--tk-surface-3) transparent;
  }

  .sheet-body::-webkit-scrollbar {
    width: 6px;
  }
  .sheet-body::-webkit-scrollbar-thumb {
    background: var(--tk-surface-3);
    border-radius: var(--tk-radius-full);
  }

  .sheet-foot {
    flex-shrink: 0;
    padding: var(--tk-space-3) var(--tk-space-5) var(--tk-space-5);
    display: flex;
    gap: var(--tk-space-2);
    justify-content: flex-end;
    border-top: 1px solid var(--tk-border-subtle);
  }

  @keyframes sheet-in {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  /* ──────────────────────────────────────────────
   *  Mobile bottom sheet
   * ────────────────────────────────────────────── */
  @media (max-width: 767px) {
    .sheet {
      position: fixed;
      top: auto;
      right: 0;
      left: 0;
      bottom: 0;
      width: auto;
      max-height: 70dvh;
      border-radius: var(--tk-radius-3xl) var(--tk-radius-3xl) 0 0;
      transform: translateY(var(--sheet-offset, 0));
      padding-bottom: max(var(--tk-space-4), env(safe-area-inset-bottom));
      transition:
        transform var(--tk-dur-long) var(--tk-ease-spring),
        opacity var(--tk-dur-medium) var(--tk-ease-out);
      animation: sheet-up var(--tk-dur-long) var(--tk-ease-spring);
      box-shadow: var(--tk-shadow-glass);
      backdrop-filter: var(--tk-blur-lg);
      -webkit-backdrop-filter: var(--tk-blur-lg);
      background: var(--tk-bg-glass-strong);
    }

    .sheet.dragging {
      transition: none;
    }

    .sheet.dismissing {
      transform: translateY(110%);
      opacity: 0;
    }

    .grabber {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--tk-space-3) 0 var(--tk-space-1);
      cursor: grab;
      touch-action: none;
      flex-shrink: 0;
    }
    .grabber:active {
      cursor: grabbing;
    }
    .grabber-bar {
      width: 36px;
      height: 4px;
      border-radius: var(--tk-radius-full);
      background: var(--tk-border-strong);
    }

    .sheet-head {
      padding: var(--tk-space-1) var(--tk-space-5) var(--tk-space-2);
    }

    .sheet-head h3 {
      font-size: var(--tk-text-md);
    }

    .sheet-body {
      padding: var(--tk-space-2) var(--tk-space-5) var(--tk-space-3);
    }

    .sheet-foot {
      padding: var(--tk-space-3) var(--tk-space-5) var(--tk-space-2);
    }
  }

  @keyframes sheet-up {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
</style>
