export {};
// WebGPU interfaces are provided by Bun's bundled DOM library. These standard
// browser constants and the canvas overload are absent from that library build.
declare global {
  const GPUBufferUsage: Readonly<{
    UNIFORM: number;
    COPY_DST: number;
    STORAGE: number;
    VERTEX: number;
  }>;
  const GPUShaderStage: Readonly<{
    VERTEX: number;
    FRAGMENT: number;
    COMPUTE: number;
  }>;
  const GPUTextureUsage: Readonly<{
    TEXTURE_BINDING: number;
    COPY_DST: number;
    RENDER_ATTACHMENT: number;
  }>;
  interface HTMLCanvasElement {
    getContext(contextId: "webgpu"): GPUCanvasContext | null;
  }
}
