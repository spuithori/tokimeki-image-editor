import type { FilterPreset, AdjustmentsState, ToneCurve, ToneCurvePoint, HSLAdjustment } from '../types';
import { createDefaultAdjustments, createDefaultToneCurve, createDefaultHSL } from './adjustments';

// Shorthand helpers for readable preset definitions
function curve(rgb?: ToneCurvePoint[], red?: ToneCurvePoint[], green?: ToneCurvePoint[], blue?: ToneCurvePoint[]): ToneCurve {
  const base = createDefaultToneCurve();
  if (rgb) base.rgb = rgb;
  if (red) base.red = red;
  if (green) base.green = green;
  if (blue) base.blue = blue;
  return base;
}

function hsl(overrides: Partial<Record<keyof HSLAdjustment, Partial<{ hue: number; saturation: number; luminance: number }>>>): HSLAdjustment {
  const base = createDefaultHSL();
  for (const [color, adj] of Object.entries(overrides)) {
    const range = base[color as keyof HSLAdjustment];
    if (adj.hue !== undefined) range.hue = adj.hue;
    if (adj.saturation !== undefined) range.saturation = adj.saturation;
    if (adj.luminance !== undefined) range.luminance = adj.luminance;
  }
  return base;
}

// Common curve shapes
const P = (x: number, y: number): ToneCurvePoint => ({ x, y });

/** Gentle S-curve for pleasing contrast */
const S_CURVE = [P(0, 0), P(64, 48), P(192, 210), P(255, 255)];
/** Strong S-curve */
const S_CURVE_STRONG = [P(0, 0), P(56, 32), P(200, 224), P(255, 255)];
/** Lifted blacks (film look) */
const LIFTED_BLACKS = [P(0, 20), P(64, 68), P(192, 210), P(255, 250)];
/** Crushed blacks + lifted shadows */
const CRUSHED = [P(0, 0), P(32, 8), P(80, 72), P(192, 216), P(255, 255)];
/** Faded: raised blacks, lowered whites */
const FADED_CURVE = [P(0, 30), P(128, 128), P(255, 235)];

/**
 * Built-in filter presets
 * Each filter is a combination of adjustment values
 */
