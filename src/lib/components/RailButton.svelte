<script lang="ts">
  import type { Snippet } from 'svelte';
  import { haptic, type HapticKind } from '../utils/haptics';

  interface Props {
    label: string;
    onclick?: (event: MouseEvent) => void;
    pressed?: boolean;
    disabled?: boolean;
    variant?: 'default' | 'accent' | 'danger';
    haptics?: HapticKind | false;
    children: Snippet;
    /** Optional indicator badge — color swatch, number etc */
    badge?: Snippet;
  }

  let {
    label,
    onclick,
    pressed = false,
    disabled = false,
    variant = 'default',
    haptics = 'selection',
    children,
    badge
  }: Props = $props();

  function handle(e: MouseEvent) {
    if (disabled) return;
    if (haptics) haptic(haptics);
    onclick?.(e);
  }
</script>

<button
  type="button"
  class="rail-btn variant-{variant}"
  class:pressed
  aria-label={label}
  aria-pressed={pressed}
  title={label}
  {disabled}
  onclick={handle}
>
  <span class="icon">
    {@render children()}
  </span>
  {#if badge}
    <span class="badge" aria-hidden="true">{@render badge()}</span>
  {/if}
</button>

<style lang="postcss">
  .rail-btn {
    appearance: none;
    position: relative;
    width: var(--tk-touch-min);
    height: var(--tk-touch-min);
    border: none;
    background: transparent;
    color: var(--tk-text-secondary);
    border-radius: var(--tk-radius-lg);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring),
      box-shadow var(--tk-dur-quick) var(--tk-ease-out);
    -webkit-tap-highlight-color: transparent;
    flex-shrink: 0;
  }

  .rail-btn:hover:not(:disabled) {
    background: var(--tk-surface-hover);
    color: var(--tk-text-primary);
  }

  .rail-btn:active:not(:disabled) {
    transform: scale(0.92);
  }

  .rail-btn.pressed {
    background: var(--tk-accent-soft);
    color: var(--tk-accent-hover);
    box-shadow: 0 0 0 1px var(--tk-accent) inset;
  }

  .rail-btn.variant-accent {
    background: var(--tk-accent);
    color: var(--tk-text-on-accent);
    box-shadow: 0 4px 14px rgba(10, 132, 255, 0.32);
  }
  .rail-btn.variant-accent:hover:not(:disabled) {
    background: var(--tk-accent-hover);
  }

  .rail-btn.variant-danger {
    color: var(--tk-danger);
  }
  .rail-btn.variant-danger:hover:not(:disabled) {
    background: var(--tk-danger-soft);
  }

  .rail-btn:disabled {
    color: var(--tk-text-disabled);
    cursor: not-allowed;
    opacity: 0.5;
  }

  .icon {
    display: grid;
    place-items: center;
  }

  .badge {
    position: absolute;
    bottom: 4px;
    right: 4px;
    pointer-events: none;
  }

  @media (max-width: 767px) {
    .rail-btn {
      width: 40px;
      height: 40px;
      border-radius: var(--tk-radius-md);
    }
  }
</style>
