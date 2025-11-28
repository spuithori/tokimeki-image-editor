// Main component
export { default as ImageEditor } from './components/ImageEditor.svelte';

// Types
export type {
  EditorMode,
  ImageData,
  CropArea,
  TransformState,
  ExportOptions,
  EditorState
} from './types';

// Utils
export * from './utils/canvas';