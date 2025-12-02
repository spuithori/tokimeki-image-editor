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
