//! Stroke Processor WASM Module
//!
//! High-performance stroke tessellation using Lyon.
//! Converts stroke points into GPU-ready triangle meshes.

use wasm_bindgen::prelude::*;
use lyon_tessellation::{
    BuffersBuilder, FillOptions, FillTessellator, FillVertex, StrokeOptions,
    StrokeTessellator, StrokeVertex, VertexBuffers,
};
use lyon_path::{Path, geom::point};

#[cfg(feature = "console_error_panic_hook")]
use console_error_panic_hook;

/// Initialize panic hook for better error messages
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Tessellated stroke result
#[wasm_bindgen]
pub struct TessellatedStroke {
    vertices: Vec<f32>,
    indices: Vec<u32>,
}

#[wasm_bindgen]
impl TessellatedStroke {
    /// Get vertices as Float32Array
    /// Layout: [x, y, nx, ny, width, r, g, b, a, side] repeated
    #[wasm_bindgen(getter)]
    pub fn vertices(&self) -> Vec<f32> {
        self.vertices.clone()
    }

    /// Get indices as Uint32Array
    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Vec<u32> {
        self.indices.clone()
    }

    /// Number of vertices
    #[wasm_bindgen(getter)]
    pub fn vertex_count(&self) -> usize {
        self.vertices.len() / 10 // 10 floats per vertex
    }

    /// Number of indices
    #[wasm_bindgen(getter)]
    pub fn index_count(&self) -> usize {
        self.indices.len()
    }
}

/// Tessellate a variable-width stroke path
///
/// # Arguments
/// * `points` - Flat array [x0, y0, w0, x1, y1, w1, ...]
/// * `color` - RGBA color [r, g, b, a]
/// * `tolerance` - Tessellation tolerance (lower = more triangles)
///
/// # Returns
/// TessellatedStroke with vertices and indices
#[wasm_bindgen]
pub fn tessellate_variable_stroke(
    points: &[f32],
    color: &[f32],
    _tolerance: f32,
) -> TessellatedStroke {
    let point_count = points.len() / 3;

    if point_count < 2 {
        return TessellatedStroke {
            vertices: vec![],
            indices: vec![],
        };
    }

    let r = color.get(0).copied().unwrap_or(0.0);
    let g = color.get(1).copied().unwrap_or(0.0);
    let b = color.get(2).copied().unwrap_or(0.0);
    let a = color.get(3).copied().unwrap_or(1.0);

    let mut vertices: Vec<f32> = Vec::with_capacity(point_count * 20); // 2 vertices per point
    let mut indices: Vec<u32> = Vec::with_capacity((point_count - 1) * 6); // 2 triangles per segment

    // Generate outline vertices
    for i in 0..point_count {
        let x = points[i * 3];
        let y = points[i * 3 + 1];
        let w = points[i * 3 + 2];

        // Calculate normal (perpendicular to direction)
        let (nx, ny) = if i == 0 {
            // First point: use direction to next
            let dx = points[3] - points[0];
            let dy = points[4] - points[1];
            let len = (dx * dx + dy * dy).sqrt();
            if len > 0.0 {
                (-dy / len, dx / len)
            } else {
                (0.0, 1.0)
            }
        } else if i == point_count - 1 {
            // Last point: use direction from previous
            let dx = points[(i) * 3] - points[(i - 1) * 3];
            let dy = points[(i) * 3 + 1] - points[(i - 1) * 3 + 1];
            let len = (dx * dx + dy * dy).sqrt();
            if len > 0.0 {
                (-dy / len, dx / len)
            } else {
                (0.0, 1.0)
            }
        } else {
            // Middle point: average of adjacent directions
            let dx1 = points[i * 3] - points[(i - 1) * 3];
            let dy1 = points[i * 3 + 1] - points[(i - 1) * 3 + 1];
            let dx2 = points[(i + 1) * 3] - points[i * 3];
            let dy2 = points[(i + 1) * 3 + 1] - points[i * 3 + 1];

            let dx = dx1 + dx2;
            let dy = dy1 + dy2;
            let len = (dx * dx + dy * dy).sqrt();
            if len > 0.0 {
                (-dy / len, dx / len)
            } else {
                (0.0, 1.0)
            }
        };

        // Left vertex (side = -1)
        vertices.extend_from_slice(&[x, y, nx, ny, w, r, g, b, a, -1.0]);

        // Right vertex (side = +1)
        vertices.extend_from_slice(&[x, y, nx, ny, w, r, g, b, a, 1.0]);
    }

    // Generate indices for triangle strip
    for i in 0..(point_count - 1) as u32 {
        let v0 = i * 2;     // Left current
        let v1 = i * 2 + 1; // Right current
        let v2 = i * 2 + 2; // Left next
        let v3 = i * 2 + 3; // Right next

        // First triangle
        indices.extend_from_slice(&[v0, v2, v1]);
        // Second triangle
        indices.extend_from_slice(&[v1, v2, v3]);
    }

    TessellatedStroke { vertices, indices }
}

