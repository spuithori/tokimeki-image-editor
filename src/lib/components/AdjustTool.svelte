<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Sun from '@lucide/svelte/icons/sun';
  import Contrast from '@lucide/svelte/icons/contrast';
  import Cloud from '@lucide/svelte/icons/cloud';
  import Moon from '@lucide/svelte/icons/moon';
  import SunMedium from '@lucide/svelte/icons/sun-medium';
  import Palette from '@lucide/svelte/icons/palette';
  import Thermometer from '@lucide/svelte/icons/thermometer';
  import Aperture from '@lucide/svelte/icons/aperture';
  import Waves from '@lucide/svelte/icons/waves';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Focus from '@lucide/svelte/icons/focus';
  import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
  import Spline from '@lucide/svelte/icons/spline';
  import Droplets from '@lucide/svelte/icons/droplets';
  import type { AdjustmentsState, ToneCurve, HSLAdjustment } from '../types';
  import ToolPanel from './ToolPanel.svelte';
  import Slider from './Slider.svelte';
  import ToneCurveTool from './ToneCurveTool.svelte';
  import HSLTool from './HSLTool.svelte';
  import { haptic } from '../utils/haptics';

  interface Props {
    adjustments: AdjustmentsState;
    onChange: (adjustments: Partial<AdjustmentsState>) => void;
    onClose: () => void;
    onCurveChange: (curve: ToneCurve) => void;
    onHSLChange: (hsl: HSLAdjustment) => void;
  }

  let { adjustments, onChange, onClose, onCurveChange, onHSLChange }: Props = $props();

  type ControlGroup = 'light' | 'color' | 'effects' | 'detail' | 'curve' | 'hsl';
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
      grain: 0,
      sharpen: 0,
      denoise: 0
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

  const detailControls = [
    { key: 'sharpen', icon: Focus, bipolar: false, min: 0, max: 100 },
    { key: 'denoise', icon: AudioWaveform, bipolar: false, min: 0, max: 100 }
  ] as const;

  let currentControls = $derived(
    activeGroup === 'light'
      ? lightControls
      : activeGroup === 'color'
      ? colorControls
      : activeGroup === 'detail'
      ? detailControls
      : effectControls
  );

  // Quick visual feedback: show how many scalar adjustments are active
  let activeCount = $derived(
    Object.entries(adjustments).filter(([_, v]) => typeof v === 'number' && v !== 0).length
  );

  function setGroup(g: ControlGroup) {
    if (g === activeGroup) return;
    haptic('selection');
    activeGroup = g;
  }

  // Drag-to-scroll for group tabs
  let tabsEl = $state<HTMLDivElement | null>(null);
  let isDraggingTabs = false; // intentionally not reactive — no re-render needed
  let dragActive = false;
  let dragStartX = 0;
  let scrollStartX = 0;

  function handleTabsPointerDown(e: PointerEvent) {
    if (!tabsEl) return;
    dragActive = true;
    isDraggingTabs = false;
    dragStartX = e.clientX;
    scrollStartX = tabsEl.scrollLeft;
  }

  function handleTabsPointerMove(e: PointerEvent) {
    if (!dragActive || !tabsEl) return;
    const dx = e.clientX - dragStartX;
    if (!isDraggingTabs && Math.abs(dx) > 5) {
      isDraggingTabs = true;
    }
    if (isDraggingTabs) {
      tabsEl.scrollLeft = scrollStartX - dx;
    }
  }

  function handleTabsPointerUp() {
    if (isDraggingTabs) {
      // Reset after a microtask so the click event on the button still sees isDraggingTabs=true
      setTimeout(() => { isDraggingTabs = false; }, 0);
    }
    dragActive = false;
  }

  function guardClick(fn: () => void) {
    return () => {
      if (!isDraggingTabs) fn();
    };
  }
</script>

<div class="adjust-tool" onwheel={handleWheel}>
  <ToolPanel title={$_('editor.adjust')} {onClose}>
    {#snippet children()}
      <div
        class="group-tabs"
        role="tablist"
        bind:this={tabsEl}
        onpointerdown={handleTabsPointerDown}
        onpointermove={handleTabsPointerMove}
        onpointerup={handleTabsPointerUp}
        onpointerleave={handleTabsPointerUp}
      >
        <button
          role="tab"
          aria-selected={activeGroup === 'light'}
          class="group-tab"
          class:active={activeGroup === 'light'}
          onclick={guardClick(() => setGroup('light'))}
        >
          <Sun size={14} />
          <span>Light</span>
        </button>
        <button
          role="tab"
          aria-selected={activeGroup === 'color'}
          class="group-tab"
          class:active={activeGroup === 'color'}
          onclick={guardClick(() => setGroup('color'))}
        >
          <Palette size={14} />
          <span>Color</span>
        </button>
        <button
          role="tab"
          aria-selected={activeGroup === 'effects'}
          class="group-tab"
          class:active={activeGroup === 'effects'}
          onclick={guardClick(() => setGroup('effects'))}
        >
          <Sparkles size={14} />
          <span>Effects</span>
        </button>
        <button
          role="tab"
          aria-selected={activeGroup === 'detail'}
          class="group-tab"
          class:active={activeGroup === 'detail'}
          onclick={guardClick(() => setGroup('detail'))}
        >
          <Focus size={14} />
          <span>Detail</span>
        </button>
        <button
          role="tab"
          aria-selected={activeGroup === 'curve'}
          class="group-tab"
          class:active={activeGroup === 'curve'}
          onclick={guardClick(() => setGroup('curve'))}
        >
          <Spline size={14} />
          <span>Curve</span>
        </button>
        <button
          role="tab"
          aria-selected={activeGroup === 'hsl'}
          class="group-tab"
          class:active={activeGroup === 'hsl'}
          onclick={guardClick(() => setGroup('hsl'))}
        >
          <Droplets size={14} />
          <span>HSL</span>
        </button>
      </div>

      <div class="control-list">
        {#if activeGroup === 'curve'}
          <ToneCurveTool toneCurve={adjustments.toneCurve} onChange={onCurveChange} />
        {:else if activeGroup === 'hsl'}
          <HSLTool hsl={adjustments.hsl} onChange={onHSLChange} />
        {:else}
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
        {/if}
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
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .group-tabs::-webkit-scrollbar {
    display: none;
  }
  .group-tabs:active {
    cursor: grabbing;
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
