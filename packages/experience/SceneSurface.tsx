import { useCallback, useRef, useState } from "react";
import { SceneCanvas } from "../../apps/home/SceneCanvas";
import type { SceneRenderer } from "../../apps/home/renderer";
import type { Scene } from "../../apps/home/scene";
import { IconButton } from "./icons";
export function SceneSurface({ scene }: { scene: Scene }) {
  const instance = useRef<SceneRenderer | null>(null);
  const [paused, setPaused] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [zoom, setZoom] = useState(1);
  const receive = useCallback((renderer: SceneRenderer | null) => {
    instance.current = renderer;
  }, []);
  return (
    <div className="unified-scene">
      <SceneCanvas
        scene={scene}
        paused={paused}
        zoom={zoom}
        onPause={setPaused}
        onZoom={setZoom}
        onRenderer={receive}
      />
      <div className="scene-tools">
        <IconButton
          icon={paused ? "play" : "pause"}
          label={paused ? "Animer la scène" : "Mettre la scène en pause"}
          aria-pressed={!paused}
          onClick={() => setPaused(!paused)}
        />
        <IconButton
          icon="zoom"
          label="Zoomer la scène"
          disabled={zoom >= 1.6}
          onClick={() => setZoom(Math.min(1.6, zoom + 0.2))}
        />
        <IconButton
          icon="reset"
          label="Réinitialiser le point de vue"
          onClick={() => {
            instance.current?.reset();
            setZoom(1);
          }}
        />
      </div>
    </div>
  );
}
