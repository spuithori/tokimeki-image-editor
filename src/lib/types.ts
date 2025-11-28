export type EditorMode = 'crop' | 'rotate' | 'export' | null;

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

export interface TransformState {
  rotation: number; // in degrees: 0, 90, 180, 270
  flipHorizontal: boolean;
  flipVertical: boolean;
  scale: number;
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
  viewport: Viewport;
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
  exportOptions: ExportOptions;
  viewport: Viewport;
  history: EditorHistory;
}
