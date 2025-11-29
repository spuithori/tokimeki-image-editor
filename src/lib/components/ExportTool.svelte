<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Download } from 'lucide-svelte';
  import type { ExportOptions } from '../types';

  interface Props {
    options: ExportOptions;
    onChange: (options: Partial<ExportOptions>) => void;
    onExport: () => void;
    onClose: () => void;
  }

  let { options, onChange, onExport, onClose }: Props = $props();

  function handleFormatChange(format: 'png' | 'jpeg') {
    onChange({ format });
  }

  function handleQualityChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    onChange({ quality: value });
  }
</script>

<div class="export-tool">
  <div class="tool-header">
    <h3>{$_('editor.export')}</h3>
    <button class="close-btn" onclick={onClose}>✕</button>
  </div>

  <div class="tool-content">
    <div class="tool-group">
      <label>{$_('editor.format')}</label>
      <div class="format-buttons">
        <button
          class="format-btn"
          class:active={options.format === 'png'}
          onclick={() => handleFormatChange('png')}
        >
          PNG
        </button>
        <button
          class="format-btn"
          class:active={options.format === 'jpeg'}
          onclick={() => handleFormatChange('jpeg')}
        >
          JPEG
        </button>
      </div>
    </div>

    {#if options.format === 'jpeg'}
      <div class="tool-group">
        <label>
          {$_('editor.quality')}: {Math.round(options.quality * 100)}%
        </label>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={options.quality}
          oninput={handleQualityChange}
          class="quality-slider"
        />
      </div>
    {/if}

    <button class="export-btn" onclick={onExport}>
      <Download size={20} />
      <span>{$_('editor.download')}</span>
    </button>
  </div>
</div>

<style lang="postcss">
  .export-tool {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .tool-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .tool-header h3 {
    margin: 0;
    font-size: 1.1rem;
  }

  .close-btn {
    background: none;
    border: none;
    color: #fff;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.2s;
  }

  .close-btn:hover {
    background: #444;
  }

  .tool-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .tool-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .tool-group label {
    font-size: 0.9rem;
    color: #ccc;
  }

  .format-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .format-btn {
    flex: 1;
    padding: 0.5rem 1rem;
    background: #333;
    color: #fff;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.9rem;
  }

  .format-btn:hover {
    background: #444;
    border-color: #555;
  }

  .format-btn.active {
    background: var(--primary-color, #63b97b);
    border-color: var(--primary-color, #63b97b);
  }

  .quality-slider {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: #444;
    outline: none;
    cursor: pointer;
  }

  .quality-slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--primary-color, #63b97b);
    cursor: pointer;
  }

  .quality-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--primary-color, #63b97b);
    cursor: pointer;
    border: none;
  }

  .export-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    background: var(--primary-color, #63b97b);
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 1rem;
    font-weight: 500;
  }

  .export-btn:hover {
    background: var(--primary-color, #63b97b);
  }
</style>
