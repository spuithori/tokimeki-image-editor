/**
 * WebGPU Shader for annotation compositing
 *
 * Handles:
 * - Alpha blending for normal annotations
 * - Destination-out blending for eraser strokes
 * - Viewport transformation (pan/zoom)
 */

export const ANNOTATION_COMPOSITE_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct Uniforms {
  // Viewport transform
  offsetX: f32,
  offsetY: f32,
  scale: f32,
  zoom: f32,
  // Canvas dimensions
  canvasWidth: f32,
  canvasHeight: f32,
  // Padding for alignment
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var annotationTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) VertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
  let uv = pos[VertexIndex] * 0.5 + 0.5;
  output.uv = vec2<f32>(uv.x, 1.0 - uv.y);
  return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let color = textureSample(annotationTexture, mySampler, uv);
  return color;
}
`;

/**
 * Shader for multi-layer annotation compositing
 * Composites base texture with annotation layer using proper alpha blending
 */
export const ANNOTATION_BLEND_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct BlendUniforms {
  // Blend mode: 0 = normal alpha blend, 1 = destination-out (eraser)
  blendMode: f32,
  opacity: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var baseTexture: texture_2d<f32>;
@group(0) @binding(2) var overlayTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> blend: BlendUniforms;

@vertex
fn vs_main(@builtin(vertex_index) VertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
  let uv = pos[VertexIndex] * 0.5 + 0.5;
  output.uv = vec2<f32>(uv.x, 1.0 - uv.y);
  return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let base = textureSample(baseTexture, mySampler, uv);
  let overlay = textureSample(overlayTexture, mySampler, uv);

  let overlayAlpha = overlay.a * blend.opacity;

  // Blend mode: 0 = normal, 1 = eraser (destination-out)
  if (blend.blendMode < 0.5) {
    // Normal alpha blending (Porter-Duff over)
    let outAlpha = overlayAlpha + base.a * (1.0 - overlayAlpha);
    if (outAlpha > 0.0) {
      let outRgb = (overlay.rgb * overlayAlpha + base.rgb * base.a * (1.0 - overlayAlpha)) / outAlpha;
      return vec4<f32>(outRgb, outAlpha);
    }
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  } else {
    // Destination-out (eraser): base * (1 - overlay.a)
    let outAlpha = base.a * (1.0 - overlayAlpha);
    if (outAlpha > 0.0) {
      return vec4<f32>(base.rgb, outAlpha);
    }
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
}
`;

/**
 * Simple passthrough shader for copying textures
 */
export const ANNOTATION_COPY_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var srcTexture: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) VertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
  let uv = pos[VertexIndex] * 0.5 + 0.5;
  output.uv = vec2<f32>(uv.x, 1.0 - uv.y);
  return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(srcTexture, mySampler, uv);
}
`;

/**
 * Vector Stroke Shader for GPU-accelerated vector rendering
 *
 * Features:
 * - Variable width strokes using geometry expansion
 * - Anti-aliased edges using signed distance field
 * - Viewport transformation (pan/zoom)
 * - LOD-aware rendering
 */
export const VECTOR_STROKE_SHADER = `
struct VertexInput {
  @location(0) position: vec2<f32>,    // Center point of stroke
  @location(1) normal: vec2<f32>,      // Perpendicular direction
  @location(2) width: f32,             // Stroke width at this point
  @location(3) color: vec4<f32>,       // RGBA color
  @location(4) side: f32,              // -1 for left, +1 for right
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) edge_distance: f32,     // For anti-aliasing
  @location(2) width: f32,             // Pass width for SDF
};

struct ViewUniforms {
  // Viewport transform
  offsetX: f32,
  offsetY: f32,
  scale: f32,
  zoom: f32,
  // Canvas dimensions
  canvasWidth: f32,
  canvasHeight: f32,
  // Source image dimensions (after crop)
  sourceWidth: f32,
  sourceHeight: f32,
  // Crop offset
  cropOffsetX: f32,
  cropOffsetY: f32,
  // Render settings
  antiAlias: f32,      // 0 = off, 1 = on
  _pad: f32,
};

