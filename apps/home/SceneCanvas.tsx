import { useEffect, useRef, useState } from "react";
import type { Scene } from "./scene.ts";
import { SceneRenderer } from "./renderer.ts";
export function SceneCanvas({
  scene,
  paused,
  zoom,
  onPause,
  onZoom,
  onRenderer,
}: {
  scene: Scene | null;
  paused: boolean;
  zoom: number;
  onPause: (paused: boolean) => void;
  onZoom: (zoom: number) => void;
  onRenderer: (renderer: SceneRenderer | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<SceneRenderer | null>(null),
    [status, setStatus] = useState("loading"),
    [error, setError] = useState("");
  useEffect(() => {
    if (!canvas.current) return;
    try {
      const instance = new SceneRenderer(canvas.current, {
        onStatus: (next, message) => {
          setStatus(next);
          setError(message ?? "");
        },
        onPause,
        onZoom,
      });
      renderer.current = instance;
      onRenderer(instance);
      return () => {
        instance.dispose();
        renderer.current = null;
        onRenderer(null);
      };
    } catch (error) {
      setStatus("error");
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [onPause, onRenderer, onZoom]);
  useEffect(() => {
    if (scene && renderer.current)
      void renderer.current.load(scene).catch(() => {});
  }, [scene]);
  useEffect(() => renderer.current?.setPaused(paused), [paused]);
  useEffect(() => renderer.current?.setZoom(zoom), [zoom]);
  return (
    <div className="scene-stage" data-status={status}>
      {scene ? (
        <img
          className={`scene-fallback ${status === "ready" ? "is-hidden" : ""}`}
          src={scene.assets.preview.url}
          alt={scene.title}
          width={scene.width}
          height={scene.height}
        />
      ) : null}
      <canvas
        ref={canvas}
        className="scene-canvas"
        role="img"
        tabIndex={status === "ready" ? 0 : -1}
        aria-hidden={status !== "ready"}
        aria-label={
          scene ? `Scène interactive : ${scene.title}` : "Scène interactive"
        }
        aria-describedby="scene-help"
      />
      <p id="scene-help" className="visually-hidden">
        Faites glisser horizontalement pour changer de point de vue. Au clavier
        : flèches pour pivoter, plus et moins pour zoomer, espace pour arrêter
        le mouvement, zéro pour réinitialiser.
      </p>
      {error ? (
        <p className="webgl-note" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
