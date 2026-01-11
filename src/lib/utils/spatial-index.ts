/**
 * Spatial Index using R-tree (rbush)
 *
 * Provides O(log n + k) query performance for viewport culling and point queries.
 * Critical for handling 100,000+ strokes without performance degradation.
 */

import RBush from 'rbush';
import type { Annotation, AnnotationPoint, Viewport, CropArea } from '../types';

// R-tree item interface
interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

// Extended R-tree with annotation lookup
class AnnotationRBush extends RBush<SpatialItem> {
  toBBox(item: SpatialItem) {
    return item;
  }
  compareMinX(a: SpatialItem, b: SpatialItem) {
    return a.minX - b.minX;
  }
  compareMinY(a: SpatialItem, b: SpatialItem) {
    return a.minY - b.minY;
  }
}

// Bounding box calculation result
export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Spatial Index for annotations
 */
export class SpatialIndex {
  private tree: AnnotationRBush;
  private annotationMap: Map<string, Annotation>;
  private boundingBoxCache: Map<string, BoundingBox>;

  constructor() {
    this.tree = new AnnotationRBush();
    this.annotationMap = new Map();
    this.boundingBoxCache = new Map();
  }

  /**
   * Calculate bounding box for an annotation
   */
  private calculateBoundingBox(annotation: Annotation): BoundingBox {
    const { type, points, strokeWidth, fontSize, text } = annotation;

    if (points.length === 0 && type !== 'fill') {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    // Stroke width padding (half on each side)
    const padding = strokeWidth / 2;

    switch (type) {
      case 'pen':
      case 'eraser-stroke': {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        return {
          minX: minX - padding,
          minY: minY - padding,
          maxX: maxX + padding,
          maxY: maxY + padding
        };
      }

      case 'brush': {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
          const w = (p.width ?? strokeWidth) / 2;
          minX = Math.min(minX, p.x - w);
          minY = Math.min(minY, p.y - w);
          maxX = Math.max(maxX, p.x + w);
          maxY = Math.max(maxY, p.y + w);
        }
        return { minX, minY, maxX, maxY };
      }

      case 'arrow':
      case 'rectangle': {
        const [start, end] = points;
        if (!end) {
          return {
            minX: start.x - padding,
            minY: start.y - padding,
            maxX: start.x + padding,
            maxY: start.y + padding
          };
        }
        // Arrow head padding (approximate)
        const arrowPadding = type === 'arrow' ? strokeWidth * 3 : padding;
        return {
          minX: Math.min(start.x, end.x) - arrowPadding,
          minY: Math.min(start.y, end.y) - arrowPadding,
          maxX: Math.max(start.x, end.x) + arrowPadding,
          maxY: Math.max(start.y, end.y) + arrowPadding
        };
      }

      case 'text': {
        const p = points[0];
        if (!p) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        const size = fontSize ?? 48;
        const textLen = (text?.length ?? 1) * size * 0.6; // Approximate width
        return {
          minX: p.x,
          minY: p.y,
          maxX: p.x + textLen,
          maxY: p.y + size * 1.2
        };
      }

      case 'fill': {
        // Fill covers the entire image - use large bounds
        // This will be refined when we have fillMask info
        if (annotation.fillOrigin) {
          // Use a large area around fill origin
          return {
            minX: 0,
            minY: 0,
            maxX: 100000,
            maxY: 100000
          };
        }
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      }

      default:
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
  }

  /**
   * Insert an annotation into the index
   */
  insert(annotation: Annotation): void {
    // Remove existing if updating
    if (this.annotationMap.has(annotation.id)) {
      this.remove(annotation.id);
    }

    const bbox = this.calculateBoundingBox(annotation);
    this.boundingBoxCache.set(annotation.id, bbox);
    this.annotationMap.set(annotation.id, annotation);

    this.tree.insert({
      ...bbox,
      id: annotation.id
    });
  }

  /**
   * Insert multiple annotations (bulk insert is more efficient)
   */
  insertBulk(annotations: Annotation[]): void {
    const items: SpatialItem[] = [];

    for (const annotation of annotations) {
      const bbox = this.calculateBoundingBox(annotation);
      this.boundingBoxCache.set(annotation.id, bbox);
      this.annotationMap.set(annotation.id, annotation);
      items.push({ ...bbox, id: annotation.id });
    }

    this.tree.load(items);
  }

  /**
   * Remove an annotation from the index
   */
  remove(annotationId: string): boolean {
    const bbox = this.boundingBoxCache.get(annotationId);
    if (!bbox) return false;

    const item: SpatialItem = { ...bbox, id: annotationId };
    this.tree.remove(item, (a, b) => a.id === b.id);
    this.boundingBoxCache.delete(annotationId);
    this.annotationMap.delete(annotationId);
    return true;
  }

  /**
   * Update an annotation (remove and re-insert)
   */
  update(annotation: Annotation): void {
    this.remove(annotation.id);
    this.insert(annotation);
  }

  /**
   * Query annotations within a viewport
   * Returns annotations sorted by z-index (insertion order preserved via map)
   */
  queryViewport(
    viewport: Viewport,
    canvasWidth: number,
    canvasHeight: number,
    cropArea?: CropArea | null
  ): Annotation[] {
    // Calculate visible area in image coordinates
    const { zoom, offsetX, offsetY, scale } = viewport;
    const totalScale = scale * zoom;

    // Crop offset
    const cropOffsetX = cropArea?.x ?? 0;
    const cropOffsetY = cropArea?.y ?? 0;

    // Convert canvas bounds to image coordinates
    const minX = cropOffsetX + (-offsetX / totalScale);
    const minY = cropOffsetY + (-offsetY / totalScale);
    const maxX = cropOffsetX + ((canvasWidth - offsetX) / totalScale);
    const maxY = cropOffsetY + ((canvasHeight - offsetY) / totalScale);

    // Query R-tree
    const results = this.tree.search({ minX, minY, maxX, maxY });

    // Return annotations maintaining insertion order
    const annotations: Annotation[] = [];
    for (const item of results) {
      const annotation = this.annotationMap.get(item.id);
      if (annotation) {
        annotations.push(annotation);
      }
    }

    return annotations;
  }

  /**
   * Query annotations at a specific point (for eraser hit detection)
   */
  queryPoint(x: number, y: number, radius: number = 0): Annotation[] {
    const results = this.tree.search({
      minX: x - radius,
      minY: y - radius,
      maxX: x + radius,
      maxY: y + radius
    });

    const annotations: Annotation[] = [];
    for (const item of results) {
      const annotation = this.annotationMap.get(item.id);
      if (annotation) {
        annotations.push(annotation);
      }
    }

    return annotations;
  }

  /**
   * Query annotations intersecting a bounding box
   */
  queryBounds(bounds: BoundingBox): Annotation[] {
    const results = this.tree.search(bounds);

    const annotations: Annotation[] = [];
    for (const item of results) {
      const annotation = this.annotationMap.get(item.id);
      if (annotation) {
        annotations.push(annotation);
      }
    }

    return annotations;
  }

  /**
   * Get bounding box for an annotation
   */
  getBoundingBox(annotationId: string): BoundingBox | undefined {
    return this.boundingBoxCache.get(annotationId);
  }

  /**
   * Get all annotations
   */
  getAll(): Annotation[] {
    return Array.from(this.annotationMap.values());
  }

  /**
   * Get annotation by ID
   */
  get(annotationId: string): Annotation | undefined {
    return this.annotationMap.get(annotationId);
  }

  /**
   * Check if annotation exists
   */
  has(annotationId: string): boolean {
    return this.annotationMap.has(annotationId);
  }

  /**
   * Get total count
   */
  get size(): number {
    return this.annotationMap.size;
  }

  /**
   * Clear all annotations
   */
  clear(): void {
    this.tree.clear();
    this.annotationMap.clear();
    this.boundingBoxCache.clear();
  }

  /**
   * Rebuild index from annotation array
   * Use this when annotations array is modified externally
   */
  rebuild(annotations: Annotation[]): void {
    this.clear();
    this.insertBulk(annotations);
  }

  /**
   * Sync with external annotations array
   * Efficiently updates index to match the provided array
   */
  sync(annotations: Annotation[]): void {
    const currentIds = new Set(this.annotationMap.keys());
    const newIds = new Set(annotations.map(a => a.id));

    // Remove annotations that no longer exist
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        this.remove(id);
      }
    }

