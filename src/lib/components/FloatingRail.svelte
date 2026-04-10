<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Slot for icon buttons / sub components */
    children: Snippet;
    /** Optional cluster pinned to the top of the rail (e.g. apply / cancel) */
    top?: Snippet;
    /** Optional cluster pinned to the bottom of the rail (e.g. delete / clear) */
    bottom?: Snippet;
    /** Side to dock to */
    side?: 'left' | 'right';
  }

  let { children, top, bottom, side = 'right' }: Props = $props();
</script>

<aside class="rail" class:left={side === 'left'} class:right={side === 'right'} aria-label="Tool rail">
  {#if top}
    <div class="cluster cluster-top">
      {@render top()}
    </div>
  {/if}

  <div class="cluster cluster-main">
    {@render children()}
  </div>

  {#if bottom}
    <div class="cluster cluster-bottom">
      {@render bottom()}
    </div>
  {/if}
</aside>

<style lang="postcss">
  .rail {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: var(--tk-space-3);
    padding: var(--tk-space-2);
    background: var(--tk-bg-glass-strong);
    backdrop-filter: var(--tk-blur-md);
    -webkit-backdrop-filter: var(--tk-blur-md);
    border: 1px solid var(--tk-border-default);
    border-radius: var(--tk-radius-2xl);
    box-shadow: var(--tk-shadow-glass);
    z-index: var(--tk-z-sheet);
    pointer-events: auto;
    max-height: calc(100% - var(--tk-space-12));
    animation: rail-in var(--tk-dur-medium) var(--tk-ease-out);
  }

  .rail.right {
    right: var(--tk-space-3);
  }
  .rail.left {
    left: var(--tk-space-3);
  }

  .cluster {
    display: flex;
    flex-direction: column;
    gap: var(--tk-space-1);
    align-items: center;
  }

  .cluster-top,
  .cluster-bottom {
    flex-shrink: 0;
  }

  .cluster-main {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    min-height: 0;
    padding: 2px 0;
    gap: var(--tk-space-1);
  }
  .cluster-main::-webkit-scrollbar {
    display: none;
  }

  .cluster-top + .cluster-main {
    border-top: 1px solid var(--tk-border-subtle);
    padding-top: var(--tk-space-2);
  }
  .cluster-main:has(+ .cluster-bottom) {
    border-bottom: 1px solid var(--tk-border-subtle);
    padding-bottom: var(--tk-space-2);
  }

  @keyframes rail-in {
    from {
      transform: translate(20px, -50%);
      opacity: 0;
    }
    to {
      transform: translate(0, -50%);
      opacity: 1;
    }
  }

  /* ── Mobile: switch to horizontal bottom bar ── */
  @media (max-width: 767px) {
    .rail {
      top: auto;
      right: auto;
      left: var(--tk-space-2);
      right: var(--tk-space-2);
      bottom: max(var(--tk-space-2), env(safe-area-inset-bottom));
      transform: none;
      flex-direction: row;
      gap: 2px;
      padding: var(--tk-space-1);
      border-radius: var(--tk-radius-xl);
      max-height: none;
      animation: rail-in-mobile var(--tk-dur-medium) var(--tk-ease-out);
    }

    .cluster {
      flex-direction: row;
      align-items: center;
      gap: 2px;
    }

    .cluster-top,
    .cluster-bottom {
      flex-shrink: 0;
    }

    .cluster-main {
      flex: 1;
      min-width: 0;
      overflow-x: auto;
      overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      gap: 2px;
      padding: 0;
      /* Fade hint at edges to signal more content */
      mask-image: linear-gradient(
        to right,
        transparent 0px,
        black 8px,
        black calc(100% - 8px),
        transparent 100%
      );
      -webkit-mask-image: linear-gradient(
        to right,
        transparent 0px,
        black 8px,
        black calc(100% - 8px),
        transparent 100%
      );
    }
    .cluster-main::-webkit-scrollbar { display: none; }

    .cluster-top + .cluster-main {
      border-top: none;
      border-left: 1px solid var(--tk-border-subtle);
      padding-top: 0;
      padding-left: var(--tk-space-1);
    }
    .cluster-main:has(+ .cluster-bottom) {
      border-bottom: none;
      border-right: 1px solid var(--tk-border-subtle);
      padding-bottom: 0;
      padding-right: var(--tk-space-1);
    }
  }

  @keyframes rail-in-mobile {
    from {
      transform: translateX(-50%) translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
  }

  /* Landscape phones — keep vertical but tighter */
  @media (max-width: 900px) and (orientation: landscape) and (min-width: 768px) {
    .rail.right {
      right: max(var(--tk-space-3), env(safe-area-inset-right));
    }
  }
</style>
