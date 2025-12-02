struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct CompositeUniforms {
  // Blur area bounds in normalized coordinates (0-1)
  minX: f32,
  minY: f32,
  maxX: f32,
  maxY: f32,
};

@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var blurredTexture: texture_2d<f32>;
@group(0) @binding(2) var baseTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> composite: CompositeUniforms;

@vertex
fn vs_main(@builtin(vertex_index) VertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
  // Convert NDC to UV with Y-flip (NDC bottom-left maps to UV top-left)
  let uv = pos[VertexIndex] * 0.5 + 0.5;
  output.uv = vec2<f32>(uv.x, 1.0 - uv.y);
  return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  // Sample both textures first (must be in uniform control flow)
  let blurredColor = textureSample(blurredTexture, mySampler, uv);
  let baseColor = textureSample(baseTexture, mySampler, uv);

  // Check if pixel is inside blur area bounds
  let inside = uv.x >= composite.minX && uv.x <= composite.maxX &&
               uv.y >= composite.minY && uv.y <= composite.maxY;

  // Use select to choose between blurred and base
  return select(baseColor, blurredColor, inside);
}
