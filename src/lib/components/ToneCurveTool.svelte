<script lang="ts">
  import { _ } from 'tokimeki-i18n';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import type { ToneCurve, ToneCurvePoint } from '../types';
  import { haptic } from '../utils/haptics';

  interface Props {
    toneCurve: ToneCurve;
    onChange: (curve: ToneCurve) => void;
  }

  let { toneCurve, onChange }: Props = $props();

  type Channel = 'rgb' | 'red' | 'green' | 'blue';

  let activeChannel = $state<Channel>('rgb');
  let draggingIndex = $state<number | null>(null);

  let canvasEl: HTMLCanvasElement | undefined = $state();

  const CANVAS_SIZE = 200;
  const POINT_RADIUS = 6;
  const HIT_RADIUS = 14;

  const CHANNEL_COLORS: Record<Channel, string> = {
    rgb: '#ffffff',
    red: '#FF3B30',
    green: '#34C759',
    blue: '#007AFF'
  };

  let activePoints = $derived<ToneCurvePoint[]>(toneCurve[activeChannel]);
  let curveColor = $derived(CHANNEL_COLORS[activeChannel]);

  function setChannel(ch: Channel) {
    if (ch === activeChannel) return;
    haptic('selection');
    activeChannel = ch;
  }

  function drawCurve() {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = CANVAS_SIZE;
    const h = CANVAS_SIZE;

    canvasEl.width = w * dpr;
    canvasEl.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#1c1c20';
    ctx.fillRect(0, 0, w, h);

    // Grid lines (4x4)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const pos = (w / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(w, pos);
      ctx.stroke();
    }

    // Diagonal guide line (input = output)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(w, 0);
    ctx.stroke();

    // Curve line
    const points = activePoints;
    if (points.length < 2) return;

    const sorted = [...points].sort((a, b) => a.x - b.x);

    ctx.strokeStyle = curveColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    if (sorted.length === 2) {
      const p0 = toCanvas(sorted[0], w, h);
      const p1 = toCanvas(sorted[1], w, h);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    } else {
      // Catmull-Rom spline through all points
      for (let i = 0; i < sorted.length - 1; i++) {
        const p0 = toCanvas(sorted[Math.max(i - 1, 0)], w, h);
        const p1 = toCanvas(sorted[i], w, h);
        const p2 = toCanvas(sorted[Math.min(i + 1, sorted.length - 1)], w, h);
        const p3 = toCanvas(sorted[Math.min(i + 2, sorted.length - 1)], w, h);

        if (i === 0) {
          ctx.moveTo(p1.x, p1.y);
        }

        const tension = 0.5;
        const segments = 20;
        for (let t = 1; t <= segments; t++) {
          const s = t / segments;
          const s2 = s * s;
          const s3 = s2 * s;

          const cx = 0.5 * (
            (2 * p1.x) +
            (-p0.x + p2.x) * s * tension * 2 +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 * tension * 2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3 * tension * 2
          );
          const cy = 0.5 * (
            (2 * p1.y) +
            (-p0.y + p2.y) * s * tension * 2 +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 * tension * 2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3 * tension * 2
          );
          ctx.lineTo(cx, cy);
        }
      }
    }
    ctx.stroke();

    // Control points
    for (let i = 0; i < sorted.length; i++) {
      const cp = toCanvas(sorted[i], w, h);
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = curveColor;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function toCanvas(point: ToneCurvePoint, w: number, h: number): { x: number; y: number } {
    return {
      x: (point.x / 255) * w,
      y: h - (point.y / 255) * h
    };
  }

  function fromCanvas(cx: number, cy: number, w: number, h: number): ToneCurvePoint {
    return {
      x: Math.round(Math.max(0, Math.min(255, (cx / w) * 255))),
      y: Math.round(Math.max(0, Math.min(255, ((h - cy) / h) * 255)))
    };
  }

  function getCanvasCoords(e: MouseEvent | TouchEvent): { cx: number; cy: number } | null {
    if (!canvasEl) return null;
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;

    let clientX: number;
    let clientY: number;

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      cx: (clientX - rect.left) * scaleX,
      cy: (clientY - rect.top) * scaleY
    };
  }

  function findNearestPoint(cx: number, cy: number): number | null {
    const sorted = [...activePoints].sort((a, b) => a.x - b.x);
    let minDist = Infinity;
    let minIndex = -1;

    for (let i = 0; i < sorted.length; i++) {
      const cp = toCanvas(sorted[i], CANVAS_SIZE, CANVAS_SIZE);
      const dist = Math.hypot(cp.x - cx, cp.y - cy);
      if (dist < minDist) {
        minDist = dist;
        minIndex = i;
      }
    }

    if (minDist <= HIT_RADIUS) {
      // Find the original index in the unsorted array
      const sortedPoint = sorted[minIndex];
      return activePoints.findIndex(
        (p) => p.x === sortedPoint.x && p.y === sortedPoint.y
      );
    }
    return null;
  }

  function handlePointerDown(e: MouseEvent) {
    const coords = getCanvasCoords(e);
    if (!coords) return;

    const nearestIdx = findNearestPoint(coords.cx, coords.cy);

    if (nearestIdx !== null) {
      draggingIndex = nearestIdx;
    } else {
      // Add a new point
      const newPoint = fromCanvas(coords.cx, coords.cy, CANVAS_SIZE, CANVAS_SIZE);
      const newPoints = [...activePoints, newPoint];
      haptic('selection');
      emitChange(newPoints);
    }
  }

  function handlePointerMove(e: MouseEvent) {
    if (draggingIndex === null) return;
    e.preventDefault();

    const coords = getCanvasCoords(e);
    if (!coords) return;

    const updated = fromCanvas(coords.cx, coords.cy, CANVAS_SIZE, CANVAS_SIZE);
    const newPoints = [...activePoints];
    newPoints[draggingIndex] = updated;
    emitChange(newPoints);
  }

  function handlePointerUp() {
    draggingIndex = null;
  }

  function handleDblClick(e: MouseEvent) {
    const coords = getCanvasCoords(e);
    if (!coords) return;

    const nearestIdx = findNearestPoint(coords.cx, coords.cy);
    if (nearestIdx === null) return;

    // Prevent removing endpoints (keep at least 2 points)
    if (activePoints.length <= 2) return;

    const point = activePoints[nearestIdx];
    // Protect the min/max x endpoints
    const sorted = [...activePoints].sort((a, b) => a.x - b.x);
    if (point === sorted[0] || point === sorted[sorted.length - 1]) return;

    haptic('selection');
    const newPoints = activePoints.filter((_, i) => i !== nearestIdx);
    emitChange(newPoints);
  }

  function emitChange(points: ToneCurvePoint[]) {
    const updated: ToneCurve = {
      ...toneCurve,
      [activeChannel]: points
    };
    onChange(updated);
  }

  function resetChannel() {
    haptic('warning');
    const defaultPoints: ToneCurvePoint[] = [
      { x: 0, y: 0 },
      { x: 255, y: 255 }
    ];
    emitChange(defaultPoints);
  }

  $effect(() => {
    // Track dependencies explicitly
    void toneCurve;
    void activeChannel;
    drawCurve();
  });
