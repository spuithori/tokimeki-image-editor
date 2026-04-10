export type EditorMode = 'crop' | 'rotate' | 'adjust' | 'filter' | 'blur' | 'stamp' | 'annotate' | 'export' | null;

// ── Tone Curve ──────────────────────────────────────────
export interface ToneCurvePoint {
  x: number; // 0-255 input
  y: number; // 0-255 output
}

export interface ToneCurve {
  rgb: ToneCurvePoint[];
  red: ToneCurvePoint[];
  green: ToneCurvePoint[];
  blue: ToneCurvePoint[];
}

// ── HSL Per-Color Adjustment ────────────────────────────
export interface HSLRange {
  hue: number;        // -180 to +180
  saturation: number; // -100 to +100
  luminance: number;  // -100 to +100
}

export type HSLColorName = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';

export interface HSLAdjustment {
  red: HSLRange;
  orange: HSLRange;
  yellow: HSLRange;
  green: HSLRange;
  aqua: HSLRange;
  blue: HSLRange;
  purple: HSLRange;
  magenta: HSLRange;
}

export type Theme = 'dark' | 'light' | 'system';

export interface ImageData {
  original: HTMLImageElement | null;
  current: HTMLImageElement | null;
  width: number;
  height: number;
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlurArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blurStrength: number; // 0-100
}

export type StampType = 'emoji' | 'image' | 'svg';

export interface StampAsset {
  id: string;
  type: StampType;
  content: string; // emoji character, image URL, or SVG URL
  preview?: string; // for display in palette
}

export interface StampArea {
  id: string;
  x: number; // center x in image coordinates
  y: number; // center y in image coordinates
  width: number; // width in image coordinates
  height: number; // height in image coordinates (maintains aspect ratio)
  rotation: number; // in degrees
  stampAssetId: string; // reference to StampAsset
  stampType: StampType;
  stampContent: string;
}

export type AnnotationType = 'pen' | 'brush' | 'arrow' | 'rectangle' | 'text' | 'fill' | 'eraser-stroke';

export interface AnnotationPoint {
  x: number; // image coordinates
  y: number; // image coordinates
  width?: number; // for brush: width at this point (based on speed)
  pressure?: number; // for pressure-sensitive input
}

export interface Annotation {
  id: string;
  type: AnnotationType;
  color: string;
  strokeWidth: number; // in image coordinates (base width for brush)
  points: AnnotationPoint[]; // For pen/brush: all points, for arrow/rectangle: [start, end], for text: [position]
  shadow: boolean; // Enable drop shadow
  // Text-specific properties
  text?: string; // Text content for text annotations
  fontSize?: number; // Font size in image coordinates
  // Fill-specific properties
  fillMask?: ImageData; // Mask data for flood fill
  fillOrigin?: { x: number; y: number }; // Original click point for fill
}

export interface TransformState {
  rotation: number; // in degrees: 0, 90, 180, 270
  flipHorizontal: boolean;
  flipVertical: boolean;
  scale: number;
}

export interface AdjustmentsState {
  exposure: number;     // -100 to +100
  contrast: number;     // -100 to +100
  highlights: number;   // -100 to +100
  shadows: number;      // -100 to +100
  brightness: number;   // -100 to +100
  saturation: number;   // -100 to +100
  temperature: number;  // -100 to +100 (negative = cool/blue, positive = warm/red)
  vignette: number;     // -100 to +100 (negative = darken edges, positive = brighten edges)
  sepia: number;        // 0 to 100 (CSS filter sepia)
  grayscale: number;    // 0 to 100 (CSS filter grayscale)
  blur: number;         // 0 to 100 (Gaussian blur applied to entire image)
  grain: number;        // 0 to 100 (film grain effect)
  sharpen: number;      // 0 to 100 (unsharp mask)
  denoise: number;      // 0 to 100 (bilateral filter)
  toneCurve: ToneCurve;
  hsl: HSLAdjustment;
}

export interface FilterPreset {
  id: string;
  name: string;
  adjustments: Partial<AdjustmentsState>;
}

export interface ExportOptions {
  format: 'png' | 'jpeg';
  quality: number; // 0-1 for jpeg
}

export interface Viewport {
  zoom: number;
  offsetX: number;
  offsetY: number;
  scale: number; // Scale to fit image in canvas
}

export interface HistorySnapshot {
  cropArea: CropArea | null;
  transform: TransformState;
  adjustments: AdjustmentsState;
  viewport: Viewport;
  blurAreas: BlurArea[];
  stampAreas: StampArea[];
  annotations: Annotation[];
}

export interface EditorHistory {
  past: HistorySnapshot[];
  present: HistorySnapshot | null;
  future: HistorySnapshot[];
}

export interface EditorState {
  mode: EditorMode;
  imageData: ImageData;
  cropArea: CropArea | null;
  transform: TransformState;
  adjustments: AdjustmentsState;
  exportOptions: ExportOptions;
  viewport: Viewport;
  history: EditorHistory;
  blurAreas: BlurArea[];
  stampAreas: StampArea[];
  annotations: Annotation[];
}
