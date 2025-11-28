<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Crop, RotateCw, Download, RotateCcw, Undo2, Redo2 } from 'lucide-svelte';
  import type { EditorMode } from '../types';

  interface Props {
    mode: EditorMode;
    hasImage: boolean;
    canUndo?: boolean;
    canRedo?: boolean;
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
    onModeChange,
    onReset,
    onUndo,
    onRedo
  }: Props = $props();
</script>

<div class="toolbar">
  <div class="toolbar-group">
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
      class:active={mode === 'rotate'}
      disabled={!hasImage}
      onclick={() => onModeChange('rotate')}
      title={$_('toolbar.rotate')}
    >
      <RotateCw size={20} />
      <span>{$_('editor.rotate')}</span>
    </button>

    <button
      class="toolbar-btn"
      class:active={mode === 'export'}
      disabled={!hasImage}
      onclick={() => onModeChange('export')}
      title={$_('toolbar.export')}
    >
      <Download size={20} />
      <span>{$_('editor.export')}</span>
    </button>
  </div>

  <div class="toolbar-group">
    <button
      class="toolbar-btn"
      disabled={!canUndo}
      onclick={onUndo}
      title={$_('toolbar.undo')}
    >
      <Undo2 size={20} />
      <span>{$_('editor.undo')}</span>
    </button>

    <button
      class="toolbar-btn"
      disabled={!canRedo}
      onclick={onRedo}
      title={$_('toolbar.redo')}
    >
      <Redo2 size={20} />
      <span>{$_('editor.redo')}</span>
    </button>
  </div>

  <div class="toolbar-group">
    <button
      class="toolbar-btn"
      disabled={!hasImage}
      onclick={onReset}
      title={$_('editor.reset')}
    >
      <RotateCcw size={20} />
      <span>{$_('editor.reset')}</span>
    </button>
  </div>
</div>

<style lang="postcss">
  .toolbar {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .toolbar-group {
    display: flex;
    gap: 0.5rem;
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
  }

  .toolbar-btn:hover:not(:disabled) {
    background: #444;
    border-color: #555;
  }

  .toolbar-btn.active {
    background: #0066cc;
    border-color: #0077dd;
  }

  .toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toolbar-btn span {
    white-space: nowrap;
  }
</style>
