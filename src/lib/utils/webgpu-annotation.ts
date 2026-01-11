/**
 * WebGPU Annotation Renderer
 *
 * High-performance annotation rendering using WebGPU for compositing.
 *
 * Architecture:
 * - Individual strokes are rendered to offscreen Canvas 2D (preserves quality)
 * - Stroke canvases are uploaded as GPU textures (cached)
 * - WebGPU composites all textures with proper alpha blending
 * - Eraser strokes use destination-out blend mode in shader
 *
 * Performance benefits:
 * - GPU-accelerated compositing of thousands of strokes
 * - Texture caching avoids re-uploading unchanged strokes
 * - Viewport transforms done on GPU (no CPU coordinate recalculation)
 */

import type { Annotation, Viewport, CropArea, AnnotationPoint } from '../types';
import { ANNOTATION_BLEND_SHADER, ANNOTATION_COPY_SHADER } from '../shaders/annotation';
import { getOrCreateFillCanvas } from './canvas';

// WebGPU state
let device: GPUDevice | null = null;
let blendPipeline: GPURenderPipeline | null = null;
let copyPipeline: GPURenderPipeline | null = null;
let sampler: GPUSampler | null = null;
let blendUniformBuffer: GPUBuffer | null = null;

// Texture cache: annotation id -> GPU texture
const textureCache = new Map<string, {
  texture: GPUTexture;
  version: number; // Track if annotation changed
}>();

// Intermediate textures for ping-pong rendering
let intermediateTexture1: GPUTexture | null = null;
let intermediateTexture2: GPUTexture | null = null;
let currentTextureSize = { width: 0, height: 0 };

// ============================================================================
// IMAGE-SPACE CACHE
// Annotations are cached in image coordinates (not canvas coordinates).
// This allows viewport changes (pan/zoom) without re-rendering all annotations.
// ============================================================================

interface ImageSpaceCache {
  canvas: HTMLCanvasElement | null;
  annotationHash: string;  // Hash of committed annotations (excludes viewport)
  annotationCount: number;
  imageWidth: number;
  imageHeight: number;
  hasCrop: boolean;
  cropKey: string;
}

let imageSpaceCache: ImageSpaceCache = {
  canvas: null,
  annotationHash: '',
  annotationCount: 0,
  imageWidth: 0,
  imageHeight: 0,
  hasCrop: false,
  cropKey: ''
};

// Persistent output canvas - NEVER recreate, just reuse
let persistentOutputCanvas: HTMLCanvasElement | null = null;
let persistentOutputSize = { width: 0, height: 0 };

// Last rendered viewport - for detecting viewport-only changes
let lastRenderedViewport: { scale: number; zoom: number; offsetX: number; offsetY: number } | null = null;
let lastRenderedAnnotationHash: string = '';

// CSS transform tracking - for re-render after viewport settles
let cssTransformApplied = false;
let viewportSettleTimeoutId: ReturnType<typeof setTimeout> | null = null;
const VIEWPORT_SETTLE_DELAY_MS = 150; // Re-render after viewport stops changing

// Hash caching - avoid O(n) hash computation on every frame
let cachedAnnotationsRef: Annotation[] | null = null;
let cachedAnnotationsHash: string = '';
let cachedAnnotationsLength: number = 0;

/**
 * Get or create persistent output canvas
 */
function getPersistentOutputCanvas(width: number, height: number): HTMLCanvasElement {
  if (!persistentOutputCanvas || persistentOutputSize.width !== width || persistentOutputSize.height !== height) {
    persistentOutputCanvas = document.createElement('canvas');
    persistentOutputCanvas.width = width;
    persistentOutputCanvas.height = height;
    persistentOutputSize = { width, height };
  }
  return persistentOutputCanvas;
}

/**
 * Generate hash for annotations (viewport-independent)
 * Uses caching to avoid O(n) computation on every frame
 */
function hashAnnotationsForCache(annotations: Annotation[]): string {
  // Quick reference and length check - if both match, hash is likely the same
  if (annotations === cachedAnnotationsRef && annotations.length === cachedAnnotationsLength) {
    return cachedAnnotationsHash;
  }

  // Need to recompute hash
  const hash = annotations.map(a => `${a.id}:${a.type}:${a.points.length}`).join('|');

  // Update cache
  cachedAnnotationsRef = annotations;
  cachedAnnotationsHash = hash;
  cachedAnnotationsLength = annotations.length;

  return hash;
}

/**
 * Check if image-space cache needs rebuild
 */
function needsImageSpaceCacheRebuild(
  annotations: Annotation[],
  imageWidth: number,
  imageHeight: number,
  cropArea: CropArea | null | undefined
): boolean {
  if (!imageSpaceCache.canvas) return true;
  if (imageSpaceCache.imageWidth !== imageWidth) return true;
  if (imageSpaceCache.imageHeight !== imageHeight) return true;

  const cropKey = cropArea ? `${cropArea.x}:${cropArea.y}:${cropArea.width}:${cropArea.height}` : '';
  if (imageSpaceCache.cropKey !== cropKey) return true;

  const hash = hashAnnotationsForCache(annotations);
  if (imageSpaceCache.annotationHash !== hash) return true;

  return false;
}

/**
 * Render all committed annotations to image-space canvas
 * Annotations are rendered in IMAGE coordinates (not canvas coordinates)
 */
function renderAnnotationsToImageSpace(
  annotations: Annotation[],
  imageWidth: number,
  imageHeight: number,
  cropArea: CropArea | null | undefined
): HTMLCanvasElement {
  // Create canvas at image dimensions
  const canvas = document.createElement('canvas');
  canvas.width = imageWidth;
  canvas.height = imageHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Crop offset - annotations are stored in original image coordinates
  // but we need to render them relative to the crop area
  const cropOffsetX = cropArea ? cropArea.x : 0;
  const cropOffsetY = cropArea ? cropArea.y : 0;

  // In image space, scale is 1:1 but need to offset for crop
  const toImageCoords = (point: AnnotationPoint) => ({
    x: point.x - cropOffsetX,
    y: point.y - cropOffsetY
  });

  // Origin for fill canvas - need to offset for crop
  const originX = -cropOffsetX;
  const originY = -cropOffsetY;
  const totalScale = 1; // No scaling in image space

  // Render fills first (at bottom layer)
  for (const annotation of annotations) {
    if (annotation.type === 'fill') {
      renderAnnotationToImageSpaceContext(ctx, annotation, toImageCoords, totalScale, originX, originY);
    }
  }

  // Then render all non-fill annotations in original order
  for (const annotation of annotations) {
    if (annotation.type !== 'fill') {
      renderAnnotationToImageSpaceContext(ctx, annotation, toImageCoords, totalScale, originX, originY);
    }
  }

  return canvas;
}

