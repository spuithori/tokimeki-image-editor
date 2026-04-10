import { describe, it, expect } from 'vitest';
import {
  createEmptyHistory,
  createSnapshot,
  addToHistory,
  undo,
  redo,
  canUndo,
  canRedo,
  MAX_HISTORY_SIZE,
} from '../history';
import { createDefaultAdjustments } from '../adjustments';
import type { TransformState, Viewport, CropArea } from '../../types';

function makeTransform(): TransformState {
  return { rotation: 0, flipHorizontal: false, flipVertical: false, scale: 1 };
}

function makeViewport(): Viewport {
  return { zoom: 1, offsetX: 0, offsetY: 0, scale: 1 };
}

function makeSnapshot(overrides: Partial<{ rotation: number }> = {}) {
  const t = makeTransform();
  if (overrides.rotation !== undefined) t.rotation = overrides.rotation;
  return createSnapshot(null, t, createDefaultAdjustments(), makeViewport());
}

describe('history', () => {
  it('createEmptyHistory returns empty state', () => {
    const h = createEmptyHistory();
    expect(h.past).toEqual([]);
    expect(h.present).toBeNull();
    expect(h.future).toEqual([]);
  });

  it('addToHistory sets present and clears future', () => {
    let h = createEmptyHistory();
    const s1 = makeSnapshot();
    h = addToHistory(h, s1);
    expect(h.present).toEqual(s1);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);

    const s2 = makeSnapshot({ rotation: 90 });
    h = addToHistory(h, s2);
    expect(h.present).toEqual(s2);
    expect(h.past).toHaveLength(1);
  });

  it('undo restores previous state and pushes to future', () => {
    let h = createEmptyHistory();
    const s1 = makeSnapshot();
    const s2 = makeSnapshot({ rotation: 90 });
    h = addToHistory(h, s1);
    h = addToHistory(h, s2);

    const result = undo(h);
    expect(result.snapshot).toBeTruthy();
    expect(result.snapshot!.transform.rotation).toBe(0);
    expect(result.history.future).toHaveLength(1);
    expect(result.history.future[0].transform.rotation).toBe(90);
  });

  it('undo on empty past returns null snapshot', () => {
    let h = createEmptyHistory();
    h = addToHistory(h, makeSnapshot());
    const result = undo(h);
    expect(result.snapshot).toBeNull();
  });

  it('redo restores future state', () => {
    let h = createEmptyHistory();
    const s1 = makeSnapshot();
    const s2 = makeSnapshot({ rotation: 90 });
    h = addToHistory(h, s1);
    h = addToHistory(h, s2);

    const undoResult = undo(h);
    const redoResult = redo(undoResult.history);
    expect(redoResult.snapshot).toBeTruthy();
    expect(redoResult.snapshot!.transform.rotation).toBe(90);
  });

  it('redo on empty future returns null snapshot', () => {
    let h = createEmptyHistory();
    h = addToHistory(h, makeSnapshot());
    const result = redo(h);
    expect(result.snapshot).toBeNull();
  });

  it('canUndo / canRedo reflect state', () => {
    let h = createEmptyHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);

    h = addToHistory(h, makeSnapshot());
    h = addToHistory(h, makeSnapshot({ rotation: 90 }));
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);

    const { history: h2 } = undo(h);
    expect(canUndo(h2)).toBe(false);
    expect(canRedo(h2)).toBe(true);
  });

  it('respects MAX_HISTORY_SIZE', () => {
    let h = createEmptyHistory();
    for (let i = 0; i <= MAX_HISTORY_SIZE + 10; i++) {
      h = addToHistory(h, makeSnapshot({ rotation: i * 90 }));
    }
    expect(h.past.length).toBeLessThanOrEqual(MAX_HISTORY_SIZE);
  });

  it('createSnapshot deep-copies adjustments including toneCurve and hsl', () => {
    const adj = createDefaultAdjustments();
    adj.toneCurve.rgb.push({ x: 128, y: 200 });
    adj.hsl.red.hue = 30;

    const snap = createSnapshot(null, makeTransform(), adj, makeViewport());

    // Mutate original — snapshot should be unaffected
    adj.toneCurve.rgb[2].y = 100;
    adj.hsl.red.hue = 60;

    expect(snap.adjustments.toneCurve.rgb[2].y).toBe(200);
    expect(snap.adjustments.hsl.red.hue).toBe(30);
  });
});
