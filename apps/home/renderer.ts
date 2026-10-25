import { WebGPURenderer } from "../../packages/gpu/index.ts";
import { sceneAsset, type Scene, type SceneAsset } from "./scene.ts";

type Hooks = {
  onStatus?: (status: string, message?: string) => void;
  onPause?: (paused: boolean) => void;
  onZoom?: (zoom: number) => void;
};

/** Only source-manifest SVGs are rasterized; all scene composition remains in WebGPU. */
async function svgTexture(
  asset: SceneAsset,
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(url, { signal });
  if (
    !response.ok ||
    !/^image\/svg\+xml(?:;|$)/i.test(response.headers.get("content-type") ?? "")
  )
    throw new Error("SVG de scène indisponible");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SVG sans contenu");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1024 * 1024) throw new Error("SVG hors budget de 1 Mio");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes),
    sha = [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  if (sha !== asset.sha256)
    throw new Error("Empreinte SVG différente du manifeste");
  const source = new TextDecoder().decode(bytes),
    document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (
    document.querySelector(
      "parsererror,script,foreignObject,image,iframe,object,style",
    ) ||
    document.documentElement.localName !== "svg"
  )
    throw new Error("SVG de scène non autonome");
  for (const node of document.querySelectorAll("*"))
    for (const attribute of node.attributes) {
      if (
        /^on/i.test(attribute.name) ||
        (/(?:^|:)href$/i.test(attribute.name) &&
          !attribute.value.startsWith("#")) ||
        /url\(\s*["']?(?!#)/i.test(attribute.value)
      )
        throw new Error("Référence externe SVG refusée");
    }
  const width = asset.width,
    height = asset.height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384
  )
    throw new Error("Dimensions SVG non qualifiées");
  const ratio = Math.min(
      1,
      4096 / width,
      4096 / height,
      Math.sqrt((8 * 1024 ** 2) / (width * height)),
    ),
    w = Math.max(1, Math.round(width * ratio)),
    h = Math.max(1, Math.round(height * ratio));
  const sourceUrl = URL.createObjectURL(
      new Blob([bytes], { type: "image/svg+xml" }),
    ),
    image = new Image();
  let aborted: () => void = () => {};
  try {
    const cancellation = new Promise<never>((_, reject) => {
      aborted = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", aborted, { once: true });
    });
    signal.throwIfAborted();
    image.src = sourceUrl;
    await Promise.race([image.decode(), cancellation]);
    signal.throwIfAborted();
    const canvas = new OffscreenCanvas(w, h),
      context = canvas.getContext("2d");
    if (!context) throw new Error("Rasteriseur SVG indisponible");
    context.drawImage(image, 0, 0, w, h);
    const png = await canvas.convertToBlob({ type: "image/png" });
    signal.throwIfAborted();
    if (png.size > 16 * 1024 ** 2)
      throw new Error("Texture SVG rasterisée hors budget");
    return URL.createObjectURL(png);
  } finally {
    signal.removeEventListener("abort", aborted);
    image.src = "";
    URL.revokeObjectURL(sourceUrl);
  }
}

/** Adapter to the shared native WebGPU owner. Unsupported devices keep the source image. */
export class SceneRenderer {
  private ready: Promise<WebGPURenderer | null>;
  private gpu: WebGPURenderer | null = null;
  private disposed = false;
  private paused = false;
  private zoom = 1;
  private pointer: [number, number] = [0, 0];
  private generation = 0;
  private preparation: AbortController | null = null;
  private textureUrls = new Set<string>();
  constructor(
    private canvas: HTMLCanvasElement,
    private hooks: Hooks = {},
  ) {
    canvas.dataset.renderer = "webgpu";
    this.ready = WebGPURenderer.create(canvas, {
      maxDpr: 2,
      transparent: true,
      onStatus: (status, message) => {
        if (this.disposed || status === "disposed") return;
        hooks.onStatus?.(
          status,
          status === "unavailable"
            ? "WebGPU indisponible sur cet appareil ; l’image source reste affichée."
            : message,
        );
      },
    })
      .then((gpu) => {
        if (this.disposed) {
          gpu.dispose();
          return null;
        }
        this.gpu = gpu;
        gpu.setPaused(this.paused);
        gpu.setZoom(this.zoom);
        return gpu;
      })
      .catch(() => null);
    canvas.addEventListener("keydown", this.keydown);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
  }
  async load(scene: Scene) {
    this.preparation?.abort();
    const controller = new AbortController();
    this.preparation = controller;
    const generation = ++this.generation,
      gpu = await this.ready;
    if (!gpu || this.disposed || generation !== this.generation) return;
    const urls = new Set<string>();
    const prepared = new Map<string, Promise<string>>();
    const timeout = setTimeout(
      () =>
        controller.abort(
          new DOMException("Préparation SVG trop longue", "TimeoutError"),
        ),
      20000,
    );
    try {
      this.hooks.onStatus?.("loading");
      const texture = (url: string) => {
        const address = sceneAsset(url, scene);
        const asset = Object.values(scene.assets).find(
          (candidate) => sceneAsset(candidate.url, scene) === address,
        );
        if (!asset) throw new Error("Texture absente du manifeste source");
        if (asset.mime !== "image/svg+xml") return Promise.resolve(address);
        let pending = prepared.get(address);
        if (!pending) {
          pending = svgTexture(asset, address, controller.signal).then(
            (local) => {
              urls.add(local);
              return local;
            },
          );
          prepared.set(address, pending);
        }
        return pending;
      };
      const layers = await Promise.all(
        scene.layers.map(async (layer) => ({
          id: layer.id,
          url: await texture(layer.texture),
          maskUrl: layer.mask ? await texture(layer.mask) : undefined,
          width: layer.width,
          height: layer.height,
          position: layer.position,
          rotation: layer.rotation,
          opacity: layer.opacity,
          fit: "contain" as const,
        })),
      );
      if (
        controller.signal.aborted ||
        this.disposed ||
        generation !== this.generation
      )
        throw new DOMException("Aborted", "AbortError");
      await gpu.load({
        id: scene.id,
        particles: false,
        layers,
      });
      if (this.disposed || generation !== this.generation)
        throw new DOMException("Aborted", "AbortError");
      for (const old of this.textureUrls) URL.revokeObjectURL(old);
      this.textureUrls = urls;
      this.canvas.dataset.sourceLayers = String(layers.length);
      this.canvas.dataset.sourceScene = scene.id;
      this.canvas.dataset.sourceMasks = String(
        layers.filter((layer) => layer.maskUrl).length,
      );
      this.canvas.dataset.rasterizedSvg = String(prepared.size);
    } catch (error) {
      controller.abort();
      await Promise.allSettled(prepared.values());
      for (const url of urls) URL.revokeObjectURL(url);
      if (!this.disposed && generation === this.generation)
        this.hooks.onStatus?.(
          "error",
          `Scène WebGPU indisponible : ${String(error)}`,
        );
    } finally {
      clearTimeout(timeout);
    }
  }
  setPaused(value: boolean) {
    this.paused = value;
    this.gpu?.setPaused(value);
    this.hooks.onPause?.(value);
  }
  setZoom(value: number) {
    this.zoom = Math.max(0.7, Math.min(1.6, value));
    this.gpu?.setZoom(this.zoom);
    this.hooks.onZoom?.(this.zoom);
  }
  reset() {
    this.pointer = [0, 0];
    this.gpu?.reset();
    this.setZoom(1);
  }
  private wheel = (event: WheelEvent) => {
    if (event.ctrlKey || document.activeElement === this.canvas) {
      event.preventDefault();
      this.setZoom(this.zoom - event.deltaY * 0.001);
    }
  };
  private keydown = (event: KeyboardEvent) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const direction: Record<string, [number, number]> = {
      ArrowLeft: [-0.15, 0],
      ArrowRight: [0.15, 0],
      ArrowUp: [0, 0.15],
      ArrowDown: [0, -0.15],
    };
    const delta = direction[event.key];
    if (delta) {
      this.pointer = [
        Math.max(-1, Math.min(1, this.pointer[0] + delta[0])),
        Math.max(-1, Math.min(1, this.pointer[1] + delta[1])),
      ];
      this.gpu?.setPointer(...this.pointer);
    } else if (["+", "="].includes(event.key)) this.setZoom(this.zoom + 0.1);
    else if (event.key === "-") this.setZoom(this.zoom - 0.1);
    else if (["0", "r"].includes(event.key)) this.reset();
    else if (event.key === " ") this.setPaused(!this.paused);
    else return;
    event.preventDefault();
  };
  dispose() {
    this.disposed = true;
    this.generation++;
    this.preparation?.abort();
    for (const url of this.textureUrls) URL.revokeObjectURL(url);
    this.textureUrls.clear();
    this.canvas.removeEventListener("keydown", this.keydown);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.gpu?.dispose();
    this.gpu = null;
  }
}