/**
 * Render a single annotation to image-space context
 */
function renderAnnotationToImageSpaceContext(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toImageCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number,
  originX: number,
  originY: number
): void {
  if (annotation.points.length === 0 && annotation.type !== 'fill') return;

  ctx.save();

  // Apply shadow if enabled
  if (annotation.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }

  if (annotation.type === 'fill') {
    const fillCanvas = getOrCreateFillCanvas(annotation);
    if (fillCanvas) {
      // In image space, draw fill at origin with no scaling
      ctx.drawImage(fillCanvas, 0, 0);
    }
  } else if (annotation.type === 'eraser-stroke') {
    renderEraserStrokeImageSpace(ctx, annotation, toImageCoords, totalScale);
  } else if (annotation.type === 'pen') {
    renderPenStrokeImageSpace(ctx, annotation, toImageCoords, totalScale);
  } else if (annotation.type === 'brush') {
    renderBrushStrokeImageSpace(ctx, annotation, toImageCoords, totalScale);
  } else if (annotation.type === 'arrow') {
    renderArrowImageSpace(ctx, annotation, toImageCoords, totalScale);
  } else if (annotation.type === 'rectangle') {
    renderRectangleImageSpace(ctx, annotation, toImageCoords, totalScale);
  } else if (annotation.type === 'text' && annotation.text) {
    const point = toImageCoords(annotation.points[0]);
    const fontSize = annotation.fontSize ?? 48;
    ctx.fillStyle = annotation.color;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(annotation.text, point.x, point.y);
  }

  ctx.restore();
}

// Image-space rendering functions (no viewport transform)
function renderPenStrokeImageSpace(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toImageCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length === 0) return;

  const points = annotation.points.map(toImageCoords);
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = annotation.strokeWidth * totalScale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, annotation.strokeWidth * totalScale / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
  }
}

function renderBrushStrokeImageSpace(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toImageCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length === 0) return;

  const rawPoints = annotation.points.map(p => ({
    ...toImageCoords(p),
    width: p.width ?? annotation.strokeWidth
  }));

  ctx.fillStyle = annotation.color;

  if (rawPoints.length === 1) {
    const p = rawPoints[0];
    const width = (p.width * totalScale) / 2;
    const rx = width * 0.8;
    const ry = width * 1.2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (rawPoints.length === 2) {
    const p1 = rawPoints[0];
    const p2 = rawPoints[1];
    const w1 = ((p1.width ?? annotation.strokeWidth * 0.3) * totalScale) / 2;
    const w2 = ((p2.width ?? annotation.strokeWidth * 0.5) * totalScale) / 2;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      const nx = -dy / len;
      const ny = dx / len;
      const tipExtend = w2 * 0.3;
      const tipX = p2.x + (dx / len) * tipExtend;
      const tipY = p2.y + (dy / len) * tipExtend;

      ctx.beginPath();
      ctx.moveTo(p1.x + nx * w1, p1.y + ny * w1);
      ctx.quadraticCurveTo(
        (p1.x + nx * w1 + p2.x + nx * w2) / 2 + nx * w2 * 0.3,
        (p1.y + ny * w1 + p2.y + ny * w2) / 2 + ny * w2 * 0.3,
        p2.x + nx * w2, p2.y + ny * w2
      );
      ctx.quadraticCurveTo(tipX + nx * w2 * 0.2, tipY + ny * w2 * 0.2, tipX, tipY);
      ctx.quadraticCurveTo(tipX - nx * w2 * 0.2, tipY - ny * w2 * 0.2, p2.x - nx * w2, p2.y - ny * w2);
      ctx.quadraticCurveTo(
        (p1.x - nx * w1 + p2.x - nx * w2) / 2 - nx * w2 * 0.3,
        (p1.y - ny * w1 + p2.y - ny * w2) / 2 - ny * w2 * 0.3,
        p1.x - nx * w1, p1.y - ny * w1
      );
      ctx.closePath();
      ctx.fill();
    }
  } else {
    const interpolated = interpolateBrushPoints(rawPoints);
    const { leftSide, rightSide } = generateBrushOutline(interpolated, totalScale);
    if (leftSide.length >= 2) {
      renderBrushPath(ctx, leftSide, rightSide, interpolated, totalScale);
    }
  }
}

function renderEraserStrokeImageSpace(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toImageCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  const points = annotation.points.map(toImageCoords);
  ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.lineWidth = annotation.strokeWidth * totalScale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, annotation.strokeWidth * totalScale / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
  }

  ctx.restore();
}

function renderArrowImageSpace(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toImageCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length < 2) return;

  const start = toImageCoords(annotation.points[0]);
  const end = toImageCoords(annotation.points[1]);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const scaledStroke = annotation.strokeWidth * totalScale;
  const headLength = scaledStroke * 3;
  const headWidth = scaledStroke * 2;
  const lineEndX = end.x - headLength * 0.7 * Math.cos(angle);
  const lineEndY = end.y - headLength * 0.7 * Math.sin(angle);

  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = scaledStroke;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(lineEndX, lineEndY);
  ctx.stroke();

  ctx.fillStyle = annotation.color;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - headLength * Math.cos(angle) + headWidth * Math.sin(angle),
             end.y - headLength * Math.sin(angle) - headWidth * Math.cos(angle));
  ctx.lineTo(end.x - headLength * Math.cos(angle) - headWidth * Math.sin(angle),
             end.y - headLength * Math.sin(angle) + headWidth * Math.cos(angle));
  ctx.closePath();
  ctx.fill();
}

function renderRectangleImageSpace(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toImageCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length < 2) return;

  const p0 = toImageCoords(annotation.points[0]);
  const p1 = toImageCoords(annotation.points[1]);
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);
  const cornerRadius = annotation.strokeWidth * totalScale * 1.5;

  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = annotation.strokeWidth * totalScale;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cornerRadius);
  ctx.stroke();
}

