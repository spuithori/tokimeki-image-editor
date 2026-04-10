/**
 * Professional Unsharp Mask Shader
 *
 * Lightroom/Capture One quality sharpening:
 * - Luminance-only sharpening (no color fringing)
 * - Smooth threshold masking (noise-aware)
 * - Halo suppression (limits overshoot around edges)
 * - Proper detail scaling
 *
 * Takes the original and a Gaussian-blurred version as inputs.
 * sharpened_L = L + clamp(L - blurred_L, -maxHalo, maxHalo) * amount * mask
 * RGB is then reconstructed preserving original chrominance.
 */
export const SHARPEN_SHADER_CODE = `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct SharpenUniforms {
  amount: f32,     // 0-2 (mapped from 0-100: amount/50)
  threshold: f32,  // 0-1 smoothstep threshold for noise gating
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var originalTexture: texture_2d<f32>;
@group(0) @binding(2) var blurredTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> sharpen: SharpenUniforms;

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
  let original = textureSample(originalTexture, mySampler, uv);
  let blurred = textureSample(blurredTexture, mySampler, uv);

  if (sharpen.amount <= 0.0) {
    return original;
  }

  // ── Step 1: Extract luminance detail (high-pass) ──
  let origLuma = getLuminance(original.rgb);
  let blurLuma = getLuminance(blurred.rgb);
  let detail = origLuma - blurLuma;
  let detailAbs = abs(detail);

  // ── Step 2: Noise-aware threshold mask ──
  // Smooth rolloff: details below threshold are suppressed, above are fully sharpened.
  // The wide smoothstep range (0.3× to 2.5× threshold) avoids hard cutoff artifacts.
  let tLow = sharpen.threshold * 0.3;
  let tHigh = sharpen.threshold * 2.5 + 0.002; // +epsilon to avoid tLow==tHigh
  let noiseMask = smoothstep(tLow, tHigh, detailAbs);

  // ── Step 3: Halo suppression ──
  // Soft-clip the detail signal to prevent bright/dark halos around strong edges.
  // maxHalo scales with amount so stronger sharpening allows slightly more halo.
  let maxHalo = 0.08 + sharpen.amount * 0.04; // 0.08 to 0.16
  let softDetail = sign(detail) * maxHalo * tanh(detailAbs / maxHalo);

  // ── Step 4: Luminance-only sharpening ──
  let sharpenedLuma = origLuma + softDetail * sharpen.amount * noiseMask;

  // ── Step 5: Reconstruct RGB preserving chrominance ──
  // Scale RGB uniformly to achieve the new luminance.
  // This avoids color shifts that occur when sharpening R/G/B independently.
  var sharpened = original.rgb;
  if (origLuma > 0.001) {
    let ratio = clamp(sharpenedLuma / origLuma, 0.2, 5.0);
    sharpened = original.rgb * ratio;
  } else {
    // Very dark pixels: additive approach to avoid divide-by-near-zero
    let boost = softDetail * sharpen.amount * noiseMask;
    sharpened = original.rgb + vec3<f32>(boost);
  }

  return vec4<f32>(clamp(sharpened, vec3<f32>(0.0), vec3<f32>(1.0)), original.a);
}
`;
