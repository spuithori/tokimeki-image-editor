<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Crop, RotateCw, Download, RotateCcw, Undo2, Redo2, SlidersHorizontal, Sparkles, Droplet, Sticker } from 'lucide-svelte';
  import type { EditorMode } from '../types';

  interface Props {
    mode: EditorMode;
    hasImage: boolean;
    canUndo?: boolean;
    canRedo?: boolean;
    isStandalone?: boolean;
    onModeChange: (mode: EditorMode) => void;
    onReset: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
  }

  let {
    mode,
    hasImage,
    canUndo = false,
    canRedo = false,
    isStandalone = false,
    onModeChange,
    onReset,
    onUndo,
    onRedo
  }: Props = $props();
</script>

<div class="toolbar">
  <button
    class="toolbar-btn"
    disabled={!canUndo}
    onclick={onUndo}
    title={$_('toolbar.undo')}
  >
    <Undo2 size={20} />
  </button>

  <button
    class="toolbar-btn"
    disabled={!canRedo}
    onclick={onRedo}
    title={$_('toolbar.redo')}
  >
    <Redo2 size={20} />
  </button>

  <button
    class="toolbar-btn toolbar-btn--mr"
    disabled={!hasImage}
    onclick={onReset}
    title={$_('editor.reset')}
  >
    <RotateCcw size={20} />
  </button>

  <button
    class="toolbar-btn"
    class:active={mode === 'crop'}
    disabled={!hasImage}
    onclick={() => onModeChange('crop')}
    title={$_('toolbar.crop')}
  >
    <Crop size={20} />
    <span>{$_('editor.crop')}</span>
  </button>

  <button
    class="toolbar-btn"
    class:active={mode === 'adjust'}
    disabled={!hasImage}
    onclick={() => onModeChange('adjust')}
    title={$_('toolbar.adjust')}
  >
    <SlidersHorizontal size={20} />
    <span>{$_('editor.adjust')}</span>
  </button>

  <button
    class="toolbar-btn"
    class:active={mode === 'filter'}
    disabled={!hasImage}
    onclick={() => onModeChange('filter')}
    title={$_('toolbar.filter')}
  >
    <Sparkles size={20} />
    <span>{$_('editor.filter')}</span>
  </button>

  <button
    class="toolbar-btn"
    class:active={mode === 'blur'}
    disabled={!hasImage}
    onclick={() => onModeChange('blur')}
    title={$_('toolbar.blur')}
  >
    <Droplet size={20} />
    <span>{$_('editor.blur')}</span>
  </button>

  <button
    class="toolbar-btn"
    class:active={mode === 'stamp'}
    disabled={!hasImage}
    onclick={() => onModeChange('stamp')}
    title={$_('toolbar.stamp')}
  >
    <Sticker size={20} />
    <span>{$_('editor.stamp')}</span>
  </button>

  {#if isStandalone}
    <button
      class="toolbar-btn"
      class:active={mode === 'export'}
      disabled={!hasImage}
      onclick={() => onModeChange('export')}
      title={$_('toolbar.export')}
    >
      <Download size={20} />
    </button>
  {/if}
</div>

<style lang="postcss">
  .toolbar {
    width: 100%;
    display: flex;
    gap: .5rem;
    align-items: center;
    overflow-x: auto;

    @media (max-width: 767px) {
      align-items: stretch;
    }
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: #333;
    color: #fff;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.9rem;

    @media (max-width: 767px) {
      flex-direction: column;
      justify-content: center;
      font-size: .6rem;
      gap: .3rem;
      width: 64px;
    }

    &--mr {
      margin-right: auto;
    }
  }

  .toolbar-btn:hover:not(:disabled) {
    opacity: .7;
  }

  .toolbar-btn.active {
    background: var(--primary-color, #63b97b);
    border-color: var(--primary-color, #63b97b);

    &:hover {
      opacity: 1;
    }
  }

  .toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toolbar-btn span {
    white-space: nowrap;
  }
</style>
