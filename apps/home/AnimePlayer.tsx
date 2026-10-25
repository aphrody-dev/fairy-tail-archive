import { useEffect, useRef, useState } from "react";
import { Icon, Modal } from "./dialogs.tsx";
import { json } from "./scene.ts";
type Stream = {
  id: string | number;
  provider: string;
  kind: "embed" | "hls" | "dash" | "mp4" | "watch" | "catalogue";
  title: string;
  url: string;
  sourceUrl: string;
  language: string;
  access: string;
  status: string;
  expired: boolean;
  expiresAt?: string | null;
  playbackVerified: false;
  evidence: Record<string, unknown>;
  cachedFileUrl?: string | null;
  indexedFrames?: number;
  scope?: "promotional-preview" | null;
};
type HlsInstance = {
  loadSource: (url: string) => void;
  attachMedia: (element: HTMLVideoElement) => void;
  destroy: () => void;
  recoverMediaError: () => void;
  on: (
    name: string,
    handler: (
      _event: unknown,
      data: { fatal?: boolean; type?: string; details?: string },
    ) => void,
  ) => void;
};
type HlsConstructor = {
  new (options: { enableWorker: boolean }): HlsInstance;
  isSupported: () => boolean;
  Events: { ERROR: string };
  ErrorTypes: { MEDIA_ERROR: string; NETWORK_ERROR: string };
};
const remoteExpired = (stream: Stream) =>
  stream.expired ||
  (!!stream.expiresAt && Date.parse(stream.expiresAt) <= Date.now());
const localFile = (stream: Stream) =>
  stream.kind === "mp4" && stream.cachedFileUrl === `/streams/${stream.id}/file`
    ? stream.cachedFileUrl
    : null;
