/**
 * Lightweight haptic feedback wrapper.
 * Falls back silently when navigator.vibrate is unavailable.
 *
 * Patterns are intentionally tiny so they feel like a tap, not a buzz.
 */

const HAPTIC_PATTERNS = {
  selection: 8,
  light: 12,
  medium: 18,
  heavy: 28,
  success: [10, 30, 20],
  warning: [20, 40],
  error: [40, 60, 40],
  toggleOn: [6, 8, 14],
  toggleOff: 14,
  swipeStart: 6,
  swipeEnd: 10,
  longPress: 22,
} as const;

export type HapticKind = keyof typeof HAPTIC_PATTERNS;

let lastPlayed = 0;
const COOLDOWN_MS = 28;
let enabled = true;

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export function haptic(kind: HapticKind = 'selection'): void {
  if (!enabled) return;
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;

  const now = performance.now();
  if (now - lastPlayed < COOLDOWN_MS) return;
  lastPlayed = now;

  try {
    navigator.vibrate(HAPTIC_PATTERNS[kind] as number | number[]);
  } catch {
    /* noop */
  }
}
