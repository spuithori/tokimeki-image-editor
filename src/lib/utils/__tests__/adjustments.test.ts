import { describe, it, expect } from 'vitest';
import {
  createDefaultAdjustments,
  createDefaultToneCurve,
  createDefaultHSL,
  createDefaultHSLRange,
  generateCurveLUTChannel,
  generateCurveLUT,
  isToneCurveDefault,
  isHSLDefault,
} from '../adjustments';

describe('createDefaultAdjustments', () => {
  it('returns all numeric fields at 0', () => {
    const adj = createDefaultAdjustments();
    expect(adj.exposure).toBe(0);
    expect(adj.contrast).toBe(0);
    expect(adj.brightness).toBe(0);
    expect(adj.sharpen).toBe(0);
    expect(adj.denoise).toBe(0);
    expect(adj.grain).toBe(0);
  });

  it('includes default toneCurve', () => {
    const adj = createDefaultAdjustments();
    expect(adj.toneCurve.rgb).toHaveLength(2);
    expect(adj.toneCurve.rgb[0]).toEqual({ x: 0, y: 0 });
    expect(adj.toneCurve.rgb[1]).toEqual({ x: 255, y: 255 });
  });

  it('includes default HSL', () => {
    const adj = createDefaultAdjustments();
    expect(adj.hsl.red).toEqual({ hue: 0, saturation: 0, luminance: 0 });
    expect(adj.hsl.magenta).toEqual({ hue: 0, saturation: 0, luminance: 0 });
  });
});

describe('generateCurveLUTChannel', () => {
  it('linear curve produces identity LUT', () => {
    const lut = generateCurveLUTChannel([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    expect(lut).toHaveLength(256);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(128);
    expect(lut[255]).toBe(255);
  });

  it('constant curve fills with single value', () => {
    const lut = generateCurveLUTChannel([{ x: 0, y: 100 }]);
    expect(lut[0]).toBe(100);
    expect(lut[255]).toBe(100);
  });

  it('empty curve produces identity', () => {
    const lut = generateCurveLUTChannel([]);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(128);
  });

  it('S-curve produces expected shape', () => {
    const lut = generateCurveLUTChannel([
      { x: 0, y: 0 },
      { x: 64, y: 32 },   // darken shadows
      { x: 192, y: 224 },  // brighten highlights
      { x: 255, y: 255 },
    ]);
    // Shadows compressed (below identity line)
    expect(lut[64]).toBeLessThan(64);
    // Highlights expanded (above identity line)
    expect(lut[192]).toBeGreaterThan(192);
  });

  it('clamps output to 0-255', () => {
    const lut = generateCurveLUTChannel([
      { x: 0, y: -50 },
      { x: 255, y: 300 },
    ]);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
  });
});

describe('generateCurveLUT', () => {
  it('produces 256*4 bytes RGBA data', () => {
    const curve = createDefaultToneCurve();
    const data = generateCurveLUT(curve);
    expect(data).toHaveLength(256 * 4);
  });

  it('identity curve: R=G=B=input, A=255', () => {
    const curve = createDefaultToneCurve();
    const data = generateCurveLUT(curve);
    for (let i = 0; i < 256; i++) {
      expect(data[i * 4 + 0]).toBe(i); // R
      expect(data[i * 4 + 1]).toBe(i); // G
      expect(data[i * 4 + 2]).toBe(i); // B
      expect(data[i * 4 + 3]).toBe(255); // A
    }
  });

  it('master curve affects all channels', () => {
    const curve = createDefaultToneCurve();
    // Set master to invert
    curve.rgb = [{ x: 0, y: 255 }, { x: 255, y: 0 }];
    const data = generateCurveLUT(curve);
    // Value 0 → master maps to 255, then per-channel (identity) maps 255 → 255
    expect(data[0]).toBe(255); // R at input 0
    // Value 255 → master maps to 0, then per-channel maps 0 → 0
    expect(data[255 * 4]).toBe(0); // R at input 255
  });
});

describe('isToneCurveDefault', () => {
  it('returns true for default curve', () => {
    expect(isToneCurveDefault(createDefaultToneCurve())).toBe(true);
  });

  it('returns false for modified curve', () => {
    const curve = createDefaultToneCurve();
    curve.rgb.push({ x: 128, y: 200 });
    expect(isToneCurveDefault(curve)).toBe(false);
  });
});

describe('isHSLDefault', () => {
  it('returns true for default HSL', () => {
    expect(isHSLDefault(createDefaultHSL())).toBe(true);
  });

  it('returns false for modified HSL', () => {
    const hsl = createDefaultHSL();
    hsl.red.hue = 10;
    expect(isHSLDefault(hsl)).toBe(false);
  });
});
