struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct Uniforms {
  // Adjustments (10 params)
  brightness: f32,
  contrast: f32,
  exposure: f32,
  highlights: f32,
  shadows: f32,
  saturation: f32,
  temperature: f32,
  sepia: f32,
  grayscale: f32,
  vignette: f32,

  // Viewport (4 params)
  viewportZoom: f32,
  viewportOffsetX: f32,
  viewportOffsetY: f32,
  viewportScale: f32,

  // Transform (4 params)
  rotation: f32,        // in radians
  flipHorizontal: f32,  // 1.0 or -1.0
  flipVertical: f32,    // 1.0 or -1.0
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
@group(0) @binding(2) var<uniform> params: Uniforms;

// Full-screen triangle vertex shader
@vertex
fn vs_main(@builtin(vertex_index) VertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);

  // Convert NDC (-1 to 1) to canvas coordinates centered at origin
  // NDC: -1 → -canvasWidth/2, 0 → 0, 1 → canvasWidth/2
  // Note: NDC Y increases upward, but canvas Y increases downward, so flip Y
  var coord = pos[VertexIndex] * vec2<f32>(params.canvasWidth, params.canvasHeight) * 0.5;
  coord.y = -coord.y;

  // Reverse the 2D canvas transformations:
  // In 2D: translate(center + offset) → scale(zoom) → rotate → flip → draw(-w/2, -h/2)
  // In WebGPU (reverse): screen → un-translate → un-scale → un-rotate → un-flip → texture

  // 1. Subtract viewport offset (inverse of translate)
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

  // 5. Convert to texture coordinates
  // After inverse transformations, coord is in drawing space (centered at origin)

  // When there's a crop, viewport.scale is adjusted to fit crop area to canvas
  // This means coord values are scaled according to crop dimensions
  // We need to account for this when mapping to texture coordinates

  // ALWAYS use crop-aware logic
  if (params.cropWidth > 0.0 && params.cropHeight > 0.0) {
    // coord is in crop-centered space (units: pixels in crop area after inverse transforms)
    // The 2D canvas draws: drawImage(img, cropX, cropY, cropW, cropH, -cropW/2, -cropH/2, cropW, cropH)
    // This means the crop region is drawn centered, from (-cropW/2, -cropH/2) to (cropW/2, cropH/2)

    // Map from drawing space to texture coordinates:
    // Drawing space: coord ranges from (-cropW/2, -cropH/2) to (cropW/2, cropH/2)
    // Texture space: we want to read from (cropX, cropY) to (cropX+cropW, cropY+cropH)

    // Convert from centered coordinates to 0-based coordinates within crop region
    let cropLocalX = coord.x + params.cropWidth * 0.5;
    let cropLocalY = coord.y + params.cropHeight * 0.5;

    // Convert to texture coordinates by adding crop offset and normalizing by image size
    output.uv = vec2<f32>(
      (params.cropX + cropLocalX) / params.imageWidth,
      (params.cropY + cropLocalY) / params.imageHeight
    );
  } else {
    // No crop - standard transformation
    // Convert from image-centered space to top-left origin
    coord = coord + vec2<f32>(params.imageWidth * 0.5, params.imageHeight * 0.5);

    // Normalize to 0-1 range
    output.uv = coord / vec2<f32>(params.imageWidth, params.imageHeight);
  }

  return output;
}

// Helper functions
fn getLuminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn rgbToHsl(rgb: vec3<f32>) -> vec3<f32> {
  let maxVal = max(rgb.r, max(rgb.g, rgb.b));
  let minVal = min(rgb.r, min(rgb.g, rgb.b));
  var h = 0.0;
  var s = 0.0;
  let l = (maxVal + minVal) / 2.0;

  if (maxVal != minVal) {
    let d = maxVal - minVal;
    s = select(d / (maxVal + minVal), d / (2.0 - maxVal - minVal), l > 0.5);

    if (maxVal == rgb.r) {
      h = ((rgb.g - rgb.b) / d + select(0.0, 6.0, rgb.g < rgb.b)) / 6.0;
    } else if (maxVal == rgb.g) {
      h = ((rgb.b - rgb.r) / d + 2.0) / 6.0;
    } else {
      h = ((rgb.r - rgb.g) / d + 4.0) / 6.0;
    }
  }

  return vec3<f32>(h, s, l);
}

