<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { RotateCw, RotateCcw, FlipHorizontal, FlipVertical } from 'lucide-svelte';
  import type { TransformState } from '../types';
  import ToolPanel from './ToolPanel.svelte';

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

  // Prevent wheel events from propagating to canvas zoom handler
  function handleWheel(e: WheelEvent) {
    e.stopPropagation();
  }
</script>

<div class="rotate-tool" onwheel={handleWheel}>
  <ToolPanel title={$_('editor.rotate')} {onClose}>
    {#snippet children()}
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
    {/snippet}
  </ToolPanel>
</div>

<style lang="postcss">
  .rotate-tool {
    display: flex;
    flex-direction: column;
    gap: 1rem;
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
