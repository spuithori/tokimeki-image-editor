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

// Compute Gaussian weight for offset d with standard deviation sigma.
// G(d, sigma) = exp(-d*d / (2 * sigma * sigma))
fn gaussianWeight(d: f32, sigma: f32) -> f32 {
  return exp(-(d * d) / (2.0 * sigma * sigma));
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

  // Derive sigma from radius: sigma = radius / 3 covers ~99.7% of distribution.
  // Minimum sigma of 0.5 to avoid divide-by-zero-like issues.
  let sigma = max(f32(r) / 3.0, 0.5);

  // Gaussian-weighted separable blur
  var color = vec4<f32>(0.0);
  var totalWeight = 0.0;

  for (var i = -r; i <= r; i = i + 1) {
    let w = gaussianWeight(f32(i), sigma);
    let offset = vec2<f32>(f32(i)) * blur.direction * texelSize;
    let sampleUV = clamp(uv + offset, vec2<f32>(0.0), vec2<f32>(1.0));
    color = color + textureSample(myTexture, mySampler, sampleUV) * w;
    totalWeight = totalWeight + w;
  }

  return color / totalWeight;
}
`;