export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'none',
    name: 'None',
    adjustments: createDefaultAdjustments()
  },
  {
    id: 'vivid',
    name: 'Vivid',
    adjustments: {
      saturation: 40,
      contrast: 20,
      brightness: 5
    }
  },
  {
    id: 'sepia',
    name: 'Sepia',
    adjustments: {
      sepia: 80,
      brightness: -10,
      contrast: -30,
      highlights: -32,
      shadows: 30,
      vignette: -20
    }
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    adjustments: {
      grayscale: 100,
      contrast: 15
    }
  },
  {
    id: 'vintage',
    name: 'Vintage',
    adjustments: {
      sepia: 50,
      brightness: -15,
      contrast: -10,
      vignette: -40,
      saturation: -20
    }
  },
  {
    id: 'warm',
    name: 'Warm',
    adjustments: {
      sepia: -10,
      saturation: 15,
      brightness: 5,
      exposure: 10,
      temperature: 60,
    }
  },
  {
    id: 'cool',
    name: 'Cool',
    adjustments: {
      saturation: 10,
      brightness: -5,
      contrast: 10,
      temperature: -60,
    }
  },
  {
    id: 'film',
    name: 'Film',
    adjustments: {
      contrast: 60,
      highlights: -45,
      shadows: -100,
      saturation: 2,
      vignette: -24,
    }
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    adjustments: {
      contrast: 30,
      highlights: -25,
      shadows: 40,
      saturation: -15,
      temperature: -10,
      vignette: -35,
    }
  },
  {
    id: 'dramatic',
    name: 'Dramatic',
    adjustments: {
      contrast: 70,
      highlights: -60,
      shadows: -80,
      saturation: 25,
      brightness: -10,
      vignette: -50,
    }
  },
  {
    id: 'faded',
    name: 'Faded',
    adjustments: {
      contrast: -40,
      highlights: 30,
      shadows: 60,
      saturation: -25,
      brightness: 10,
    }
  },
  {
    id: 'golden',
    name: 'Golden Hour',
    adjustments: {
      temperature: 50,
      highlights: 20,
      shadows: -15,
      saturation: 20,
      brightness: 10,
      contrast: 15,
      vignette: -20,
    }
  },
  {
    id: 'soft',
    name: 'Soft',
    adjustments: {
      contrast: -25,
      highlights: 15,
      shadows: 35,
      saturation: -10,
      brightness: 8,
    }
  },
  {
    id: 'moody',
    name: 'Moody',
    adjustments: {
      contrast: 45,
      highlights: 25,
      shadows: -60,
      saturation: -5,
      brightness: -20,
      temperature: -15,
      vignette: -40,
    }
  },
  {
    id: 'pastel',
    name: 'Pastel',
    adjustments: {
      contrast: -30,
      highlights: 40,
      shadows: 50,
      saturation: 30,
      brightness: 15,
    }
  },
  {
    id: 'bleach',
    name: 'Bleach Bypass',
    adjustments: {
      contrast: 60,
      saturation: -40,
      highlights: 15,
      shadows: -20,
      brightness: 10,
    }
  },
  {
    id: 'grainy',
    name: 'Grainy',
    adjustments: {
      grain: 98,
      contrast: 22,
      saturation: -10,
      vignette: -20,
      shadows: 48,
      highlights: 10,
      blur: 8,
    }
  },

  // ── New presets using Tone Curve, HSL, Sharpen, Denoise ──

  {
    id: 'teal-orange',
    name: 'Teal & Orange',
    adjustments: {
      contrast: 15,
      saturation: 10,
      temperature: 8,
      vignette: -15,
      sharpen: 20,
      toneCurve: curve(S_CURVE),
      hsl: hsl({
        red:     { saturation: 15, luminance: 5 },
        orange:  { saturation: 25, luminance: 8 },
        yellow:  { hue: -10, saturation: -10 },
        green:   { hue: -40, saturation: -30, luminance: -10 },
        aqua:    { hue: -15, saturation: 20, luminance: -5 },
        blue:    { hue: -20, saturation: 15 },
      }),
    }
  },
  {
    id: 'portra',
    name: 'Portra 400',
    adjustments: {
      contrast: -8,
      highlights: -15,
      shadows: 20,
      saturation: -5,
      temperature: 12,
      grain: 25,
      sharpen: 15,
      toneCurve: curve(LIFTED_BLACKS),
      hsl: hsl({
        red:     { saturation: 5, luminance: 3 },
        orange:  { hue: 5, saturation: 10, luminance: 5 },
        yellow:  { hue: -5, saturation: -8 },
        green:   { hue: 10, saturation: -25, luminance: -8 },
        blue:    { saturation: -15, luminance: -5 },
      }),
    }
  },
  {
    id: 'velvia',
    name: 'Velvia',
    adjustments: {
      contrast: 25,
      saturation: 35,
      highlights: -20,
      shadows: -30,
      sharpen: 30,
      toneCurve: curve(S_CURVE_STRONG),
      hsl: hsl({
        red:     { saturation: 20, luminance: -5 },
        orange:  { saturation: 15 },
        yellow:  { saturation: 10, luminance: 5 },
        green:   { saturation: 30, luminance: -10 },
        aqua:    { saturation: 25 },
        blue:    { saturation: 30, luminance: -15 },
      }),
    }
  },
  {
    id: 'cross-process',
    name: 'Cross Process',
    adjustments: {
      contrast: 20,
      saturation: 15,
      vignette: -25,
      toneCurve: curve(
        S_CURVE,
        [P(0, 20), P(128, 150), P(255, 245)],  // Red: boosted
        [P(0, 0), P(100, 120), P(200, 190), P(255, 255)],  // Green: S-shape
        [P(0, 30), P(128, 100), P(255, 230)],  // Blue: raised blacks, suppressed mids
      ),
      hsl: hsl({
        yellow:  { hue: 15, saturation: 20 },
        green:   { hue: 30, saturation: -15 },
        aqua:    { hue: -20, saturation: 20 },
      }),
    }
  },
  {
    id: 'noir',
    name: 'Noir',
    adjustments: {
      grayscale: 100,
      contrast: 40,
      highlights: -30,
      shadows: -40,
      vignette: -45,
      sharpen: 25,
      toneCurve: curve(CRUSHED),
    }
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    adjustments: {
      contrast: 25,
      brightness: -10,
      saturation: 15,
      temperature: -25,
      vignette: -30,
      sharpen: 15,
      toneCurve: curve(
        S_CURVE,
        undefined,
        undefined,
        [P(0, 15), P(128, 140), P(255, 255)],  // Blue: lifted shadows
      ),
      hsl: hsl({
        red:     { hue: 15, saturation: 10 },
        orange:  { hue: 10 },
        aqua:    { hue: -30, saturation: 30, luminance: 5 },
        blue:    { hue: -15, saturation: 25 },
        purple:  { saturation: 35, luminance: 10 },
        magenta: { saturation: 30, luminance: 5 },
      }),
    }
  },
  {
    id: 'autumn',
    name: 'Autumn',
    adjustments: {
      temperature: 30,
      saturation: 15,
      contrast: 10,
      highlights: -10,
      vignette: -15,
      sharpen: 20,
      toneCurve: curve(S_CURVE),
      hsl: hsl({
        red:     { saturation: 20, luminance: 5 },
        orange:  { hue: -5, saturation: 35, luminance: 10 },
        yellow:  { hue: -10, saturation: 25, luminance: 5 },
        green:   { hue: -30, saturation: -20, luminance: -15 },
        aqua:    { hue: -20, saturation: -25 },
        blue:    { saturation: -15, luminance: -10 },
      }),
    }
  },
  {
    id: 'analog',
    name: 'Analog Fade',
    adjustments: {
      contrast: -15,
      saturation: -20,
      temperature: 10,
      grain: 45,
      vignette: -30,
      toneCurve: curve(FADED_CURVE),
      hsl: hsl({
        red:     { saturation: -10 },
        green:   { saturation: -20, luminance: -5 },
        blue:    { saturation: -15 },
      }),
    }
  },
  {
    id: 'chrome',
    name: 'Chrome',
    adjustments: {
      contrast: 35,
      saturation: -50,
      highlights: 20,
      shadows: -25,
      sharpen: 40,
      toneCurve: curve(S_CURVE_STRONG),
    }
  },
  {
    id: 'kodachrome',
    name: 'Kodachrome',
    adjustments: {
      contrast: 20,
      saturation: 20,
      temperature: 15,
      shadows: -15,
      highlights: -10,
      grain: 15,
      sharpen: 20,
      toneCurve: curve(
        S_CURVE,
        [P(0, 0), P(64, 55), P(192, 205), P(255, 250)],  // Red: warm push
        undefined,
        [P(0, 5), P(128, 118), P(255, 245)],  // Blue: slightly suppressed
      ),
      hsl: hsl({
        red:     { saturation: 15, luminance: 3 },
        orange:  { saturation: 20, luminance: 5 },
        yellow:  { saturation: 15 },
        green:   { saturation: 10, luminance: -5 },
        blue:    { saturation: 15, luminance: -8 },
      }),
    }
  },
  {
    id: 'ethereal',
    name: 'Ethereal',
    adjustments: {
      contrast: -20,
      brightness: 12,
      saturation: -10,
      highlights: 30,
      shadows: 40,
      temperature: -8,
      denoise: 30,
      blur: 5,
      toneCurve: curve([P(0, 25), P(64, 85), P(192, 215), P(255, 248)]),
      hsl: hsl({
        blue:    { saturation: 15, luminance: 10 },
        purple:  { saturation: 10, luminance: 8 },
        aqua:    { saturation: 10 },
      }),
    }
  },
  {
    id: 'polaroid',
    name: 'Polaroid',
    adjustments: {
      contrast: -10,
      saturation: -15,
      temperature: 15,
      brightness: 8,
      vignette: -20,
      grain: 20,
      toneCurve: curve(
        LIFTED_BLACKS,
        [P(0, 15), P(128, 138), P(255, 248)],  // Red: warm lift
        undefined,
        [P(0, 10), P(128, 120), P(255, 240)],  // Blue: slightly faded
      ),
      hsl: hsl({
        orange:  { saturation: 10, luminance: 5 },
        yellow:  { hue: -5, saturation: -10 },
        green:   { saturation: -20 },
      }),
    }
  },
];

