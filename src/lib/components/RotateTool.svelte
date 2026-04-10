<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { RotateCw, RotateCcw, FlipHorizontal, FlipVertical } from 'lucide-svelte';
  import type { TransformState } from '../types';
  import ToolPanel from './ToolPanel.svelte';
  import { haptic } from '../utils/haptics';

  interface Props {
    transform: TransformState;
    onChange: (transform: Partial<TransformState>) => void;
    onClose: () => void;
  }

  let { transform, onChange, onClose }: Props = $props();

  function rotateLeft() {
    haptic('light');
    const newRotation = (transform.rotation - 90 + 360) % 360;
    onChange({ rotation: newRotation });
  }

  function rotateRight() {
    haptic('light');
    const newRotation = (transform.rotation + 90) % 360;
    onChange({ rotation: newRotation });
  }

  function toggleFlipHorizontal() {
    haptic(transform.flipHorizontal ? 'toggleOff' : 'toggleOn');
    onChange({ flipHorizontal: !transform.flipHorizontal });
  }

  function toggleFlipVertical() {
    haptic(transform.flipVertical ? 'toggleOff' : 'toggleOn');
    onChange({ flipVertical: !transform.flipVertical });
  }

  function handleWheel(e: WheelEvent) {
    e.stopPropagation();
  }
</script>

<div class="rotate-tool" onwheel={handleWheel}>
  <ToolPanel title={$_('editor.rotate')} {onClose}>
    {#snippet children()}
      <div class="section">
        <div class="section-label">{$_('editor.rotate')}</div>
        <div class="action-grid">
          <button class="action-btn" onclick={rotateLeft} aria-label={$_('editor.rotateLeft')}>
            <RotateCcw size={22} strokeWidth={1.8} />
            <span>−90°</span>
          </button>
          <button class="action-btn" onclick={rotateRight} aria-label={$_('editor.rotateRight')}>
            <RotateCw size={22} strokeWidth={1.8} />
            <span>+90°</span>
          </button>
        </div>
        <div class="rotation-readout">{transform.rotation}°</div>
      </div>

      <div class="section">
        <div class="section-label">{$_('editor.flip')}</div>
        <div class="action-grid">
          <button
            class="action-btn"
            class:active={transform.flipHorizontal}
            aria-pressed={transform.flipHorizontal}
            onclick={toggleFlipHorizontal}
            aria-label={$_('editor.flipHorizontal')}
          >
            <FlipHorizontal size={22} strokeWidth={1.8} />
            <span>H</span>
          </button>
          <button
            class="action-btn"
            class:active={transform.flipVertical}
            aria-pressed={transform.flipVertical}
            onclick={toggleFlipVertical}
            aria-label={$_('editor.flipVertical')}
          >
            <FlipVertical size={22} strokeWidth={1.8} />
            <span>V</span>
          </button>
        </div>
      </div>
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

  .action-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--tk-space-2);
  }

  .action-btn {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--tk-space-2);
    height: var(--tk-touch-default);
    padding: 0 var(--tk-space-3);
    background: var(--tk-surface-1);
    color: var(--tk-text-secondary);
    border: 1px solid var(--tk-border-subtle);
    border-radius: var(--tk-radius-lg);
    font-family: inherit;
    font-size: var(--tk-text-base);
    font-weight: var(--tk-weight-semibold);
    cursor: pointer;
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out),
      border-color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring);
    -webkit-tap-highlight-color: transparent;
  }

  .action-btn:hover {
    background: var(--tk-surface-2);
    color: var(--tk-text-primary);
  }
  .action-btn:active {
    transform: scale(0.96);
  }
  .action-btn.active {
    background: var(--tk-accent-soft);
    color: var(--tk-accent-hover);
    border-color: var(--tk-accent);
  }

  .rotation-readout {
    font-variant-numeric: tabular-nums;
    text-align: center;
    color: var(--tk-text-tertiary);
    font-size: var(--tk-text-sm);
    margin-top: var(--tk-space-1);
  }
</style>
