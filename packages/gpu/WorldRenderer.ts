import type {} from "./native";
import { multiply, perspective } from "./math";
import {
  buildWorld,
  type WorldExhibit,
  type ExhibitPosition,
} from "./world-geometry";
import {
  cameraDirection,
  moveCamera,
  nearestRealm,
  ortho,
  portalAtRay,
  realmCenters,
  viewMatrix,
  type Realm,
  type Vec3,
} from "./world-math";
import { worldShader } from "./world-shaders";
export type Destination = Realm | "hub";
type Hooks = {
  onStatus?: (state: string, message?: string) => void;
  onRealm?: (realm: Destination) => void;
  onExhibit?: (asset: WorldExhibit) => void;
  onNearby?: (asset: WorldExhibit | null) => void;
  onAssets?: (loaded: number, total: number) => void;
};
type Journey = {
  points: Vec3[];
  start: number;
  duration: number;
  destination: Destination;
  initialYaw: number;
};
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
function catmull(points: Vec3[], t: number): [number, number, number] {
  const scaled = clamp(t, 0, 0.999999) * (points.length - 1),
    i = Math.floor(scaled),
    u = scaled - i;
  const a = points[Math.max(0, i - 1)]!,
    b = points[i]!,
    c = points[Math.min(points.length - 1, i + 1)]!,
    d = points[Math.min(points.length - 1, i + 2)]!;
  return [0, 1, 2].map(
    (k) =>
      0.5 *
      (2 * b[k]! +
        (-a[k]! + c[k]!) * u +
        (2 * a[k]! - 5 * b[k]! + 4 * c[k]! - d[k]!) * u * u +
        (-a[k]! + 3 * b[k]! - 3 * c[k]! + d[k]!) * u * u * u),
  ) as [number, number, number];
}
export class WorldRenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private main!: GPURenderPipeline;
  private shadowPipeline!: GPURenderPipeline;
  private outline!: GPURenderPipeline;
  private vertices!: GPUBuffer;
  private uniform!: GPUBuffer;
  private atlas!: GPUTexture;
  private depth: GPUTexture | null = null;
  private color: GPUTexture | null = null;
  private shadow!: GPUTexture;
  private mainBind!: GPUBindGroup;
  private shadowBind!: GPUBindGroup;
  private outlineBind!: GPUBindGroup;
  private count = 0;
  private positions: ExhibitPosition[] = [];
  private raf = 0;
  private last = 0;
  private frames = 0;
  private initialized = false;
  private pausedAt: number | null = null;
  private hiddenAt: number | null = null;
  private disposed = false;
  private paused = false;
  private visible = true;
  private fault = false;
  private recoveries = 0;
  private abort = new AbortController();
  private resizeObserver: ResizeObserver;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private position: [number, number, number] = [0, 2.8, 12];
  private yaw = 0;
  private pitch = -0.055;
  private keys = new Set<string>();
  private movement: [number, number] = [0, 0];
  private journey: Journey | null = null;
  private realm: Destination = "hub";
  private nearby: string | null = null;
  private drag: {
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null = null;
  private constructor(
    private canvas: HTMLCanvasElement,
    private assets: WorldExhibit[],
    private hooks: Hooks,
  ) {
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.invalidate();
    });
    this.resizeObserver.observe(canvas);
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.cancelPointer);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    canvas.addEventListener("keydown", this.keyDown);
    canvas.addEventListener("keyup", this.keyUp);
    canvas.addEventListener("blur", this.blur);
    document.addEventListener("visibilitychange", this.visibility);
    this.reduced.addEventListener("change", this.motionChange);
  }
  static async create(
    canvas: HTMLCanvasElement,
    assets: WorldExhibit[],
    hooks: Hooks = {},
  ) {
    const world = new WorldRenderer(canvas, assets.slice(0, 21), hooks);
    try {
      await world.initialize();
      return world;
    } catch (e) {
      world.hooks.onStatus?.("unavailable", String(e));
      world.dispose();
      throw e;
    }
  }
  private async initialize() {
    this.initialized = false;
    this.hooks.onStatus?.("initializing");
    if (!navigator.gpu) throw new Error("WebGPU indisponible");
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("Aucun adaptateur WebGPU");
    const device = await adapter.requestDevice();
    if (this.disposed) {
      device.destroy();
      return;
    }
    this.device = device;
    const context = this.canvas.getContext("webgpu");
    if (!context) throw new Error("Contexte WebGPU indisponible");
    this.context = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    device.addEventListener("uncapturederror", (event) => {
      if (this.disposed || device !== this.device) return;
      this.fault = true;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.canvas.dataset.gpuError = event.error.message;
      this.hooks.onStatus?.("error", event.error.message);
    });
    device.pushErrorScope("validation");
    const module = device.createShaderModule({
      label: "Fairy explorable architecture WGSL",
      code: worldShader,
    });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter((m) => m.type === "error");
    if (errors.length) throw new Error(errors.map((e) => e.message).join("\n"));
    const buffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: 56,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
          { shaderLocation: 2, offset: 24, format: "float32x2" },
          { shaderLocation: 3, offset: 32, format: "float32x4" },
          { shaderLocation: 4, offset: 48, format: "float32x2" },
        ],
      },
    ];
    this.main = await device.createRenderPipelineAsync({
      label: "World cel lighting + PCF shadows",
      layout: "auto",
      vertex: { module, entryPoint: "mainVertex", buffers },
      fragment: { module, entryPoint: "mainFragment", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
      multisample: { count: 4 },
    });
    this.shadowPipeline = await device.createRenderPipelineAsync({
      label: "World directional shadow map",
      layout: "auto",
      vertex: { module, entryPoint: "shadowVertex", buffers },
      fragment: { module, entryPoint: "shadowFragment", targets: [] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less",
        depthBias: 2,
        depthBiasSlopeScale: 2,
      },
    });
    this.outline = await device.createRenderPipelineAsync({
      label: "World ink silhouettes",
      layout: "auto",
      vertex: { module, entryPoint: "outlineVertex", buffers },
      fragment: {
        module,
        entryPoint: "outlineFragment",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list", cullMode: "front" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less-equal",
      },
      multisample: { count: 4 },
    });
    this.uniform = device.createBuffer({
      size: 176,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.atlas = device.createTexture({
      label: "Observed source artwork array",
      size: [512, 512, Math.max(1, this.assets.length)],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.shadow = device.createTexture({
      size: [1024, 1024],
      format: "depth32float",
      usage:
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const sampler = device.createSampler({
        minFilter: "linear",
        magFilter: "linear",
      }),
      comparison = device.createSampler({
        compare: "less-equal",
        minFilter: "linear",
        magFilter: "linear",
      });
    const common = [
      { binding: 0, resource: { buffer: this.uniform } },
      {
        binding: 1,
        resource: this.atlas.createView({ dimension: "2d-array" }),
      },
      { binding: 2, resource: sampler },
    ];
    this.mainBind = device.createBindGroup({
      layout: this.main.getBindGroupLayout(0),
      entries: [
        ...common,
        { binding: 3, resource: this.shadow.createView() },
        { binding: 4, resource: comparison },
      ],
    });
    this.shadowBind = device.createBindGroup({
      layout: this.shadowPipeline.getBindGroupLayout(0),
      entries: common,
    });
    this.outlineBind = device.createBindGroup({
      layout: this.outline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniform } }],
    });
    this.uploadGeometry();
    this.resize();
    const error = await device.popErrorScope();
    if (error) throw new Error(error.message);
    this.initialized = true;
    this.fault = false;
    this.canvas.dataset.renderer = "webgpu-world";
    this.canvas.dataset.geometry = "volumetric-mesh";
    this.canvas.dataset.gpuPipelines =
      "geometry,shadow-map,ink-outline,texture-array,msaa4";
    this.canvas.dataset.gpuStatus = "ready";
    this.hooks.onStatus?.("ready");
    this.invalidate();
    void this.loadArtwork();
    void device.lost.then((info) => {
      if (this.disposed || this.device !== device) return;
      this.fault = true;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.hooks.onStatus?.("lost", info.message);
      this.abort.abort();
      if (this.recoveries++ < 2) {
        this.releaseGPU();
        this.abort = new AbortController();
        void this.initialize().catch((e) =>
          this.hooks.onStatus?.("unavailable", String(e)),
        );
      }
    });
  }
  private uploadGeometry() {
    const mesh = buildWorld(this.assets);
    const next = this.device.createBuffer({
      size: mesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(next, 0, mesh.vertices);
    this.vertices?.destroy();
    this.vertices = next;
    this.count = mesh.vertexCount;
    this.positions = mesh.positions;
    this.canvas.dataset.worldVertices = String(mesh.vertexCount);
    this.canvas.dataset.worldExhibits = String(mesh.positions.length);
  }
  private async loadArtwork() {
    const signal = this.abort.signal;
    let next = 0,
      loaded = 0;
    const device = this.device;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < this.assets.length) {
          const slot = next++,
            asset = this.assets[slot]!;
          let bitmap: ImageBitmap | null = null;
          try {
            const url = new URL(asset.url, location.href);
            if (url.origin !== location.origin)
              throw new Error("Texture source hors origine locale");
            const response = await fetch(url, { signal });
            if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
            const blob = await response.blob();
            if (blob.size > 8 * 1024 * 1024)
              throw new Error("Image hors budget");
            bitmap = await createImageBitmap(blob);
            asset.aspect = bitmap.width / bitmap.height;
            const square = await createImageBitmap(bitmap, {
              resizeWidth: 512,
              resizeHeight: 512,
              resizeQuality: "high",
            });
            bitmap.close();
            bitmap = square;
            if (signal.aborted || this.disposed || this.device !== device)
              return;
            device.queue.copyExternalImageToTexture(
              { source: bitmap },
              { texture: this.atlas, origin: [0, 0, slot] },
              [512, 512],
            );
            loaded++;
            this.canvas.dataset.loadedArtworks = String(loaded);
            this.hooks.onAssets?.(loaded, this.assets.length);
            this.invalidate();
          } catch {
            if (!signal.aborted) {
              this.canvas.dataset.failedArtworks = String(
                Number(this.canvas.dataset.failedArtworks ?? 0) + 1,
              );
            }
          } finally {
            bitmap?.close();
          }
        }
      }),
    );
    if (!signal.aborted && !this.disposed && this.device === device) {
      this.uploadGeometry();
      this.invalidate();
    }
  }
  private resize() {
    if (!this.device || this.disposed) return;
    const rect = this.canvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 1.5),
      ratio = Math.min(
        1,
        Math.sqrt(
          2_000_000 / Math.max(1, rect.width * rect.height * dpr * dpr),
        ),
      );
    const width = Math.max(1, Math.round(rect.width * dpr * ratio)),
      height = Math.max(1, Math.round(rect.height * dpr * ratio));
    if (
      this.canvas.width === width &&
      this.canvas.height === height &&
      this.depth
    )
      return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.depth?.destroy();
    this.color?.destroy();
    this.depth = this.device.createTexture({
      size: [width, height],
      format: "depth24plus",
      sampleCount: 4,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.color = this.device.createTexture({
      size: [width, height],
      format: navigator.gpu.getPreferredCanvasFormat(),
      sampleCount: 4,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
  goTo(destination: Destination) {
    this.keys.clear();
    this.movement = [0, 0];
    const old = nearestRealm(this.position),
      x = destination === "hub" ? 0 : realmCenters[destination];
    if (
      destination === old ||
      (destination === "hub" &&
        Math.hypot(this.position[0], this.position[2] - 12) < 0.1)
    ) {
      this.journey = null;
      this.invalidate();
      return;
    }
    const points: Vec3[] = [[...this.position]];
    if (old) points.push([realmCenters[old], 2.8, -3]);
    points.push([x, 2.8, -3]);
    points.push(destination === "hub" ? [0, 2.8, 12] : [x, 2.8, -12]);
    if (this.reduced.matches) {
      this.position = [...points[points.length - 1]!];
      this.yaw = destination === "hub" ? 0 : 0;
      this.pitch = -0.04;
      this.journey = null;
      this.reportRealm();
      this.invalidate();
      return;
    }
    this.journey = {
      points,
      start: performance.now(),
      duration: Math.min(5500, 1800 + points.length * 500),
      destination,
      initialYaw: this.yaw,
    };
    this.invalidate();
  }
  setMovement(x: number, z: number) {
    this.journey = null;
    this.movement = [x, z];
    this.invalidate();
  }
  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    const now = performance.now();
    if (paused) this.pausedAt = now;
    else {
      if (this.journey && this.pausedAt !== null)
        this.journey.start += now - this.pausedAt;
      this.pausedAt = null;
      this.last = now;
    }
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.movement = [0, 0];
    }
    this.invalidate();
  }
  reset() {
    this.goTo("hub");
  }
  openNearby() {
    const asset = this.positions.find((p) => p.asset.id === this.nearby)?.asset;
    if (asset) this.hooks.onExhibit?.(asset);
  }
  private reportRealm() {
    const realm = nearestRealm(this.position) ?? "hub";
    if (realm !== this.realm) {
      this.realm = realm;
      this.hooks.onRealm?.(realm);
    }
  }
  private render = (now: number) => {
    this.raf = 0;
    if (
      !this.initialized ||
      this.disposed ||
      this.fault ||
      document.hidden ||
      !this.visible
    )
      return;
    const dt = Math.min((now - (this.last || now)) / 1000, 0.045);
    this.last = now;
    if (this.journey && !this.paused) {
      const j = this.journey,
        t = clamp((now - j.start) / j.duration, 0, 1),
        smooth = t * t * (3 - 2 * t);
      this.position = catmull(j.points, smooth);
      const ahead = catmull(j.points, Math.min(1, smooth + 0.018));
      const dx = ahead[0] - this.position[0],
        dz = ahead[2] - this.position[2];
      if (Math.hypot(dx, dz) > 0.01) {
        const target = Math.atan2(dx, -dz);
        this.yaw +=
          Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw)) *
          Math.min(1, dt * 5);
      }
      this.pitch += (-0.04 - this.pitch) * dt * 4;
      if (t >= 1) {
        this.journey = null;
        this.yaw = 0;
      }
    } else if (!this.paused) {
      const forward =
        (this.keys.has("ArrowUp") || this.keys.has("w") ? 1 : 0) -
        (this.keys.has("ArrowDown") || this.keys.has("s") ? 1 : 0) +
        this.movement[1];
      const side =
        (this.keys.has("ArrowRight") || this.keys.has("d") ? 1 : 0) -
        (this.keys.has("ArrowLeft") || this.keys.has("a") ? 1 : 0) +
        this.movement[0];
      if (forward || side) {
        const speed = (dt * 5.4) / Math.max(1, Math.hypot(side, forward));
        this.position = moveCamera(
          this.position,
          (Math.sin(this.yaw) * forward + Math.cos(this.yaw) * side) * speed,
          (-Math.cos(this.yaw) * forward + Math.sin(this.yaw) * side) * speed,
        );
      }
    }
    this.reportRealm();
    const dir = cameraDirection(this.yaw, this.pitch),
      target: Vec3 = [
        this.position[0] + dir[0],
        this.position[1] + dir[1],
        this.position[2] + dir[2],
      ];
    const vp = multiply(
      perspective(
        this.canvas.width / this.canvas.height,
        0.1,
        120,
        Math.PI / 2.5,
      ),
      viewMatrix(this.position, target),
    );
    const light = multiply(
      ortho(-38, 38, -38, 38, 0.1, 120),
      viewMatrix([-24, 42, 18], [0, 0, -14]),
    );
    const data = new Float32Array(44);
    data.set(vp);
    data.set(light, 16);
    data.set([...this.position, this.reduced.matches ? 0 : now / 1000], 32);
    data.set([0.45, 0.8, 0.3, 0.3], 36);
    data.set([0.17, 0.145, 0.14, 0.014], 40);
    this.device.queue.writeBuffer(this.uniform, 0, data);
    const encoder = this.device.createCommandEncoder();
    const shadow = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadow.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    shadow.setPipeline(this.shadowPipeline);
    shadow.setBindGroup(0, this.shadowBind);
    shadow.setVertexBuffer(0, this.vertices);
    shadow.draw(this.count);
    shadow.end();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.color!.createView(),
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.22, g: 0.2, b: 0.23, a: 1 },
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
      depthStencilAttachment: {
        view: this.depth!.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setVertexBuffer(0, this.vertices);
    pass.setPipeline(this.outline);
    pass.setBindGroup(0, this.outlineBind);
    pass.draw(this.count);
    pass.setPipeline(this.main);
    pass.setBindGroup(0, this.mainBind);
    pass.draw(this.count);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.frames++;
    this.canvas.dataset.gpuFrames = String(this.frames);
    this.canvas.dataset.cameraPosition = this.position
      .map((n) => n.toFixed(2))
      .join(",");
    this.canvas.dataset.cameraYaw = this.yaw.toFixed(3);
    this.canvas.dataset.realm = this.realm;
    this.canvas.dataset.travelling = String(!!this.journey);
    {
      let near: ExhibitPosition | undefined;
      let best = 8;
      for (const exhibit of this.positions) {
        const distance = Math.hypot(
          exhibit.position[0] - this.position[0],
          exhibit.position[2] - this.position[2],
        );
        if (distance < best) {
          near = exhibit;
          best = distance;
        }
      }
      const id = near?.asset.id ?? null;
      if (id !== this.nearby) {
        this.nearby = id;
        this.hooks.onNearby?.(near?.asset ?? null);
      }
    }
    if (
      !this.paused &&
      (!this.reduced.matches ||
        this.journey ||
        this.keys.size ||
        this.movement.some(Boolean))
    )
      this.invalidate();
  };
  private invalidate() {
    if (
      this.initialized &&
      !this.raf &&
      !this.disposed &&
      !this.fault &&
      !document.hidden
    )
      this.raf = requestAnimationFrame(this.render);
  }
  private ray(clientX: number, clientY: number): Vec3 {
    const r = this.canvas.getBoundingClientRect(),
      x =
        ((((clientX - r.left) / r.width) * 2 - 1) *
          Math.tan(Math.PI / 5) *
          r.width) /
        r.height,
      y = (1 - ((clientY - r.top) / r.height) * 2) * Math.tan(Math.PI / 5);
    const forward = cameraDirection(this.yaw, this.pitch),
      right: Vec3 = [Math.cos(this.yaw), 0, Math.sin(this.yaw)],
      up: Vec3 = [
        -Math.sin(this.yaw) * Math.sin(this.pitch),
        Math.cos(this.pitch),
        Math.cos(this.yaw) * Math.sin(this.pitch),
      ];
    const d: Vec3 = [
        forward[0] + right[0] * x + up[0] * y,
        forward[1] + right[1] * x + up[1] * y,
        forward[2] + right[2] * x + up[2] * y,
      ],
      length = Math.hypot(...d);
    return [d[0] / length, d[1] / length, d[2] / length];
  }
  private pick(x: number, y: number) {
    const ray = this.ray(x, y),
      portal = portalAtRay(this.position, ray);
    if (portal && this.position[2] > -9) {
      this.goTo(portal);
      return;
    }
    let best = 70,
      chosen: WorldExhibit | undefined;
    for (const p of this.positions) {
      const normal: Vec3 = [Math.sin(p.yaw), 0, Math.cos(p.yaw)],
        den = normal[0] * ray[0] + normal[2] * ray[2];
      if (Math.abs(den) < 0.001) continue;
      const t =
        ((p.position[0] - this.position[0]) * normal[0] +
          (p.position[2] - this.position[2]) * normal[2]) /
        den;
      if (t < 0.1 || t >= best) continue;
      const px = this.position[0] + ray[0] * t - p.position[0],
        py = this.position[1] + ray[1] * t - p.position[1],
        pz = this.position[2] + ray[2] * t - p.position[2];
      const horizontal = px * Math.cos(p.yaw) - pz * Math.sin(p.yaw);
      if (Math.abs(horizontal) < p.width / 2 && Math.abs(py) < p.height / 2) {
        best = t;
        chosen = p.asset;
      }
    }
    if (chosen) this.hooks.onExhibit?.(chosen);
    else if (portal) this.goTo("hub");
  }
  private down = (event: PointerEvent) => {
    if (this.paused) return;
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    };
  };
  private move = (event: PointerEvent) => {
    if (!this.drag || this.drag.id !== event.pointerId || this.paused) return;
    this.journey = null;
    this.yaw += (event.clientX - this.drag.x) * 0.004;
    this.pitch = clamp(
      this.pitch - (event.clientY - this.drag.y) * 0.003,
      -0.7,
      0.7,
    );
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
    this.invalidate();
  };
  private up = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    if (
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6
    )
      this.pick(event.clientX, event.clientY);
  };
  private cancelPointer = () => {
    this.drag = null;
  };
  private wheel = (event: WheelEvent) => {
    if (this.paused || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    this.journey = null;
    const dir = cameraDirection(this.yaw, 0),
      step = clamp(event.deltaY * 0.012, -2, 2);
    this.position = moveCamera(this.position, dir[0] * step, dir[2] * step);
    this.invalidate();
  };
  private keyDown = (event: KeyboardEvent) => {
    if (
      this.paused ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "w",
        "a",
        "s",
        "d",
      ].includes(event.key)
    ) {
      this.journey = null;
      this.keys.add(event.key);
      event.preventDefault();
      this.invalidate();
    } else if (event.key === "Enter") {
      this.openNearby();
      event.preventDefault();
    } else if (event.key === "Escape") {
      this.goTo("hub");
    }
  };
  private keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key);
  };
  private blur = () => {
    this.keys.clear();
    this.movement = [0, 0];
    this.drag = null;
  };
  private visibility = () => {
    if (document.hidden) {
      this.hiddenAt = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.blur();
    } else {
      const now = performance.now();
      if (this.journey && this.hiddenAt !== null && !this.paused)
        this.journey.start += now - this.hiddenAt;
      this.hiddenAt = null;
      this.last = now;
      this.invalidate();
    }
  };
  private motionChange = () => {
    if (this.reduced.matches && this.journey) {
      this.position = [...this.journey.points[this.journey.points.length - 1]!];
      this.journey = null;
      this.yaw = 0;
      this.pitch = -0.04;
      this.reportRealm();
    }
    this.invalidate();
  };
  private releaseGPU() {
    this.initialized = false;
    this.vertices?.destroy();
    this.uniform?.destroy();
    this.atlas?.destroy();
    this.shadow?.destroy();
    this.depth?.destroy();
    this.color?.destroy();
    this.depth = null;
    this.color = null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.reduced.removeEventListener("change", this.motionChange);
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.cancelPointer);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.canvas.removeEventListener("keydown", this.keyDown);
    this.canvas.removeEventListener("keyup", this.keyUp);
    this.canvas.removeEventListener("blur", this.blur);
    this.releaseGPU();
    this.context?.unconfigure();
    this.device?.destroy();
  }
}