/**
 * Get a filter preset by ID
 */
export function getFilterPreset(id: string): FilterPreset | undefined {
  return FILTER_PRESETS.find(preset => preset.id === id);
}

/**
 * Apply a filter preset to adjustments
 */
export function applyFilterPreset(
  preset: FilterPreset,
  baseAdjustments: AdjustmentsState = createDefaultAdjustments()
): AdjustmentsState {
  // Start with base adjustments or defaults
  const result = { ...baseAdjustments };

  // Apply preset values
  Object.entries(preset.adjustments).forEach(([key, value]) => {
    if (value !== undefined) {
      (result as any)[key] = value;
    }
  });

  return result;
}

/**
 * Check if current adjustments match a filter preset.
 * Only compares scalar adjustment values (not toneCurve/hsl which are objects).
 */
export function matchesFilterPreset(
  adjustments: AdjustmentsState,
  preset: FilterPreset
): boolean {
  const presetAdjustments = applyFilterPreset(preset);

  // Compare only scalar values (skip object fields like toneCurve, hsl)
  const scalarKeys = Object.keys(presetAdjustments).filter(key => {
    const val = (presetAdjustments as any)[key];
    return typeof val === 'number';
  });

  return scalarKeys.every(key => {
    return (adjustments as any)[key] === (presetAdjustments as any)[key];
  });
}
