import type { AdjustmentsState, Viewport, TransformState, CropArea, BlurArea, ToneCurve } from '../types';
import { IMAGE_EDITOR_SHADER_CODE } from '../shaders/image-editor';
import { BLUR_SHADER_CODE } from '../shaders/blur';
import { COMPOSITE_SHADER_CODE } from '../shaders/composite';
import { GRAIN_SHADER_CODE } from '../shaders/grain';
import { SHARPEN_SHADER_CODE } from '../shaders/sharpen';
import { DENOISE_SHADER_CODE } from '../shaders/denoise';
import { generateCurveLUT, isToneCurveDefault } from './adjustments';

const SHADER_CODE = IMAGE_EDITOR_SHADER_CODE;

/**
 * WebGPU Render Pipeline for image adjustments with viewport and transform support
 * Uses fragment shader to apply adjustments in real-time
 */

// Canvas clear color (theme-aware: dark=#000, light=#fafafa)
let canvasClearColor: GPUColor = { r: 0, g: 0, b: 0, a: 1 };

export function setCanvasClearColor(color: GPUColor): void {
  canvasClearColor = color;
}

// WebGPU state
let gpuDevice: GPUDevice | null = null;
let gpuContext: GPUCanvasContext | null = null;
let gpuPipeline: GPURenderPipeline | null = null;
let gpuUniformBuffer: GPUBuffer | null = null;
let gpuSampler: GPUSampler | null = null;
let gpuTexture: GPUTexture | null = null;
let gpuBindGroup: GPUBindGroup | null = null;

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

// Grain pipeline state
let gpuGrainPipeline: GPURenderPipeline | null = null;
let gpuGrainUniformBuffer: GPUBuffer | null = null;

// Sharpen pipeline state
let gpuSharpenPipeline: GPURenderPipeline | null = null;
let gpuSharpenUniformBuffer: GPUBuffer | null = null;

// Denoise pipeline state
let gpuDenoisePipeline: GPURenderPipeline | null = null;
let gpuDenoiseUniformBuffer: GPUBuffer | null = null;

// Tone Curve LUT texture (256×1 RGBA)
let gpuCurveLUTTexture: GPUTexture | null = null;
let gpuCurveLUTSampler: GPUSampler | null = null;

