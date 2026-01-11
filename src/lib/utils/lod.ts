/**
 * Level of Detail (LOD) System
 *
 * Adjusts rendering quality based on zoom level for optimal performance.
 * At lower zoom levels, points are simplified to reduce GPU/CPU load.
 *
 * Features:
 * - Zoom-based point simplification
 * - Ramer-Douglas-Peucker algorithm for curve simplification
 * - Tessellation quality adjustment
 */

import type { AnnotationPoint } from '../types';

// LOD level configuration
export interface LODLevel {
  minZoom: number;
  maxZoom: number;
  pointSkip: number;           // Every Nth point kept
  simplifyTolerance: number;   // RDP algorithm tolerance
  tessellationQuality: number; // 0.25 - 2.0
}

// LOD configuration
// Lower zoom = more aggressive simplification (fewer details needed)
// Higher zoom = less simplification (preserve all details)
export const LOD_LEVELS: LODLevel[] = [
  { minZoom: 0.0, maxZoom: 0.25, pointSkip: 4, simplifyTolerance: 6.0, tessellationQuality: 0.125 },
  { minZoom: 0.25, maxZoom: 0.5, pointSkip: 2, simplifyTolerance: 3.0, tessellationQuality: 0.25 },
  { minZoom: 0.5, maxZoom: 0.75, pointSkip: 1, simplifyTolerance: 1.5, tessellationQuality: 0.5 },
  { minZoom: 0.75, maxZoom: 1.0, pointSkip: 1, simplifyTolerance: 0.75, tessellationQuality: 0.75 },
  { minZoom: 1.0, maxZoom: 1.5, pointSkip: 1, simplifyTolerance: 0.25, tessellationQuality: 1.0 },
  { minZoom: 1.5, maxZoom: Infinity, pointSkip: 1, simplifyTolerance: 0.1, tessellationQuality: 2.0 },
];

/**
 * Get LOD level for current zoom
 */
export function getLODLevel(zoom: number): LODLevel {
  for (const level of LOD_LEVELS) {
    if (zoom >= level.minZoom && zoom < level.maxZoom) {
      return level;
    }
  }
  return LOD_LEVELS[LOD_LEVELS.length - 1];
}

/**
 * Get tessellation quality for current zoom
 */
export function getTessellationQuality(zoom: number): number {
  return getLODLevel(zoom).tessellationQuality;
}

/**
 * Simple point skip simplification
 * Keeps every Nth point, plus first and last
 */
export function simplifyBySkip<T extends { x: number; y: number }>(
  points: T[],
  skip: number
): T[] {
  if (skip <= 1 || points.length <= 3) {
    return points;
  }

  const result: T[] = [points[0]];

  for (let i = skip; i < points.length - 1; i += skip) {
    result.push(points[i]);
  }

  // Always include last point
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1]);
  }

  return result;
}

/**
 * Perpendicular distance from point to line segment
 */
function perpendicularDistance(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number }
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    // Line segment is a point
    const pdx = point.x - lineStart.x;
    const pdy = point.y - lineStart.y;
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }

  // Project point onto line
  const t = Math.max(0, Math.min(1,
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSq
  ));

  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  const distX = point.x - projX;
  const distY = point.y - projY;

  return Math.sqrt(distX * distX + distY * distY);
}

/**
 * Ramer-Douglas-Peucker algorithm for curve simplification
 * Preserves curve shape better than simple skip
 */
export function simplifyRDP<T extends { x: number; y: number }>(
  points: T[],
  tolerance: number
): T[] {
  if (points.length <= 2) {
    return points;
  }

  // Find the point with maximum distance
  let maxDist = 0;
  let maxIndex = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = simplifyRDP(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyRDP(points.slice(maxIndex), tolerance);

    // Combine results, removing duplicate middle point
    return [...left.slice(0, -1), ...right];
  }

  // All points are within tolerance, return just endpoints
  return [start, end];
}

/**
 * Simplify annotation points for current LOD
 */
export function simplifyForLOD(
  points: AnnotationPoint[],
  zoom: number,
  preserveWidths: boolean = true
): AnnotationPoint[] {
  if (points.length <= 2) {
    return points;
  }

  const lod = getLODLevel(zoom);

  // First apply RDP simplification
  let simplified = simplifyRDP(points, lod.simplifyTolerance);

  // Then apply skip if still too many points
  if (simplified.length > 100 && lod.pointSkip > 1) {
    simplified = simplifyBySkip(simplified, lod.pointSkip);
  }

  // Ensure we have at least 2 points
  if (simplified.length < 2 && points.length >= 2) {
    simplified = [points[0], points[points.length - 1]];
  }

  return simplified;
}

