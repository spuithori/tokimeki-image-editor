<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { AdjustmentsState } from '../types';
  import { FILTER_PRESETS, applyFilterPreset, matchesFilterPreset } from '../utils/filters';
  import { X } from 'lucide-svelte';

  interface Props {
    adjustments: AdjustmentsState;
    onChange: (adjustments: AdjustmentsState) => void;
    onClose: () => void;
  }

  let { adjustments, onChange, onClose }: Props = $props();

  // Find currently selected filter (if any)
  let selectedFilterId = $derived(
    FILTER_PRESETS.find(preset => matchesFilterPreset(adjustments, preset))?.id || null
  );

  function handleFilterSelect(filterId: string) {
    const preset = FILTER_PRESETS.find(p => p.id === filterId);
    if (preset) {
      const newAdjustments = applyFilterPreset(preset);
      onChange(newAdjustments);
    }
  }
</script>

<div class="filter-tool">
  <div class="tool-header">
    <h3>{$_('editor.filter')}</h3>
    <button class="close-btn" onclick={onClose} title={$_('editor.close')}>
      <X size={20} />
    </button>
  </div>

  <div class="filter-info">
    <p class="info-text">{$_('filters.info')}</p>
  </div>

  <div class="filter-grid">
    {#each FILTER_PRESETS as preset}
      <button
        class="filter-card"
        class:active={selectedFilterId === preset.id}
        onclick={() => handleFilterSelect(preset.id)}
      >
        <div class="filter-preview">
          <!-- Placeholder for filter preview - could add thumbnail later -->
          <div class="filter-name">{$_(preset.id === 'none' ? 'editor.none' : `filters.${preset.id}`)}</div>
        </div>
      </button>
    {/each}
  </div>
</div>

<style lang="postcss">
  .filter-tool {
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
    color: #fff;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    background: transparent;
    border: none;
    color: #999;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: #444;
    color: #fff;
  }

  .filter-grid {
    display: grid;
    grid-template-columns: repeat(2, 120px);
    gap: 1rem;
    overflow-y: auto;
    scrollbar-width: thin;
    padding-bottom: 1rem;
  }

  .filter-card {
    display: flex;
    flex-direction: column;
    padding: 1rem;
    background: #333;
    border: 2px solid #444;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    min-height: 80px;
    flex: 0 0 auto;
  }

  .filter-card:hover {
    background: #3a3a3a;
    border-color: #555;
  }

  .filter-card.active {
    background: #0066cc;
    border-color: #0077dd;
  }

  .filter-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
  }

  .filter-name {
    font-size: 0.9rem;
    font-weight: 600;
    color: #fff;
    text-align: center;
  }

  .filter-info {
    padding: 0.75rem;
    background: rgba(0, 102, 204, 0.1);
    border-left: 3px solid #0066cc;
    border-radius: 4px;
  }

  .info-text {
    margin: 0;
    font-size: 0.85rem;
    color: #ccc;
  }
</style>