const expired = (stream: Stream) => !localFile(stream) && remoteExpired(stream);
let hlsPromise: Promise<HlsConstructor> | null = null;
function hls(): Promise<HlsConstructor> {
  if (hlsPromise) return hlsPromise;
  hlsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/streams/player/hls.min.js";
    script.async = true;
    script.onload = () => {
      const constructor = (window as Window & { Hls?: HlsConstructor }).Hls;
      if (constructor) resolve(constructor);
      else reject(new Error("Le lecteur HLS local est indisponible."));
    };
    script.onerror = () =>
      reject(new Error("Le lecteur HLS local n’a pas pu être chargé."));
    document.head.append(script);
  });
  return hlsPromise;
}
function Video({ stream }: { stream: Stream }) {
  const ref = useRef<HTMLVideoElement>(null),
    [error, setError] = useState(""),
    [useRemote, setUseRemote] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let destroyed = false,
      instance: HlsInstance | undefined;
    setError("");
    (async () => {
      if (useRemote ? remoteExpired(stream) : expired(stream))
        throw new Error(
          "Ce flux a expiré. Ouvrez sa page source pour les options de diffusion actuelles.",
        );
      if (
        stream.kind === "hls" &&
        !video.canPlayType("application/vnd.apple.mpegurl")
      ) {
        const Hls = await hls();
        if (destroyed) return;
        if (!Hls.isSupported())
          throw new Error("Ce navigateur ne peut pas lire ce flux HLS.");
        instance = new Hls({ enableWorker: false });
        let mediaRecoveries = 0,
          lastMediaRecovery = 0;
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || destroyed) return;
          if (
            data.type === Hls.ErrorTypes.MEDIA_ERROR &&
            video.error &&
            mediaRecoveries === 0 &&
            Date.now() - lastMediaRecovery >= 5000
          ) {
            mediaRecoveries++;
            lastMediaRecovery = Date.now();
            instance?.recoverMediaError();
            return;
          }
          setError(
            `Flux HLS interrompu : ${data.details ?? data.type ?? "erreur de lecture"}. La source reste accessible.`,
          );
          instance?.destroy();
          instance = undefined;
        });
        instance.loadSource(stream.url);
        instance.attachMedia(video);
      } else if (
        stream.kind === "dash" &&
        !video.canPlayType("application/dash+xml")
      )
        throw new Error(
          "La lecture DASH n’est pas disponible dans ce navigateur ; la source reste accessible.",
        );
      else video.src = (!useRemote && localFile(stream)) || stream.url;
    })().catch((error) => {
      if (!destroyed)
        setError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      destroyed = true;
      video.pause();
      instance?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [stream, useRemote]);
  return (
    <>
      <video
        ref={ref}
        controls
        playsInline
        preload="metadata"
        aria-label={stream.title}
        onError={() => {
          const code = ref.current?.error?.code;
          const causes: Record<number, string> = {
            1: "Lecture interrompue",
            2: "Erreur réseau",
            3: "Décodage vidéo impossible",
            4: "Format ou source non pris en charge",
          };
          setError(
            `${!useRemote && localFile(stream) ? "Le fichier local n’a pas pu être lu. " : ""}${causes[code ?? 0] ?? "Lecture vidéo impossible"}${code ? ` (code ${code})` : ""}. Vous pouvez ouvrir la source.`,
          );
        }}
      />
      {error ? (
        <p role="status" className="reader-note">
          {error}
        </p>
      ) : null}
      {error && localFile(stream) && !useRemote && !remoteExpired(stream) ? (
        <button
          type="button"
          className="source-link"
          onClick={() => setUseRemote(true)}
        >
          Essayer le lien vidéo distant
        </button>
      ) : null}
    </>
  );
}
export function AnimePlayer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Stream[]>([]),
    [selected, setSelected] = useState<string | number | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void json<{ items: Stream[] }>("/streams", controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setItems(result.items);
          const playable = result.items.filter(
            (item) =>
              !expired(item) &&
              ["embed", "mp4", "hls", "dash"].includes(item.kind),
          );
          setSelected(
            playable.find((item) => item.kind === "embed")?.id ??
              playable[0]?.id ??
              null,
          );
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open]);
  const playable = items.filter(
      (item) =>
        !expired(item) && ["embed", "mp4", "hls", "dash"].includes(item.kind),
    ),
    current = playable.find((item) => item.id === selected),
    links = items.filter(
      (item) => item.kind === "watch" || item.kind === "catalogue",
    );
  const promotional =
    current?.scope === "promotional-preview" ||
    (typeof current?.evidence?.scope === "string" &&
      current.evidence.scope.startsWith("public-page-promotional-preview"));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="L’anime, en images et en vidéos"
      id="anime-player"
      className="anime-dialog"
    >
      <p className="reader-note">
        Vidéos et lecteurs publics observés dans les sources de la bibliothèque.
        Aucune lecture automatique.
      </p>
      {loading ? (
        <p role="status">Ouverture des vidéos disponibles…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          {open && current ? (
            <>
              <h3 className="video-title">{current.title}</h3>
              {promotional ? (
                <p className="reader-note">
                  Aperçu promotionnel public — ce fichier n’est pas un épisode
                  complet.
                </p>
              ) : null}
              {localFile(current) ? (
                <p className="reader-note">
                  Fichier local disponible · {current.indexedFrames ?? 0} images
                  indexées. La lecture dépend du navigateur.
                </p>
              ) : null}
              <div className="video-surface">
                {current.kind === "embed" ? (
                  <iframe
                    key={current.id}
                    title={current.title}
                    src={current.url}
                    allow="encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                ) : (
                  <Video key={current.id} stream={current} />
                )}
              </div>
              <a
                className="source-link"
                href={current.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir chez {current.provider}
                <Icon name="source" />
              </a>
            </>
          ) : (
            <p>
              Aucun lecteur vidéo n’est actuellement disponible dans le
              catalogue local.
            </p>
          )}
          <ul className="video-list">
            {playable.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={item.id === selected}
                  onClick={() => setSelected(item.id)}
                >
                  <span>{item.title}</span>
                  <small>
                    {item.provider} ·{" "}
                    {item.kind === "embed"
                      ? "lecteur public"
                      : item.kind.toUpperCase()}
                  </small>
                  <Icon name="arrow" />
                </button>
              </li>
            ))}
          </ul>
          {links.length ? (
            <div className="video-source-links">
              <h3>Pages de diffusion</h3>
              {links.slice(0, 5).map((item) => (
                <a
                  key={item.id}
                  className="source-link"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.title}
                  <Icon name="source" />
                </a>
              ))}
            </div>
          ) : null}
        </>
      )}
    </Modal>
  );
}
