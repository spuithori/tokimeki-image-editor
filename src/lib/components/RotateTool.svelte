<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { RotateCw, RotateCcw, FlipHorizontal, FlipVertical } from 'lucide-svelte';
  import type { TransformState } from '../types';

  interface Props {
    transform: TransformState;
    onChange: (transform: Partial<TransformState>) => void;
    onClose: () => void;
  }

  let { transform, onChange, onClose }: Props = $props();

  function rotateLeft() {
    const newRotation = (transform.rotation - 90 + 360) % 360;
    onChange({ rotation: newRotation });
  }

  function rotateRight() {
    const newRotation = (transform.rotation + 90) % 360;
    onChange({ rotation: newRotation });
  }

  function toggleFlipHorizontal() {
    onChange({ flipHorizontal: !transform.flipHorizontal });
  }

  function toggleFlipVertical() {
    onChange({ flipVertical: !transform.flipVertical });
  }
</script>

<div class="rotate-tool">
  <div class="tool-header">
    <h3>{$_('editor.rotate')}</h3>
    <button class="close-btn" onclick={onClose}>✕</button>
  </div>

  <div class="tool-content">
    <div class="tool-group">
      <label>{$_('editor.rotate')}</label>
      <div class="button-group">
        <button class="tool-btn" onclick={rotateLeft} title={$_('editor.rotateLeft')}>
          <RotateCcw size={20} />
          <span>{$_('editor.rotateLeft')}</span>
        </button>
        <button class="tool-btn" onclick={rotateRight} title={$_('editor.rotateRight')}>
          <RotateCw size={20} />
          <span>{$_('editor.rotateRight')}</span>
        </button>
      </div>
      <div class="rotation-info">
        Current: {transform.rotation}°
      </div>
    </div>

    <div class="tool-group">
      <label>{$_('editor.flip')}</label>
      <div class="button-group">
        <button
          class="tool-btn"
          class:active={transform.flipHorizontal}
          onclick={toggleFlipHorizontal}
          title={$_('editor.flipHorizontal')}
        >
          <FlipHorizontal size={20} />
          <span>{$_('editor.flipHorizontal')}</span>
        </button>
        <button
          class="tool-btn"
          class:active={transform.flipVertical}
          onclick={toggleFlipVertical}
          title={$_('editor.flipVertical')}
        >
          <FlipVertical size={20} />
          <span>{$_('editor.flipVertical')}</span>
        </button>
      </div>
    </div>
  </div>
</div>

<style lang="postcss">
  .rotate-tool {
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

  .button-group {
    display: flex;
    gap: 0.5rem;
  }

  .tool-btn {
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

  .tool-btn:hover {
    background: #444;
    border-color: #555;
  }

  .tool-btn.active {
    background: var(--primary-color, #63b97b);
    border-color: var(--primary-color, #63b97b);
  }

  .rotation-info {
    font-size: 0.85rem;
    color: #999;
  }
</style>
