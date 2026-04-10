export const GRAIN_SHADER_CODE = `// Film Grain shader — high-quality FBM-based organic grain
// Applied as final compositing pass after blur

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct GrainUniforms {
  // Grain parameters (1 param)
  grainAmount: f32,      // 0 to 100

  // Viewport (4 params)
  viewportZoom: f32,
  viewportOffsetX: f32,
  viewportOffsetY: f32,
  viewportScale: f32,

  // Transform (4 params)
  rotation: f32,         // in radians
  flipHorizontal: f32,   // 1.0 or -1.0
  flipVertical: f32,     // 1.0 or -1.0
  transformScale: f32,

  // Canvas dimensions (2 params)
  canvasWidth: f32,
  canvasHeight: f32,

  // Image dimensions (2 params)
  imageWidth: f32,
  imageHeight: f32,

  // Crop area (4 params)
  cropX: f32,
  cropY: f32,
  cropWidth: f32,
  cropHeight: f32,
};

@group(0) @binding(0) var mySampler: sampler;
@group(0) @binding(1) var myTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GrainUniforms;

// Simple pass-through vertex shader
@vertex
fn vs_main(@builtin(vertex_index) VertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
  // UV coordinates map directly to texture (0-1)
  output.uv = pos[VertexIndex] * 0.5 + 0.5;
  output.uv.y = 1.0 - output.uv.y; // Flip Y for texture coordinates
  return output;
}

// ── Noise primitives ──────────────────────────────────────

// High-quality 2D hash → uniform in [0, 1]
fn hash22(p: vec2<f32>) -> vec2<f32> {
  var p3 = fract(vec3<f32>(p.xyx) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

fn hash21(p: vec2<f32>) -> f32 {
  let p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  let d = dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z + d);
}

// Value noise: smooth interpolated noise from lattice hashing
fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);

  // Hermite smoothstep for smooth interpolation
  let u = f * f * (3.0 - 2.0 * f);

  let a = hash21(i + vec2<f32>(0.0, 0.0));
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian Motion — multi-octave value noise for organic grain texture
fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;

  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * valueNoise(pos * frequency);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
    // Rotate each octave slightly to reduce axis-aligned artifacts
    pos = vec2<f32>(
      pos.x * 0.866 - pos.y * 0.5,
      pos.x * 0.5 + pos.y * 0.866
    );
  }

  return value;
}

// Box-Muller: convert uniform pair to Gaussian N(0,1) sample
fn boxMuller(u: vec2<f32>) -> f32 {
  let u1 = max(u.x, 0.0001);
  return sqrt(-2.0 * log(u1)) * cos(6.28318530718 * u.y);
}

fn getLuminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// ── Image-space coordinate recovery ───────────────────────

fn canvasToImageCoord(canvasCoord: vec2<f32>) -> vec2<f32> {
  var coord = canvasCoord - vec2<f32>(params.canvasWidth * 0.5, params.canvasHeight * 0.5);

  // Reverse viewport
  coord = coord - vec2<f32>(params.viewportOffsetX, params.viewportOffsetY);

  let totalScale = params.viewportScale * params.viewportZoom * params.transformScale;
  coord = coord / totalScale;

  // Reverse rotation
  if (params.rotation != 0.0) {
    let cos_r = cos(-params.rotation);
    let sin_r = sin(-params.rotation);
    coord = vec2<f32>(
      coord.x * cos_r - coord.y * sin_r,
      coord.x * sin_r + coord.y * cos_r
    );
  }

  // Reverse flip
  coord.x = coord.x * params.flipHorizontal;
  coord.y = coord.y * params.flipVertical;

  // To image pixel coords
  if (params.cropWidth > 0.0 && params.cropHeight > 0.0) {
    return vec2<f32>(
      params.cropX + coord.x + params.cropWidth * 0.5,
      params.cropY + coord.y + params.cropHeight * 0.5
    );
  }
  return coord + vec2<f32>(params.imageWidth * 0.5, params.imageHeight * 0.5);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var color = textureSample(myTexture, mySampler, uv);
  var rgb = color.rgb;

  if (params.grainAmount <= 0.0) {
    return vec4<f32>(rgb, color.a);
  }

  // Recover image-space coordinates for stable grain
  let canvasCoord = uv * vec2<f32>(params.canvasWidth, params.canvasHeight);
  let imageCoord = canvasToImageCoord(canvasCoord);

  let grainIntensity = params.grainAmount / 100.0;
  let luma = getLuminance(rgb);

  // ── Film-authentic luminance mask ──
  // Real film: grain is STRONGEST in shadows, moderate in midtones, weakest in highlights.
  // Silver halide crystals are more visible in under-exposed areas.
  let shadowGrain = smoothstep(0.0, 0.3, luma);    // Ramp up from pure black
  let highlightDamp = 1.0 - smoothstep(0.6, 1.0, luma); // Dampen in highlights
  let lumaMask = mix(1.0, shadowGrain * highlightDamp, 0.4);
  // Ensure very dark areas (outside image bounds) don't show grain
  let boundsMask = smoothstep(0.01, 0.06, luma);
  let finalMask = lumaMask * boundsMask;

  // ── Multi-octave organic grain via FBM ──
  // Three independent noise layers at different scales for organic feel
  // Fine grain: ~2-3 pixel detail (high-ISO look)
  let fineNoise = fbm(imageCoord / 2.5, 2) - 0.5;
  // Medium grain: ~5-6 pixel clumps
  let medNoise = fbm(imageCoord / 5.5 + vec2<f32>(73.17, 91.43), 2) - 0.5;
  // Coarse structure: ~10-12 pixel variation
  let coarseNoise = fbm(imageCoord / 11.0 + vec2<f32>(149.3, 223.7), 2) - 0.5;

  // Weighted combination: emphasize fine grain for realistic look
  let combinedNoise = fineNoise * 0.50 + medNoise * 0.30 + coarseNoise * 0.20;

  // ── Per-channel color grain ──
  // Real film has slight color variations between RGB layers (chromatic grain).
  // Each channel gets a slightly different noise sample.
  let grainR = fbm(imageCoord / 3.0 + vec2<f32>(0.0, 0.0), 2) - 0.5;
  let grainG = fbm(imageCoord / 3.0 + vec2<f32>(37.7, 58.3), 2) - 0.5;
  let grainB = fbm(imageCoord / 3.0 + vec2<f32>(71.1, 113.9), 2) - 0.5;
  let chromaGrain = vec3<f32>(grainR, grainG, grainB);

  // Blend: 70% luminance grain (shared) + 30% chromatic grain (per-channel)
  let grainVec = combinedNoise * vec3<f32>(0.7) + chromaGrain * 0.3;

  // ── Apply grain ──
  let strength = grainIntensity * 0.30 * finalMask;
  rgb = rgb + grainVec * strength;

  // Clamp
  rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));

  return vec4<f32>(rgb, color.a);
}
`;
