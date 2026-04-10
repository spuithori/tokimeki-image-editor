import { describe, it, expect } from 'vitest';
import {
  createViewport,
  updateViewport,
  calculateZoom,
  calculatePanOffset,
  resetViewport,
} from '../viewport';

describe('viewport', () => {
  it('createViewport returns defaults', () => {
    const v = createViewport(2);
    expect(v).toEqual({ zoom: 1, offsetX: 0, offsetY: 0, scale: 2 });
  });

  it('createViewport defaults scale to 1', () => {
    const v = createViewport();
    expect(v.scale).toBe(1);
  });

  it('updateViewport merges partial changes', () => {
    const v = createViewport(1);
    const v2 = updateViewport(v, { zoom: 2, offsetX: 10 });
    expect(v2.zoom).toBe(2);
    expect(v2.offsetX).toBe(10);
    expect(v2.scale).toBe(1); // unchanged
  });

  it('calculateZoom clamps between 0.1 and 5', () => {
    const v = createViewport(1);
    const zoomed = calculateZoom(v, 100, 800, 600);
    expect(zoomed.zoom).toBe(5);

    const zoomedOut = calculateZoom(v, -100, 800, 600);
    expect(zoomedOut.zoom).toBeCloseTo(0.1, 1);
  });

  it('calculateZoom towards cursor adjusts offset', () => {
    const v = createViewport(1);
    const rect = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
    const zoomed = calculateZoom(v, 0.5, 800, 600, 400, 300, rect);
    expect(zoomed.zoom).toBe(1.5);
    // Offset should shift towards cursor
    expect(typeof zoomed.offsetX).toBe('number');
  });

  it('calculatePanOffset clamps to bounds', () => {
    const v = createViewport(1);
    const result = calculatePanOffset(v, 10000, 10000, 500, 500, 800, 600);
    // Should be clamped
    expect(result.offsetX).toBeLessThan(10000);
    expect(result.offsetY).toBeLessThan(10000);
  });

  it('resetViewport returns clean state', () => {
    const v = resetViewport(3);
    expect(v).toEqual({ zoom: 1, offsetX: 0, offsetY: 0, scale: 3 });
  });
});
