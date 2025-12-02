export const GRAIN_SHADER_CODE = `// Grain shader - applies film grain on top of processed image
// This shader is designed to be used as a final pass after blur

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

// Helper functions
fn getLuminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// High-quality 2D hash function for uniform random numbers in [0, 1]
fn hash2d(p: vec2<f32>) -> f32 {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
  let dot_p3 = dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z + dot_p3);
}

// Generate two independent uniform random numbers
fn hash2d_dual(p: vec2<f32>) -> vec2<f32> {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
  let p4 = fract(vec3<f32>(p.y, p.x, p.y) * vec3<f32>(0.0973, 0.1031, 0.1030));
  let dot_p3 = dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
  let dot_p4 = dot(p4, vec3<f32>(p4.y, p4.z, p4.x) + 45.67);
  return vec2<f32>(
    fract((p3.x + p3.y) * p3.z + dot_p3),
    fract((p4.x + p4.y) * p4.z + dot_p4)
  );
}

// Box-Muller transform: converts two uniform random variables to Gaussian distribution
// Returns a sample from N(0, 1) - standard normal distribution
fn boxMuller(u1: f32, u2: f32) -> f32 {
  // Ensure u1 is not zero to avoid log(0)
  let u1_safe = max(u1, 0.0001);
  let radius = sqrt(-2.0 * log(u1_safe));
  let theta = 2.0 * 3.14159265359 * u2;
  return radius * cos(theta);
}

// Generate Gaussian-distributed noise using Box-Muller transform
fn gaussianNoise(p: vec2<f32>) -> f32 {
  let uniforms = hash2d_dual(p);
  return boxMuller(uniforms.x, uniforms.y);
}

// Overlay blend mode - enhances contrast
// When a < 0.5: result = 2 * a * b
// When a >= 0.5: result = 1 - 2 * (1-a) * (1-b)
fn overlayBlend(base: f32, blend: f32) -> f32 {
  if (base < 0.5) {
    return 2.0 * base * blend;
  } else {
    return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  }
}

// Soft light blend mode - gentler than overlay
fn softLightBlend(base: f32, blend: f32) -> f32 {
  if (blend < 0.5) {
    return base - (1.0 - 2.0 * blend) * base * (1.0 - base);
  } else {
    let d = select(sqrt(base), base, base < 0.25);
    return base + (2.0 * blend - 1.0) * (d - base);
  }
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  // Sample the blurred/processed texture
  var color = textureSample(myTexture, mySampler, uv);
  var rgb = color.rgb;

  // Calculate image-space coordinates for grain
  // Convert UV (0-1) to canvas coordinates
  var canvasCoord = uv * vec2<f32>(params.canvasWidth, params.canvasHeight);

  // Convert canvas coordinates (top-left origin) to centered coordinates
  var coord = canvasCoord - vec2<f32>(params.canvasWidth * 0.5, params.canvasHeight * 0.5);

  // Reverse the viewport transformations to get image-space coordinates
  // 1. Subtract viewport offset
  coord = coord - vec2<f32>(params.viewportOffsetX, params.viewportOffsetY);

  // 2. Inverse zoom/scale
  let totalScale = params.viewportScale * params.viewportZoom * params.transformScale;
  coord = coord / totalScale;

  // 3. Inverse rotation
  if (params.rotation != 0.0) {
    let cos_r = cos(-params.rotation);
    let sin_r = sin(-params.rotation);
    coord = vec2<f32>(
      coord.x * cos_r - coord.y * sin_r,
      coord.x * sin_r + coord.y * cos_r
    );
  }

  // 4. Inverse flip
  coord.x = coord.x * params.flipHorizontal;
  coord.y = coord.y * params.flipVertical;

  // 5. Convert to image pixel coordinates
  var imageCoord: vec2<f32>;
  if (params.cropWidth > 0.0 && params.cropHeight > 0.0) {
    // Crop mode: coord is in crop-centered space
    let cropLocalX = coord.x + params.cropWidth * 0.5;
    let cropLocalY = coord.y + params.cropHeight * 0.5;
    imageCoord = vec2<f32>(
      params.cropX + cropLocalX,
      params.cropY + cropLocalY
    );
  } else {
    // No crop: coord is in image-centered space
    imageCoord = coord + vec2<f32>(params.imageWidth * 0.5, params.imageHeight * 0.5);
  }

  // Apply film grain if enabled
  if (params.grainAmount > 0.0) {
    let grainIntensity = params.grainAmount / 100.0;

    // Calculate luminance for grain masking
    let luma = getLuminance(rgb);

    // === Authentic film grain using uniform distribution ===
    // Film grain is random, sharp, and granular - not smooth Gaussian

    // Primary grain layer (2.5-3 pixels) - sharp, visible grain
    let grain1 = hash2d(floor(imageCoord / 2.8)) - 0.5;

    // Secondary grain layer (3.5-4 pixels) - adds texture variation
    let grain2 = hash2d(floor(imageCoord / 3.6) + vec2<f32>(123.45, 678.90)) - 0.5;

    // Tertiary grain layer (5-6 pixels) - larger grain structure
    let grain3 = hash2d(floor(imageCoord / 5.2) + vec2<f32>(345.67, 890.12)) - 0.5;

    // Coarse grain layer (7-8 pixels) - clumping effect
    let grain4 = hash2d(floor(imageCoord / 7.5) + vec2<f32>(567.89, 234.56)) - 0.5;

    // Combine with emphasis on visible mid-size grain
    // Sharp transitions create authentic film texture
    let grainNoise = grain1 * 0.35 + grain2 * 0.3 + grain3 * 0.25 + grain4 * 0.1;

    // Enhance grain contrast for more pronounced effect
    let enhancedGrain = sign(grainNoise) * pow(abs(grainNoise), 0.8);

    // === Luminance-based masking ===
    // Grain visible across most tones, natural falloff at extremes
    var lumaMask = 1.0 - pow(abs(luma - 0.5) * 2.0, 1.5);
    lumaMask = smoothstep(0.1, 1.0, lumaMask);

    // Hide grain in very dark areas (outside image bounds)
    let shadowMask = smoothstep(0.02, 0.12, luma);

    // Slightly reduce grain in very bright areas
    let highlightMask = 1.0 - smoothstep(0.9, 1.0, luma);

    lumaMask = lumaMask * shadowMask * highlightMask;

    // === Apply strong, visible grain ===
    let grainStrength = grainIntensity * 0.35;

    // Apply grain with luminance masking
    let grainValue = enhancedGrain * grainStrength * lumaMask;
    rgb = rgb + vec3<f32>(grainValue);
  }

  // Clamp final result
  rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));

  return vec4<f32>(rgb, color.a);
}
`;
