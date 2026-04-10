<script lang="ts">
  import { _ } from 'svelte-i18n';
  import {
    Sun,
    Contrast,
    Cloud,
    Moon,
    SunMedium,
    Palette,
    Thermometer,
    Aperture,
    Waves,
    Sparkles
  } from 'lucide-svelte';
  import type { AdjustmentsState } from '../types';
  import ToolPanel from './ToolPanel.svelte';
  import Slider from './Slider.svelte';
  import { haptic } from '../utils/haptics';

  interface Props {
    adjustments: AdjustmentsState;
    onChange: (adjustments: Partial<AdjustmentsState>) => void;
    onClose: () => void;
  }

  let { adjustments, onChange, onClose }: Props = $props();

  type ControlGroup = 'light' | 'color' | 'effects';
  let activeGroup = $state<ControlGroup>('light');

  function handleChange(key: keyof AdjustmentsState, value: number) {
    onChange({ [key]: value });
  }

  function resetAll() {
    haptic('warning');
    onChange({
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      brightness: 0,
      saturation: 0,
      temperature: 0,
      vignette: 0,
      sepia: 0,
      grayscale: 0,
      blur: 0,
      grain: 0
    });
  }

  // Prevent wheel events from propagating to canvas zoom handler
  function handleWheel(e: WheelEvent) {
    e.stopPropagation();
  }

  const lightControls = [
    { key: 'exposure', icon: Sun, bipolar: true, min: -100, max: 100 },
    { key: 'brightness', icon: SunMedium, bipolar: true, min: -100, max: 100 },
    { key: 'contrast', icon: Contrast, bipolar: true, min: -100, max: 100 },
    { key: 'highlights', icon: Cloud, bipolar: true, min: -100, max: 100 },
    { key: 'shadows', icon: Moon, bipolar: true, min: -100, max: 100 }
  ] as const;

  const colorControls = [
    { key: 'saturation', icon: Palette, bipolar: true, min: -100, max: 100 },
    { key: 'temperature', icon: Thermometer, bipolar: true, min: -100, max: 100 }
  ] as const;

  const effectControls = [
    { key: 'vignette', icon: Aperture, bipolar: true, min: -100, max: 100 },
    { key: 'blur', icon: Waves, bipolar: false, min: 0, max: 100 },
    { key: 'grain', icon: Sparkles, bipolar: false, min: 0, max: 100 }
  ] as const;

  let currentControls = $derived(
    activeGroup === 'light'
      ? lightControls
      : activeGroup === 'color'
      ? colorControls
      : effectControls
  );

  // Quick visual feedback: show how many adjustments are active
  let activeCount = $derived(
    Object.values(adjustments).filter((v) => v !== 0).length
  );

  function setGroup(g: ControlGroup) {
    if (g === activeGroup) return;
    haptic('selection');
    activeGroup = g;
  }
</script>

<div class="adjust-tool" onwheel={handleWheel}>
  <ToolPanel title={$_('editor.adjust')} {onClose}>
    {#snippet children()}
      <div class="group-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeGroup === 'light'}
          class="group-tab"
          class:active={activeGroup === 'light'}
          onclick={() => setGroup('light')}
        >
          <Sun size={14} />
          <span>Light</span>
        </button>
        <button
          role="tab"
          aria-selected={activeGroup === 'color'}
          class="group-tab"
          class:active={activeGroup === 'color'}
          onclick={() => setGroup('color')}
        >
          <Palette size={14} />
          <span>Color</span>
        </button>
        <button
          role="tab"
          aria-selected={activeGroup === 'effects'}
          class="group-tab"
          class:active={activeGroup === 'effects'}
          onclick={() => setGroup('effects')}
        >
          <Sparkles size={14} />
          <span>Effects</span>
        </button>
      </div>

      <div class="control-list">
        {#each currentControls as control (control.key)}
          {@const Icon = control.icon}
          <div class="control-row">
            <div class="control-icon">
              <Icon size={16} strokeWidth={1.8} />
            </div>
            <div class="control-slider">
              <Slider
                label={$_(`adjustments.${control.key}`)}
                value={adjustments[control.key as keyof AdjustmentsState]}
                min={control.min}
                max={control.max}
                bipolar={control.bipolar}
                onInput={(v) => handleChange(control.key as keyof AdjustmentsState, v)}
              />
            </div>
          </div>
        {/each}
      </div>
    {/snippet}

    {#snippet actions()}
      <div class="footer-row">
        <span class="active-count">
          {#if activeCount > 0}
            <span class="dot"></span>
            {activeCount} {activeCount === 1 ? 'edit' : 'edits'}
          {/if}
        </span>
        <button class="reset-btn" onclick={resetAll} disabled={activeCount === 0}>
          {$_('editor.reset')}
        </button>
      </div>
    {/snippet}
  </ToolPanel>
</div>

<style lang="postcss">
  .adjust-tool {
    /* Sheet handles the panel chrome — keep this wrapper transparent */
  }

  .group-tabs {
    display: flex;
    gap: var(--tk-space-1);
    padding: var(--tk-space-1);
    background: var(--tk-surface-1);
    border-radius: var(--tk-radius-lg);
    margin-bottom: var(--tk-space-3);
  }

  .group-tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--tk-space-1);
    height: 34px;
    padding: 0 var(--tk-space-3);
    border: none;
    background: transparent;
    color: var(--tk-text-tertiary);
    border-radius: var(--tk-radius-md);
    font-size: var(--tk-text-xs);
    font-weight: var(--tk-weight-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tk-tracking-wide);
    cursor: pointer;
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out);
    -webkit-tap-highlight-color: transparent;
  }

  .group-tab:hover {
    color: var(--tk-text-secondary);
  }

  .group-tab.active {
    background: var(--tk-bg-elevated);
    color: var(--tk-text-primary);
    box-shadow: var(--tk-shadow-xs);
  }

  .control-list {
    display: flex;
    flex-direction: column;
    gap: var(--tk-space-3);
  }

  .control-row {
    display: grid;
    grid-template-columns: 32px 1fr;
    gap: var(--tk-space-3);
    align-items: center;
  }

  .control-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--tk-radius-md);
    background: var(--tk-surface-1);
    display: grid;
    place-items: center;
    color: var(--tk-text-secondary);
  }

  .footer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--tk-space-3);
    width: 100%;
  }

  .active-count {
    display: inline-flex;
    align-items: center;
    gap: var(--tk-space-2);
    font-size: var(--tk-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tk-tracking-wide);
    color: var(--tk-text-tertiary);
    font-weight: var(--tk-weight-semibold);
  }
  .dot {
    width: 6px;
    height: 6px;
    background: var(--tk-accent);
    border-radius: var(--tk-radius-full);
    box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.18);
  }

  .reset-btn {
    appearance: none;
    border: 1px solid var(--tk-border-default);
    background: var(--tk-surface-1);
    color: var(--tk-text-secondary);
    padding: 0 var(--tk-space-4);
    height: 36px;
    border-radius: var(--tk-radius-full);
    cursor: pointer;
    font-size: var(--tk-text-sm);
    font-weight: var(--tk-weight-semibold);
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring);
  }
  .reset-btn:hover:not(:disabled) {
    background: var(--tk-surface-2);
    color: var(--tk-text-primary);
  }
  .reset-btn:active:not(:disabled) {
    transform: scale(0.96);
  }
  .reset-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
