import { describe, it, expect } from 'vitest';
import {
  createEditorState,
  createDefaultTransform,
  createDefaultExportOptions,
  setMode,
  applyTransformUpdate,
  applyAdjustmentsUpdate,
  setBlurAreas,
  setAnnotations,
  setViewport,
  saveToHistory,
  handleUndo,
  handleRedo,
  canUndo,
  canRedo,
  getKeyboardAction,
} from '../editor-core';

describe('createEditorState', () => {
  it('returns valid initial state', () => {
    const state = createEditorState();
    expect(state.mode).toBeNull();
    expect(state.imageData.original).toBeNull();
    expect(state.adjustments.exposure).toBe(0);
    expect(state.adjustments.sharpen).toBe(0);
    expect(state.adjustments.denoise).toBe(0);
    expect(state.adjustments.toneCurve).toBeTruthy();
    expect(state.adjustments.hsl).toBeTruthy();
    expect(state.blurAreas).toEqual([]);
    expect(state.annotations).toEqual([]);
  });
});

describe('setMode', () => {
  it('changes mode', () => {
    const state = createEditorState();
    const updated = setMode(state, 'crop');
    expect(updated.mode).toBe('crop');
  });
});

describe('applyTransformUpdate', () => {
  it('merges transform changes', () => {
    const state = createEditorState();
    const updated = applyTransformUpdate(state, { rotation: 90 });
    expect(updated.transform.rotation).toBe(90);
    expect(updated.transform.flipHorizontal).toBe(false);
  });
});

describe('applyAdjustmentsUpdate', () => {
  it('merges adjustment changes', () => {
    const state = createEditorState();
    const updated = applyAdjustmentsUpdate(state, { exposure: 50, sharpen: 30 });
    expect(updated.adjustments.exposure).toBe(50);
    expect(updated.adjustments.sharpen).toBe(30);
    expect(updated.adjustments.contrast).toBe(0);
  });
});

describe('history integration', () => {
  it('undo/redo cycle works', () => {
    let state = createEditorState();
    state = saveToHistory(state);
    state = applyAdjustmentsUpdate(state, { exposure: 50 });
    state = saveToHistory(state);

    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(false);

    state = handleUndo(state);
    expect(state.adjustments.exposure).toBe(0);
    expect(canRedo(state)).toBe(true);

    state = handleRedo(state);
    expect(state.adjustments.exposure).toBe(50);
  });
});

// getKeyboardAction tests require DOM (KeyboardEvent) — skipped in node environment
describe.skipIf(typeof globalThis.KeyboardEvent === 'undefined')('getKeyboardAction', () => {
  it('recognizes Ctrl+Z as undo', () => {
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
    const action = getKeyboardAction(event);
    expect(action.type).toBe('undo');
  });

  it('recognizes Ctrl+Shift+Z as redo', () => {
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true });
    const action = getKeyboardAction(event);
    expect(action.type).toBe('redo');
  });

  it('recognizes Ctrl+Y as redo', () => {
    const event = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true });
    const action = getKeyboardAction(event);
    expect(action.type).toBe('redo');
  });

  it('returns none for regular keys', () => {
    const event = new KeyboardEvent('keydown', { key: 'a' });
    const action = getKeyboardAction(event);
    expect(action.type).toBe('none');
  });
});
