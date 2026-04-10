import { describe, it, expect } from 'vitest';
import { FILTER_PRESETS, getFilterPreset, applyFilterPreset, matchesFilterPreset } from '../filters';
import { createDefaultAdjustments } from '../adjustments';

describe('FILTER_PRESETS', () => {
  it('has at least 10 presets', () => {
    expect(FILTER_PRESETS.length).toBeGreaterThanOrEqual(10);
  });

  it('each preset has id and name', () => {
    for (const preset of FILTER_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
    }
  });

  it('includes "none" preset', () => {
    const none = FILTER_PRESETS.find(p => p.id === 'none');
    expect(none).toBeTruthy();
  });
});

describe('getFilterPreset', () => {
  it('finds existing preset', () => {
    const preset = getFilterPreset('vivid');
    expect(preset).toBeTruthy();
    expect(preset!.name).toBe('Vivid');
  });

  it('returns undefined for unknown id', () => {
    expect(getFilterPreset('nonexistent')).toBeUndefined();
  });
});

describe('applyFilterPreset', () => {
  it('applies preset values over defaults', () => {
    const preset = getFilterPreset('vivid')!;
    const result = applyFilterPreset(preset);
    expect(result.saturation).toBe(40);
    expect(result.contrast).toBe(20);
    // Unset values remain default
    expect(result.exposure).toBe(0);
  });

  it('preserves new fields (sharpen, denoise, toneCurve, hsl)', () => {
    const preset = getFilterPreset('vivid')!;
    const result = applyFilterPreset(preset);
    expect(result.sharpen).toBe(0);
    expect(result.denoise).toBe(0);
    expect(result.toneCurve).toBeTruthy();
    expect(result.hsl).toBeTruthy();
  });
});

describe('matchesFilterPreset', () => {
  it('matches "none" preset with defaults', () => {
    const adj = createDefaultAdjustments();
    const none = getFilterPreset('none')!;
    expect(matchesFilterPreset(adj, none)).toBe(true);
  });

  it('does not match vivid with defaults', () => {
    const adj = createDefaultAdjustments();
    const vivid = getFilterPreset('vivid')!;
    expect(matchesFilterPreset(adj, vivid)).toBe(false);
  });
});