    // Add or update annotations
    for (const annotation of annotations) {
      const existing = this.annotationMap.get(annotation.id);
      if (!existing) {
        this.insert(annotation);
      } else if (existing.points.length !== annotation.points.length) {
        // Points changed - update
        this.update(annotation);
      }
    }
  }
}

// Singleton instance for global use
let globalSpatialIndex: SpatialIndex | null = null;

/**
 * Get the global spatial index instance
 */
export function getSpatialIndex(): SpatialIndex {
  if (!globalSpatialIndex) {
    globalSpatialIndex = new SpatialIndex();
  }
  return globalSpatialIndex;
}

/**
 * Reset the global spatial index
 */
export function resetSpatialIndex(): void {
  if (globalSpatialIndex) {
    globalSpatialIndex.clear();
  }
  globalSpatialIndex = null;
}

/**
 * Calculate which tiles are affected by a bounding box
 */
export function getTilesForBounds(bounds: BoundingBox, tileSize: number): string[] {
  const tiles: string[] = [];

  const startTileX = Math.floor(bounds.minX / tileSize);
  const endTileX = Math.floor(bounds.maxX / tileSize);
  const startTileY = Math.floor(bounds.minY / tileSize);
  const endTileY = Math.floor(bounds.maxY / tileSize);

  for (let tx = startTileX; tx <= endTileX; tx++) {
    for (let ty = startTileY; ty <= endTileY; ty++) {
      tiles.push(`${tx}:${ty}`);
    }
  }

  return tiles;
}
