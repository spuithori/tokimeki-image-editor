import type { AdjustmentsState, Viewport, TransformState, CropArea, BlurArea } from '../types';
import SHADER_CODE from '../shaders/image-editor.wgsl?raw';
import BLUR_SHADER_CODE from '../shaders/blur.wgsl?raw';
import COMPOSITE_SHADER_CODE from '../shaders/composite.wgsl?raw';
import GRAIN_SHADER_CODE from '../shaders/grain.wgsl?raw';

/**
 * WebGPU Render Pipeline for image adjustments with viewport and transform support
 * Uses fragment shader to apply adjustments in real-time
 */

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

    // Check if we need multi-pass rendering (for blur or grain layering)
    const hasGlobalBlur = adjustments.blur > 0;
    const hasRegionalBlur = blurAreas.length > 0 && blurAreas.some(area => area.blurStrength > 0);
    const hasGrain = adjustments.grain > 0;
    const needsMultiPass = hasGlobalBlur || hasRegionalBlur || hasGrain;

    // If grain is enabled, we apply it in a separate pass AFTER blur
    // So pass grain=0 to the main shader
    const mainShaderGrain = needsMultiPass ? 0 : adjustments.grain;

    // Update uniforms
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

      // Crop area (4 floats)
      cropArea?.x ?? 0,
      cropArea?.y ?? 0,
      cropArea?.width ?? 0,
      cropArea?.height ?? 0,

      // Padding to 32 floats for alignment (11+4+4+2+2+4=27, need 5 padding)
      0, 0, 0, 0, 0
    ]);
    gpuDevice.queue.writeBuffer(gpuUniformBuffer, 0, uniformData);

    if (!needsMultiPass) {
      // No blur or grain - render directly to canvas
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

    // Has blur or grain - use multi-pass rendering
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
      adjustments.grain
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
  grainAmount: number = 0
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
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
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
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
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
