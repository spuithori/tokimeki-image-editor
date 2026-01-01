<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Crop, Download, SlidersHorizontal, Sparkles, Droplet, Sticker, PenLine, Undo2, Redo2, RotateCcw } from 'lucide-svelte';
  import type { EditorMode } from '../types';

  interface Props {
    mode: EditorMode;
    hasImage: boolean;
    canUndo: boolean;
    canRedo: boolean;
    isStandalone?: boolean;
    onModeChange: (mode: EditorMode) => void;
    onUndo: () => void;
    onRedo: () => void;
    onReset: () => void;
  }

  let {
    mode,
    hasImage,
    canUndo,
    canRedo,
    isStandalone = false,
    onModeChange,
    onUndo,
    onRedo,
    onReset,
  }: Props = $props();
</script>

<div class="toolbar">
  {#if isStandalone}
    <div class="toolbar-group history-controls">
      <button
        class="toolbar-btn icon-only"
        disabled={!canUndo}
        onclick={onUndo}
        title={$_('toolbar.undo')}
      >
        <Undo2 size={20} />
      </button>
      <button
        class="toolbar-btn icon-only"
        disabled={!canRedo}
        onclick={onRedo}
        title={$_('toolbar.redo')}
      >
        <Redo2 size={20} />
      </button>
      <button
        class="toolbar-btn icon-only"
        disabled={!hasImage}
        onclick={onReset}
        title={$_('editor.reset')}
      >
        <RotateCcw size={20} />
      </button>
    </div>
  {/if}

  <div class="toolbar-group mode-controls">
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

  <button
    class="toolbar-btn"
    class:active={mode === 'annotate'}
    disabled={!hasImage}
    onclick={() => onModeChange('annotate')}
    title={$_('toolbar.annotate')}
  >
    <PenLine size={20} />
    <span>{$_('editor.annotate')}</span>
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
</div>

<style lang="postcss">
  .toolbar {
    width: 100%;
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: center;
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }

    @media (max-width: 767px) {
      justify-content: flex-start;
      align-items: center;
      gap: .5rem;
      padding: 0 .5rem;
      -webkit-overflow-scrolling: touch;
    }
  }

  .toolbar-group {
    display: flex;
    gap: .25rem;
    align-items: center;
    flex-shrink: 0;
  }

  .history-controls {
    border-right: 1px solid #444;
    padding-right: 1rem;

    @media (max-width: 767px) {
      border-right: 1px solid #444;
      padding-right: .5rem;
    }
  }

  .mode-controls {
    gap: .5rem;

    @media (max-width: 767px) {
      gap: .25rem;
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
    flex-shrink: 0;

    @media (max-width: 767px) {
      flex-direction: column;
      justify-content: center;
      font-size: .55rem;
      gap: .2rem;
      padding: .4rem .5rem;
      min-width: 48px;
      width: auto;
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

  .toolbar-btn.icon-only {
    padding: 0.5rem;
    width: auto;

    @media (max-width: 767px) {
      width: auto;
      min-width: 40px;
    }
  }
</style>
