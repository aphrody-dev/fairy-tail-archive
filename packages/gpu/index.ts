import { fitPlane, model, multiply, perspective } from "./math";
import { particleRenderShader, particleShader, sceneShader } from "./shaders";

export type GPULayer = {
  id: string;
  url: string;
  maskUrl?: string;
  width?: number;
  height?: number;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  opacity?: number;
  fit?: "contain" | "cover";
  exposure?: number;
};
export type GPUScene = { id: string; layers: GPULayer[]; particles?: boolean };
export type GPUStatus =
  | "initializing"
  | "ready"
  | "loading"
  | "unavailable"
  | "lost"
  | "error"
  | "disposed";
type Hooks = {
  onStatus?: (status: GPUStatus, message?: string) => void;
  onFrame?: (frames: number) => void;
  maxDpr?: number;
  /** Optional transparent clear for surfaces that retain the source page background. */
  transparent?: boolean;
};
type Texture = { gpu: GPUTexture; width: number; height: number };
type Material = {
  layer: GPULayer;
  texture: Texture;
  mask: Texture;
  uniform: GPUBuffer;
  binding: GPUBindGroup;
};
const blend: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/** Native WebGPU: WGSL render + compute pipelines. No WebGL or canvas-2D renderer. */
export class WebGPURenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private particlePipeline!: GPURenderPipeline;
  private computePipeline!: GPUComputePipeline;
  private sampler!: GPUSampler;
  private white!: Texture;
  private motion!: GPUBuffer;
  private particles!: GPUBuffer;
  private computeBind!: GPUBindGroup;
  private particleBind: GPUBindGroup | null = null;
  private materials: Material[] = [];
  private outgoing: Material[] = [];
  private scene: GPUScene | null = null;
  private requestedScene: GPUScene | null = null;
  private available = false;
  private resizeObserver: ResizeObserver;
  private intersection: IntersectionObserver;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private abort: AbortController | null = null;
  private epoch = 0;
  private destroyed = false;
  private paused = false;
  private visible = true;
  private frame = 0;
  private raf = 0;
  private transition = 0;
  private zoom = 1;
  private pointer = [0, 0];
  private camera = [0, 0];
  private recovering = false;
  private lastTime = 0;
  private constructor(
    private canvas: HTMLCanvasElement,
    private hooks: Hooks,
  ) {
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.invalidate();
    });
    this.resizeObserver.observe(canvas);
    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries[0]?.isIntersecting ?? true;
      this.invalidate();
    });
    this.intersection.observe(canvas);
    document.addEventListener("visibilitychange", this.visibility);
    this.reduced.addEventListener("change", this.motionChange);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerleave", this.pointerLeave);
  }
  static async create(canvas: HTMLCanvasElement, hooks: Hooks = {}) {
    const renderer = new WebGPURenderer(canvas, hooks);
    try {
      await renderer.initialize();
      return renderer;
    } catch (error) {
      renderer.hooks.onStatus?.("unavailable", String(error));
      renderer.dispose();
      throw error;
    }
  }
  private async initialize() {
    this.available = false;
    this.hooks.onStatus?.("initializing");
    if (!navigator.gpu)
      throw new Error("WebGPU n’est pas exposé par ce navigateur.");
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("Aucun adaptateur WebGPU disponible.");
    const device = await adapter.requestDevice();
    if (this.destroyed) {
      device.destroy();
      return;
    }
    this.device = device;
    const context = this.canvas.getContext("webgpu");
    if (!context) throw new Error("Le contexte WebGPU n’a pas pu être créé.");
    this.context = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    device.addEventListener("uncapturederror", (event) => {
      if (!this.destroyed) {
        this.hooks.onStatus?.("error", event.error.message);
        this.canvas.dataset.gpuError = event.error.message;
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
    });
    device.pushErrorScope("validation");
    const shader = device.createShaderModule({
      label: "Fairy sourced planes WGSL",
      code: sceneShader,
    });
    const compilation = await shader.getCompilationInfo();
    const errors = compilation.messages.filter(
      (message) => message.type === "error",
    );
    if (errors.length)
      throw new Error(errors.map((message) => message.message).join("\n"));
    this.pipeline = await device.createRenderPipelineAsync({
      label: "Fairy perspective scene",
      layout: "auto",
      vertex: { module: shader, entryPoint: "vertexMain" },
      fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [{ format, blend }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.computePipeline = await device.createComputePipelineAsync({
      label: "Fairy ambient particle simulation",
      layout: "auto",
      compute: {
        module: device.createShaderModule({ code: particleShader }),
        entryPoint: "simulate",
      },
    });
    const particleModule = device.createShaderModule({
      code: particleRenderShader,
    });
    this.particlePipeline = await device.createRenderPipelineAsync({
      label: "Fairy source-colored particle field",
      layout: "auto",
      vertex: { module: particleModule, entryPoint: "vertexMain" },
      fragment: {
        module: particleModule,
        entryPoint: "fragmentMain",
        targets: [{ format, blend }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    this.white = {
      gpu: device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      }),
      width: 1,
      height: 1,
    };
    device.queue.writeTexture(
      { texture: this.white.gpu },
      new Uint8Array([255, 255, 255, 255]),
      {},
      [1, 1],
    );
    this.motion = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particles = device.createBuffer({
      size: 128 * 16,
      usage: GPUBufferUsage.STORAGE,
    });
    this.computeBind = device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.motion } },
        { binding: 1, resource: { buffer: this.particles } },
      ],
    });
    const error = await device.popErrorScope();
    if (error) throw new Error(error.message);
    this.resize();
    this.canvas.dataset.renderer = "webgpu";
    this.canvas.dataset.gpuPipelines = "render,compute,particles";
    this.available = true;
    void device.lost.then((info) => {
      if (this.destroyed || this.device !== device) return;
      this.available = false;
      this.hooks.onStatus?.("lost", info.message);
      this.canvas.dataset.gpuStatus = "lost";
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (!this.recovering) {
        this.recovering = true;
        void this.recover();
      }
    });
  }
  private async recover() {
    this.abort?.abort();
    this.epoch++;
    this.release(this.materials);
    this.release(this.outgoing);
    this.materials = [];
    this.outgoing = [];
    this.white?.gpu.destroy();
    this.motion?.destroy();
    this.particles?.destroy();
    try {
      await this.initialize();
      if (this.requestedScene && !this.destroyed)
        await this.load(this.requestedScene);
    } catch (error) {
      if (!this.destroyed) this.hooks.onStatus?.("unavailable", String(error));
    } finally {
      this.recovering = false;
    }
  }
  private async texture(url: string, signal: AbortSignal): Promise<Texture> {
    const address = new URL(url, location.href);
    if (address.origin !== location.origin)
      throw new Error(
        "Texture GPU : utiliser une URL locale de provenance vérifiée.",
      );
    const response = await fetch(address, { signal });
    if (!response.ok) throw new Error(`Texture HTTP ${response.status}`);
    if (!/^image\//i.test(response.headers.get("content-type") ?? ""))
      throw new Error("La texture n’est pas une image.");
    const blob = await response.blob();
    if (blob.size > 16 * 1024 * 1024)
      throw new Error("Texture supérieure au budget de 16 Mo.");
    let bitmap = await createImageBitmap(blob);
    try {
      const max = Math.min(this.device.limits.maxTextureDimension2D, 4096);
      if (bitmap.width > max || bitmap.height > max) {
        const ratio = Math.min(max / bitmap.width, max / bitmap.height);
        const resized = await createImageBitmap(bitmap, {
          resizeWidth: Math.max(1, Math.round(bitmap.width * ratio)),
          resizeHeight: Math.max(1, Math.round(bitmap.height * ratio)),
          resizeQuality: "high",
        });
        bitmap.close();
        bitmap = resized;
      }
      if (signal.aborted || this.destroyed)
        throw new DOMException("Aborted", "AbortError");
      const gpu = this.device.createTexture({
        label: address.pathname,
        size: [bitmap.width, bitmap.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: gpu },
        [bitmap.width, bitmap.height],
      );
      return { gpu, width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  async load(scene: GPUScene) {
    if (this.destroyed) return;
    this.requestedScene = scene;
    if (!this.available) return;
    if (!scene.layers.length || scene.layers.length > 24)
      throw new Error("Une scène GPU doit avoir entre 1 et 24 plans.");
    const epoch = ++this.epoch;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.hooks.onStatus?.("loading");
    const loaded = new Map<string, Texture>();
    const materials: Material[] = [];
    const acquire = async (url: string) => {
      const old = loaded.get(url);
      if (old) return old;
      const texture = await this.texture(url, abort.signal);
      loaded.set(url, texture);
      return texture;
    };
    try {
      for (const layer of scene.layers) {
        const texture = await acquire(layer.url),
          mask = layer.maskUrl ? await acquire(layer.maskUrl) : this.white;
        if (epoch !== this.epoch || this.destroyed)
          throw new DOMException("Aborted", "AbortError");
        const uniform = this.device.createBuffer({
          label: layer.id,
          size: 80,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const binding = this.device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: texture.gpu.createView() },
            { binding: 3, resource: mask.gpu.createView() },
          ],
        });
        materials.push({ layer, texture, mask, uniform, binding });
      }
      if (epoch !== this.epoch || this.destroyed)
        throw new DOMException("Aborted", "AbortError");
      this.release(this.outgoing);
      this.outgoing = this.materials;
      this.materials = materials;
      this.scene = scene;
      this.transition = performance.now();
      const texture = materials[materials.length - 1]!.texture;
      this.particleBind = this.device.createBindGroup({
        layout: this.particlePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.motion } },
          { binding: 1, resource: { buffer: this.particles } },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: texture.gpu.createView() },
        ],
      });
      this.canvas.dataset.gpuStatus = "ready";
      this.hooks.onStatus?.("ready");
      this.invalidate();
    } catch (error) {
      for (const material of materials) material.uniform.destroy();
      for (const texture of loaded.values()) texture.gpu.destroy();
      if (!abort.signal.aborted && !this.destroyed) {
        this.hooks.onStatus?.("error", String(error));
        throw error;
      }
    }
  }
  private resize() {
    if (!this.device || this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, this.hooks.maxDpr ?? 1.5);
    const budget = Math.min(
      1,
      Math.sqrt(2_800_000 / Math.max(1, rect.width * rect.height * dpr * dpr)),
    );
    this.canvas.width = clamp(
      Math.round(rect.width * dpr * budget),
      1,
      this.device.limits.maxTextureDimension2D,
    );
    this.canvas.height = clamp(
      Math.round(rect.height * dpr * budget),
      1,
      this.device.limits.maxTextureDimension2D,
    );
  }
  private drawMaterial(
    pass: GPURenderPassEncoder,
    material: Material,
    projection: Float32Array,
    fade: number,
  ) {
    const { layer, texture } = material,
      aspect = this.canvas.width / this.canvas.height;
    const pos = layer.position ?? [0, 0, 0],
      rotation = layer.rotation ?? [0, 0, 0];
    const fit = fitPlane(
      texture.width / texture.height,
      aspect,
      3.2 - pos[2],
      layer.fit === "cover",
    );
    const width = layer.width ?? fit.width * 0.88,
      height = layer.height ?? fit.height * 0.88;
    const moving = !this.paused && !this.reduced.matches;
    const x = pos[0] + (moving ? this.camera[0]! * 0.08 : 0),
      y = pos[1] + (moving ? this.camera[1]! * 0.05 : 0);
    const transform = model(
      x,
      y,
      pos[2] - 3.2,
      width * this.zoom,
      height * this.zoom,
      rotation[0] + (moving ? -this.camera[1]! * 0.035 : 0),
      rotation[1] + (moving ? this.camera[0]! * 0.055 : 0),
      rotation[2],
    );
    const data = new Float32Array(20);
    data.set(multiply(projection, transform));
    data.set(
      [
        (layer.opacity ?? 1) * fade,
        layer.maskUrl ? 1 : 0,
        layer.exposure ?? 1,
        0,
      ],
      16,
    );
    this.device.queue.writeBuffer(material.uniform, 0, data);
    pass.setBindGroup(0, material.binding);
    pass.draw(6);
  }
  private render = (now: number) => {
    this.raf = 0;
    if (
      this.destroyed ||
      !this.visible ||
      document.hidden ||
      !this.materials.length
    )
      return;
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.camera[0]! += (this.pointer[0]! - this.camera[0]!) * 0.07;
    this.camera[1]! += (this.pointer[1]! - this.camera[1]!) * 0.07;
    const moving = !this.paused && !this.reduced.matches;
    const fade = this.reduced.matches
      ? 1
      : clamp((now - this.transition) / 650, 0, 1);
    const particles = moving && this.scene?.particles && this.particleBind;
    const encoder = this.device.createCommandEncoder({
      label: "Fairy WebGPU frame",
    });
    if (particles) {
      this.device.queue.writeBuffer(
        this.motion,
        0,
        new Float32Array([
          now / 1000,
          delta,
          this.canvas.width / this.canvas.height,
          1,
        ]),
      );
      const compute = encoder.beginComputePass();
      compute.setPipeline(this.computePipeline);
      compute.setBindGroup(0, this.computeBind);
      compute.dispatchWorkgroups(2);
      compute.end();
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: this.hooks.transparent
            ? { r: 0, g: 0, b: 0, a: 0 }
            : { r: 0.015, g: 0.015, b: 0.022, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    const projection = perspective(this.canvas.width / this.canvas.height);
    if (fade < 1)
      for (const material of this.outgoing)
        this.drawMaterial(pass, material, projection, 1 - fade);
    for (const material of this.materials)
      this.drawMaterial(pass, material, projection, fade);
    if (particles) {
      pass.setPipeline(this.particlePipeline);
      pass.setBindGroup(0, this.particleBind!);
      pass.draw(6, 128);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.frame++;
    this.canvas.dataset.gpuFrames = String(this.frame);
    if (this.frame === 1 || this.frame % 120 === 0)
      this.hooks.onFrame?.(this.frame);
    if (fade >= 1 && this.outgoing.length) {
      this.release(this.outgoing);
      this.outgoing = [];
    }
    if (moving || fade < 1) this.invalidate();
  };
  private invalidate() {
    if (
      !this.raf &&
      !this.destroyed &&
      this.visible &&
      !document.hidden &&
      this.materials.length
    )
      this.raf = requestAnimationFrame(this.render);
  }
  setPaused(paused: boolean) {
    this.paused = paused;
    this.invalidate();
  }
  setZoom(zoom: number) {
    this.zoom = clamp(zoom, 0.5, 3);
    this.invalidate();
  }
  setPointer(x: number, y: number) {
    this.pointer = [clamp(x, -1, 1), clamp(y, -1, 1)];
    this.invalidate();
  }
  reset() {
    this.zoom = 1;
    this.pointer = [0, 0];
    this.camera = [0, 0];
    this.invalidate();
  }
  private pointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.setPointer(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
  };
  private pointerLeave = () => this.setPointer(0, 0);
  private visibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else this.invalidate();
  };
  private motionChange = () => this.invalidate();
  private release(materials: Material[]) {
    const textures = new Set<GPUTexture>();
    for (const material of materials) {
      material.uniform.destroy();
      textures.add(material.texture.gpu);
      if (material.mask !== this.white) textures.add(material.mask.gpu);
    }
    for (const texture of textures) texture.destroy();
  }
  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.epoch++;
    this.abort?.abort();
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersection.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.reduced.removeEventListener("change", this.motionChange);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerleave", this.pointerLeave);
    this.release(this.materials);
    this.release(this.outgoing);
    this.white?.gpu.destroy();
    this.motion?.destroy();
    this.particles?.destroy();
    this.context?.unconfigure();
    this.device?.destroy();
    this.hooks.onStatus?.("disposed");
  }
}
import type {} from "./native";