@group(0) @binding(0) var<uniform> view: ViewUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  // Calculate total scale
  let totalScale = view.scale * view.zoom;

  // Convert from image coords to canvas coords
  let centerX = view.canvasWidth / 2.0;
  let centerY = view.canvasHeight / 2.0;

  // Transform point
  let imageX = input.position.x - view.cropOffsetX - view.sourceWidth / 2.0;
  let imageY = input.position.y - view.cropOffsetY - view.sourceHeight / 2.0;

  let canvasX = imageX * totalScale + centerX + view.offsetX;
  let canvasY = imageY * totalScale + centerY + view.offsetY;

  // Expand vertex by normal and width
  let scaledWidth = input.width * totalScale;
  let expandedX = canvasX + input.normal.x * scaledWidth * 0.5 * input.side;
  let expandedY = canvasY + input.normal.y * scaledWidth * 0.5 * input.side;

  // Convert to clip space (-1 to 1)
  let clipX = (expandedX / view.canvasWidth) * 2.0 - 1.0;
  let clipY = 1.0 - (expandedY / view.canvasHeight) * 2.0;

  output.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  output.color = input.color;
  output.edge_distance = input.side; // -1 to +1 for SDF
  output.width = scaledWidth;

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Anti-aliasing using edge distance
  var alpha = input.color.a;

  if (view.antiAlias > 0.5) {
    // Calculate distance to edge (edge is at |side| = 1)
    let dist = abs(input.edge_distance);
    // Smooth edge over ~1-2 pixels
    let aaWidth = 1.5 / max(input.width, 1.0);
    alpha *= smoothstep(1.0 + aaWidth, 1.0 - aaWidth, dist);
  }

  return vec4<f32>(input.color.rgb, alpha);
}
`;

/**
 * Instanced stroke shader for rendering many strokes efficiently
 *
 * Each instance is a single stroke segment (quad)
 * Uses instancing to reduce draw calls
 */
export const INSTANCED_STROKE_SHADER = `
struct InstanceData {
  startPos: vec2<f32>,
  endPos: vec2<f32>,
  startWidth: f32,
  endWidth: f32,
  color: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
};

