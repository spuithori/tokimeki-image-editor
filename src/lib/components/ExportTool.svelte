<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Download, FileImage, ImageDown } from 'lucide-svelte';
  import type { ExportOptions } from '../types';
  import ToolPanel from './ToolPanel.svelte';
  import Slider from './Slider.svelte';
  import { haptic } from '../utils/haptics';

  interface Props {
    options: ExportOptions;
    onChange: (options: Partial<ExportOptions>) => void;
    onExport: () => void;
    onClose: () => void;
  }

  let { options, onChange, onExport, onClose }: Props = $props();

  function handleFormatChange(format: 'png' | 'jpeg') {
    haptic('selection');
    onChange({ format });
  }

  function handleQualityChange(value: number) {
    onChange({ quality: value / 100 });
  }

  function handleWheel(e: WheelEvent) {
    e.stopPropagation();
  }

  function handleExport() {
    haptic('success');
    onExport();
  }
</script>

<div class="export-tool" onwheel={handleWheel}>
  <ToolPanel title={$_('editor.export')} {onClose}>
    {#snippet children()}
      <div class="section">
        <div class="section-label">{$_('editor.format')}</div>
        <div class="format-grid">
          <button
            type="button"
            class="format-card"
            class:active={options.format === 'png'}
            onclick={() => handleFormatChange('png')}
          >
            <FileImage size={22} strokeWidth={1.6} />
            <span class="format-name">PNG</span>
            <span class="format-meta">Lossless</span>
          </button>
          <button
            type="button"
            class="format-card"
            class:active={options.format === 'jpeg'}
            onclick={() => handleFormatChange('jpeg')}
          >
            <ImageDown size={22} strokeWidth={1.6} />
            <span class="format-name">JPEG</span>
            <span class="format-meta">Smaller</span>
          </button>
        </div>
      </div>

      {#if options.format === 'jpeg'}
        <div class="section">
          <Slider
            label={$_('editor.quality')}
            value={Math.round(options.quality * 100)}
            min={10}
            max={100}
            step={5}
            suffix="%"
            onInput={handleQualityChange}
          />
        </div>
      {/if}
    {/snippet}

    {#snippet actions()}
      <button class="export-btn" onclick={handleExport}>
        <Download size={18} strokeWidth={2.2} />
        <span>{$_('editor.download')}</span>
      </button>
    {/snippet}
  </ToolPanel>
</div>

<style lang="postcss">
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--tk-space-2);
    margin-bottom: var(--tk-space-4);
  }
  .section:last-child {
    margin-bottom: 0;
  }

  .section-label {
    font-size: var(--tk-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tk-tracking-wide);
    color: var(--tk-text-tertiary);
    font-weight: var(--tk-weight-semibold);
  }

  .format-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--tk-space-2);
  }

  .format-card {
    appearance: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--tk-space-1);
    padding: var(--tk-space-4) var(--tk-space-3);
    background: var(--tk-surface-1);
    color: var(--tk-text-secondary);
    border: 1.5px solid var(--tk-border-subtle);
    border-radius: var(--tk-radius-lg);
    cursor: pointer;
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      border-color var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring);
    -webkit-tap-highlight-color: transparent;
  }

  .format-card:hover {
    background: var(--tk-surface-2);
    color: var(--tk-text-primary);
  }
  .format-card:active {
    transform: scale(0.97);
  }
  .format-card.active {
    background: var(--tk-accent-soft);
    border-color: var(--tk-accent);
    color: var(--tk-accent-hover);
  }

  .format-name {
    font-size: var(--tk-text-md);
    font-weight: var(--tk-weight-semibold);
    letter-spacing: var(--tk-tracking-tight);
  }
  .format-meta {
    font-size: var(--tk-text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tk-tracking-wide);
    color: var(--tk-text-tertiary);
  }

  .export-btn {
    appearance: none;
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--tk-space-2);
    height: 48px;
    background: var(--tk-accent);
    color: var(--tk-text-on-accent);
    border: none;
    border-radius: var(--tk-radius-full);
    font-family: inherit;
    font-size: var(--tk-text-md);
    font-weight: var(--tk-weight-semibold);
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(10, 132, 255, 0.32);
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring),
      box-shadow var(--tk-dur-quick) var(--tk-ease-out);
  }
  .export-btn:hover {
    background: var(--tk-accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(10, 132, 255, 0.4);
  }
  .export-btn:active {
    transform: translateY(0) scale(0.98);
  }
</style>