fn hslToRgb(hsl: vec3<f32>) -> vec3<f32> {
  let h = hsl.x;
  let s = hsl.y;
  let l = hsl.z;

  if (s == 0.0) {
    return vec3<f32>(l, l, l);
  }

  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;

  let r = hue2rgb(p, q, h + 1.0 / 3.0);
  let g = hue2rgb(p, q, h);
  let b = hue2rgb(p, q, h - 1.0 / 3.0);

  return vec3<f32>(r, g, b);
}

fn hue2rgb(p: f32, q: f32, t_: f32) -> f32 {
  var t = t_;
  if (t < 0.0) { t += 1.0; }
  if (t > 1.0) { t -= 1.0; }
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 1.0 / 2.0) { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  // Sample texture FIRST (must be in uniform control flow before any branching)
  var color = textureSample(myTexture, mySampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
  var rgb = color.rgb;

  // Check if outside texture bounds (0-1) and set to black
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    rgb = vec3<f32>(0.0);
  }

  // When crop is active, only show the crop region - black out everything else
  if (params.cropWidth > 0.0) {
    let cropMinU = params.cropX / params.imageWidth;
    let cropMaxU = (params.cropX + params.cropWidth) / params.imageWidth;
    let cropMinV = params.cropY / params.imageHeight;
    let cropMaxV = (params.cropY + params.cropHeight) / params.imageHeight;

    // If UV is outside the crop region, render black
    if (uv.x < cropMinU || uv.x > cropMaxU || uv.y < cropMinV || uv.y > cropMaxV) {
      rgb = vec3<f32>(0.0);
    }
  }

  // 1. Brightness
  if (params.brightness != 0.0) {
    let factor = 1.0 + (params.brightness / 200.0);
    rgb = rgb * factor;
  }

  // 2. Contrast
  if (params.contrast != 0.0) {
    let factor = 1.0 + (params.contrast / 200.0);
    rgb = (rgb - 0.5) * factor + 0.5;
  }

  // 3. Exposure
  if (params.exposure != 0.0) {
    rgb = rgb * exp2(params.exposure / 100.0);
  }

  // 4. Shadows and Highlights
  if (params.shadows != 0.0 || params.highlights != 0.0) {
    let luma = getLuminance(rgb);

    if (params.shadows != 0.0) {
      let shadowMask = pow(1.0 - luma, 2.0);
      rgb = rgb - rgb * (params.shadows / 100.0) * shadowMask * 0.5;
    }

    if (params.highlights != 0.0) {
      let highlightMask = pow(luma, 2.0);
      rgb = rgb + rgb * (params.highlights / 100.0) * highlightMask * 0.5;
    }
  }

  // 5. Saturation
  if (params.saturation != 0.0) {
    rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    var hsl = rgbToHsl(rgb);
    hsl.y = clamp(hsl.y * (1.0 + params.saturation / 100.0), 0.0, 1.0);
    rgb = hslToRgb(hsl);
  }

  // 5.5. Color Temperature
  // Warm (positive): add red, subtract blue
  // Cool (negative): subtract red, add blue
  if (params.temperature != 0.0) {
    let temp = params.temperature / 100.0;
    rgb.r = rgb.r + temp * 0.1;
    rgb.b = rgb.b - temp * 0.1;
  }

  // 6. Sepia
  if (params.sepia != 0.0) {
    let sepiaAmount = params.sepia / 100.0;
    let tr = 0.393 * rgb.r + 0.769 * rgb.g + 0.189 * rgb.b;
    let tg = 0.349 * rgb.r + 0.686 * rgb.g + 0.168 * rgb.b;
    let tb = 0.272 * rgb.r + 0.534 * rgb.g + 0.131 * rgb.b;
    rgb = mix(rgb, vec3<f32>(tr, tg, tb), sepiaAmount);
  }

  // 7. Grayscale
  if (params.grayscale != 0.0) {
    let gray = getLuminance(rgb);
    rgb = mix(rgb, vec3<f32>(gray), params.grayscale / 100.0);
  }

  // 8. Vignette
  if (params.vignette != 0.0) {
    let center = vec2<f32>(0.5, 0.5);
    let dist = distance(uv, center);
    let vignetteFactor = params.vignette / 100.0;
    let vignetteAmount = pow(dist * 1.4, 2.0);
    rgb = rgb * (1.0 + vignetteFactor * vignetteAmount * 1.5);
  }

  // Clamp final result
  rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));

  return vec4<f32>(rgb, color.a);
}