/// Tessellate a uniform-width stroke using Lyon
///
/// # Arguments
/// * `points` - Flat array [x0, y0, x1, y1, ...]
/// * `stroke_width` - Uniform stroke width
/// * `color` - RGBA color [r, g, b, a]
/// * `tolerance` - Tessellation tolerance
#[wasm_bindgen]
pub fn tessellate_stroke(
    points: &[f32],
    stroke_width: f32,
    color: &[f32],
    tolerance: f32,
) -> TessellatedStroke {
    let point_count = points.len() / 2;

    if point_count < 2 {
        return TessellatedStroke {
            vertices: vec![],
            indices: vec![],
        };
    }

    let r = color.get(0).copied().unwrap_or(0.0);
    let g = color.get(1).copied().unwrap_or(0.0);
    let b = color.get(2).copied().unwrap_or(0.0);
    let a = color.get(3).copied().unwrap_or(1.0);

    // Build path
    let mut builder = Path::builder();
    builder.begin(point(points[0], points[1]));

    for i in 1..point_count {
        builder.line_to(point(points[i * 2], points[i * 2 + 1]));
    }
    builder.end(false);

    let path = builder.build();

    // Tessellate
    let mut buffers: VertexBuffers<[f32; 10], u32> = VertexBuffers::new();
    let mut tessellator = StrokeTessellator::new();

    let options = StrokeOptions::default()
        .with_line_width(stroke_width)
        .with_line_cap(lyon_tessellation::LineCap::Round)
        .with_line_join(lyon_tessellation::LineJoin::Round)
        .with_tolerance(tolerance);

    let result = tessellator.tessellate_path(
        &path,
        &options,
        &mut BuffersBuilder::new(&mut buffers, |vertex: StrokeVertex| {
            let pos = vertex.position();
            let normal = vertex.normal();
            [pos.x, pos.y, normal.x, normal.y, stroke_width, r, g, b, a, 0.0]
        }),
    );

    match result {
        Ok(_) => {
            let vertices: Vec<f32> = buffers.vertices.iter().flat_map(|v| v.iter().copied()).collect();
            TessellatedStroke {
                vertices,
                indices: buffers.indices,
            }
        }
        Err(_) => TessellatedStroke {
            vertices: vec![],
            indices: vec![],
        },
    }
}

/// Tessellate a filled path using Lyon
///
/// # Arguments
/// * `points` - Flat array [x0, y0, x1, y1, ...] defining closed polygon
/// * `color` - RGBA color [r, g, b, a]
/// * `tolerance` - Tessellation tolerance
#[wasm_bindgen]
pub fn tessellate_fill(
    points: &[f32],
    color: &[f32],
    tolerance: f32,
) -> TessellatedStroke {
    let point_count = points.len() / 2;

    if point_count < 3 {
        return TessellatedStroke {
            vertices: vec![],
            indices: vec![],
        };
    }

    let r = color.get(0).copied().unwrap_or(0.0);
    let g = color.get(1).copied().unwrap_or(0.0);
    let b = color.get(2).copied().unwrap_or(0.0);
    let a = color.get(3).copied().unwrap_or(1.0);

    // Build closed path
    let mut builder = Path::builder();
    builder.begin(point(points[0], points[1]));

    for i in 1..point_count {
        builder.line_to(point(points[i * 2], points[i * 2 + 1]));
    }
    builder.close();

    let path = builder.build();

    // Tessellate
    let mut buffers: VertexBuffers<[f32; 6], u32> = VertexBuffers::new();
    let mut tessellator = FillTessellator::new();

    let options = FillOptions::default()
        .with_tolerance(tolerance);

    let result = tessellator.tessellate_path(
        &path,
        &options,
        &mut BuffersBuilder::new(&mut buffers, |vertex: FillVertex| {
            let pos = vertex.position();
            [pos.x, pos.y, r, g, b, a]
        }),
    );

    match result {
        Ok(_) => {
            let vertices: Vec<f32> = buffers.vertices.iter().flat_map(|v| v.iter().copied()).collect();
            TessellatedStroke {
                vertices,
                indices: buffers.indices,
            }
        }
        Err(_) => TessellatedStroke {
            vertices: vec![],
            indices: vec![],
        },
    }
}

