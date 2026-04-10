<script lang="ts">
  import { haptic } from '../utils/haptics';

  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    bipolar?: boolean;
    suffix?: string;
    showValue?: boolean;
    disabled?: boolean;
    onInput: (value: number) => void;
  }

  let {
    label,
    value,
    min,
    max,
    step = 1,
    bipolar = false,
    suffix = '',
    showValue = true,
    disabled = false,
    onInput
  }: Props = $props();

  let id = `tk-slider-${Math.random().toString(36).slice(2, 9)}`;
  let lastTickValue = value;

  let percent = $derived(((value - min) / (max - min)) * 100);
  let zeroPercent = $derived(((0 - min) / (max - min)) * 100);

  let trackFill = $derived.by(() => {
    if (bipolar) {
      const start = Math.min(percent, zeroPercent);
      const end = Math.max(percent, zeroPercent);
      return { left: `${start}%`, width: `${end - start}%` };
    }
    return { left: '0%', width: `${percent}%` };
  });

  function handleInput(e: Event) {
    const next = Number((e.currentTarget as HTMLInputElement).value);
    // Tick haptic at integer crossings to feel mechanical without buzzing.
    if (Math.abs(next - lastTickValue) >= Math.max(step, (max - min) / 50)) {
      haptic('selection');
      lastTickValue = next;
    }
    onInput(next);
  }
</script>

<div class="slider" class:disabled>
  <div class="slider-row">
    <label for={id}>{label}</label>
    {#if showValue}
      <span class="value" class:nonzero={value !== 0 && bipolar}>
        {value > 0 && bipolar ? '+' : ''}{value}{suffix}
      </span>
    {/if}
  </div>
  <div class="track-wrap">
    <div class="track">
      <div class="track-fill" style:left={trackFill.left} style:width={trackFill.width}></div>
      {#if bipolar}
        <div class="track-mid" style:left="{zeroPercent}%"></div>
      {/if}
    </div>
    <input
      {id}
      type="range"
      {min}
      {max}
      {step}
      {value}
      {disabled}
      aria-label={label}
      oninput={handleInput}
    />
  </div>
</div>

<style lang="postcss">
  .slider {
    display: flex;
    flex-direction: column;
    gap: var(--tk-space-2);
    user-select: none;
  }

  .slider.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .slider-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--tk-space-2);
  }

  label {
    font-size: var(--tk-text-base);
    font-weight: var(--tk-weight-medium);
    color: var(--tk-text-secondary);
    letter-spacing: var(--tk-tracking-tight);
  }

  .value {
    font-size: var(--tk-text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--tk-text-tertiary);
    font-weight: var(--tk-weight-medium);
    transition: color var(--tk-dur-quick) var(--tk-ease-out);
  }

  .value.nonzero {
    color: var(--tk-accent);
  }

  .track-wrap {
    position: relative;
    height: var(--tk-touch-min);
    display: flex;
    align-items: center;
  }

  .track {
    position: absolute;
    inset: auto 0;
    height: 6px;
    background: var(--tk-surface-2);
    border-radius: var(--tk-radius-full);
    overflow: hidden;
  }

  .track-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    background: linear-gradient(
      90deg,
      var(--tk-accent) 0%,
      var(--tk-accent-hover) 100%
    );
    border-radius: var(--tk-radius-full);
    transition: width var(--tk-dur-instant) var(--tk-ease-out),
      left var(--tk-dur-instant) var(--tk-ease-out);
  }

  .track-mid {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 1px;
    background: var(--tk-border-strong);
    pointer-events: none;
  }

  input[type='range'] {
    position: relative;
    z-index: 1;
    width: 100%;
    height: var(--tk-touch-min);
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    touch-action: pan-y;
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 22px;
    height: 22px;
    background: var(--tk-slider-thumb);
    border: 3px solid var(--tk-accent);
    border-radius: var(--tk-radius-full);
    cursor: grab;
    box-shadow: var(--tk-shadow-md);
    transition: transform var(--tk-dur-quick) var(--tk-ease-spring),
      box-shadow var(--tk-dur-quick) var(--tk-ease-out);
  }

  input[type='range']::-webkit-slider-thumb:hover {
    transform: scale(1.08);
  }

  input[type='range']:active::-webkit-slider-thumb {
    cursor: grabbing;
    transform: scale(1.18);
    box-shadow: var(--tk-shadow-lg), var(--tk-accent-glow);
  }

  input[type='range']::-moz-range-thumb {
    width: 22px;
    height: 22px;
    background: var(--tk-slider-thumb);
    border: 3px solid var(--tk-accent);
    border-radius: var(--tk-radius-full);
    cursor: grab;
    box-shadow: var(--tk-shadow-md);
    transition: transform var(--tk-dur-quick) var(--tk-ease-spring);
  }

  input[type='range']:focus-visible::-webkit-slider-thumb {
    box-shadow: var(--tk-shadow-md), var(--tk-accent-glow);
  }
</style>