/**
 * Visvalingam-Whyatt algorithm (alternative to RDP)
 * Better for maintaining visual appearance
 */
export function simplifyVisvalingam<T extends { x: number; y: number }>(
  points: T[],
  minArea: number
): T[] {
  if (points.length <= 2) {
    return points;
  }

  // Calculate triangle area
  function triangleArea(p1: T, p2: T, p3: T): number {
    return Math.abs(
      (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y)) / 2
    );
  }

  // Create working copy with areas
  interface PointWithArea {
    point: T;
    area: number;
    prev: PointWithArea | null;
    next: PointWithArea | null;
    removed: boolean;
  }

  const nodes: PointWithArea[] = points.map((p, i) => ({
    point: p,
    area: Infinity,
    prev: null,
    next: null,
    removed: false
  }));

  // Link nodes
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].prev = i > 0 ? nodes[i - 1] : null;
    nodes[i].next = i < nodes.length - 1 ? nodes[i + 1] : null;
  }

  // Calculate initial areas
  for (let i = 1; i < nodes.length - 1; i++) {
    nodes[i].area = triangleArea(
      nodes[i].prev!.point,
      nodes[i].point,
      nodes[i].next!.point
    );
  }

  // Iteratively remove smallest area point
  let remaining = nodes.length;
  const targetCount = Math.max(2, Math.ceil(points.length * 0.3));

  while (remaining > targetCount) {
    // Find minimum area
    let minNode: PointWithArea | null = null;
    let minAreaVal = Infinity;

    for (const node of nodes) {
      if (!node.removed && node.prev && node.next && node.area < minAreaVal) {
        minAreaVal = node.area;
        minNode = node;
      }
    }

    if (!minNode || minAreaVal > minArea) break;

    // Remove node
    minNode.removed = true;
    remaining--;

    // Update neighbors
    if (minNode.prev && minNode.next) {
      minNode.prev.next = minNode.next;
      minNode.next.prev = minNode.prev;

      // Recalculate areas for neighbors
      if (minNode.prev.prev) {
        minNode.prev.area = triangleArea(
          minNode.prev.prev.point,
          minNode.prev.point,
          minNode.next.point
        );
      }
      if (minNode.next.next) {
        minNode.next.area = triangleArea(
          minNode.prev.point,
          minNode.next.point,
          minNode.next.next.point
        );
      }
    }
  }

  // Collect remaining points
  return nodes.filter(n => !n.removed).map(n => n.point);
}

/**
 * Adaptive simplification based on stroke density
 * More aggressive simplification in dense areas
 */
export function adaptiveSimplify(
  points: AnnotationPoint[],
  zoom: number,
  baseStrokeWidth: number
): AnnotationPoint[] {
  if (points.length <= 2) {
    return points;
  }

  const lod = getLODLevel(zoom);

  // Calculate point density
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalLength += Math.sqrt(dx * dx + dy * dy);
  }

  const avgSpacing = totalLength / (points.length - 1);
  const targetSpacing = baseStrokeWidth * lod.tessellationQuality;

  // If points are already sparse enough, return as-is
  if (avgSpacing >= targetSpacing * 0.8) {
    return points;
  }

  // Calculate target point count
  const targetCount = Math.max(2, Math.ceil(totalLength / targetSpacing));

  // Use uniform sampling
  if (targetCount >= points.length) {
    return points;
  }

  const result: AnnotationPoint[] = [points[0]];
  let currentLength = 0;
  let targetLength = totalLength / targetCount;
  let accumulatedLength = 0;

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);

    accumulatedLength += segmentLength;

    if (accumulatedLength >= targetLength) {
      result.push(points[i]);
      accumulatedLength = 0;
    }
  }

  // Always include last point
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1]);
  }

  return result;
}

/**
 * Check if LOD simplification should be applied
 */
export function shouldSimplify(zoom: number, pointCount: number): boolean {
  const lod = getLODLevel(zoom);

  // Don't simplify at high zoom (tolerance < 0.5) or with few points
  if (lod.pointSkip <= 1 && lod.simplifyTolerance < 0.5) {
    return false;
  }

  // Only simplify if we have enough points
  return pointCount > 10;
}

/**
 * Get recommended batch size for rendering at current LOD
 */
export function getRecommendedBatchSize(zoom: number): number {
  const lod = getLODLevel(zoom);

  // At low zoom, render more strokes per batch
  if (lod.tessellationQuality <= 0.25) {
    return 1000;
  } else if (lod.tessellationQuality <= 0.5) {
    return 500;
  } else if (lod.tessellationQuality <= 1.0) {
    return 200;
  }

  return 100;
}
