export const IOS_MAX_CANVAS_AREA = 16_777_216;

export function isIOSLike(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  platform: string = typeof navigator !== 'undefined' ? navigator.platform : '',
  maxTouchPoints: number = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0
): boolean {
  return /iP(hone|ad|od)/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export interface ExportDimensions {
  width: number;
  height: number;
  renderScale: number;
}

export function computeExportDimensions(
  width: number,
  height: number,
  limits: { maxDimension?: number; maxArea?: number } = {}
): ExportDimensions {
  const { maxDimension = Infinity, maxArea = Infinity } = limits;
  const s = Math.min(
    1,
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxArea / (width * height))
  );
  if (!(s > 0) || s >= 1) {
    return { width, height, renderScale: 1 };
  }
  const w = Math.max(1, Math.floor(width * s));
  const h = Math.max(1, Math.floor(height * s));
  return { width: w, height: h, renderScale: Math.max(w / width, h / height) };
}

export function alignedBytesPerRow(width: number): number {
  return Math.ceil((width * 4) / 256) * 256;
}

export function unpadRows(
  padded: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number
): Uint8ClampedArray {
  const rowBytes = width * 4;
  const out = new Uint8ClampedArray(rowBytes * height);
  for (let y = 0; y < height; y++) {
    out.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes), y * rowBytes);
  }
  return out;
}