</script>

<svelte:window onpointerup={handlePointerUp} onpointermove={handlePointerMove} />

<div class="tone-curve-tool">
  <div class="channel-tabs" role="tablist">
    <button
      role="tab"
      aria-selected={activeChannel === 'rgb'}
      class="channel-tab"
      class:active={activeChannel === 'rgb'}
      onclick={() => setChannel('rgb')}
    >
      <span class="channel-label channel-rgb">RGB</span>
    </button>
    <button
      role="tab"
      aria-selected={activeChannel === 'red'}
      class="channel-tab"
      class:active={activeChannel === 'red'}
      onclick={() => setChannel('red')}
    >
      <span class="channel-label channel-red">R</span>
    </button>
    <button
      role="tab"
      aria-selected={activeChannel === 'green'}
      class="channel-tab"
      class:active={activeChannel === 'green'}
      onclick={() => setChannel('green')}
    >
      <span class="channel-label channel-green">G</span>
    </button>
    <button
      role="tab"
      aria-selected={activeChannel === 'blue'}
      class="channel-tab"
      class:active={activeChannel === 'blue'}
      onclick={() => setChannel('blue')}
    >
      <span class="channel-label channel-blue">B</span>
    </button>
  </div>

  <div class="canvas-wrap">
    <canvas
      bind:this={canvasEl}
      class="curve-canvas"
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      onpointerdown={handlePointerDown}
      ondblclick={handleDblClick}
    ></canvas>
  </div>

  <div class="footer-row">
    <button class="reset-btn" onclick={resetChannel}>
      <RotateCcw size={14} />
      <span>{$_('editor.reset')}</span>
    </button>
  </div>
</div>

<style lang="postcss">
  .tone-curve-tool {
    display: flex;
    flex-direction: column;
    gap: var(--tk-space-3);
  }

  .channel-tabs {
    display: flex;
    gap: var(--tk-space-1);
    padding: var(--tk-space-1);
    background: var(--tk-surface-1);
    border-radius: var(--tk-radius-lg);
  }

  .channel-tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 34px;
    padding: 0 var(--tk-space-3);
    border: none;
    background: transparent;
    border-radius: var(--tk-radius-md);
    cursor: pointer;
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out);
    -webkit-tap-highlight-color: transparent;
  }

  .channel-tab:hover {
    background: var(--tk-surface-hover);
  }

  .channel-tab.active {
    background: var(--tk-bg-elevated);
    box-shadow: var(--tk-shadow-xs);
  }

  .channel-label {
    font-size: var(--tk-text-xs);
    font-weight: var(--tk-weight-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tk-tracking-wide);
  }

  .channel-rgb {
    color: var(--tk-text-tertiary);
  }

  .channel-tab.active .channel-rgb {
    color: var(--tk-text-primary);
  }

  .channel-red {
    color: rgba(255, 59, 48, 0.6);
  }

  .channel-tab.active .channel-red {
    color: #FF3B30;
  }

  .channel-green {
    color: rgba(52, 199, 89, 0.6);
  }

  .channel-tab.active .channel-green {
    color: #34C759;
  }

  .channel-blue {
    color: rgba(0, 122, 255, 0.6);
  }

  .channel-tab.active .channel-blue {
    color: #007AFF;
  }

  .canvas-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: var(--tk-radius-md);
    overflow: hidden;
    border: 1px solid var(--tk-border-subtle);
    touch-action: none;
  }

  .curve-canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }

  .footer-row {
    display: flex;
    justify-content: flex-end;
  }

  .reset-btn {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: var(--tk-space-1);
    border: 1px solid var(--tk-border-default);
    background: var(--tk-surface-1);
    color: var(--tk-text-secondary);
    padding: 0 var(--tk-space-3);
    height: 32px;
    border-radius: var(--tk-radius-full);
    cursor: pointer;
    font-size: var(--tk-text-sm);
    font-weight: var(--tk-weight-semibold);
    transition:
      background var(--tk-dur-quick) var(--tk-ease-out),
      color var(--tk-dur-quick) var(--tk-ease-out),
      transform var(--tk-dur-quick) var(--tk-ease-spring);
  }

  .reset-btn:hover {
    background: var(--tk-surface-2);
    color: var(--tk-text-primary);
  }

  .reset-btn:active {
    transform: scale(0.96);
  }
</style>
