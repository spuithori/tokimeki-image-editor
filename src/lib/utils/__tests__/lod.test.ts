import { describe, it, expect } from 'vitest';
import {
  getLODLevel,
  getTessellationQuality,
  simplifyBySkip,
  simplifyRDP,
  simplifyForLOD,
  shouldSimplify,
  getRecommendedBatchSize,
} from '../lod';

describe('getLODLevel', () => {
  it('returns correct level for low zoom', () => {
    const level = getLODLevel(0.1);
    expect(level.pointSkip).toBe(4);
    expect(level.simplifyTolerance).toBe(6.0);
  });

  it('returns correct level for 1x zoom', () => {
    const level = getLODLevel(1.0);
    expect(level.pointSkip).toBe(1);
    expect(level.tessellationQuality).toBe(1.0);
  });

  it('returns highest detail for very high zoom', () => {
    const level = getLODLevel(5.0);
    expect(level.simplifyTolerance).toBe(0.1);
    expect(level.tessellationQuality).toBe(2.0);
  });
});

describe('simplifyBySkip', () => {
  it('returns original points when skip <= 1', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
    expect(simplifyBySkip(pts, 1)).toEqual(pts);
  });

  it('keeps first and last point', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i }));
    const result = simplifyBySkip(pts, 3);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('reduces point count', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i }));
    const result = simplifyBySkip(pts, 4);
    expect(result.length).toBeLessThan(pts.length);
  });
});

describe('simplifyRDP', () => {
  it('returns endpoints for straight line', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i }));
    const result = simplifyRDP(pts, 0.1);
    expect(result).toEqual([pts[0], pts[pts.length - 1]]);
  });

  it('preserves points on curves', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 10 }, // far from straight line
      { x: 10, y: 0 },
    ];
    const result = simplifyRDP(pts, 1);
    expect(result.length).toBe(3); // All kept
  });

  it('handles 2 or fewer points', () => {
    expect(simplifyRDP([{ x: 0, y: 0 }], 1)).toHaveLength(1);
    expect(simplifyRDP([], 1)).toHaveLength(0);
  });
});

describe('simplifyForLOD', () => {
  it('returns original for <= 2 points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyForLOD(pts, 1.0)).toEqual(pts);
  });

  it('simplifies more aggressively at low zoom', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({
      x: i * 10,
      y: Math.sin(i * 0.5) * 100,
    }));
    const low = simplifyForLOD(pts, 0.1);
    const high = simplifyForLOD(pts, 2.0);
    expect(low.length).toBeLessThanOrEqual(high.length);
  });
});

describe('shouldSimplify', () => {
  it('returns false for high zoom', () => {
    expect(shouldSimplify(2.0, 100)).toBe(false);
  });

  it('returns false for few points', () => {
    expect(shouldSimplify(0.5, 5)).toBe(false);
  });

  it('returns true for low zoom with many points', () => {
    expect(shouldSimplify(0.2, 100)).toBe(true);
  });
});

describe('getTessellationQuality', () => {
  it('returns number for any zoom', () => {
    expect(typeof getTessellationQuality(1.0)).toBe('number');
    expect(getTessellationQuality(0.1)).toBeLessThan(getTessellationQuality(2.0));
  });
});

describe('getRecommendedBatchSize', () => {
  it('returns larger batches at low zoom', () => {
    const low = getRecommendedBatchSize(0.1);
    const high = getRecommendedBatchSize(2.0);
    expect(low).toBeGreaterThan(high);
  });
});