// Helper functions and constants
const BLUR_UNIFORMS_ZERO = new Float32Array([1.0, 0.0, 0.0, 0.0]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createRenderPass(
  commandEncoder: GPUCommandEncoder,
  view: GPUTextureView,
  pipeline: GPURenderPipeline,
  bindGroup: GPUBindGroup
): void {
  const renderPass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  renderPass.setPipeline(pipeline);
  renderPass.setBindGroup(0, bindGroup);
  renderPass.draw(3, 1, 0, 0);
  renderPass.end();
}

function createBlurBindGroup(textureView: GPUTextureView): GPUBindGroup | null {
  if (!gpuDevice || !gpuBlurPipeline || !gpuSampler || !gpuBlurUniformBuffer) {
    return null;
  }
  return gpuDevice.createBindGroup({
    layout: gpuBlurPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: gpuSampler },
      { binding: 1, resource: textureView },
      { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
    ],
  });
}

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
    // 11 (adjustments) + 4 (viewport) + 4 (transform) + 2 (canvas) + 2 (image) + 4 (crop) = 27 floats
    // + HSL: 8 colors × 4 floats (vec3 + padding) = 32 floats
    // Total = 59 floats, round up to 64 for alignment = 256 bytes
    gpuUniformBuffer = gpuDevice.createBuffer({
      size: 256, // 64 floats * 4 bytes
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

    // Create grain pipeline
    const grainShaderModule = gpuDevice.createShaderModule({ code: GRAIN_SHADER_CODE });
    gpuGrainPipeline = gpuDevice.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: grainShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: grainShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Create grain uniform buffer
    // 1 (grain) + 4 (viewport) + 4 (transform) + 2 (canvas) + 2 (image) + 4 (crop) = 17 floats
    // Padded to 20 floats for alignment (80 bytes)
    gpuGrainUniformBuffer = gpuDevice.createBuffer({
      size: 80, // 20 floats * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create sharpen pipeline
    const sharpenShaderModule = gpuDevice.createShaderModule({ code: SHARPEN_SHADER_CODE });
    gpuSharpenPipeline = gpuDevice.createRenderPipeline({
      layout: 'auto',
      vertex: { module: sharpenShaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: sharpenShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    gpuSharpenUniformBuffer = gpuDevice.createBuffer({
      size: 16, // 4 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create denoise pipeline
    const denoiseShaderModule = gpuDevice.createShaderModule({ code: DENOISE_SHADER_CODE });
    gpuDenoisePipeline = gpuDevice.createRenderPipeline({
      layout: 'auto',
      vertex: { module: denoiseShaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: denoiseShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    gpuDenoiseUniformBuffer = gpuDevice.createBuffer({
      size: 16, // 4 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create tone curve LUT texture (256×1 RGBA) — identity by default
    gpuCurveLUTTexture = gpuDevice.createTexture({
      size: [256, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    gpuCurveLUTSampler = gpuDevice.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Write identity LUT
    const identityLUT = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      identityLUT[i * 4 + 0] = i;
      identityLUT[i * 4 + 1] = i;
      identityLUT[i * 4 + 2] = i;
      identityLUT[i * 4 + 3] = 255;
    }
    gpuDevice.queue.writeTexture(
      { texture: gpuCurveLUTTexture },
      identityLUT,
      { bytesPerRow: 256 * 4 },
      [256, 1, 1]
    );

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
  if (!gpuDevice || !gpuPipeline || !gpuTexture || !gpuSampler || !gpuUniformBuffer || !gpuCurveLUTSampler || !gpuCurveLUTTexture) return;

  gpuBindGroup = gpuDevice.createBindGroup({
    layout: gpuPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: gpuSampler },
      { binding: 1, resource: gpuTexture.createView() },
      { binding: 2, resource: { buffer: gpuUniformBuffer } },
      { binding: 3, resource: gpuCurveLUTSampler },
      { binding: 4, resource: gpuCurveLUTTexture.createView() },
    ],
  });
}

/**
 * Update the tone curve LUT texture from current adjustments
 */
export function updateCurveLUT(toneCurve: ToneCurve): void {
  if (!gpuDevice || !gpuCurveLUTTexture) return;

  const lutData = generateCurveLUT(toneCurve);
  gpuDevice.queue.writeTexture(
    { texture: gpuCurveLUTTexture },
    lutData,
    { bytesPerRow: 256 * 4 },
    [256, 1, 1]
  );

  // Rebind with new LUT
  updateBindGroup();
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

    // Check if we need multi-pass rendering
    const hasGlobalBlur = adjustments.blur > 0;
    const hasRegionalBlur = blurAreas.length > 0 && blurAreas.some(area => area.blurStrength > 0);
    const hasGrain = adjustments.grain > 0;
    const hasSharpen = adjustments.sharpen > 0;
    const hasDenoise = adjustments.denoise > 0;
    const needsMultiPass = hasGlobalBlur || hasRegionalBlur || hasGrain || hasSharpen || hasDenoise;

    // If grain is enabled, we apply it in a separate pass AFTER blur
    // So pass grain=0 to the main shader
    const mainShaderGrain = needsMultiPass ? 0 : adjustments.grain;

    // Build HSL uniform data (8 colors × vec4 with padding)
    const hsl = adjustments.hsl;

    // Update uniforms — extended to 64 floats (256 bytes)
    const uniformData = new Float32Array([
      // Adjustments (11 floats)
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
      mainShaderGrain,

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

      // Crop area (4 floats) — ends at float index 26
      cropArea?.x ?? 0,
      cropArea?.y ?? 0,
      cropArea?.width ?? 0,
      cropArea?.height ?? 0,

      // Clear color (3 floats: index 27-29) + padding (2 floats: index 30-31)
      canvasClearColor.r, canvasClearColor.g, canvasClearColor.b, 0, 0,

      // HSL per-color (8 × vec4: h, s, l, 0) = 32 floats (index 32-63)
      hsl.red.hue, hsl.red.saturation, hsl.red.luminance, 0,
      hsl.orange.hue, hsl.orange.saturation, hsl.orange.luminance, 0,
      hsl.yellow.hue, hsl.yellow.saturation, hsl.yellow.luminance, 0,
      hsl.green.hue, hsl.green.saturation, hsl.green.luminance, 0,
      hsl.aqua.hue, hsl.aqua.saturation, hsl.aqua.luminance, 0,
      hsl.blue.hue, hsl.blue.saturation, hsl.blue.luminance, 0,
      hsl.purple.hue, hsl.purple.saturation, hsl.purple.luminance, 0,
      hsl.magenta.hue, hsl.magenta.saturation, hsl.magenta.luminance, 0,
    ]);
    gpuDevice.queue.writeBuffer(gpuUniformBuffer, 0, uniformData);

    if (!needsMultiPass) {
      // No blur or grain - render directly to canvas
      const commandEncoder = gpuDevice.createCommandEncoder();
      const textureView = gpuContext.getCurrentTexture().createView();

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          clearValue: canvasClearColor,
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

    // Has multi-pass effects - use extended rendering
    return renderWithBlur(
      blurAreas,
      canvasWidth,
      canvasHeight,
      imageWidth,
      imageHeight,
      cropArea,
      viewport,
      transform,
      adjustments.blur,
      adjustments.grain,
      adjustments.sharpen,
      adjustments.denoise
    );
  } catch (error) {
    console.error('WebGPU render failed:', error);
    return false;
  }
}

/**
 * Render with blur (global and/or regional) and grain using multi-pass compositing
 */
function renderWithBlur(
  blurAreas: BlurArea[],
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
  cropArea: CropArea | null,
  viewport: Viewport,
  transform: TransformState,
  globalBlurStrength: number = 0,
  grainAmount: number = 0,
  sharpenAmount: number = 0,
  denoiseStrength: number = 0
): boolean {
  if (!gpuDevice || !gpuContext || !gpuPipeline || !gpuBindGroup ||
      !gpuBlurPipeline || !gpuBlurUniformBuffer ||
      !gpuCompositePipeline || !gpuCompositeUniformBuffer ||
      !gpuGrainPipeline || !gpuGrainUniformBuffer || !gpuSampler) {
    console.error('Missing WebGPU resources for multi-pass rendering');
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

  gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, BLUR_UNIFORMS_ZERO);

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

  // === Pass 2b: Denoise (bilateral filter) if enabled ===
  if (denoiseStrength > 0 && gpuDenoisePipeline && gpuDenoiseUniformBuffer) {
    commandEncoder = gpuDevice.createCommandEncoder();

    const denoiseUniforms = new Float32Array([denoiseStrength / 100, 0, 0, 0]);
    gpuDevice.queue.writeBuffer(gpuDenoiseUniformBuffer, 0, denoiseUniforms);

    const denoiseBindGroup = gpuDevice.createBindGroup({
      layout: gpuDenoisePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView4 },
        { binding: 2, resource: { buffer: gpuDenoiseUniformBuffer } },
      ],
    });

    const denoisePass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediateView2,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    denoisePass.setPipeline(gpuDenoisePipeline);
    denoisePass.setBindGroup(0, denoiseBindGroup);
    denoisePass.draw(3, 1, 0, 0);
    denoisePass.end();

    gpuDevice.queue.submit([commandEncoder.finish()]);

    // Copy denoised result back to accumulator (intermediate2 → intermediate4)
    commandEncoder = gpuDevice.createCommandEncoder();
    gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, BLUR_UNIFORMS_ZERO);

    const denoiseCopyBg = gpuDevice.createBindGroup({
      layout: gpuBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView2 },
        { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
      ],
    });

    const denoiseCopyPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediateView4,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    denoiseCopyPass.setPipeline(gpuBlurPipeline);
    denoiseCopyPass.setBindGroup(0, denoiseCopyBg);
    denoiseCopyPass.draw(3, 1, 0, 0);
    denoiseCopyPass.end();

    gpuDevice.queue.submit([commandEncoder.finish()]);
  }

  // === Pass 2c: Sharpen (unsharp mask) if enabled ===
  if (sharpenAmount > 0 && gpuSharpenPipeline && gpuSharpenUniformBuffer) {
    // Step 1: Blur the current accumulator (intermediate4) for the unsharp mask
    // Horizontal blur → intermediate2
    const sharpenBlurRadius = 4; // σ≈1.3 — captures meaningful edge structure, not pixel noise
    commandEncoder = gpuDevice.createCommandEncoder();

    const sharpBlurH = new Float32Array([1.0, 0.0, sharpenBlurRadius, 0.0]);
    gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, sharpBlurH);

    const sharpBlurHBg = gpuDevice.createBindGroup({
      layout: gpuBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView4 },
        { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
      ],
    });

    const sharpBlurHPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediateView2,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    sharpBlurHPass.setPipeline(gpuBlurPipeline);
    sharpBlurHPass.setBindGroup(0, sharpBlurHBg);
    sharpBlurHPass.draw(3, 1, 0, 0);
    sharpBlurHPass.end();
    gpuDevice.queue.submit([commandEncoder.finish()]);

    // Vertical blur → intermediate3
    commandEncoder = gpuDevice.createCommandEncoder();
    const sharpBlurV = new Float32Array([0.0, 1.0, sharpenBlurRadius, 0.0]);
    gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, sharpBlurV);

    const sharpBlurVBg = gpuDevice.createBindGroup({
      layout: gpuBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView2 },
        { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
      ],
    });

    const sharpBlurVPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediateView3,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    sharpBlurVPass.setPipeline(gpuBlurPipeline);
    sharpBlurVPass.setBindGroup(0, sharpBlurVBg);
    sharpBlurVPass.draw(3, 1, 0, 0);
    sharpBlurVPass.end();
    gpuDevice.queue.submit([commandEncoder.finish()]);

    // Step 2: Apply unsharp mask (original=intermediate4, blurred=intermediate3 → intermediate2)
    commandEncoder = gpuDevice.createCommandEncoder();

    // amount: 0-100 → 0-2.0 (50=1x standard sharpening)
    // threshold: auto-scale with amount — more sharpening needs more noise gating
    const sharpAmt = sharpenAmount / 50.0;
    const sharpThresh = 0.01 + sharpenAmount * 0.0004; // 0.01 at low, ~0.05 at max
    const sharpenUniforms = new Float32Array([sharpAmt, sharpThresh, 0, 0]);
    gpuDevice.queue.writeBuffer(gpuSharpenUniformBuffer, 0, sharpenUniforms);

    const sharpenBindGroup = gpuDevice.createBindGroup({
      layout: gpuSharpenPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView4 },  // original
        { binding: 2, resource: intermediateView3 },  // blurred
        { binding: 3, resource: { buffer: gpuSharpenUniformBuffer } },
      ],
    });

    const sharpenPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediateView2,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    sharpenPass.setPipeline(gpuSharpenPipeline);
    sharpenPass.setBindGroup(0, sharpenBindGroup);
    sharpenPass.draw(3, 1, 0, 0);
    sharpenPass.end();
    gpuDevice.queue.submit([commandEncoder.finish()]);

    // Copy sharpened result back to accumulator (intermediate2 → intermediate4)
    commandEncoder = gpuDevice.createCommandEncoder();
    gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, BLUR_UNIFORMS_ZERO);

    const sharpCopyBg = gpuDevice.createBindGroup({
      layout: gpuBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView2 },
        { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
      ],
    });

    const sharpCopyPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediateView4,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    sharpCopyPass.setPipeline(gpuBlurPipeline);
    sharpCopyPass.setBindGroup(0, sharpCopyBg);
    sharpCopyPass.draw(3, 1, 0, 0);
    sharpCopyPass.end();
    gpuDevice.queue.submit([commandEncoder.finish()]);
  }

  // === Pass 3a: Apply global blur if enabled ===
  if (globalBlurStrength > 0) {
    // Map blur 0-100 to radius 0-10
    const globalBlurRadius = Math.ceil((globalBlurStrength / 100) * 10);

    // Horizontal blur pass (intermediate4 accumulator -> intermediate2)
    commandEncoder = gpuDevice.createCommandEncoder();

    const blurUniformsH = new Float32Array([1.0, 0.0, globalBlurRadius, 0.0]);
    gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, blurUniformsH);

    const blurBindGroupH = gpuDevice.createBindGroup({
      layout: gpuBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView4 },
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

    // Vertical blur pass (intermediate2 -> intermediate4)
    commandEncoder = gpuDevice.createCommandEncoder();

    const blurUniformsV = new Float32Array([0.0, 1.0, globalBlurRadius, 0.0]);
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
        view: intermediateView4,
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
  }

  // === Pass 3b: Process each regional blur area ===
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

    // Calculate blur radius to match Canvas2D behavior
    const imageBlurPx = (blurArea.blurStrength / 100) * 100;
    const blurRadius = Math.ceil(imageBlurPx * totalScale);

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
    const minX = clamp(canvasBlurX / canvasWidth, 0, 1);
    const minY = clamp(canvasBlurY / canvasHeight, 0, 1);
    const maxX = clamp((canvasBlurX + canvasBlurWidth) / canvasWidth, 0, 1);
    const maxY = clamp((canvasBlurY + canvasBlurHeight) / canvasHeight, 0, 1);

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

    gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, BLUR_UNIFORMS_ZERO);

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

  // === Pass 4: Apply grain (if enabled) or copy final result to canvas ===
  commandEncoder = gpuDevice.createCommandEncoder();

  const canvasView = gpuContext.getCurrentTexture().createView();

  if (grainAmount > 0) {
    // Apply grain using grain pipeline
    const rotationRad = (transform.rotation * Math.PI) / 180;

    const grainUniforms = new Float32Array([
      // Grain parameter (1 float)
      grainAmount,

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

      // Padding to 20 floats (17 used, 3 padding)
      0, 0, 0
    ]);
    gpuDevice.queue.writeBuffer(gpuGrainUniformBuffer, 0, grainUniforms);

    const grainBindGroup = gpuDevice.createBindGroup({
      layout: gpuGrainPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView4 },
        { binding: 2, resource: { buffer: gpuGrainUniformBuffer } },
      ],
    });

    const renderPassGrain = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: canvasView,
        clearValue: canvasClearColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    renderPassGrain.setPipeline(gpuGrainPipeline);
    renderPassGrain.setBindGroup(0, grainBindGroup);
    renderPassGrain.draw(3, 1, 0, 0);
    renderPassGrain.end();
  } else {
    // No grain - simple copy to canvas
    gpuDevice.queue.writeBuffer(gpuBlurUniformBuffer, 0, BLUR_UNIFORMS_ZERO);

    const finalBindGroup = gpuDevice.createBindGroup({
      layout: gpuBlurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gpuSampler },
        { binding: 1, resource: intermediateView4 },
        { binding: 2, resource: { buffer: gpuBlurUniformBuffer } },
      ],
    });

    const renderPassFinal = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: canvasView,
        clearValue: canvasClearColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    renderPassFinal.setPipeline(gpuBlurPipeline);
    renderPassFinal.setBindGroup(0, finalBindGroup);
    renderPassFinal.draw(3, 1, 0, 0);
    renderPassFinal.end();
  }

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
 * Export image using WebGPU rendering at full resolution
 * Creates an offscreen canvas and renders the final image with all adjustments
 */
