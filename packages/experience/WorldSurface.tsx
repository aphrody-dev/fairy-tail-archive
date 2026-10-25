import { useEffect, useRef, useState } from "react";
import { sourceCatalog } from "@fairy/ui";
import { WorldRenderer, type Destination } from "../gpu/WorldRenderer";
import type { WorldExhibit } from "../gpu/world-geometry";
import { IconButton } from "./icons";

export function worldExhibits(): WorldExhibit[] {
  const result: WorldExhibit[] = [];
  for (const [realm, ids, match] of [
    ["manga", ["W24"], /fumetti-cover/],
    ["anime", ["W01"], /img_key_visual|img_chara/],
    ["games", ["W14"], /gallery_.*\.(jpg|png)|chara\/img_(natsu|lucy)\.png/],
  ] as const) {
    let count = 0;
    for (const id of ids) {
      const source = sourceCatalog.sources.find((s) => s.id === id);
      source?.images.forEach((image, index) => {
        if (count >= 7 || !match.test(image.url)) return;
        result.push({
          id: `${id}:${index}`,
          realm,
          sourceId: id,
          assetIndex: index,
          url: `/references/${id}/${index}`,
          originalUrl: image.url,
          sourceUrl: image.sourceUrl,
          title: image.alt || source.title || source.url,
          aspect: realm === "manga" ? 0.67 : 0.9,
          sourceClass: source.sourceClass,
        });
        count++;
      });
    }
  }
  return result;
}
const labels = {
  hub: "La halle de la guilde",
  manga: "Archives du manga",
  anime: "Observatoire de l’anime",
  games: "Arène des jeux",
};
const exhibits = worldExhibits();
export function WorldSurface({
  journey,
  paused,
  controls,
  onOpen,
  onRealm,
  onRead,
  onVideo,
  onScenes,
  scenesAvailable,
}: {
  journey: { destination: Destination; serial: number };
  paused: boolean;
  controls: boolean;
  onOpen: (asset: WorldExhibit) => void;
  onRealm: (realm: Destination) => void;
  onRead: () => void;
  onVideo: () => void;
  onScenes: () => void;
  scenesAvailable: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<WorldRenderer | null>(null);
  const callbacks = useRef({ onOpen, onRealm });
  callbacks.current = { onOpen, onRealm };
  const [status, setStatus] = useState("initializing"),
    [message, setMessage] = useState("");
  const [realm, setRealm] = useState<Destination>("hub"),
    [nearby, setNearby] = useState<WorldExhibit | null>(null);
  const [loaded, setLoaded] = useState(0),
    [help, setHelp] = useState(false);
  const latest = useRef({ journey, paused });
  latest.current = { journey, paused: paused || help };
  useEffect(() => {
    let gone = false;
    let instance: WorldRenderer | null = null;
    if (!canvas.current) return;
    callbacks.current.onRealm("hub");
    void WorldRenderer.create(
      canvas.current,
      exhibits.map((a) => ({ ...a })),
      {
        onStatus: (state, detail) => {
          if (!gone) {
            setStatus(state);
            setMessage(detail ?? "");
          }
        },
        onRealm: (r) => {
          if (!gone) {
            setRealm(r);
            callbacks.current.onRealm(r);
          }
        },
        onNearby: (a) => {
          if (!gone) setNearby(a);
        },
        onExhibit: (a) => callbacks.current.onOpen(a),
        onAssets: (n) => {
          if (!gone) setLoaded(n);
        },
      },
    )
      .then((world) => {
        instance = world;
        if (gone) {
          world.dispose();
          return;
        }
        renderer.current = world;
        world.setPaused(latest.current.paused);
        if (latest.current.journey.serial)
          world.goTo(latest.current.journey.destination);
      })
      .catch(() => {});
    return () => {
      gone = true;
      instance?.dispose();
      renderer.current = null;
    };
  }, []);
  useEffect(() => {
    if (journey.serial) renderer.current?.goTo(journey.destination);
  }, [journey]);
  useEffect(() => renderer.current?.setPaused(paused || help), [paused, help]);
  return (
    <div className="world-surface">
      <canvas
        ref={canvas}
        tabIndex={0}
        aria-label="Univers 3D explorable de Fairy Tail"
        aria-describedby="world-help"
      />
      {controls && (
        <>
          <div className="world-heading">
            <p>FAIRY TAIL · EXPLORATION</p>
            <h1>{labels[realm]}</h1>
            <span>
              {loaded} / {exhibits.length} œuvres sourcées
            </span>
          </div>
          <div className="world-reticle" aria-hidden="true">
            +
          </div>
          <div className="world-actions viewer-chrome">
            <IconButton
              icon="reset"
              label="Retour à la halle"
              onClick={() => renderer.current?.goTo("hub")}
            />
            <IconButton
              icon="book"
              label="Ouvrir les extraits du manga"
              onClick={onRead}
            />
            <IconButton
              icon="film"
              label="Ouvrir les vidéos sourcées"
              onClick={onVideo}
            />
            <IconButton
              icon="info"
              label="Commandes de l’exploration"
              aria-expanded={help}
              onClick={() => setHelp(!help)}
            />
            {nearby && (
              <IconButton
                icon="image"
                label={`Examiner : ${nearby.title}`}
                onClick={() => onOpen(nearby)}
              />
            )}
          </div>
          <div className="world-scenes viewer-chrome">
            <IconButton
              icon="layers"
              label="Explorer les scènes multicouches"
              disabled={!scenesAvailable}
              onClick={onScenes}
            />
          </div>
          <div className="world-walk viewer-chrome" aria-label="Déplacement">
            {(
              [
                ["left", -1, 0, "Marcher à gauche"],
                ["up", 0, 1, "Avancer"],
                ["down", 0, -1, "Reculer"],
                ["right", 1, 0, "Marcher à droite"],
              ] as const
            ).map(([icon, x, z, label]) => (
              <IconButton
                key={icon}
                icon={icon}
                label={label}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  renderer.current?.setMovement(x, z);
                }}
                onPointerUp={() => renderer.current?.setMovement(0, 0)}
                onPointerCancel={() => renderer.current?.setMovement(0, 0)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    renderer.current?.setMovement(x, z);
                  }
                }}
                onKeyUp={() => renderer.current?.setMovement(0, 0)}
                onBlur={() => renderer.current?.setMovement(0, 0)}
              />
            ))}
          </div>
          <p className="world-source">
            {nearby ? (
              <a href={nearby.sourceUrl} target="_blank" rel="noreferrer">
                {nearby.title} ↗
              </a>
            ) : (
              "Trois arches. Trois univers. Traversez-les."
            )}
          </p>
          <p
            id="world-help"
            className={help ? "world-help viewer-chrome" : "sr-only"}
          >
            Glissez pour regarder. Flèches ou WASD pour marcher après avoir
            sélectionné la scène. Cliquez sur une arche pour la traverser, sur
            une œuvre pour l’examiner. Entrée : œuvre proche. Échap : retour à
            la halle.
          </p>
        </>
      )}
      {status !== "ready" && (
        <div className="world-status viewer-chrome" role="status">
          {status === "initializing"
            ? "Ouverture de la guilde…"
            : `Exploration WebGPU indisponible : ${message}`}
          <p>
            La bibliothèque et les sources restent accessibles par les icônes.
          </p>
        </div>
      )}
    </div>
  );
}