/**
 * Clear image-space cache
 */
export function clearImageSpaceCache(): void {
  // Clear hash cache
  cachedAnnotationsRef = null;
  cachedAnnotationsHash = '';
  cachedAnnotationsLength = 0;

  imageSpaceCache = {
    canvas: null,
    annotationHash: '',
    annotationCount: 0,
    imageWidth: 0,
    imageHeight: 0,
    hasCrop: false,
    cropKey: ''
  };
  lastRenderedViewport = null;
  lastRenderedAnnotationHash = '';
}

/**
 * Check if we can skip rendering (viewport-only change with no current stroke)
 * Returns true if rendering can be skipped and CSS transform should be used instead
 */
export function canSkipRenderForViewportChange(
  annotations: Annotation[],
  currentStroke: Annotation | null,
  viewport: Viewport
): boolean {
  // Can't skip if there's a current stroke being drawn
  if (currentStroke && currentStroke.points.length > 0) {
    return false;
  }

  // Can't skip if cache is not ready
  if (!imageSpaceCache.canvas) {
    return false;
  }

  // Check if annotations changed
  const currentHash = hashAnnotationsForCache(annotations);
  if (currentHash !== lastRenderedAnnotationHash) {
    return false;
  }

  // Annotations haven't changed, viewport change can be handled by CSS transform
  return true;
}

/**
 * Get CSS transform for viewport change (used when skipping render)
 * Returns the transform to apply to the annotation canvas element
 */
export function getViewportTransformCSS(
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number
): { transform: string; transformOrigin: string } | null {
  if (!lastRenderedViewport) {
    return null;
  }

  // Calculate the difference from the last rendered viewport
  const lastScale = lastRenderedViewport.scale * lastRenderedViewport.zoom;
  const currentScale = viewport.scale * viewport.zoom;

  // Scale ratio
  const scaleRatio = currentScale / lastScale;

  // Offset difference (in canvas pixels)
  const offsetDiffX = viewport.offsetX - lastRenderedViewport.offsetX;
  const offsetDiffY = viewport.offsetY - lastRenderedViewport.offsetY;

  // Transform origin should be center of canvas
  const originX = canvasWidth / 2;
  const originY = canvasHeight / 2;

  return {
    transform: `translate(${offsetDiffX}px, ${offsetDiffY}px) scale(${scaleRatio})`,
    transformOrigin: `${originX}px ${originY}px`
  };
}

/**
 * Reset CSS transform (call after re-rendering)
 */
export function resetViewportTransform(element: HTMLCanvasElement): void {
  element.style.transform = '';
  element.style.transformOrigin = '';
  cssTransformApplied = false;

  // Clear any pending settle timeout
  if (viewportSettleTimeoutId !== null) {
    clearTimeout(viewportSettleTimeoutId);
    viewportSettleTimeoutId = null;
  }
}

/**
 * Check if CSS transform is currently applied
 */
export function isCSSTransformApplied(): boolean {
  return cssTransformApplied;
}

/**
 * Mark that CSS transform has been applied and schedule a re-render when viewport settles
 * Returns a callback that should be called to trigger re-render
 */
export function markCSSTransformApplied(onSettle: () => void): void {
  cssTransformApplied = true;

  // Clear any existing timeout
  if (viewportSettleTimeoutId !== null) {
    clearTimeout(viewportSettleTimeoutId);
  }

  // Schedule re-render after viewport settles
  viewportSettleTimeoutId = setTimeout(() => {
    viewportSettleTimeoutId = null;
    if (cssTransformApplied) {
      // Viewport has settled, trigger re-render
      onSettle();
    }
  }, VIEWPORT_SETTLE_DELAY_MS);
}

/**
 * Render directly to target canvas (no intermediate canvas creation)
 * This is the high-performance render path
 */
export function renderAnnotationsDirect(
  targetCanvas: HTMLCanvasElement,
  annotations: Annotation[],
  currentStroke: Annotation | null,
  image: HTMLImageElement,
  viewport: Viewport,
  cropArea: CropArea | null | undefined
): void {
  const width = targetCanvas.width;
  const height = targetCanvas.height;
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return;

  // Determine image dimensions for caching
  const imageWidth = cropArea ? cropArea.width : image.width;
  const imageHeight = cropArea ? cropArea.height : image.height;

  // Check if we need to rebuild the image-space cache
  const currentHash = hashAnnotationsForCache(annotations);
  const needsCacheRebuild = needsImageSpaceCacheRebuild(annotations, imageWidth, imageHeight, cropArea);

  if (needsCacheRebuild) {
    // Rebuild cache with all committed annotations in image coordinates
    const cacheCanvas = renderAnnotationsToImageSpace(annotations, imageWidth, imageHeight, cropArea);
    const cropKey = cropArea ? `${cropArea.x}:${cropArea.y}:${cropArea.width}:${cropArea.height}` : '';

    imageSpaceCache = {
      canvas: cacheCanvas,
      annotationHash: currentHash,
      annotationCount: annotations.length,
      imageWidth,
      imageHeight,
      hasCrop: !!cropArea,
      cropKey
    };
  }

  // Clear target canvas
  ctx.clearRect(0, 0, width, height);

  // Calculate viewport transform parameters
  const totalScale = viewport.scale * viewport.zoom;
  const centerX = width / 2;
  const centerY = height / 2;
  const cropOffsetX = cropArea ? cropArea.x : 0;
  const cropOffsetY = cropArea ? cropArea.y : 0;

  // Draw cached image-space annotations with viewport transform applied
  if (imageSpaceCache.canvas) {
    const destX = centerX + viewport.offsetX - (imageWidth / 2) * totalScale;
    const destY = centerY + viewport.offsetY - (imageHeight / 2) * totalScale;
    const destWidth = imageWidth * totalScale;
    const destHeight = imageHeight * totalScale;

    ctx.drawImage(
      imageSpaceCache.canvas,
      destX, destY, destWidth, destHeight
    );
  }

  // Render current stroke in real-time (if any)
  if (currentStroke && currentStroke.points.length > 0) {
    const toCanvasCoords = (point: AnnotationPoint) => ({
      x: (point.x - cropOffsetX - imageWidth / 2) * totalScale + centerX + viewport.offsetX,
      y: (point.y - cropOffsetY - imageHeight / 2) * totalScale + centerY + viewport.offsetY
    });

    const originX = (0 - cropOffsetX - imageWidth / 2) * totalScale + centerX + viewport.offsetX;
    const originY = (0 - cropOffsetY - imageHeight / 2) * totalScale + centerY + viewport.offsetY;

    renderAnnotationDirect(ctx, currentStroke, toCanvasCoords, totalScale, originX, originY);
  }

  // Update last rendered state
  lastRenderedViewport = {
    scale: viewport.scale,
    zoom: viewport.zoom,
    offsetX: viewport.offsetX,
    offsetY: viewport.offsetY
  };
  lastRenderedAnnotationHash = currentHash;

  // Reset any CSS transform
  resetViewportTransform(targetCanvas);
}

