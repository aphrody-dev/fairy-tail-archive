import { useEffect, useRef, useState } from "react";
import { WebGPURenderer, type GPUStatus } from "../gpu/index";

export function GPUSurface({
  url,
  label,
  manga,
  immersive,
  paused = false,
}: {
  url: string;
  label: string;
  manga: boolean;
  immersive: boolean;
  paused?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<WebGPURenderer | null>(null);
  const [status, setStatus] = useState<GPUStatus>("initializing");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    let instance: WebGPURenderer | null = null;
    if (!canvas.current) return;
    void WebGPURenderer.create(canvas.current, {
      onStatus: (state, message) => {
        if (disposed) return;
        setStatus(state);
        setError(message ?? "");
      },
    })
      .then((gpu) => {
        if (disposed) {
          gpu.dispose();
          return;
        }
        instance = gpu;
        renderer.current = gpu;
        setReady(true);
      })
      .catch((reason) => {
        if (!disposed) {
          setStatus("unavailable");
          setError(String(reason));
        }
      });
    return () => {
      disposed = true;
      instance?.dispose();
      renderer.current = null;
    };
  }, []);
  useEffect(
    () => renderer.current?.setPaused(paused || manga),
    [paused, manga, ready],
  );
  useEffect(() => {
    const gpu = renderer.current;
    if (!gpu || !ready) return;
    const mobile = matchMedia("(max-width: 800px)").matches;
    void gpu
      .load({
        id: url,
        particles: !manga && !immersive,
        layers: [
          ...(!manga
            ? [
                {
                  id: "ambient",
                  url,
                  position: [0, 0, -1.4] as const,
                  fit: "cover" as const,
                  opacity: 0.72,
                  exposure: 0.45,
                },
              ]
            : []),
          {
            id: "artwork",
            url,
            position: [immersive ? 0 : mobile ? 0.25 : 0.65, 0, 0],
            fit: "contain",
            opacity: 1,
            exposure: 1,
          },
        ],
      })
      .catch(() => {});
  }, [url, manga, immersive, ready]);
  return (
    <div
      className="gpu-surface"
      data-status={status}
      data-ready={status === "ready"}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        className="gpu-canvas"
        aria-hidden={status !== "ready"}
      />
      {error ? (
        <span className="gpu-note" role="status">
          WebGPU indisponible · image originale affichée
        </span>
      ) : null}
    </div>
  );
}
