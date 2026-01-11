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