/**
 * Initialize WebGPU for annotation rendering
 */
export async function initAnnotationWebGPU(): Promise<boolean> {
  if (device) return true;

  try {
    if (!navigator.gpu) {
      console.warn('WebGPU not supported for annotations');
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.warn('No WebGPU adapter for annotations');
      return false;
    }

    device = await adapter.requestDevice();

    // Create sampler
    sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Create blend pipeline
    const blendShaderModule = device.createShaderModule({ code: ANNOTATION_BLEND_SHADER });
    blendPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: blendShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: blendShaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Create copy pipeline
    const copyShaderModule = device.createShaderModule({ code: ANNOTATION_COPY_SHADER });
    copyPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: copyShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: copyShaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Create blend uniform buffer
    blendUniformBuffer = device.createBuffer({
      size: 16, // 4 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    console.log('WebGPU annotation renderer initialized');
    return true;
  } catch (error) {
    console.error('Failed to initialize WebGPU for annotations:', error);
    return false;
  }
}

/**
 * Check if WebGPU annotation rendering is available
 */
export function isAnnotationWebGPUReady(): boolean {
  return device !== null && blendPipeline !== null;
}

/**
 * Ensure intermediate textures are the right size
 */
function ensureIntermediateTextures(width: number, height: number): void {
  if (!device) return;

  if (currentTextureSize.width === width && currentTextureSize.height === height) {
    return;
  }

  // Destroy old textures
  intermediateTexture1?.destroy();
  intermediateTexture2?.destroy();

  // Create new textures
  const textureDescriptor: GPUTextureDescriptor = {
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  };

  intermediateTexture1 = device.createTexture(textureDescriptor);
  intermediateTexture2 = device.createTexture(textureDescriptor);
  currentTextureSize = { width, height };
}

/**
 * Create a GPU texture from a Canvas 2D element
 */
function createTextureFromCanvas(canvas: HTMLCanvasElement): GPUTexture | null {
  if (!device) return null;

  const texture = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: canvas },
    { texture },
    { width: canvas.width, height: canvas.height }
  );

  return texture;
}

/**
 * Render a single annotation to an offscreen canvas
 */
