<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Crop, SlidersHorizontal, Sparkles, Droplet, Sticker, PenLine, Download } from 'lucide-svelte';
  import type { EditorMode } from '../types';
  import { haptic } from '../utils/haptics';

  interface Props {
    mode: EditorMode;
    hasImage: boolean;
    isStandalone?: boolean;
    onModeChange: (mode: EditorMode) => void;
  }

  let { mode, hasImage, isStandalone = false, onModeChange }: Props = $props();

  const baseTools = [
    { id: 'crop' as const, icon: Crop, labelKey: 'editor.crop', titleKey: 'toolbar.crop' },
    { id: 'adjust' as const, icon: SlidersHorizontal, labelKey: 'editor.adjust', titleKey: 'toolbar.adjust' },
    { id: 'filter' as const, icon: Sparkles, labelKey: 'editor.filter', titleKey: 'toolbar.filter' },
    { id: 'blur' as const, icon: Droplet, labelKey: 'editor.blur', titleKey: 'toolbar.blur' },
    { id: 'stamp' as const, icon: Sticker, labelKey: 'editor.stamp', titleKey: 'toolbar.stamp' },
    { id: 'annotate' as const, icon: PenLine, labelKey: 'editor.annotate', titleKey: 'toolbar.annotate' }
  ];

  let tools = $derived(
    isStandalone
      ? [
          ...baseTools,
          { id: 'export' as const, icon: Download, labelKey: 'editor.export', titleKey: 'toolbar.export' }
        ]
      : baseTools
  );

  function handleClick(toolId: EditorMode) {
    if (!hasImage) return;
    haptic(mode === toolId ? 'toggleOff' : 'toggleOn');
    // tap the same tool again to dismiss it
    onModeChange(mode === toolId ? null : toolId);
  }
</script>

<nav class="dock" aria-label="Editor tools">
  <div class="dock-rail">
    {#each tools as tool (tool.id)}
      {@const Icon = tool.icon}
      {@const isActive = mode === tool.id}
      <button
        type="button"
        class="dock-btn"
        class:active={isActive}
        disabled={!hasImage}
        title={$_(tool.titleKey)}
        aria-pressed={isActive}
        aria-label={$_(tool.titleKey)}
        onclick={() => handleClick(tool.id)}
      >
        <span class="dock-icon">
          <Icon size={20} strokeWidth={1.8} />
        </span>
        <span class="dock-label">{$_(tool.labelKey)}</span>
        <span class="dock-indicator" aria-hidden="true"></span>
      </button>
    {/each}
  </div>
</nav>

<style lang="postcss">
  .dock {
    width: 100%;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  .dock-rail {
    pointer-events: auto;
    display: flex;
    align-items: stretch;
    gap: var(--tk-space-1);
    padding: var(--tk-space-2);
    background: var(--tk-bg-glass);
    backdrop-filter: var(--tk-blur-md);
    -webkit-backdrop-filter: var(--tk-blur-md);
    border: 1px solid var(--tk-border-default);
    border-radius: var(--tk-radius-2xl);
    box-shadow: var(--tk-shadow-md);
    overflow-x: auto;
    scrollbar-width: none;
    max-width: 100%;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;
  }
  .dock-rail::-webkit-scrollbar { display: none; }

  .dock-btn {
    position: relative;
    appearance: none;
    background: transparent;
    border: none;
    color: var(--tk-text-secondary);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: var(--tk-space-2) var(--tk-space-3);
    min-width: var(--tk-touch-default);
    min-height: var(--tk-touch-default);
    border-radius: var(--tk-radius-lg);
    cursor: pointer;
    flex-shrink: 0;
    scroll-snap-align: center;
    transition:
      color var(--tk-dur-quick) var(--tk-ease-out),
      background var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-medium) var(--tk-ease-spring);
    -webkit-tap-highlight-color: transparent;
  }

  .dock-btn:hover:not(:disabled) {
    color: var(--tk-text-primary);
    background: var(--tk-surface-hover);
  }

  .dock-btn:active:not(:disabled) {
    transform: scale(0.92);
  }

  .dock-btn.active {
    color: var(--tk-accent);
  }

  .dock-btn.active .dock-icon {
    background: var(--tk-accent-soft);
    color: var(--tk-accent-hover);
  }

  .dock-btn:disabled {
    color: var(--tk-text-disabled);
    cursor: not-allowed;
  }

  .dock-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--tk-radius-md);
    display: grid;
    place-items: center;
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out);
  }

  .dock-label {
    font-size: var(--tk-text-2xs);
    font-weight: var(--tk-weight-medium);
    letter-spacing: var(--tk-tracking-wide);
    text-transform: uppercase;
    line-height: 1;
    white-space: nowrap;
  }

  .dock-indicator {
    position: absolute;
    bottom: -2px;
    left: 50%;
    width: 4px;
    height: 4px;
    border-radius: var(--tk-radius-full);
    background: var(--tk-accent);
    opacity: 0;
    transform: translateX(-50%) scale(0.6);
    transition:
      opacity var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-medium) var(--tk-ease-spring);
  }

  .dock-btn.active .dock-indicator {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }

  @media (max-width: 767px) {
    .dock {
      width: 100%;
    }
    .dock-rail {
      width: 100%;
      max-width: 100%;
      border-radius: var(--tk-radius-xl);
      justify-content: flex-start;
      padding: var(--tk-space-1) var(--tk-space-2);
    }
    .dock-btn {
      padding: var(--tk-space-2) var(--tk-space-2);
      min-width: 56px;
    }
    .dock-icon {
      width: 32px;
      height: 32px;
    }
  }
</style>
