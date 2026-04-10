/**
 * Bilateral Filter Denoise Shader
 *
 * Edge-preserving smoothing: combines spatial proximity with luminance similarity.
 * Smooths noise while preserving sharp edges.
 */
export const DENOISE_SHADER_CODE = `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct DenoiseUniforms {
  strength: f32,    // 0-1 (mapped from 0-100)
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var myTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> denoise: DenoiseUniforms;

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

fn getLuminance(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let center = textureSample(myTexture, mySampler, uv);

  if (denoise.strength <= 0.0) {
    return center;
  }

  let texSize = vec2<f32>(textureDimensions(myTexture));
  let texelSize = 1.0 / texSize;

  // Bilateral filter parameters derived from strength
  // Spatial sigma: controls blur extent (1-3 pixels)
  let sigmaSpatial = 1.0 + denoise.strength * 2.0;
  // Range sigma: controls edge preservation (lower = sharper edges preserved)
  let sigmaRange = 0.05 + denoise.strength * 0.15;

  let centerLuma = getLuminance(center.rgb);

  // 5×5 bilateral filter kernel
  var result = vec3<f32>(0.0);
  var totalWeight = 0.0;
  let radius = 2;

  for (var dy = -radius; dy <= radius; dy = dy + 1) {
    for (var dx = -radius; dx <= radius; dx = dx + 1) {
      let offset = vec2<f32>(f32(dx), f32(dy)) * texelSize;
      let sampleUV = clamp(uv + offset, vec2<f32>(0.0), vec2<f32>(1.0));
      let sampleColor = textureSample(myTexture, mySampler, sampleUV);

      // Spatial weight (Gaussian)
      let spatialDist = f32(dx * dx + dy * dy);
      let spatialWeight = exp(-spatialDist / (2.0 * sigmaSpatial * sigmaSpatial));

      // Range/luminance weight (Gaussian on color difference)
      let sampleLuma = getLuminance(sampleColor.rgb);
      let lumaDiff = centerLuma - sampleLuma;
      let rangeWeight = exp(-(lumaDiff * lumaDiff) / (2.0 * sigmaRange * sigmaRange));

      let w = spatialWeight * rangeWeight;
      result = result + sampleColor.rgb * w;
      totalWeight = totalWeight + w;
    }
  }

  let denoised = result / totalWeight;
  return vec4<f32>(denoised, center.a);
}
`;