struct ViewUniforms {
  offsetX: f32,
  offsetY: f32,
  scale: f32,
  zoom: f32,
  canvasWidth: f32,
  canvasHeight: f32,
  sourceWidth: f32,
  sourceHeight: f32,
  cropOffsetX: f32,
  cropOffsetY: f32,
  antiAlias: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> view: ViewUniforms;
@group(0) @binding(1) var<storage, read> instances: array<InstanceData>;

// Quad vertices: 0-1 = left edge, 2-3 = right edge (as triangle strip)
fn getQuadVertex(vertexId: u32) -> vec2<f32> {
  switch(vertexId) {
    case 0u: { return vec2<f32>(0.0, -0.5); } // Start left
    case 1u: { return vec2<f32>(1.0, -0.5); } // End left
    case 2u: { return vec2<f32>(0.0,  0.5); } // Start right
    default: { return vec2<f32>(1.0,  0.5); } // End right
  }
}

fn transformToCanvas(pos: vec2<f32>) -> vec2<f32> {
  let totalScale = view.scale * view.zoom;
  let centerX = view.canvasWidth / 2.0;
  let centerY = view.canvasHeight / 2.0;

  let imageX = pos.x - view.cropOffsetX - view.sourceWidth / 2.0;
  let imageY = pos.y - view.cropOffsetY - view.sourceHeight / 2.0;

  return vec2<f32>(
    imageX * totalScale + centerX + view.offsetX,
    imageY * totalScale + centerY + view.offsetY
  );
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var output: VertexOutput;

  let inst = instances[instanceIndex];
  let quad = getQuadVertex(vertexIndex);

  // Calculate direction and normal
  let dir = inst.endPos - inst.startPos;
  let len = length(dir);
  var normal = vec2<f32>(0.0, 0.0);

  if (len > 0.001) {
    let dirNorm = dir / len;
    normal = vec2<f32>(-dirNorm.y, dirNorm.x);
  }

  // Interpolate position and width
  let t = quad.x;
  let pos = mix(inst.startPos, inst.endPos, t);
  let width = mix(inst.startWidth, inst.endWidth, t);

  // Transform and expand
  let canvasPos = transformToCanvas(pos);
  let totalScale = view.scale * view.zoom;
  let scaledWidth = width * totalScale;

  let expandedPos = canvasPos + normal * scaledWidth * quad.y;

  // Convert to clip space
  let clipX = (expandedPos.x / view.canvasWidth) * 2.0 - 1.0;
  let clipY = 1.0 - (expandedPos.y / view.canvasHeight) * 2.0;

  output.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  output.color = inst.color;
  output.uv = quad;

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Anti-aliasing at edges
  let edgeDist = abs(input.uv.y);
  let alpha = input.color.a * smoothstep(0.5, 0.4, edgeDist);

  return vec4<f32>(input.color.rgb, alpha);
}
`;

/**
 * Round cap shader for stroke endpoints
 */
export const STROKE_CAP_SHADER = `
struct CapData {
  center: vec2<f32>,
  direction: vec2<f32>,  // Direction the cap faces
  width: f32,
  color: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) localPos: vec2<f32>,  // Position relative to cap center
};

struct ViewUniforms {
  offsetX: f32,
  offsetY: f32,
  scale: f32,
  zoom: f32,
  canvasWidth: f32,
  canvasHeight: f32,
  sourceWidth: f32,
  sourceHeight: f32,
  cropOffsetX: f32,
  cropOffsetY: f32,
  antiAlias: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> view: ViewUniforms;
@group(0) @binding(1) var<storage, read> caps: array<CapData>;

// Semicircle vertices (triangle fan)
fn getSemicircleVertex(vertexId: u32, capDir: vec2<f32>) -> vec2<f32> {
  // 8 segments for semicircle
  let angle = f32(vertexId) * 3.14159 / 8.0;
  let x = cos(angle);
  let y = sin(angle);

  // Rotate to align with cap direction
  let rotX = x * capDir.x - y * capDir.y;
  let rotY = x * capDir.y + y * capDir.x;

  return vec2<f32>(rotX, rotY);
}

fn transformToCanvas(pos: vec2<f32>) -> vec2<f32> {
  let totalScale = view.scale * view.zoom;
  let centerX = view.canvasWidth / 2.0;
  let centerY = view.canvasHeight / 2.0;

  let imageX = pos.x - view.cropOffsetX - view.sourceWidth / 2.0;
  let imageY = pos.y - view.cropOffsetY - view.sourceHeight / 2.0;

  return vec2<f32>(
    imageX * totalScale + centerX + view.offsetX,
    imageY * totalScale + centerY + view.offsetY
  );
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var output: VertexOutput;

  let cap = caps[instanceIndex];
  let localPos = getSemicircleVertex(vertexIndex % 9u, cap.direction);

  let totalScale = view.scale * view.zoom;
  let radius = cap.width * totalScale * 0.5;

  let canvasCenter = transformToCanvas(cap.center);
  let expandedPos = canvasCenter + localPos * radius;

  let clipX = (expandedPos.x / view.canvasWidth) * 2.0 - 1.0;
  let clipY = 1.0 - (expandedPos.y / view.canvasHeight) * 2.0;

  output.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  output.color = cap.color;
  output.localPos = localPos;

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let dist = length(input.localPos);
  let alpha = input.color.a * smoothstep(1.0, 0.9, dist);

  return vec4<f32>(input.color.rgb, alpha);
}
`;
