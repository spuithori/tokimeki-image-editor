import type { AdjustmentsState, Viewport, TransformState, CropArea, BlurArea } from '../types';

/**
 * WebGPU Render Pipeline for image adjustments with viewport and transform support
 * Uses fragment shader to apply adjustments in real-time
 */

// WGSL Shader for image adjustments using render pipeline
const SHADER_CODE = /* wgsl */ `
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
  // The viewport scale is adjusted to fit either the full image or crop area

  var imgWidth = params.imageWidth;
  var imgHeight = params.imageHeight;
  var texOffsetX = 0.0;
  var texOffsetY = 0.0;

  if (params.cropWidth > 0.0 && params.cropHeight > 0.0) {
    // When cropped, the viewport.scale has been adjusted to fit the crop area
    // So coord is already in crop-centered space (units: crop pixels)
    imgWidth = params.cropWidth;
    imgHeight = params.cropHeight;
    texOffsetX = params.cropX / params.imageWidth;
    texOffsetY = params.cropY / params.imageHeight;
  }

  // Convert from centered space to top-left origin
  coord = coord + vec2<f32>(imgWidth * 0.5, imgHeight * 0.5);

  // Normalize to 0-1 range
  var texCoord = coord / vec2<f32>(imgWidth, imgHeight);

  // When cropped, map to the crop region in the texture
  if (params.cropWidth > 0.0 && params.cropHeight > 0.0) {
    texCoord = texCoord * vec2<f32>(params.cropWidth / params.imageWidth, params.cropHeight / params.imageHeight);
    texCoord = texCoord + vec2<f32>(texOffsetX, texOffsetY);
  }

  output.uv = texCoord;

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

  // FIX: Swapped arguments in select() for correct HSL to RGB conversion
  // select(false_value, true_value, condition)
  // When l < 0.5, we want l * (1.0 + s)
  // When l >= 0.5, we want l + s - l * s
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
  // Sample texture first (must be in uniform control flow)
  var color = textureSample(myTexture, mySampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
  var rgb = color.rgb;

  // Check if outside bounds and set to black if so
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    rgb = vec3<f32>(0.0);
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
`;

