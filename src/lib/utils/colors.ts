export const DEFAULT_COLOR_PRESETS = [
  '#FF6B6B',
  '#FFA94D',
  '#FFD93D',
  '#6BCB77',
  '#4D96FF',
  '#9B72F2',
  '#F8F9FA',
  '#495057'
] as const;

export const DEFAULT_DRAWING_COLOR = '#FF6B6B';

export type ColorPreset = typeof DEFAULT_COLOR_PRESETS[number];

// Stroke width presets for drawing tools
export const STROKE_WIDTH_PRESETS = [
  { label: 'S', value: 4 },
  { label: 'M', value: 8 },
  { label: 'L', value: 16 }
] as const;

export const DEFAULT_STROKE_WIDTH = 8;

export type StrokeWidthPreset = typeof STROKE_WIDTH_PRESETS[number];