function renderAnnotationToCanvas(
  annotation: Annotation,
  width: number,
  height: number,
  image: HTMLImageElement,
  viewport: Viewport,
  cropArea: CropArea | null | undefined
): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Calculate transform
  const totalScale = viewport.scale * viewport.zoom;
  const centerX = width / 2;
  const centerY = height / 2;
  const sourceWidth = cropArea ? cropArea.width : image.width;
  const sourceHeight = cropArea ? cropArea.height : image.height;
  const cropOffsetX = cropArea ? cropArea.x : 0;
  const cropOffsetY = cropArea ? cropArea.y : 0;

  const toCanvasCoords = (point: AnnotationPoint) => ({
    x: (point.x - cropOffsetX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX,
    y: (point.y - cropOffsetY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY
  });

  const originX = (0 - cropOffsetX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX;
  const originY = (0 - cropOffsetY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY;

  // Render based on annotation type
  if (annotation.type === 'fill') {
    const fillCanvas = getOrCreateFillCanvas(annotation);
    if (fillCanvas) {
      ctx.drawImage(
        fillCanvas,
        originX,
        originY,
        fillCanvas.width * totalScale,
        fillCanvas.height * totalScale
      );
    }
  } else if (annotation.type === 'eraser-stroke') {
    // For eraser, we draw white with alpha (will be used as mask)
    if (annotation.points.length === 0) return null;

    const points = annotation.points.map(toCanvasCoords);
    ctx.strokeStyle = 'white';
    ctx.fillStyle = 'white';
    ctx.lineWidth = annotation.strokeWidth * totalScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, annotation.strokeWidth * totalScale / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();
    }
  } else if (annotation.type === 'pen') {
    if (annotation.points.length === 0) return null;

    const points = annotation.points.map(toCanvasCoords);
    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = annotation.strokeWidth * totalScale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (annotation.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }

    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, annotation.strokeWidth * totalScale / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();
    }
  } else if (annotation.type === 'brush') {
    renderBrushToCanvas(ctx, annotation, toCanvasCoords, totalScale);
  } else if (annotation.type === 'arrow') {
    renderArrowToCanvas(ctx, annotation, toCanvasCoords, totalScale);
  } else if (annotation.type === 'rectangle') {
    renderRectangleToCanvas(ctx, annotation, toCanvasCoords, totalScale);
  } else if (annotation.type === 'text' && annotation.text) {
    const point = toCanvasCoords(annotation.points[0]);
    const scaledFontSize = (annotation.fontSize ?? 48) * totalScale;

    if (annotation.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }

    ctx.fillStyle = annotation.color;
    ctx.font = `bold ${scaledFontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(annotation.text, point.x, point.y);
  }

  return canvas;
}

function renderBrushToCanvas(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (p: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length === 0) return;

  const rawPoints = annotation.points.map(p => ({
    ...toCanvasCoords(p),
    width: p.width ?? annotation.strokeWidth
  }));

  ctx.fillStyle = annotation.color;

  if (annotation.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }

  if (rawPoints.length === 1) {
    const p = rawPoints[0];
    const width = (p.width * totalScale) / 2;
    const rx = width * 0.8;
    const ry = width * 1.2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (rawPoints.length === 2) {
    // Two points - render tapered stroke
    const p1 = rawPoints[0];
    const p2 = rawPoints[1];
    const w1 = ((p1.width ?? annotation.strokeWidth * 0.3) * totalScale) / 2;
    const w2 = ((p2.width ?? annotation.strokeWidth * 0.5) * totalScale) / 2;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      const nx = -dy / len;
      const ny = dx / len;
      const tipExtend = w2 * 0.3;
      const tipX = p2.x + (dx / len) * tipExtend;
      const tipY = p2.y + (dy / len) * tipExtend;

      ctx.beginPath();
      ctx.moveTo(p1.x + nx * w1, p1.y + ny * w1);
      ctx.quadraticCurveTo(
        (p1.x + nx * w1 + p2.x + nx * w2) / 2 + nx * w2 * 0.3,
        (p1.y + ny * w1 + p2.y + ny * w2) / 2 + ny * w2 * 0.3,
        p2.x + nx * w2, p2.y + ny * w2
      );
      ctx.quadraticCurveTo(tipX + nx * w2 * 0.2, tipY + ny * w2 * 0.2, tipX, tipY);
      ctx.quadraticCurveTo(tipX - nx * w2 * 0.2, tipY - ny * w2 * 0.2, p2.x - nx * w2, p2.y - ny * w2);
      ctx.quadraticCurveTo(
        (p1.x - nx * w1 + p2.x - nx * w2) / 2 - nx * w2 * 0.3,
        (p1.y - ny * w1 + p2.y - ny * w2) / 2 - ny * w2 * 0.3,
        p1.x - nx * w1, p1.y - ny * w1
      );
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // 3+ points - interpolate for smooth outline with variable width
    const interpolated = interpolateBrushPoints(rawPoints);
    const { leftSide, rightSide } = generateBrushOutline(interpolated, totalScale);

    if (leftSide.length >= 2) {
      renderBrushPath(ctx, leftSide, rightSide, interpolated, totalScale);
    }
  }
}

function interpolateBrushPoints(rawPoints: { x: number; y: number; width: number }[]): { x: number; y: number; width: number }[] {
  const interpolated: { x: number; y: number; width: number }[] = [];
  for (let i = 0; i < rawPoints.length - 1; i++) {
    const p1 = rawPoints[i];
    const p2 = rawPoints[i + 1];
    const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

    interpolated.push(p1);

    const interpolateCount = Math.floor(dist / 5);
    for (let j = 1; j < interpolateCount; j++) {
      const t = j / interpolateCount;
      const smoothT = t * t * (3 - 2 * t);
      interpolated.push({
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
        width: p1.width + (p2.width - p1.width) * smoothT
      });
    }
  }
  interpolated.push(rawPoints[rawPoints.length - 1]);
  return interpolated;
}

function generateBrushOutline(
  interpolated: { x: number; y: number; width: number }[],
  totalScale: number
): { leftSide: { x: number; y: number }[]; rightSide: { x: number; y: number }[] } {
  let leftSide: { x: number; y: number }[] = [];
  let rightSide: { x: number; y: number }[] = [];

  for (let i = 0; i < interpolated.length; i++) {
    const curr = interpolated[i];
    const width = (curr.width * totalScale) / 2;

    let dx: number, dy: number;
    if (i === 0) {
      dx = interpolated[1].x - curr.x;
      dy = interpolated[1].y - curr.y;
    } else if (i === interpolated.length - 1) {
      dx = curr.x - interpolated[i - 1].x;
      dy = curr.y - interpolated[i - 1].y;
    } else {
      const lookback = Math.min(i, 3);
      const lookforward = Math.min(interpolated.length - 1 - i, 3);
      dx = interpolated[i + lookforward].x - interpolated[i - lookback].x;
      dy = interpolated[i + lookforward].y - interpolated[i - lookback].y;
    }

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;

    const nx = -dy / len;
    const ny = dx / len;

    leftSide.push({ x: curr.x + nx * width, y: curr.y + ny * width });
    rightSide.push({ x: curr.x - nx * width, y: curr.y - ny * width });
  }

  // Smooth the outline
  leftSide = smoothBrushOutline(leftSide);
  rightSide = smoothBrushOutline(rightSide);

  return { leftSide, rightSide };
}

function smoothBrushOutline(pts: { x: number; y: number }[], windowSize: number = 5): { x: number; y: number }[] {
  if (pts.length < 3) return pts;
  const result: { x: number; y: number }[] = [];
  const halfWindow = Math.floor(windowSize / 2);
  for (let i = 0; i < pts.length; i++) {
    if (i < halfWindow || i >= pts.length - halfWindow) {
      result.push(pts[i]);
      continue;
    }
    let sumX = 0, sumY = 0, count = 0;
    for (let j = -halfWindow; j <= halfWindow; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < pts.length) {
        sumX += pts[idx].x;
        sumY += pts[idx].y;
        count++;
      }
    }
    result.push({ x: sumX / count, y: sumY / count });
  }
  return result;
}

function renderBrushPath(
  ctx: CanvasRenderingContext2D,
  leftSide: { x: number; y: number }[],
  rightSide: { x: number; y: number }[],
  interpolated: { x: number; y: number; width: number }[],
  totalScale: number
): void {
  ctx.beginPath();
  ctx.moveTo(leftSide[0].x, leftSide[0].y);

  // Left side
  for (let i = 1; i < leftSide.length - 1; i++) {
    const curr = leftSide[i];
    const next = leftSide[i + 1];
    const endX = (curr.x + next.x) / 2;
    const endY = (curr.y + next.y) / 2;
    ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
  }
  ctx.lineTo(leftSide[leftSide.length - 1].x, leftSide[leftSide.length - 1].y);

  // End cap
  const lastPoint = interpolated[interpolated.length - 1];
  const lastWidth = (lastPoint.width * totalScale) / 2;
  const tipExtend = lastWidth * 0.4;
  const lastDx = interpolated.length > 1
    ? interpolated[interpolated.length - 1].x - interpolated[interpolated.length - 2].x
    : 0;
  const lastDy = interpolated.length > 1
    ? interpolated[interpolated.length - 1].y - interpolated[interpolated.length - 2].y
    : 0;
  const lastLen = Math.sqrt(lastDx * lastDx + lastDy * lastDy);

  if (lastLen > 0) {
    const tipX = lastPoint.x + (lastDx / lastLen) * tipExtend;
    const tipY = lastPoint.y + (lastDy / lastLen) * tipExtend;
    ctx.quadraticCurveTo(tipX, tipY, rightSide[rightSide.length - 1].x, rightSide[rightSide.length - 1].y);
  } else {
    ctx.lineTo(rightSide[rightSide.length - 1].x, rightSide[rightSide.length - 1].y);
  }

  // Right side backward
  for (let i = rightSide.length - 2; i > 0; i--) {
    const curr = rightSide[i];
    const prev = rightSide[i - 1];
    const endX = (curr.x + prev.x) / 2;
    const endY = (curr.y + prev.y) / 2;
    ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
  }
  ctx.lineTo(rightSide[0].x, rightSide[0].y);

  // Start cap
  const firstPoint = interpolated[0];
  const firstWidth = (firstPoint.width * totalScale) / 2;
  const startExtend = firstWidth * 0.3;
  const firstDx = interpolated.length > 1
    ? interpolated[0].x - interpolated[1].x
    : 0;
  const firstDy = interpolated.length > 1
    ? interpolated[0].y - interpolated[1].y
    : 0;
  const firstLen = Math.sqrt(firstDx * firstDx + firstDy * firstDy);

  if (firstLen > 0) {
    const startTipX = firstPoint.x + (firstDx / firstLen) * startExtend;
    const startTipY = firstPoint.y + (firstDy / firstLen) * startExtend;
    ctx.quadraticCurveTo(startTipX, startTipY, leftSide[0].x, leftSide[0].y);
  }

  ctx.closePath();
  ctx.fill();
}

function renderArrowToCanvas(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (p: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length < 2) return;

  const start = toCanvasCoords(annotation.points[0]);
  const end = toCanvasCoords(annotation.points[1]);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const scaledStroke = annotation.strokeWidth * totalScale;
  const headLength = scaledStroke * 3;
  const headWidth = scaledStroke * 2;

  if (annotation.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }

  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = scaledStroke;
  ctx.lineCap = 'round';

  const lineEndX = end.x - headLength * 0.7 * Math.cos(angle);
  const lineEndY = end.y - headLength * 0.7 * Math.sin(angle);

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(lineEndX, lineEndY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - headLength * Math.cos(angle) + headWidth * Math.sin(angle),
             end.y - headLength * Math.sin(angle) - headWidth * Math.cos(angle));
  ctx.lineTo(end.x - headLength * Math.cos(angle) - headWidth * Math.sin(angle),
             end.y - headLength * Math.sin(angle) + headWidth * Math.cos(angle));
  ctx.closePath();
  ctx.fill();
}

function renderRectangleToCanvas(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (p: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length < 2) return;

  const p0 = toCanvasCoords(annotation.points[0]);
  const p1 = toCanvasCoords(annotation.points[1]);
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);
  const cornerRadius = annotation.strokeWidth * totalScale * 1.5;

  if (annotation.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }

  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = annotation.strokeWidth * totalScale;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cornerRadius);
  ctx.stroke();
}

/**
 * Generate a cache key for an annotation based on its content
 */
function getAnnotationCacheKey(
  annotation: Annotation,
  viewport: Viewport,
  width: number,
  height: number
): string {
  // Include viewport in cache key so textures are regenerated on pan/zoom
  const viewportKey = `${viewport.scale.toFixed(4)}:${viewport.zoom.toFixed(4)}:${viewport.offsetX.toFixed(2)}:${viewport.offsetY.toFixed(2)}`;

  // Content key must uniquely identify the annotation's visual state
  let contentKey: string;
  if (annotation.type === 'text') {
    contentKey = `${annotation.text}:${annotation.fontSize}`;
  } else if (annotation.type === 'fill') {
    // Fill is identified by its mask data (position where fill was clicked)
    const pt = annotation.points[0];
    contentKey = `fill:${pt?.x ?? 0}:${pt?.y ?? 0}`;
  } else if (annotation.points.length > 0) {
    // For strokes, include first and last point positions + count for better change detection
    const first = annotation.points[0];
    const last = annotation.points[annotation.points.length - 1];
    contentKey = `${annotation.points.length}:${first.x.toFixed(1)}:${first.y.toFixed(1)}:${last.x.toFixed(1)}:${last.y.toFixed(1)}`;
  } else {
    contentKey = `${annotation.points.length}`;
  }

  return `${annotation.id}:${viewportKey}:${width}:${height}:${contentKey}`;
}

/**
 * Clear texture cache (call when annotations are significantly modified)
 */
export function clearAnnotationTextureCache(): void {
  for (const cached of textureCache.values()) {
    cached.texture.destroy();
  }
  textureCache.clear();
}

/**
 * Prune stale cache entries for deleted annotations
 * Call this when annotations are removed to free GPU memory
 */
export function pruneAnnotationTextureCache(currentAnnotationIds: Set<string>): void {
  const keysToDelete: string[] = [];

  for (const key of textureCache.keys()) {
    // Cache key format: "annotationId:viewportKey:width:height:contentKey"
    const annotationId = key.split(':')[0];
    if (!currentAnnotationIds.has(annotationId)) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    const cached = textureCache.get(key);
    if (cached) {
      cached.texture.destroy();
      textureCache.delete(key);
    }
  }
}

// Render state for frame management
let pendingRenderState: {
  annotations: Annotation[];
  currentStroke: Annotation | null;
  width: number;
  height: number;
  image: HTMLImageElement;
  viewport: Viewport;
  cropArea: CropArea | null | undefined;
  targetCanvas: HTMLCanvasElement;
  onComplete: () => void;
} | null = null;

let isRendering = false;
let animationFrameId: number | null = null;

/**
 * Schedule a WebGPU annotation render
 * Uses requestAnimationFrame to avoid race conditions and ensure smooth rendering
 */
export function scheduleAnnotationRender(
  annotations: Annotation[],
  currentStroke: Annotation | null,
  width: number,
  height: number,
  image: HTMLImageElement,
  viewport: Viewport,
  cropArea: CropArea | null | undefined,
  targetCanvas: HTMLCanvasElement,
  onComplete: () => void
): void {
  // Store the latest render state (overwrites any pending state)
  pendingRenderState = {
    annotations: [...annotations],
    currentStroke,
    width,
    height,
    image,
    viewport: { ...viewport },
    cropArea,
    targetCanvas,
    onComplete
  };

  // If not already scheduled, schedule a render
  if (animationFrameId === null && !isRendering) {
    animationFrameId = requestAnimationFrame(processRenderQueue);
  }
}

/**
 * Process the render queue
 */
async function processRenderQueue(): Promise<void> {
  animationFrameId = null;

  if (!pendingRenderState || isRendering) {
    return;
  }

  isRendering = true;
  const state = pendingRenderState;
  pendingRenderState = null;

  try {
    const result = await renderAnnotationsWithWebGPUInternal(
      state.annotations,
      state.currentStroke,
      state.width,
      state.height,
      state.image,
      state.viewport,
      state.cropArea
    );

    if (result && state.targetCanvas) {
      const ctx = state.targetCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, state.width, state.height);
        ctx.drawImage(result, 0, 0);
      }
    }

    state.onComplete();
  } catch (error) {
    console.error('WebGPU annotation render failed:', error);
    state.onComplete();
  } finally {
    isRendering = false;

    // If there's a new pending state, schedule another render
    if (pendingRenderState) {
      animationFrameId = requestAnimationFrame(processRenderQueue);
    }
  }
}

/**
 * Cancel any pending renders
 */
export function cancelPendingRenders(): void {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  pendingRenderState = null;
}

/**
 * Internal WebGPU render function
 *
 * OPTIMIZED APPROACH: Image-space caching + viewport transform
 * - Committed annotations are cached in IMAGE coordinates (not canvas coordinates)
 * - Viewport transform is applied when compositing to output canvas
 * - Only current stroke is rendered in real-time
 * - Pan/zoom does NOT trigger full re-render of all annotations
 */
async function renderAnnotationsWithWebGPUInternal(
  annotations: Annotation[],
  currentStroke: Annotation | null,
  width: number,
  height: number,
  image: HTMLImageElement,
  viewport: Viewport,
  cropArea: CropArea | null | undefined
): Promise<HTMLCanvasElement | null> {
  if (annotations.length === 0 && !currentStroke) {
    return null;
  }

  // Determine image dimensions for caching
  const imageWidth = cropArea ? cropArea.width : image.width;
  const imageHeight = cropArea ? cropArea.height : image.height;

  // Check if we need to rebuild the image-space cache
  // Only rebuild when ANNOTATIONS change, not when viewport changes
  if (needsImageSpaceCacheRebuild(annotations, imageWidth, imageHeight, cropArea)) {
    // Rebuild cache with all committed annotations in image coordinates
    const cacheCanvas = renderAnnotationsToImageSpace(annotations, imageWidth, imageHeight, cropArea);
    const cropKey = cropArea ? `${cropArea.x}:${cropArea.y}:${cropArea.width}:${cropArea.height}` : '';

    imageSpaceCache = {
      canvas: cacheCanvas,
      annotationHash: hashAnnotationsForCache(annotations),
      annotationCount: annotations.length,
      imageWidth,
      imageHeight,
      hasCrop: !!cropArea,
      cropKey
    };
  }

  // Create output canvas
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const ctx = outputCanvas.getContext('2d');
  if (!ctx) return null;

  // Calculate viewport transform parameters
  const totalScale = viewport.scale * viewport.zoom;
  const centerX = width / 2;
  const centerY = height / 2;
  const cropOffsetX = cropArea ? cropArea.x : 0;
  const cropOffsetY = cropArea ? cropArea.y : 0;

  // Draw cached image-space annotations with viewport transform applied
  if (imageSpaceCache.canvas) {
    ctx.save();

    // Apply viewport transform
    // 1. Translate to center of canvas
    // 2. Apply offset
    // 3. Scale
    // 4. Translate back by half of source image
    const destX = centerX + viewport.offsetX - (imageWidth / 2) * totalScale;
    const destY = centerY + viewport.offsetY - (imageHeight / 2) * totalScale;
    const destWidth = imageWidth * totalScale;
    const destHeight = imageHeight * totalScale;

    // If there's a crop, we need to handle source offset
    if (cropArea) {
      // For cropped images, draw the appropriate region
      ctx.drawImage(
        imageSpaceCache.canvas,
        0, 0, imageWidth, imageHeight,  // Source rectangle (in image-space cache)
        destX, destY, destWidth, destHeight  // Destination rectangle (with viewport transform)
      );
    } else {
      ctx.drawImage(
        imageSpaceCache.canvas,
        destX, destY, destWidth, destHeight
      );
    }

    ctx.restore();
  }

  // Render current stroke in real-time (if any)
  // This is the only per-frame rendering - current stroke needs real-time update
  if (currentStroke && currentStroke.points.length > 0) {
    const toCanvasCoords = (point: AnnotationPoint) => ({
      x: (point.x - cropOffsetX - imageWidth / 2) * totalScale + centerX + viewport.offsetX,
      y: (point.y - cropOffsetY - imageHeight / 2) * totalScale + centerY + viewport.offsetY
    });

    const originX = (0 - cropOffsetX - imageWidth / 2) * totalScale + centerX + viewport.offsetX;
    const originY = (0 - cropOffsetY - imageHeight / 2) * totalScale + centerY + viewport.offsetY;

    renderAnnotationDirect(ctx, currentStroke, toCanvasCoords, totalScale, originX, originY);
  }

  return outputCanvas;
}

/**
 * Render a single annotation directly to canvas context with proper composite operations
 */
function renderAnnotationDirect(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number,
  originX: number,
  originY: number
): void {
  if (annotation.points.length === 0 && annotation.type !== 'fill') return;

  ctx.save();

  // Apply shadow if enabled
  if (annotation.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }

  if (annotation.type === 'fill') {
    const fillCanvas = getOrCreateFillCanvas(annotation);
    if (fillCanvas) {
      ctx.drawImage(
        fillCanvas,
        originX,
        originY,
        fillCanvas.width * totalScale,
        fillCanvas.height * totalScale
      );
    }
  } else if (annotation.type === 'eraser-stroke') {
    // Use Canvas 2D destination-out for eraser (this works correctly)
    renderEraserStrokeDirect(ctx, annotation, toCanvasCoords, totalScale);
  } else if (annotation.type === 'pen') {
    renderPenStrokeDirect(ctx, annotation, toCanvasCoords, totalScale);
  } else if (annotation.type === 'brush') {
    renderBrushStrokeDirect(ctx, annotation, toCanvasCoords, totalScale);
  } else if (annotation.type === 'arrow') {
    renderArrowDirect(ctx, annotation, toCanvasCoords, totalScale);
  } else if (annotation.type === 'rectangle') {
    renderRectangleDirect(ctx, annotation, toCanvasCoords, totalScale);
  } else if (annotation.type === 'text' && annotation.text) {
    const point = toCanvasCoords(annotation.points[0]);
    const scaledFontSize = (annotation.fontSize ?? 48) * totalScale;
    ctx.fillStyle = annotation.color;
    ctx.font = `bold ${scaledFontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(annotation.text, point.x, point.y);
  }

  ctx.restore();
}

function renderPenStrokeDirect(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length === 0) return;

  const points = annotation.points.map(toCanvasCoords);
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = annotation.strokeWidth * totalScale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, annotation.strokeWidth * totalScale / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
  }
}