/// Simplify a path using Ramer-Douglas-Peucker algorithm
///
/// # Arguments
/// * `points` - Flat array [x0, y0, x1, y1, ...]
/// * `epsilon` - Distance threshold
///
/// # Returns
/// Simplified points as flat array
#[wasm_bindgen]
pub fn simplify_path(points: &[f32], epsilon: f32) -> Vec<f32> {
    let point_count = points.len() / 2;

    if point_count <= 2 {
        return points.to_vec();
    }

    fn rdp_simplify(points: &[(f32, f32)], epsilon: f32, result: &mut Vec<(f32, f32)>) {
        if points.len() <= 2 {
            if !points.is_empty() {
                result.push(points[0]);
            }
            return;
        }

        let start = points[0];
        let end = points[points.len() - 1];

        let mut max_dist = 0.0f32;
        let mut max_idx = 0;

        for (i, &p) in points.iter().enumerate().skip(1).take(points.len() - 2) {
            let dist = perpendicular_distance(p, start, end);
            if dist > max_dist {
                max_dist = dist;
                max_idx = i;
            }
        }

        if max_dist > epsilon {
            rdp_simplify(&points[..=max_idx], epsilon, result);
            rdp_simplify(&points[max_idx..], epsilon, result);
        } else {
            result.push(start);
        }
    }

    fn perpendicular_distance(point: (f32, f32), line_start: (f32, f32), line_end: (f32, f32)) -> f32 {
        let dx = line_end.0 - line_start.0;
        let dy = line_end.1 - line_start.1;
        let len_sq = dx * dx + dy * dy;

        if len_sq == 0.0 {
            let pdx = point.0 - line_start.0;
            let pdy = point.1 - line_start.1;
            return (pdx * pdx + pdy * pdy).sqrt();
        }

        let t = ((point.0 - line_start.0) * dx + (point.1 - line_start.1) * dy) / len_sq;
        let t = t.clamp(0.0, 1.0);

        let proj_x = line_start.0 + t * dx;
        let proj_y = line_start.1 + t * dy;

        let dist_x = point.0 - proj_x;
        let dist_y = point.1 - proj_y;

        (dist_x * dist_x + dist_y * dist_y).sqrt()
    }

    // Convert to tuples
    let pts: Vec<(f32, f32)> = (0..point_count)
        .map(|i| (points[i * 2], points[i * 2 + 1]))
        .collect();

    let mut result: Vec<(f32, f32)> = Vec::new();
    rdp_simplify(&pts, epsilon, &mut result);
    result.push(pts[pts.len() - 1]); // Always include last point

    // Convert back to flat array
    result.iter().flat_map(|&(x, y)| [x, y]).collect()
}

/// Calculate bounding box for points
///
/// # Returns
/// [minX, minY, maxX, maxY]
#[wasm_bindgen]
pub fn calculate_bounds(points: &[f32], point_stride: usize) -> Vec<f32> {
    let point_count = points.len() / point_stride;

    if point_count == 0 {
        return vec![0.0, 0.0, 0.0, 0.0];
    }

    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;

    for i in 0..point_count {
        let x = points[i * point_stride];
        let y = points[i * point_stride + 1];
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }

    vec![min_x, min_y, max_x, max_y]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tessellate_stroke() {
        let points = vec![0.0, 0.0, 100.0, 100.0];
        let color = vec![1.0, 0.0, 0.0, 1.0];
        let result = tessellate_stroke(&points, 10.0, &color, 0.1);
        assert!(result.vertex_count() > 0);
        assert!(result.index_count() > 0);
    }

    #[test]
    fn test_simplify_path() {
        let points = vec![0.0, 0.0, 1.0, 0.1, 2.0, 0.0, 3.0, 0.1, 4.0, 0.0];
        let simplified = simplify_path(&points, 0.5);
        assert!(simplified.len() < points.len());
    }
}
