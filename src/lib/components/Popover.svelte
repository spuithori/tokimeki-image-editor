<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    /** Anchor side relative to the trigger element. The popover floats outward from this side. */
    side?: 'left' | 'right' | 'top' | 'bottom';
    /** Anchor element to position against */
    anchor: HTMLElement | null;
    children: Snippet;
  }

  let { open, onClose, side = 'left', anchor, children }: Props = $props();

  let popoverEl = $state<HTMLDivElement | null>(null);
  let top = $state(0);
  let left = $state(0);
  let placed = $state(false);
  let resizeObserver: ResizeObserver | null = null;

  function compute() {
    if (!open || !anchor || !popoverEl) return;

    const a = anchor.getBoundingClientRect();
    // offsetWidth/Height ignore transforms (animations) — gives the *resting* size.
    const w = popoverEl.offsetWidth;
    const h = popoverEl.offsetHeight;

    if (w === 0 || h === 0) {
      // Layout not ready yet, try again next frame
      requestAnimationFrame(compute);
      return;
    }

    const gap = 10;
    const margin = 8;
    let nextTop = 0;
    let nextLeft = 0;
    let resolvedSide = side;

    // For "left" / "right" check whether the requested side actually fits;
    // if not, flip to the opposite side automatically.
    if (side === 'left' && a.left - w - gap < margin) {
      resolvedSide = 'right';
    } else if (side === 'right' && a.right + w + gap > window.innerWidth - margin) {
      resolvedSide = 'left';
    } else if (side === 'top' && a.top - h - gap < margin) {
      resolvedSide = 'bottom';
    } else if (side === 'bottom' && a.bottom + h + gap > window.innerHeight - margin) {
      resolvedSide = 'top';
    }

    switch (resolvedSide) {
      case 'left':
        nextTop = a.top + a.height / 2 - h / 2;
        nextLeft = a.left - w - gap;
        break;
      case 'right':
        nextTop = a.top + a.height / 2 - h / 2;
        nextLeft = a.right + gap;
        break;
      case 'top':
        nextTop = a.top - h - gap;
        nextLeft = a.left + a.width / 2 - w / 2;
        break;
      case 'bottom':
        nextTop = a.bottom + gap;
        nextLeft = a.left + a.width / 2 - w / 2;
        break;
    }

    // Viewport clamp
    nextTop = Math.max(margin, Math.min(window.innerHeight - h - margin, nextTop));
    nextLeft = Math.max(margin, Math.min(window.innerWidth - w - margin, nextLeft));

    top = nextTop;
    left = nextLeft;
    placed = true;
  }

  // Re-compute whenever the popover toggles open / anchor changes / popover mounts
  $effect(() => {
    if (!open) {
      placed = false;
      resizeObserver?.disconnect();
      resizeObserver = null;
      return;
    }

    if (!anchor || !popoverEl) return;

    placed = false;

    // Wait for DOM, then double-rAF for browsers that need a paint to settle
    let cancelled = false;
    (async () => {
      await tick();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled) return;
          compute();
        });
      });
    })();

    // Track size changes of both anchor and popover so the popover keeps up
    // when the trigger or its content reflows.
    resizeObserver = new ResizeObserver(() => compute());
    resizeObserver.observe(popoverEl);
    resizeObserver.observe(anchor);

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });

  function handlePointerDownOutside(e: PointerEvent) {
    if (!open || !popoverEl) return;
    const target = e.target as Node;
    if (popoverEl.contains(target)) return;
    if (anchor && anchor.contains(target)) return;
    onClose();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      onClose();
    }
  }

  function handleScroll() {
    if (open) compute();
  }

  function handleResize() {
    if (open) compute();
  }

  onMount(() => {
    window.addEventListener('pointerdown', handlePointerDownOutside, true);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleResize);
    // Capture so we catch scrolls inside ancestors too
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDownOutside, true);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  });
</script>

{#if open}
  <div
    bind:this={popoverEl}
    class="popover side-{side}"
    class:placed
    style="top: {top}px; left: {left}px;"
    role="dialog"
  >
    <div class="popover-inner">
      {@render children()}
    </div>
  </div>
{/if}

<style lang="postcss">
  .popover {
    position: fixed;
    z-index: var(--tk-z-toast);
    pointer-events: auto;
    /* While we measure & place, keep the popover invisible to prevent flicker */
    opacity: 0;
    transition: opacity var(--tk-dur-quick) var(--tk-ease-out);
  }

  .popover.placed {
    opacity: 1;
  }

  .popover-inner {
    background: var(--tk-bg-glass-strong);
    backdrop-filter: var(--tk-blur-md);
    -webkit-backdrop-filter: var(--tk-blur-md);
    border: 1px solid var(--tk-border-default);
    border-radius: var(--tk-radius-xl);
    box-shadow: var(--tk-shadow-glass);
    padding: var(--tk-space-3);
    color: var(--tk-text-primary);
    min-width: 180px;
    max-width: 280px;
    /* Animate the inner element only — outer .popover keeps a stable bounding box
       so position measurements are not corrupted by the in-flight transform. */
    transform-origin: center;
    animation: pop-in var(--tk-dur-medium) var(--tk-ease-spring);
  }

  .popover.side-left .popover-inner {
    transform-origin: right center;
  }
  .popover.side-right .popover-inner {
    transform-origin: left center;
  }
  .popover.side-top .popover-inner {
    transform-origin: center bottom;
  }
  .popover.side-bottom .popover-inner {
    transform-origin: center top;
  }

  @keyframes pop-in {
    0% {
      opacity: 0;
      transform: scale(0.94);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
