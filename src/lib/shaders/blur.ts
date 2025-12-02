export const BLUR_SHADER_CODE = `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct BlurUniforms {
  direction: vec2<f32>,  // (1, 0) for horizontal, (0, 1) for vertical
  radius: f32,
  padding: f32,
};

@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var myTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> blur: BlurUniforms;

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
  let r = i32(blur.radius);

  // Pass-through if radius is 0
  if (r == 0) {
    return textureSample(myTexture, mySampler, uv);
  }

  let texSize = vec2<f32>(textureDimensions(myTexture));
  let texelSize = 1.0 / texSize;

  // Gaussian blur weights (for radius up to 10)
  // Pre-normalized weights for different radii
  var color = vec4<f32>(0.0);

  // Simple box blur for now (equal weights)
  // TODO: Use proper Gaussian weights
  let totalSamples = f32(r * 2 + 1);

  // Sample along the blur direction
  for (var i = -r; i <= r; i = i + 1) {
    let offset = vec2<f32>(f32(i)) * blur.direction * texelSize;
    let sampleUV = uv + offset;
    color = color + textureSample(myTexture, mySampler, sampleUV) / totalSamples;
  }

  return color;
}
`;
