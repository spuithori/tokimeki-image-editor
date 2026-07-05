import { describe, it, expect } from 'vitest';
import {
  IOS_MAX_CANVAS_AREA,
  alignedBytesPerRow,
  computeExportDimensions,
  isIOSLike,
  unpadRows,
} from '../export-limits';

describe('computeExportDimensions', () => {
  it('returns identity for images within all limits', () => {
    expect(computeExportDimensions(4000, 3000, { maxDimension: 8192, maxArea: IOS_MAX_CANVAS_AREA }))
      .toEqual({ width: 4000, height: 3000, renderScale: 1 });
  });

  it('returns identity when no limits are given', () => {
    expect(computeExportDimensions(20000, 20000)).toEqual({ width: 20000, height: 20000, renderScale: 1 });
  });

  it('clamps a 24MP iPhone photo under the iOS canvas area limit', () => {
    const { width, height, renderScale } = computeExportDimensions(5712, 4284, { maxArea: IOS_MAX_CANVAS_AREA });
    expect(width * height).toBeLessThanOrEqual(IOS_MAX_CANVAS_AREA);
    expect(width / height).toBeCloseTo(5712 / 4284, 2);
    expect(renderScale).toBeLessThan(1);
    expect(renderScale).toBeGreaterThanOrEqual(Math.min(width / 5712, height / 4284));
    expect(renderScale).toBe(Math.max(width / 5712, height / 4284));
  });

  it('clamps by max dimension', () => {
    const { width, height } = computeExportDimensions(20000, 500, { maxDimension: 8192 });
    expect(width).toBeLessThanOrEqual(8192);
    expect(height).toBeLessThanOrEqual(8192);
    expect(width / height).toBeCloseTo(20000 / 500, 0);
  });

  it('applies the tighter of area and dimension limits together', () => {
    const { width, height } = computeExportDimensions(10000, 9000, { maxDimension: 8192, maxArea: IOS_MAX_CANVAS_AREA });
    expect(width).toBeLessThanOrEqual(8192);
    expect(height).toBeLessThanOrEqual(8192);
    expect(width * height).toBeLessThanOrEqual(IOS_MAX_CANVAS_AREA);
  });

  it('never returns zero dimensions', () => {
    const { width, height } = computeExportDimensions(30000, 1, { maxDimension: 100 });
    expect(width).toBeGreaterThanOrEqual(1);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});

describe('alignedBytesPerRow', () => {
  it('aligns to 256-byte multiples', () => {
    expect(alignedBytesPerRow(64)).toBe(256);
    expect(alignedBytesPerRow(100)).toBe(512);
    expect(alignedBytesPerRow(256)).toBe(1024);
  });

  it('keeps already-aligned rows unchanged', () => {
    expect(alignedBytesPerRow(128)).toBe(512);
    expect(alignedBytesPerRow(1024)).toBe(4096);
  });
});

describe('unpadRows', () => {
  it('strips row padding and preserves pixel bytes', () => {
    const width = 2;
    const height = 3;
    const bytesPerRow = 256;
    const padded = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
      for (let i = 0; i < width * 4; i++) {
        padded[y * bytesPerRow + i] = y * 100 + i;
      }
      padded[y * bytesPerRow + width * 4] = 0xff;
    }
    const out = unpadRows(padded, width, height, bytesPerRow);
    expect(out.length).toBe(width * 4 * height);
    for (let y = 0; y < height; y++) {
      for (let i = 0; i < width * 4; i++) {
        expect(out[y * width * 4 + i]).toBe(y * 100 + i);
      }
    }
  });

  it('is a no-op copy when bytesPerRow equals the row size', () => {
    const padded = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = unpadRows(padded, 1, 2, 4);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('isIOSLike', () => {
  it('detects iPhone and iPad user agents', () => {
    expect(isIOSLike('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', 'iPhone', 5)).toBe(true);
    expect(isIOSLike('Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X)', 'iPad', 5)).toBe(true);
  });

  it('detects iPadOS masquerading as macOS', () => {
    expect(isIOSLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true);
  });

  it('does not flag a regular Mac', () => {
    expect(isIOSLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
  });

  it('does not flag Windows or Android', () => {
    expect(isIOSLike('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0)).toBe(false);
    expect(isIOSLike('Mozilla/5.0 (Linux; Android 15)', 'Linux armv8l', 5)).toBe(false);
  });
});