export async function exportWithWebGPU(
  imageSource: HTMLImageElement | ImageBitmap,
  adjustments: AdjustmentsState,
  transform: TransformState,
  cropArea: CropArea | null = null,
  blurAreas: BlurArea[] = []
): Promise<HTMLCanvasElement | null> {
  try {
    // Detect mobile devices
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      console.log('Mobile device detected, WebGPU export may have limited support');
    }

    // Get adapter and device
    if (!navigator.gpu) {
      console.warn('WebGPU not supported for export');
      return null;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.warn('No WebGPU adapter for export');
      return null;
    }

    const device = await adapter.requestDevice();
    const format = navigator.gpu.getPreferredCanvasFormat();

    // Calculate output dimensions based on crop and rotation
    const sourceWidth = cropArea ? cropArea.width : imageSource.width;
    const sourceHeight = cropArea ? cropArea.height : imageSource.height;
    const needsSwap = transform.rotation === 90 || transform.rotation === 270;
    const outputWidth = needsSwap ? sourceHeight : sourceWidth;
    const outputHeight = needsSwap ? sourceWidth : sourceHeight;

    // Create offscreen canvas at full resolution
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const context = canvas.getContext('webgpu') as GPUCanvasContext;
    if (!context) {
      console.warn('Failed to get WebGPU context for export');
      return null;
    }

    context.configure({ device, format, alphaMode: 'premultiplied' });

    // Upload image as texture
    const bitmap = imageSource instanceof ImageBitmap
      ? imageSource
      : await createImageBitmap(imageSource);

    const texture = device.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture },
      [bitmap.width, bitmap.height]
    );

    // Create sampler
    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Create pipelines
    const mainShaderModule = device.createShaderModule({ code: SHADER_CODE });
    const mainPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mainShaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: mainShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const blurShaderModule = device.createShaderModule({ code: BLUR_SHADER_CODE });
    const blurPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blurShaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: blurShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const grainShaderModule = device.createShaderModule({ code: GRAIN_SHADER_CODE });
    const grainPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: grainShaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: grainShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const compositeShaderModule = device.createShaderModule({ code: COMPOSITE_SHADER_CODE });
    const compositePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: compositeShaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: compositeShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Create sharpen pipeline
    const sharpenShaderModule = device.createShaderModule({ code: SHARPEN_SHADER_CODE });
    const sharpenPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: sharpenShaderModule, entryPoint: 'vs_main' },
      fragment: { module: sharpenShaderModule, entryPoint: 'fs_main', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });

    // Create denoise pipeline
    const denoiseShaderModule = device.createShaderModule({ code: DENOISE_SHADER_CODE });
    const denoisePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: denoiseShaderModule, entryPoint: 'vs_main' },
      fragment: { module: denoiseShaderModule, entryPoint: 'fs_main', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });

    // Create uniform buffers — main buffer at 256 bytes to match preview pipeline
    const mainUniformBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const blurUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const grainUniformBuffer = device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const sharpenUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const denoiseUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create tone curve LUT texture for export
    const curveLUTTexture = device.createTexture({
      size: [256, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const curveLUTSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Upload tone curve LUT
    const lutData = generateCurveLUT(adjustments.toneCurve);
    device.queue.writeTexture(
      { texture: curveLUTTexture },
      lutData,
      { bytesPerRow: 256 * 4 },
      [256, 1, 1]
    );

    // Create intermediate textures
    const intermediate1 = device.createTexture({
      size: [outputWidth, outputHeight, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const intermediate2 = device.createTexture({
      size: [outputWidth, outputHeight, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const intermediate3 = device.createTexture({
      size: [outputWidth, outputHeight, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const intermediate4 = device.createTexture({
      size: [outputWidth, outputHeight, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Setup viewport and transform for export (no zoom/pan, centered)
    const viewport: Viewport = {
      zoom: 1.0,
      offsetX: 0,
      offsetY: 0,
      scale: 1.0,
    };

    // Prepare uniforms (grain=0 for main pass, include HSL)
    const rotationRad = (transform.rotation * Math.PI) / 180;
    const hsl = adjustments.hsl;
    const uniformData = new Float32Array([
      // Adjustments (11 floats) - grain set to 0
      adjustments.brightness, adjustments.contrast, adjustments.exposure,
      adjustments.highlights, adjustments.shadows, adjustments.saturation,
      adjustments.temperature, adjustments.sepia, adjustments.grayscale,
      adjustments.vignette, 0, // grain = 0
      // Viewport (4 floats)
      viewport.zoom, viewport.offsetX, viewport.offsetY, viewport.scale,
      // Transform (4 floats)
      rotationRad,
      transform.flipHorizontal ? -1.0 : 1.0,
      transform.flipVertical ? -1.0 : 1.0,
      transform.scale,
      // Canvas dimensions (2 floats)
      outputWidth, outputHeight,
      // Image dimensions (2 floats)
      bitmap.width, bitmap.height,
      // Crop area (4 floats) — ends at index 26
      cropArea?.x ?? 0, cropArea?.y ?? 0,
      cropArea?.width ?? 0, cropArea?.height ?? 0,
      // Clear color (3 floats) + padding (2 floats) — export uses black background
      0, 0, 0, 0, 0,
      // HSL per-color (8 × vec4: h, s, l, 0) = 32 floats (index 32-63)
      hsl.red.hue, hsl.red.saturation, hsl.red.luminance, 0,
      hsl.orange.hue, hsl.orange.saturation, hsl.orange.luminance, 0,
      hsl.yellow.hue, hsl.yellow.saturation, hsl.yellow.luminance, 0,
      hsl.green.hue, hsl.green.saturation, hsl.green.luminance, 0,
      hsl.aqua.hue, hsl.aqua.saturation, hsl.aqua.luminance, 0,
      hsl.blue.hue, hsl.blue.saturation, hsl.blue.luminance, 0,
      hsl.purple.hue, hsl.purple.saturation, hsl.purple.luminance, 0,
      hsl.magenta.hue, hsl.magenta.saturation, hsl.magenta.luminance, 0,
    ]);
    device.queue.writeBuffer(mainUniformBuffer, 0, uniformData);

    // Create bind group for main pass (includes curve LUT texture)
    const mainBindGroup = device.createBindGroup({
      layout: mainPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: { buffer: mainUniformBuffer } },
        { binding: 3, resource: curveLUTSampler },
        { binding: 4, resource: curveLUTTexture.createView() },
      ],
    });

    // Pass 1: Render with adjustments
    let commandEncoder = device.createCommandEncoder();
    const renderPass1 = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediate1.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass1.setPipeline(mainPipeline);
    renderPass1.setBindGroup(0, mainBindGroup);
    renderPass1.draw(3, 1, 0, 0);
    renderPass1.end();
    device.queue.submit([commandEncoder.finish()]);

    // Pass 2: Copy to accumulator
    commandEncoder = device.createCommandEncoder();
    device.queue.writeBuffer(blurUniformBuffer, 0, BLUR_UNIFORMS_ZERO);
    const copyBindGroup = device.createBindGroup({
      layout: blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: intermediate1.createView() },
        { binding: 2, resource: { buffer: blurUniformBuffer } },
      ],
    });
    const copyPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: intermediate4.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    copyPass.setPipeline(blurPipeline);
    copyPass.setBindGroup(0, copyBindGroup);
    copyPass.draw(3, 1, 0, 0);
    copyPass.end();
    device.queue.submit([commandEncoder.finish()]);

    // Pass 2b: Denoise (bilateral filter) if enabled
    if (adjustments.denoise > 0) {
      commandEncoder = device.createCommandEncoder();
      const denoiseUniforms = new Float32Array([adjustments.denoise / 100, 0, 0, 0]);
      device.queue.writeBuffer(denoiseUniformBuffer, 0, denoiseUniforms);

      const denoiseBindGroup = device.createBindGroup({
        layout: denoisePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: intermediate4.createView() },
          { binding: 2, resource: { buffer: denoiseUniformBuffer } },
        ],
      });

      const denoisePass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: intermediate2.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      denoisePass.setPipeline(denoisePipeline);
      denoisePass.setBindGroup(0, denoiseBindGroup);
      denoisePass.draw(3, 1, 0, 0);
      denoisePass.end();
      device.queue.submit([commandEncoder.finish()]);

      // Copy denoised → accumulator
      commandEncoder = device.createCommandEncoder();
      device.queue.writeBuffer(blurUniformBuffer, 0, BLUR_UNIFORMS_ZERO);
      const dnCopyBg = device.createBindGroup({
        layout: blurPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: intermediate2.createView() },
          { binding: 2, resource: { buffer: blurUniformBuffer } },
        ],
      });
      const dnCopyPass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: intermediate4.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      dnCopyPass.setPipeline(blurPipeline);
      dnCopyPass.setBindGroup(0, dnCopyBg);
      dnCopyPass.draw(3, 1, 0, 0);
      dnCopyPass.end();
      device.queue.submit([commandEncoder.finish()]);
    }

    // Pass 2c: Sharpen (unsharp mask) if enabled
    if (adjustments.sharpen > 0) {
      const sharpenBlurRadius = 4; // σ≈1.3

      // Horizontal blur → intermediate2
      commandEncoder = device.createCommandEncoder();
      device.queue.writeBuffer(blurUniformBuffer, 0, new Float32Array([1.0, 0.0, sharpenBlurRadius, 0.0]));
      const shBgH = device.createBindGroup({
        layout: blurPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: intermediate4.createView() },
          { binding: 2, resource: { buffer: blurUniformBuffer } },
        ],
      });
      const shPassH = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: intermediate2.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      shPassH.setPipeline(blurPipeline);
      shPassH.setBindGroup(0, shBgH);
      shPassH.draw(3, 1, 0, 0);
      shPassH.end();
      device.queue.submit([commandEncoder.finish()]);

      // Vertical blur → intermediate3
      commandEncoder = device.createCommandEncoder();
      device.queue.writeBuffer(blurUniformBuffer, 0, new Float32Array([0.0, 1.0, sharpenBlurRadius, 0.0]));
      const shBgV = device.createBindGroup({
        layout: blurPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: intermediate2.createView() },
          { binding: 2, resource: { buffer: blurUniformBuffer } },
        ],
      });
      const shPassV = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: intermediate3.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      shPassV.setPipeline(blurPipeline);
      shPassV.setBindGroup(0, shBgV);
      shPassV.draw(3, 1, 0, 0);
      shPassV.end();
      device.queue.submit([commandEncoder.finish()]);

      // Unsharp mask composite: original(intermediate4) + blurred(intermediate3) → intermediate2
      commandEncoder = device.createCommandEncoder();
      const sharpAmt = adjustments.sharpen / 50.0;
      const sharpThresh = 0.01 + adjustments.sharpen * 0.0004;
      device.queue.writeBuffer(sharpenUniformBuffer, 0, new Float32Array([sharpAmt, sharpThresh, 0, 0]));
      const sharpBg = device.createBindGroup({
        layout: sharpenPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: intermediate4.createView() },
          { binding: 2, resource: intermediate3.createView() },
          { binding: 3, resource: { buffer: sharpenUniformBuffer } },
        ],
      });
      const sharpPass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: intermediate2.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      sharpPass.setPipeline(sharpenPipeline);
      sharpPass.setBindGroup(0, sharpBg);
      sharpPass.draw(3, 1, 0, 0);
      sharpPass.end();
      device.queue.submit([commandEncoder.finish()]);

      // Copy sharpened → accumulator
      commandEncoder = device.createCommandEncoder();
      device.queue.writeBuffer(blurUniformBuffer, 0, BLUR_UNIFORMS_ZERO);
      const shCopyBg = device.createBindGroup({
        layout: blurPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: intermediate2.createView() },
          { binding: 2, resource: { buffer: blurUniformBuffer } },
        ],
      });
      const shCopyPass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: intermediate4.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      shCopyPass.setPipeline(blurPipeline);
      shCopyPass.setBindGroup(0, shCopyBg);
      shCopyPass.draw(3, 1, 0, 0);
      shCopyPass.end();
      device.queue.submit([commandEncoder.finish()]);
    }

    // Pass 3a: Apply global blur if needed
    if (adjustments.blur > 0) {
      const globalBlurRadius = Math.ceil((adjustments.blur / 100) * 10);

      // Horizontal pass
      commandEncoder = device.createCommandEncoder();
      const blurUniformsH = new Float32Array([1.0, 0.0, globalBlurRadius, 0.0]);
      device.queue.writeBuffer(blurUniformBuffer, 0, blurUniformsH);
      const blurBindGroupH = device.createBindGroup({
        layout: blurPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: intermediate4.createView() },
          { binding: 2, resource: { buffer: blurUniformBuffer } },
        ],
      });
      const blurPassH = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: intermediate2.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      blurPassH.setPipeline(blurPipeline);
      blurPassH.setBindGroup(0, blurBindGroupH);
      blurPassH.draw(3, 1, 0, 0);
      blurPassH.end();
      device.queue.submit([commandEncoder.finish()]);

      // Vertical pass
      commandEncoder = device.createCommandEncoder();
      const blurUniformsV = new Float32Array([0.0, 1.0, globalBlurRadius, 0.0]);
      device.queue.writeBuffer(blurUniformBuffer, 0, blurUniformsV);
      const blurBindGroupV = device.createBindGroup({
        layout: blurPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: intermediate2.createView() },
          { binding: 2, resource: { buffer: blurUniformBuffer } },
        ],
      });
      const blurPassV = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: intermediate4.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      blurPassV.setPipeline(blurPipeline);
      blurPassV.setBindGroup(0, blurBindGroupV);
      blurPassV.draw(3, 1, 0, 0);
      blurPassV.end();
      device.queue.submit([commandEncoder.finish()]);
    }

    // Pass 3b: Apply regional blur areas
    if (blurAreas.length > 0) {
      // Create composite uniform buffer for blur area compositing
      const compositeUniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // For export, we use a centered viewport with no zoom/pan
      // Image is rendered at full resolution, centered
      const totalScale = viewport.scale * viewport.zoom * transform.scale; // All 1.0 for export
      const centerX = outputWidth / 2;
      const centerY = outputHeight / 2;

      // Determine source dimensions based on crop
      const sourceWidth = cropArea ? cropArea.width : bitmap.width;
      const sourceHeight = cropArea ? cropArea.height : bitmap.height;
      const cropOffsetX = cropArea ? cropArea.x : 0;
      const cropOffsetY = cropArea ? cropArea.y : 0;

      for (const blurArea of blurAreas) {
        if (blurArea.blurStrength <= 0) continue;

        // Calculate blur radius to match Canvas2D behavior
        // For export, totalScale = 1.0, so blur is in image pixels
        const imageBlurPx = (blurArea.blurStrength / 100) * 100;
        const blurRadius = Math.ceil(imageBlurPx * totalScale);

        // Convert blur area from image space to canvas space, then to UV coordinates
        // 1. Convert to crop-relative coordinates
        const relativeX = blurArea.x - cropOffsetX;
        const relativeY = blurArea.y - cropOffsetY;

        // 2. Transform from image space to canvas space
        // For export: viewport offset = 0, zoom = 1, scale = 1
        const canvasBlurX = (relativeX - sourceWidth / 2) * totalScale + centerX + viewport.offsetX;
        const canvasBlurY = (relativeY - sourceHeight / 2) * totalScale + centerY + viewport.offsetY;
        const canvasBlurWidth = blurArea.width * totalScale;
        const canvasBlurHeight = blurArea.height * totalScale;

        // 3. Convert to normalized UV coordinates (0-1)
        const minX = clamp(canvasBlurX / outputWidth, 0, 1);
        const minY = clamp(canvasBlurY / outputHeight, 0, 1);
        const maxX = clamp((canvasBlurX + canvasBlurWidth) / outputWidth, 0, 1);
        const maxY = clamp((canvasBlurY + canvasBlurHeight) / outputHeight, 0, 1);

        // Horizontal blur: intermediate1 (base) -> intermediate2
        commandEncoder = device.createCommandEncoder();
        const blurUniformsH = new Float32Array([1.0, 0.0, blurRadius, 0.0]);
        device.queue.writeBuffer(blurUniformBuffer, 0, blurUniformsH);
        const blurBindGroupH = device.createBindGroup({
          layout: blurPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: intermediate1.createView() },
            { binding: 2, resource: { buffer: blurUniformBuffer } },
          ],
        });
        const blurPassH = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate2.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        blurPassH.setPipeline(blurPipeline);
        blurPassH.setBindGroup(0, blurBindGroupH);
        blurPassH.draw(3, 1, 0, 0);
        blurPassH.end();
        device.queue.submit([commandEncoder.finish()]);

        // Vertical blur: intermediate2 -> intermediate3
        commandEncoder = device.createCommandEncoder();
        const blurUniformsV = new Float32Array([0.0, 1.0, blurRadius, 0.0]);
        device.queue.writeBuffer(blurUniformBuffer, 0, blurUniformsV);
        const blurBindGroupV = device.createBindGroup({
          layout: blurPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: intermediate2.createView() },
            { binding: 2, resource: { buffer: blurUniformBuffer } },
          ],
        });
        const blurPassV = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate3.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        blurPassV.setPipeline(blurPipeline);
        blurPassV.setBindGroup(0, blurBindGroupV);
        blurPassV.draw(3, 1, 0, 0);
        blurPassV.end();
        device.queue.submit([commandEncoder.finish()]);

        // Composite: blend intermediate3 (blurred region) with intermediate4 (accumulator)
        commandEncoder = device.createCommandEncoder();
        const compositeUniforms = new Float32Array([minX, minY, maxX, maxY]);
        device.queue.writeBuffer(compositeUniformBuffer, 0, compositeUniforms);
        const compositeBindGroup = device.createBindGroup({
          layout: compositePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: intermediate3.createView() }, // blurred
            { binding: 2, resource: intermediate4.createView() }, // accumulator
            { binding: 3, resource: { buffer: compositeUniformBuffer } },
          ],
        });
        const compositePass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate2.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        compositePass.setPipeline(compositePipeline);
        compositePass.setBindGroup(0, compositeBindGroup);
        compositePass.draw(3, 1, 0, 0);
        compositePass.end();
        device.queue.submit([commandEncoder.finish()]);

        // Copy back to accumulator: intermediate2 -> intermediate4
        commandEncoder = device.createCommandEncoder();
        device.queue.writeBuffer(blurUniformBuffer, 0, BLUR_UNIFORMS_ZERO);
        const copyBackBindGroup = device.createBindGroup({
          layout: blurPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: intermediate2.createView() },
            { binding: 2, resource: { buffer: blurUniformBuffer } },
          ],
        });
        const copyBackPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate4.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        copyBackPass.setPipeline(blurPipeline);
        copyBackPass.setBindGroup(0, copyBackBindGroup);
        copyBackPass.draw(3, 1, 0, 0);
        copyBackPass.end();
        device.queue.submit([commandEncoder.finish()]);
      }

      // Cleanup composite buffer
      compositeUniformBuffer.destroy();
    }

    // Pass 4: Apply grain or copy to canvas
    // Note: Always use grain pipeline to render to canvas because it has the correct format
    // When grain is 0, the grain shader will just pass through the image
    commandEncoder = device.createCommandEncoder();
    const canvasView = context.getCurrentTexture().createView();

    const grainUniforms = new Float32Array([
      adjustments.grain, // Use actual grain value (0 if no grain)
      viewport.zoom, viewport.offsetX, viewport.offsetY, viewport.scale,
      rotationRad,
      transform.flipHorizontal ? -1.0 : 1.0,
      transform.flipVertical ? -1.0 : 1.0,
      transform.scale,
      outputWidth, outputHeight,
      bitmap.width, bitmap.height,
      cropArea?.x ?? 0, cropArea?.y ?? 0,
      cropArea?.width ?? 0, cropArea?.height ?? 0,
      0, 0, 0
    ]);
    device.queue.writeBuffer(grainUniformBuffer, 0, grainUniforms);

    const grainBindGroup = device.createBindGroup({
      layout: grainPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: intermediate4.createView() },
        { binding: 2, resource: { buffer: grainUniformBuffer } },
      ],
    });

    const grainPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: canvasView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    grainPass.setPipeline(grainPipeline);
    grainPass.setBindGroup(0, grainBindGroup);
    grainPass.draw(3, 1, 0, 0);
    grainPass.end();

    device.queue.submit([commandEncoder.finish()]);

    // Wait for rendering to complete
    await device.queue.onSubmittedWorkDone();

    // Validate that the canvas has actual content (not all black)
    // This is important for mobile devices where WebGPU might fail silently
    try {
      const ctx2d = document.createElement('canvas').getContext('2d');
      if (ctx2d) {
        const testCanvas = document.createElement('canvas');
        testCanvas.width = Math.min(canvas.width, 100);
        testCanvas.height = Math.min(canvas.height, 100);
        const testCtx = testCanvas.getContext('2d');

        if (testCtx) {
          // Draw a small portion of the WebGPU canvas to test
          testCtx.drawImage(canvas, 0, 0, testCanvas.width, testCanvas.height);
          const imageData = testCtx.getImageData(0, 0, testCanvas.width, testCanvas.height);
          const data = imageData.data;

          // Check if at least some pixels are non-zero
          let hasContent = false;
          for (let i = 0; i < data.length; i += 4) {
            // Check RGB values (ignore alpha)
            if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) {
              hasContent = true;
              break;
            }
          }

          if (!hasContent) {
            console.warn('WebGPU export produced empty/black canvas, will use Canvas2D fallback');
            // Cleanup before returning null
            texture.destroy();
            intermediate1.destroy();
            intermediate2.destroy();
            intermediate3.destroy();
            intermediate4.destroy();
            mainUniformBuffer.destroy();
            blurUniformBuffer.destroy();
            grainUniformBuffer.destroy();
            sharpenUniformBuffer.destroy();
            denoiseUniformBuffer.destroy();
            curveLUTTexture.destroy();
            return null;
          }
        }
      }
    } catch (validationError) {
      console.warn('Failed to validate WebGPU canvas, assuming it is valid:', validationError);
      // If validation fails, assume the canvas is valid and continue
    }

    // Cleanup
    texture.destroy();
    intermediate1.destroy();
    intermediate2.destroy();
    intermediate3.destroy();
    intermediate4.destroy();
    mainUniformBuffer.destroy();
    blurUniformBuffer.destroy();
    grainUniformBuffer.destroy();
    sharpenUniformBuffer.destroy();
    denoiseUniformBuffer.destroy();
    curveLUTTexture.destroy();

    return canvas;
  } catch (error) {
    console.error('Failed to export with WebGPU:', error);
    return null;
  }
}

/**
 * Cleanup WebGPU resources
 */
export function cleanupWebGPU() {
  gpuTexture?.destroy();
  gpuUniformBuffer?.destroy();
  gpuBlurUniformBuffer?.destroy();
  gpuCompositeUniformBuffer?.destroy();
  gpuGrainUniformBuffer?.destroy();
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
  gpuGrainPipeline = null;
  gpuGrainUniformBuffer = null;
  gpuIntermediateTexture = null;
  gpuIntermediateTexture2 = null;
  gpuIntermediateTexture3 = null;
  gpuIntermediateTexture4 = null;
}
