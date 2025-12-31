import type { HistorySnapshot, EditorHistory } from '../types';

// Maximum number of history states to keep
export const MAX_HISTORY_SIZE = 50;

export function createEmptyHistory(): EditorHistory {
  return {
    past: [],
    present: null,
    future: []
  };
}

export function createSnapshot(
  cropArea: any,
  transform: any,
  adjustments: any,
  viewport: any,
  blurAreas: any[] = [],
  stampAreas: any[] = [],
  annotations: any[] = []
): HistorySnapshot {
  return {
    cropArea: cropArea ? { ...cropArea } : null,
    transform: { ...transform },
    adjustments: { ...adjustments },
    viewport: { ...viewport },
    blurAreas: blurAreas.map(area => ({ ...area })),
    stampAreas: stampAreas.map(area => ({ ...area })),
    annotations: annotations.map(annotation => ({
      ...annotation,
      points: annotation.points.map((p: any) => ({ ...p }))
    }))
  };
}

export function addToHistory(
  history: EditorHistory,
  snapshot: HistorySnapshot
): EditorHistory {
  const newPast = history.present
    ? [...history.past, history.present]
    : history.past;

  // Limit history size
  const limitedPast = newPast.slice(-MAX_HISTORY_SIZE);

  return {
    past: limitedPast,
    present: snapshot,
    future: [] // Clear future when adding new state
  };
}

export function undo(history: EditorHistory): {
  history: EditorHistory;
  snapshot: HistorySnapshot | null;
} {
  if (history.past.length === 0 || !history.present) {
    return { history, snapshot: null };
  }

  const previous = history.past[history.past.length - 1];
  const newPast = history.past.slice(0, -1);

  return {
    history: {
      past: newPast,
      present: previous,
      future: [history.present, ...history.future]
    },
    snapshot: previous
  };
}

export function redo(history: EditorHistory): {
  history: EditorHistory;
  snapshot: HistorySnapshot | null;
} {
  if (history.future.length === 0 || !history.present) {
    return { history, snapshot: null };
  }

  const next = history.future[0];
  const newFuture = history.future.slice(1);

  return {
    history: {
      past: [...history.past, history.present],
      present: next,
      future: newFuture
    },
    snapshot: next
  };
}

export function canUndo(history: EditorHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: EditorHistory): boolean {
  return history.future.length > 0;
}