// WGSL Shader for Gaussian Blur (separable, single-pass)
const BLUR_SHADER_CODE = /* wgsl */ `
struct VertexOutput {
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

// WGSL Shader for compositing blurred region onto base image
const COMPOSITE_SHADER_CODE = /* wgsl */ `
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
`;

// WebGPU state
let gpuDevice: GPUDevice | null = null;
let gpuContext: GPUCanvasContext | null = null;
let gpuPipeline: GPURenderPipeline | null = null;
let gpuUniformBuffer: GPUBuffer | null = null;
let gpuSampler: GPUSampler | null = null;
let gpuTexture: GPUTexture | null = null;
let gpuBindGroup: GPUBindGroup | null = null;
let currentCanvas: HTMLCanvasElement | null = null;

// Blur pipeline state
let gpuBlurPipeline: GPURenderPipeline | null = null;
let gpuBlurUniformBuffer: GPUBuffer | null = null;
let gpuIntermediateTexture: GPUTexture | null = null;
let gpuIntermediateTexture2: GPUTexture | null = null;

// Composite pipeline state
let gpuCompositePipeline: GPURenderPipeline | null = null;
let gpuCompositeUniformBuffer: GPUBuffer | null = null;
let gpuIntermediateTexture3: GPUTexture | null = null;
let gpuIntermediateTexture4: GPUTexture | null = null; // 4th texture for blur temp

/**
 * Initialize WebGPU for the given canvas
 */
export async function initWebGPUCanvas(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    if (!navigator.gpu) {
      console.warn('WebGPU not supported');
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.warn('No WebGPU adapter');
      return false;
    }

    gpuDevice = await adapter.requestDevice();

    // Get WebGPU context
    gpuContext = canvas.getContext('webgpu') as GPUCanvasContext;
    if (!gpuContext) {
      console.warn('Failed to get WebGPU context');
      return false;
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    gpuContext.configure({
      device: gpuDevice,
      format: format,
      alphaMode: 'premultiplied',
    });

    // Create uniform buffer
    // 10 (adjustments) + 4 (viewport) + 4 (transform) + 2 (canvas dims) + 2 (image dims) + 4 (crop) = 26 floats
    // Round up to 32 for alignment
    gpuUniformBuffer = gpuDevice.createBuffer({
      size: 128, // 32 floats * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create sampler
    gpuSampler = gpuDevice.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    // Create shader module
    const shaderModule = gpuDevice.createShaderModule({ code: SHADER_CODE });

    // Create render pipeline
    gpuPipeline = gpuDevice.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Create blur pipeline
    const blurShaderModule = gpuDevice.createShaderModule({ code: BLUR_SHADER_CODE });
    gpuBlurPipeline = gpuDevice.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: blurShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: blurShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Create blur uniform buffer
    gpuBlurUniformBuffer = gpuDevice.createBuffer({
      size: 16, // 2 floats (direction) + 1 float (radius) + 1 float (padding) = 4 floats * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create composite pipeline
    const compositeShaderModule = gpuDevice.createShaderModule({ code: COMPOSITE_SHADER_CODE });
    gpuCompositePipeline = gpuDevice.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: compositeShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: compositeShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Create composite uniform buffer
    gpuCompositeUniformBuffer = gpuDevice.createBuffer({
      size: 16, // 4 floats (minX, minY, maxX, maxY) = 4 floats * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    currentCanvas = canvas;
    console.log('WebGPU render pipeline initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize WebGPU:', error);
    return false;
  }
}

/**
 * Upload image to GPU as texture
 */
export async function uploadImageToGPU(imageSource: HTMLImageElement | ImageBitmap): Promise<boolean> {
  if (!gpuDevice || !gpuPipeline) return false;

  try {
    // Create texture from image
    const bitmap = imageSource instanceof ImageBitmap
      ? imageSource
      : await createImageBitmap(imageSource);

    gpuTexture = gpuDevice.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    gpuDevice.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: gpuTexture },
      [bitmap.width, bitmap.height]
    );

    // Update bind group
    updateBindGroup();
    return true;
  } catch (error) {
    console.error('Failed to upload image to GPU:', error);
    return false;
  }
}

/**
 * Update bind group with current texture and uniforms
 */
function updateBindGroup() {
  if (!gpuDevice || !gpuPipeline || !gpuTexture || !gpuSampler || !gpuUniformBuffer) return;

  gpuBindGroup = gpuDevice.createBindGroup({
    layout: gpuPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: gpuSampler },
      { binding: 1, resource: gpuTexture.createView() },
      { binding: 2, resource: { buffer: gpuUniformBuffer } },
    ],
  });
}

/**
 * Ensure intermediate textures exist and match canvas size
 */
function ensureIntermediateTextures(width: number, height: number) {
  if (!gpuDevice) return;

  const format = navigator.gpu.getPreferredCanvasFormat();

  // Check if textures need to be recreated
  const needsRecreate =
    !gpuIntermediateTexture ||
    gpuIntermediateTexture.width !== width ||
    gpuIntermediateTexture.height !== height;

  if (needsRecreate) {
    // Destroy old textures
    gpuIntermediateTexture?.destroy();
    gpuIntermediateTexture2?.destroy();
    gpuIntermediateTexture3?.destroy();
    gpuIntermediateTexture4?.destroy();

    // Create new intermediate textures
    gpuIntermediateTexture = gpuDevice.createTexture({
      size: [width, height, 1],
      format: format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    gpuIntermediateTexture2 = gpuDevice.createTexture({
      size: [width, height, 1],
      format: format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    gpuIntermediateTexture3 = gpuDevice.createTexture({
      size: [width, height, 1],
      format: format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    gpuIntermediateTexture4 = gpuDevice.createTexture({
      size: [width, height, 1],
      format: format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
}

/**
 * Render with adjustments, viewport, transform, crop, and blur areas
 */
export function renderWithAdjustments(
  adjustments: AdjustmentsState,
  viewport: Viewport,
  transform: TransformState,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
  cropArea: CropArea | null = null,
  blurAreas: BlurArea[] = []
): boolean {
  if (!gpuDevice || !gpuContext || !gpuPipeline || !gpuBindGroup || !gpuUniformBuffer) {
    return false;
  }

  try {
    // Convert rotation from degrees to radians
    const rotationRad = (transform.rotation * Math.PI) / 180;

    // Update uniforms
    const uniformData = new Float32Array([
      // Adjustments (10 floats)
      adjustments.brightness,
      adjustments.contrast,
      adjustments.exposure,
      adjustments.highlights,
      adjustments.shadows,
      adjustments.saturation,
      adjustments.temperature,
      adjustments.sepia,
      adjustments.grayscale,
      adjustments.vignette,

      // Viewport (4 floats)
      viewport.zoom,
      viewport.offsetX,
      viewport.offsetY,
      viewport.scale,

      // Transform (4 floats)
      rotationRad,
      transform.flipHorizontal ? -1.0 : 1.0,
      transform.flipVertical ? -1.0 : 1.0,
      transform.scale,

      // Canvas dimensions (2 floats)
      canvasWidth,
      canvasHeight,

      // Image dimensions (2 floats)
      imageWidth,
      imageHeight,

      // Crop area (4 floats)
      cropArea?.x ?? 0,
      cropArea?.y ?? 0,
      cropArea?.width ?? 0,
      cropArea?.height ?? 0,

      // Padding to 32 floats for alignment
      0, 0, 0, 0, 0, 0
    ]);
    gpuDevice.queue.writeBuffer(gpuUniformBuffer, 0, uniformData);

    // Check if we need blur processing
    const hasBlur = blurAreas.length > 0 && blurAreas.some(area => area.blurStrength > 0);

    if (!hasBlur) {
      // No blur - render directly to canvas
      const commandEncoder = gpuDevice.createCommandEncoder();
      const textureView = gpuContext.getCurrentTexture().createView();

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      renderPass.setPipeline(gpuPipeline);
      renderPass.setBindGroup(0, gpuBindGroup);
      renderPass.draw(3, 1, 0, 0);
      renderPass.end();

      gpuDevice.queue.submit([commandEncoder.finish()]);
      return true;
    }

    // Has blur - use multi-pass rendering
    return renderWithBlur(blurAreas, canvasWidth, canvasHeight, imageWidth, imageHeight, cropArea, viewport, transform);
  } catch (error) {
    console.error('WebGPU render failed:', error);
    return false;
  }
}

/**
 * Render with blur areas using regional blur compositing
 */
function renderWithBlur(
  blurAreas: BlurArea[],
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
  cropArea: CropArea | null,
  viewport: Viewport,
  transform: TransformState
): boolean {
  if (!gpuDevice || !gpuContext || !gpuPipeline || !gpuBindGroup ||
      !gpuBlurPipeline || !gpuBlurUniformBuffer ||
      !gpuCompositePipeline || !gpuCompositeUniformBuffer || !gpuSampler) {
    console.error('Missing WebGPU resources for blur');
    return false;
  }

  // Ensure all intermediate textures exist
  ensureIntermediateTextures(canvasWidth, canvasHeight);
  if (!gpuIntermediateTexture || !gpuIntermediateTexture2 ||
      !gpuIntermediateTexture3 || !gpuIntermediateTexture4) {
    console.error('Failed to create intermediate textures');
    return false;
  }

  const intermediateView1 = gpuIntermediateTexture.createView();
  const intermediateView2 = gpuIntermediateTexture2.createView();
  const intermediateView3 = gpuIntermediateTexture3.createView();
  const intermediateView4 = gpuIntermediateTexture4.createView();

  // === Pass 1: Render adjustments to intermediate texture 1 (base image) ===
  let commandEncoder = gpuDevice.createCommandEncoder();

  const renderPass1 = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: intermediateView1,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });

  renderPass1.setPipeline(gpuPipeline);
  renderPass1.setBindGroup(0, gpuBindGroup);
  renderPass1.draw(3, 1, 0, 0);
  renderPass1.end();

  gpuDevice.queue.submit([commandEncoder.finish()]);

  // === Pass 2: Copy base image to accumulator (intermediate1 -> intermediate4) ===
  commandEncoder = gpuDevice.createCommandEncoder();

  const blurUniformsZero = new Float32Array([1.0, 0.0, 0.0, 0.0]);
  gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, blurUniformsZero);

  const copyBindGroup = gpuDevice.createBindGroup({
    layout: gpuBlurPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: gpuSampler },
      { binding: 1, resource: intermediateView1 },
      { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
    ],
  });

  const copyPass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: intermediateView4,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });

  copyPass.setPipeline(gpuBlurPipeline);
  copyPass.setBindGroup(0, copyBindGroup);
  copyPass.draw(3, 1, 0, 0);
  copyPass.end();

  gpuDevice.queue.submit([commandEncoder.finish()]);

  // === Pass 3: Process each blur area ===
  // Determine source dimensions based on crop
  const sourceWidth = cropArea ? cropArea.width : imageWidth;
  const sourceHeight = cropArea ? cropArea.height : imageHeight;
  const cropOffsetX = cropArea ? cropArea.x : 0;
  const cropOffsetY = cropArea ? cropArea.y : 0;

  // Calculate transform parameters (same as 2D canvas)
  const totalScale = viewport.scale * viewport.zoom * transform.scale;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  for (const blurArea of blurAreas) {
    if (blurArea.blurStrength <= 0) continue;

    const blurRadius = Math.min(Math.ceil((blurArea.blurStrength / 100) * 50), 50);

    // Blur areas are in IMAGE space, need to convert to canvas space, then to UV
    // Following the same logic as 2D canvas implementation

    // 1. Convert blur area to crop-relative coordinates
    const relativeX = blurArea.x - cropOffsetX;
    const relativeY = blurArea.y - cropOffsetY;

    // 2. Transform from image space to canvas space
    const canvasBlurX = (relativeX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX;
    const canvasBlurY = (relativeY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY;
    const canvasBlurWidth = blurArea.width * totalScale;
    const canvasBlurHeight = blurArea.height * totalScale;

    // 3. Convert canvas space to normalized UV coordinates (0-1)
    const minX = Math.max(0, Math.min(1, canvasBlurX / canvasWidth));
    const minY = Math.max(0, Math.min(1, canvasBlurY / canvasHeight));
    const maxX = Math.max(0, Math.min(1, (canvasBlurX + canvasBlurWidth) / canvasWidth));
    const maxY = Math.max(0, Math.min(1, (canvasBlurY + canvasBlurHeight) / canvasHeight));

    // Pass 3a: Horizontal blur (intermediate1 base -> intermediate2)
    commandEncoder = gpuDevice.createCommandEncoder();

    const blurUniformsH = new Float32Array([1.0, 0.0, blurRadius, 0.0]);
    gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, blurUniformsH);

    const blurBindGroupH = gpuDevice.createBindGroup({
      layout: gpuBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView1 },
        { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
      ],
    });

    const renderPassH = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediateView2,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    renderPassH.setPipeline(gpuBlurPipeline);
    renderPassH.setBindGroup(0, blurBindGroupH);
    renderPassH.draw(3, 1, 0, 0);
    renderPassH.end();

    gpuDevice.queue.submit([commandEncoder.finish()]);

    // Pass 3b: Vertical blur (intermediate2 -> intermediate3)
    commandEncoder = gpuDevice.createCommandEncoder();

    const blurUniformsV = new Float32Array([0.0, 1.0, blurRadius, 0.0]);
    gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, blurUniformsV);

    const blurBindGroupV = gpuDevice.createBindGroup({
      layout: gpuBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView2 },
        { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
      ],
    });

    const renderPassV = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediateView3,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    renderPassV.setPipeline(gpuBlurPipeline);
    renderPassV.setBindGroup(0, blurBindGroupV);
    renderPassV.draw(3, 1, 0, 0);
    renderPassV.end();

    gpuDevice.queue.submit([commandEncoder.finish()]);

    // Pass 3c: Composite blurred region with accumulator (intermediate3 blurred + intermediate4 accumulator -> intermediate2)
    commandEncoder = gpuDevice.createCommandEncoder();

    const compositeUniforms = new Float32Array([minX, minY, maxX, maxY]);
    gpuDevice.queue.writeBuffer(gpuCompositeUniformBuffer, 0, compositeUniforms);

    const compositeBindGroup = gpuDevice.createBindGroup({
      layout: gpuCompositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView3 }, // blurred
        { binding: 2, resource: intermediateView4 }, // accumulator
        { binding: 3, resource: { buffer: gpuCompositeUniformBuffer } },
      ],
    });

    const renderPassComp = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediateView2,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    renderPassComp.setPipeline(gpuCompositePipeline);
    renderPassComp.setBindGroup(0, compositeBindGroup);
    renderPassComp.draw(3, 1, 0, 0);
    renderPassComp.end();

    gpuDevice.queue.submit([commandEncoder.finish()]);

    // Pass 3d: Copy result back to accumulator (intermediate2 -> intermediate4)
    commandEncoder = gpuDevice.createCommandEncoder();

    gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, blurUniformsZero);

    const copyBackBindGroup = gpuDevice.createBindGroup({
      layout: gpuBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView2 },
        { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
      ],
    });

    const copyBackPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediateView4,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    copyBackPass.setPipeline(gpuBlurPipeline);
    copyBackPass.setBindGroup(0, copyBackBindGroup);
    copyBackPass.draw(3, 1, 0, 0);
    copyBackPass.end();

    gpuDevice.queue.submit([commandEncoder.finish()]);
  }

  // === Pass 4: Copy final accumulated result to canvas ===
  commandEncoder = gpuDevice.createCommandEncoder();

  gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, blurUniformsZero);

  const finalBindGroup = gpuDevice.createBindGroup({
    layout: gpuBlurPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: gpuSampler },
      { binding: 1, resource: intermediateView4 },
      { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
    ],
  });

  const canvasView = gpuContext.getCurrentTexture().createView();
  const renderPassFinal = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: canvasView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });

  renderPassFinal.setPipeline(gpuBlurPipeline);
  renderPassFinal.setBindGroup(0, finalBindGroup);
  renderPassFinal.draw(3, 1, 0, 0);
  renderPassFinal.end();

  gpuDevice.queue.submit([commandEncoder.finish()]);
  return true;
}

/**
 * Check if WebGPU is initialized for canvas
 */
export function isWebGPUInitialized(): boolean {
  return gpuDevice !== null && gpuContext !== null && gpuPipeline !== null;
}

/**
 * Cleanup WebGPU resources
 */
export function cleanupWebGPU() {
  gpuTexture?.destroy();
  gpuUniformBuffer?.destroy();
  gpuBlurUniformBuffer?.destroy();
  gpuCompositeUniformBuffer?.destroy();
  gpuIntermediateTexture?.destroy();
  gpuIntermediateTexture2?.destroy();
  gpuIntermediateTexture3?.destroy();
  gpuIntermediateTexture4?.destroy();

  gpuDevice = null;
  gpuContext = null;
  gpuPipeline = null;
  gpuUniformBuffer = null;
  gpuSampler = null;
  gpuTexture = null;
  gpuBindGroup = null;
  gpuBlurPipeline = null;
  gpuBlurUniformBuffer = null;
  gpuCompositePipeline = null;
  gpuCompositeUniformBuffer = null;
  gpuIntermediateTexture = null;
  gpuIntermediateTexture2 = null;
  gpuIntermediateTexture3 = null;
  gpuIntermediateTexture4 = null;
  currentCanvas = null;
}
