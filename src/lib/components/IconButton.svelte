<script lang="ts">
  import type { Snippet } from 'svelte';
  import { haptic, type HapticKind } from '../utils/haptics';

  interface Props {
    label: string;
    onclick?: (event: MouseEvent) => void;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'ghost' | 'solid' | 'soft' | 'danger' | 'accent';
    pressed?: boolean;
    disabled?: boolean;
    title?: string;
    haptics?: HapticKind | false;
    type?: 'button' | 'submit';
    children: Snippet;
  }

  let {
    label,
    onclick,
    size = 'md',
    variant = 'ghost',
    pressed = false,
    disabled = false,
    title,
    haptics = 'selection',
    type = 'button',
    children
  }: Props = $props();

  function handleClick(event: MouseEvent) {
    if (disabled) return;
    if (haptics) haptic(haptics);
    onclick?.(event);
  }
</script>

<button
  {type}
  class="icon-btn size-{size} variant-{variant}"
  class:pressed
  aria-label={label}
  aria-pressed={variant === 'ghost' || variant === 'soft' ? pressed : undefined}
  title={title ?? label}
  {disabled}
  onclick={handleClick}
>
  {@render children()}
</button>

<style lang="postcss">
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--tk-radius-md);
    background: transparent;
    color: var(--tk-text-secondary);
    cursor: pointer;
    appearance: none;
    padding: 0;
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring),
      box-shadow var(--tk-dur-quick) var(--tk-ease-out);
    -webkit-tap-highlight-color: transparent;
    flex-shrink: 0;
  }

  .icon-btn.size-sm {
    width: var(--tk-control-sm);
    height: var(--tk-control-sm);
    border-radius: var(--tk-radius-sm);
  }
  .icon-btn.size-md {
    width: var(--tk-touch-min);
    height: var(--tk-touch-min);
  }
  .icon-btn.size-lg {
    width: var(--tk-touch-default);
    height: var(--tk-touch-default);
    border-radius: var(--tk-radius-lg);
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--tk-surface-hover);
    color: var(--tk-text-primary);
  }
  .icon-btn:active:not(:disabled) {
    transform: scale(0.94);
    background: var(--tk-surface-active);
  }

  .variant-ghost.pressed {
    background: var(--tk-accent-soft);
    color: var(--tk-accent-hover);
  }

  .variant-solid {
    background: var(--tk-surface-2);
    color: var(--tk-text-primary);
  }
  .variant-solid:hover:not(:disabled) {
    background: var(--tk-surface-hover);
  }

  .variant-soft {
    background: var(--tk-surface-1);
    color: var(--tk-text-secondary);
  }
  .variant-soft.pressed {
    background: var(--tk-accent-soft);
    color: var(--tk-accent-hover);
  }

  .variant-accent {
    background: var(--tk-accent);
    color: var(--tk-text-on-accent);
  }
  .variant-accent:hover:not(:disabled) {
    background: var(--tk-accent-hover);
  }

  .variant-danger {
    background: var(--tk-danger-soft);
    color: var(--tk-danger);
  }
  .variant-danger:hover:not(:disabled) {
    background: var(--tk-danger);
    color: var(--tk-text-on-accent);
  }

  .icon-btn:disabled {
    color: var(--tk-text-disabled);
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