function renderBrushStrokeDirect(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length === 0) return;

  const rawPoints = annotation.points.map(p => ({
    ...toCanvasCoords(p),
    width: p.width ?? annotation.strokeWidth
  }));

  ctx.fillStyle = annotation.color;

  if (rawPoints.length === 1) {
    const p = rawPoints[0];
    const width = (p.width * totalScale) / 2;
    const rx = width * 0.8;
    const ry = width * 1.2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (rawPoints.length === 2) {
    const p1 = rawPoints[0];
    const p2 = rawPoints[1];
    const w1 = ((p1.width ?? annotation.strokeWidth * 0.3) * totalScale) / 2;
    const w2 = ((p2.width ?? annotation.strokeWidth * 0.5) * totalScale) / 2;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      const nx = -dy / len;
      const ny = dx / len;
      const tipExtend = w2 * 0.3;
      const tipX = p2.x + (dx / len) * tipExtend;
      const tipY = p2.y + (dy / len) * tipExtend;

      ctx.beginPath();
      ctx.moveTo(p1.x + nx * w1, p1.y + ny * w1);
      ctx.quadraticCurveTo(
        (p1.x + nx * w1 + p2.x + nx * w2) / 2 + nx * w2 * 0.3,
        (p1.y + ny * w1 + p2.y + ny * w2) / 2 + ny * w2 * 0.3,
        p2.x + nx * w2, p2.y + ny * w2
      );
      ctx.quadraticCurveTo(tipX + nx * w2 * 0.2, tipY + ny * w2 * 0.2, tipX, tipY);
      ctx.quadraticCurveTo(tipX - nx * w2 * 0.2, tipY - ny * w2 * 0.2, p2.x - nx * w2, p2.y - ny * w2);
      ctx.quadraticCurveTo(
        (p1.x - nx * w1 + p2.x - nx * w2) / 2 - nx * w2 * 0.3,
        (p1.y - ny * w1 + p2.y - ny * w2) / 2 - ny * w2 * 0.3,
        p1.x - nx * w1, p1.y - ny * w1
      );
      ctx.closePath();
      ctx.fill();
    }
  } else {
    const interpolated = interpolateBrushPoints(rawPoints);
    const { leftSide, rightSide } = generateBrushOutline(interpolated, totalScale);
    if (leftSide.length >= 2) {
      renderBrushPath(ctx, leftSide, rightSide, interpolated, totalScale);
    }
  }
}

