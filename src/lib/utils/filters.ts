import type { FilterPreset, AdjustmentsState } from '../types';
import { createDefaultAdjustments } from './adjustments';

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
      hue: -10,
    }
  },
  {
    id: 'cool',
    name: 'Cool',
    adjustments: {
      saturation: 10,
      brightness: -5,
      contrast: 10,
      hue: 15,
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
  }
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
 * Check if current adjustments match a filter preset
 */
export function matchesFilterPreset(
  adjustments: AdjustmentsState,
  preset: FilterPreset
): boolean {
  const presetAdjustments = applyFilterPreset(preset);

  // Compare all adjustment values
  return Object.keys(presetAdjustments).every(key => {
    return (adjustments as any)[key] === (presetAdjustments as any)[key];
  });
}