function renderEraserStrokeDirect(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  const points = annotation.points.map(toCanvasCoords);
  ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.lineWidth = annotation.strokeWidth * totalScale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, annotation.strokeWidth * totalScale / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
  }

  ctx.restore();
}

function renderArrowDirect(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length < 2) return;

  const start = toCanvasCoords(annotation.points[0]);
  const end = toCanvasCoords(annotation.points[1]);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const scaledStroke = annotation.strokeWidth * totalScale;
  const headLength = scaledStroke * 3;
  const headWidth = scaledStroke * 2;
  const lineEndX = end.x - headLength * 0.7 * Math.cos(angle);
  const lineEndY = end.y - headLength * 0.7 * Math.sin(angle);

  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = scaledStroke;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(lineEndX, lineEndY);
  ctx.stroke();

  ctx.fillStyle = annotation.color;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - headLength * Math.cos(angle) + headWidth * Math.sin(angle),
             end.y - headLength * Math.sin(angle) - headWidth * Math.cos(angle));
  ctx.lineTo(end.x - headLength * Math.cos(angle) - headWidth * Math.sin(angle),
             end.y - headLength * Math.sin(angle) + headWidth * Math.cos(angle));
  ctx.closePath();
  ctx.fill();
}

function renderRectangleDirect(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toCanvasCoords: (point: AnnotationPoint) => { x: number; y: number },
  totalScale: number
): void {
  if (annotation.points.length < 2) return;

  const p0 = toCanvasCoords(annotation.points[0]);
  const p1 = toCanvasCoords(annotation.points[1]);
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);
  const cornerRadius = annotation.strokeWidth * totalScale * 1.5;

  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = annotation.strokeWidth * totalScale;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cornerRadius);
  ctx.stroke();
}


/**
 * Render all annotations using WebGPU compositing (legacy sync API)
 * @deprecated Use scheduleAnnotationRender instead
 */
export async function renderAnnotationsWithWebGPU(
  annotations: Annotation[],
  currentStroke: Annotation | null,
  width: number,
  height: number,
  image: HTMLImageElement,
  viewport: Viewport,
  cropArea: CropArea | null | undefined
): Promise<HTMLCanvasElement | null> {
  return renderAnnotationsWithWebGPUInternal(
    annotations,
    currentStroke,
    width,
    height,
    image,
    viewport,
    cropArea
  );
}

/**
 * Cleanup WebGPU resources
 */
export function cleanupAnnotationWebGPU(): void {
  clearAnnotationTextureCache();
  clearImageSpaceCache();  // Clear image-space cache
  intermediateTexture1?.destroy();
  intermediateTexture2?.destroy();
  blendUniformBuffer?.destroy();
  device = null;
  blendPipeline = null;
  copyPipeline = null;
  sampler = null;
  blendUniformBuffer = null;
  intermediateTexture1 = null;
  intermediateTexture2 = null;
}
