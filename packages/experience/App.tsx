import { useEffect, useRef, useState } from "react";
import { Icon, IconButton } from "./icons";
import { LibraryPanel, type LibraryKind } from "./LibraryPanel";
import { WorldSurface } from "./WorldSurface";
import type { Destination } from "../gpu/WorldRenderer";
import type { WorldExhibit } from "../gpu/world-geometry";
import { GPUSurface } from "./GPUSurface";
import { SceneSurface } from "./SceneSurface";
import { AnimePlayer } from "../../apps/home/AnimePlayer";
import { SearchPanel } from "./SearchPanel";
import type { Scene } from "../../apps/home/scene";
import {
  Button,
  Dialog,
  Select,
  SourceThemeProvider,
  sourceCatalog,
  type OfficialSource,
  type SourceAsset,
} from "@fairy/ui";

type ViewerAsset = SourceAsset & {
  width?: number;
  height?: number;
  sha256?: string;
  ordinal?: number;
};
type PreviewVolume = {
  title: string;
  isbn13: string;
  previewSourceUrl: string | null;
  availability: { cachedPreviewPages: number };
};
type PreviewResponse = {
  volume: {
    title: string;
    isbn13: string;
    language: string;
    previewUrl: string;
    epubUrl: string;
    readingDirection: string;
  } | null;
  pages: {
    ordinal: number;
    assets: {
      localUrl: string;
      sourceUrl: string;
      width: number;
      height: number;
      sha256: string;
      cacheState: string;
    }[];
  }[];
};

const catalog = sourceCatalog;
const collected = catalog.sources.filter(
  (source) => source.status === "verified",
);
const languageNames = new Intl.DisplayNames(["fr"], { type: "language" });
const languages = [
  ...new Set(
    catalog.sources
      .map((source) => source.language)
      .filter((value): value is string => !!value),
  ),
].sort();
const classLabels = {
  official: "Officiel",
  wiki: "Wiki",
  streaming: "Streaming",
  scan: "Scan",
};
const statusLabels = {
  verified: "Collecté",
  unavailable: "Indisponible à la collecte",
  not_collected: "Non collecté",
};
function assetLabel(asset: SourceAsset) {
  return (
    asset.alt ||
    decodeURIComponent(
      new URL(asset.url, location.href).pathname.split("/").pop() || asset.url,
    )
  );
}
function artworks(source: OfficialSource | undefined): SourceAsset[] {
  const images = source?.images ?? [];
  const art = images.filter(
    (image) =>
      image.kind !== "logo" &&
      !/(?:\/|_)(?:icon|logo|text|txt|title|ttl|btn|onair|pic|bg)[_./-]/i.test(
        image.url,
      ),
  );
  return art.length ? art : images;
}
function initialAsset(source: OfficialSource | undefined) {
  if (!source) return 0;
  const images = artworks(source);
  const large = images.findIndex(
    (asset) =>
      /key.?visual|main_pc|main-visual|img_key|top_main/i.test(asset.url) &&
      asset.kind !== "logo",
  );
  return large >= 0
    ? large
    : Math.max(
        0,
        images.findIndex((asset) => asset.kind === "social"),
      );
}

export function Experience() {
  const [sourceId, setSourceId] = useState(
    collected.find(
      (source) =>
        source.sourceClass === "official" &&
        source.category === "anime" &&
        source.images.length,
    )?.id ??
      collected[0]?.id ??
      "",
  );
  const [language, setLanguage] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const [assetIndex, setAssetIndex] = useState(() =>
    initialAsset(catalog.sources.find((source) => source.id === sourceId)),
  );
  const [controls, setControls] = useState(true);
  const [browse, setBrowse] = useState(false);
  const [gallery, setGallery] = useState(true);
  const [library, setLibrary] = useState<LibraryKind | null>(null);
  const [worldRealm, setWorldRealm] = useState<Destination>("hub");
  const [worldMode, setWorldMode] = useState(true);
  const [journey, setJourney] = useState<{
    destination: Destination;
    serial: number;
  }>({ destination: "hub", serial: 0 });
  const [sceneMode, setSceneMode] = useState(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneError, setSceneError] = useState("");
  const [videoOpen, setVideoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [imageError, setImageError] = useState(false);
  const [mode, setMode] = useState<"sources" | "preview">("sources");
  const [volumes, setVolumes] = useState<PreviewVolume[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [apiStatus, setApiStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [apiError, setApiError] = useState("");
  const [fullscreenError, setFullscreenError] = useState("");
  const restoreRef = useRef<HTMLButtonElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const previousBrowse = useRef(false);
  const requestEpoch = useRef(0);
  const source =
    catalog.sources.find((entry) => entry.id === sourceId) ?? collected[0];
  const availableSources = catalog.sources.filter(
    (entry) =>
      (showAll || entry.status === "verified") &&
      (language === "all" || entry.language === language),
  );
  const previewAssets: ViewerAsset[] =
    preview?.pages.flatMap((page) =>
      page.assets
        .filter((asset) => asset.cacheState === "cached")
        .map((asset) => ({
          url: asset.localUrl,
          alt: `${preview.volume?.title ?? ""} — ${page.ordinal}`,
          kind: "image" as const,
          sourceUrl: asset.sourceUrl,
          selector: "publisher-preview-spine-order",
          width: asset.width,
          height: asset.height,
          sha256: asset.sha256,
          ordinal: page.ordinal,
        })),
    ) ?? [];
  const assets: ViewerAsset[] = sceneMode
    ? scenes.map((scene) => ({
        url: scene.assets.preview.url,
        alt: scene.title,
        kind: "image",
        sourceUrl: scene.source.url,
        selector: `scene:${scene.id}`,
        width: scene.width,
        height: scene.height,
        sha256: scene.source.sha256,
      }))
    : mode === "preview"
      ? previewAssets
      : artworks(source);
  const activeScene = sceneMode ? scenes[assetIndex] : undefined;
  const asset = assets[assetIndex];
  const originalAssetIndex =
    source?.images.findIndex((image) => image.url === asset?.url) ?? -1;
  const gpuUrl =
    mode === "preview"
      ? asset?.url
      : originalAssetIndex >= 0
        ? `/references/${encodeURIComponent(source!.id)}/${originalAssetIndex}`
        : null;
  const title = sceneMode
    ? activeScene?.title
    : mode === "preview"
      ? preview?.volume?.title
      : source?.title;
  const contentLanguage = sceneMode
    ? undefined
    : mode === "preview"
      ? preview?.volume?.language
      : source?.language;
  const logo =
    catalog.sources
      .find((entry) => entry.id === "W03")
      ?.images.find(
        (image) =>
          image.kind === "logo" && /\/logo\.png(?:$|\?)/.test(image.url),
      ) ?? source?.images.find((image) => image.kind === "logo");

  function travel(destination: Destination) {
    requestEpoch.current++;
    setApiStatus("idle");
    setBrowse(false);
    setLibrary(null);
    setWorldMode(true);
    setJourney((j) => ({ destination, serial: j.serial + 1 }));
  }
  function openExhibit(item: WorldExhibit) {
    if (!item.sourceId) return;
    chooseSource(item.sourceId);
    const next = catalog.sources.find((s) => s.id === item.sourceId);
    setAssetIndex(
      Math.max(
        0,
        artworks(next).findIndex((a) => a.url === item.originalUrl),
      ),
    );
  }
  function chooseSource(id: string) {
    const next = catalog.sources.find((entry) => entry.id === id);
    if (!next) return;
    requestEpoch.current += 1;
    setApiStatus("idle");
    setApiError("");
    setWorldMode(false);
    setSourceId(id);
    setBrowse(false);
    setLibrary(null);
    setAssetIndex(initialAsset(next));
    setMode("sources");
    setSceneMode(false);
    setActualSize(false);
  }
  function changeAsset(index: number) {
    setAssetIndex(index);
    setActualSize(false);
  }
  useEffect(() => {
    if (!worldMode)
      document.getElementById("visual")?.focus({ preventScroll: true });
  }, [worldMode]);
  useEffect(() => {
    setImageError(false);
    setNaturalSize(null);
  }, [asset?.url]);
  useEffect(() => {
    if (!controls) restoreRef.current?.focus();
  }, [controls]);
  useEffect(() => {
    if (previousBrowse.current && !browse) browseRef.current?.focus();
    previousBrowse.current = browse;
  }, [browse]);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/scenes", { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Scènes HTTP ${response.status}`);
        const data: Scene[] = await response.json();
        if (!Array.isArray(data))
          throw new Error("Catalogue des scènes invalide");
        if (!abort.signal.aborted) setScenes(data);
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setSceneError(String(reason));
      });
    return () => abort.abort();
  }, []);

  async function loadPreview(isbn: string, epoch = ++requestEpoch.current) {
    if (epoch !== requestEpoch.current) return;
    setApiStatus("loading");
    setApiError("");
    try {
      const response = await fetch(
        `/manga/volumes/${encodeURIComponent(isbn)}/pages?limit=100`,
      );
      if (!response.ok) throw new Error(`API HTTP ${response.status}`);
      const data: PreviewResponse = await response.json();
      if (epoch !== requestEpoch.current) return;
      if (!data.volume || !data.pages.length)
        throw new Error("Aucune page d’extrait disponible.");
      setWorldMode(false);
      setPreview(data);
      setAssetIndex(0);
      setMode("preview");
      setSceneMode(false);
      setApiStatus("ready");
    } catch (error) {
      if (epoch !== requestEpoch.current) return;
      setApiError(error instanceof Error ? error.message : String(error));
      setApiStatus("error");
    }
  }
  async function openPreviews() {
    const epoch = ++requestEpoch.current;
    setApiStatus("loading");
    setApiError("");
    try {
      const firstResponse = await fetch("/manga/volumes?limit=100");
      if (!firstResponse.ok)
        throw new Error(`API HTTP ${firstResponse.status}`);
      const first: { items: PreviewVolume[]; total: number } =
        await firstResponse.json();
      if (epoch !== requestEpoch.current) return;
      const remaining = await Promise.all(
        Array.from(
          { length: Math.min(9, Math.ceil(first.total / 100) - 1) },
          (_, index) =>
            fetch(`/manga/volumes?limit=100&offset=${(index + 1) * 100}`).then(
              async (response) => {
                if (!response.ok)
                  throw new Error(`API HTTP ${response.status}`);
                return response.json() as Promise<{ items: PreviewVolume[] }>;
              },
            ),
        ),
      );
      const ready = [
        ...first.items,
        ...remaining.flatMap((page) => page.items),
      ].filter((volume) => volume.availability.cachedPreviewPages > 0);
      if (epoch !== requestEpoch.current) return;
      setVolumes(ready);
      if (!ready[0])
        throw new Error(
          "Aucun extrait éditeur mis en cache dans l’API locale.",
        );
      await loadPreview(ready[0].isbn13, epoch);
    } catch (error) {
      if (epoch !== requestEpoch.current) return;
      setApiError(error instanceof Error ? error.message : String(error));
      setApiStatus("error");
    }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError("");
    } catch {
      setFullscreenError(
        "Le navigateur n’autorise pas le plein écran dans ce contexte.",
      );
    }
  }
  if (!source) return <p>Aucune source générée disponible.</p>;

  return (
    <SourceThemeProvider
      sourceId={source.id}
      className={`viewer-app ${worldMode ? "viewer-world" : ""} ${controls ? "" : "viewer-hidden"}`}
    >
      <a className="viewer-skip" href="#visual">
        Aller au visuel
      </a>
      {!controls ? (
        <Button
          className="viewer-restore viewer-chrome"
          ref={restoreRef}
          onClick={() => setControls(true)}
        >
          <Icon name="eye" />
          <span className="sr-only">Afficher les contrôles</span>
        </Button>
      ) : null}

      {!worldMode && asset && !imageError ? (
        <div className="viewer-ambient" aria-hidden="true">
          <img src={asset.url} alt="" />
        </div>
      ) : null}
      {!worldMode && <div className="viewer-vignette" aria-hidden="true" />}
      {controls ? (
        <>
          <header className="viewer-brand-mark">
            {logo ? <img src={logo.url} alt={logo.alt} /> : null}
          </header>
          <nav className="viewer-orbit" aria-label="Navigation de l’univers">
            <IconButton
              icon="image"
              label="Univers 3D"
              aria-pressed={worldMode}
              onClick={() => travel("hub")}
            />
            <IconButton
              icon="globe"
              ref={browseRef}
              label="Explorer les sources"
              aria-expanded={browse}
              aria-controls="source-browser"
              onClick={() => {
                setLibrary(null);
                setBrowse(!browse);
              }}
            />
            <IconButton
              icon="film"
              label="Traverser vers l’anime"
              aria-pressed={worldMode && worldRealm === "anime"}
              onClick={() => {
                setBrowse(false);
                setLibrary(null);
                travel("anime");
              }}
            />
            <IconButton
              icon="book"
              label="Traverser vers le manga"
              aria-pressed={
                (worldMode && worldRealm === "manga") ||
                (!worldMode && !sceneMode && mode === "preview")
              }
              loading={apiStatus === "loading"}
              onClick={() => travel("manga")}
            />
            <IconButton
              icon="compass"
              label="Jeux"
              aria-pressed={
                (worldMode && worldRealm === "games") ||
                (!worldMode &&
                  !sceneMode &&
                  mode === "sources" &&
                  /jeu/.test(source.category))
              }
              onClick={() => travel("games")}
            />
            <span className="orbit-divider" />
            <IconButton
              icon="library"
              label="Bibliothèque complète"
              aria-expanded={library === "manga"}
              onClick={() => {
                setBrowse(false);
                setLibrary(library ? null : "manga");
              }}
            />
            <IconButton
              icon="users"
              label="Wikis et communauté"
              aria-expanded={library === "wiki"}
              onClick={() => {
                setBrowse(false);
                setLibrary(library ? null : "wiki");
              }}
            />
            <IconButton
              icon="grid"
              label="Galerie"
              aria-pressed={!worldMode && gallery}
              onClick={() => {
                setWorldMode(false);
                setGallery(!gallery);
              }}
            />
          </nav>
          <div className="viewer-corner-tools">
            <IconButton
              icon="search"
              label="Rechercher dans tous les contenus"
              aria-haspopup="dialog"
              onClick={() => setSearchOpen(true)}
            />
            <IconButton
              icon="expand"
              label="Plein écran"
              onClick={fullscreen}
            />
            <IconButton
              icon="eye"
              label="Masquer les contrôles"
              onClick={() => {
                setBrowse(false);
                setLibrary(null);
                setControls(false);
              }}
            />
          </div>
          {browse ? (
            <aside
              id="source-browser"
              className="source-browser viewer-chrome"
              aria-label="Explorer les sources"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setBrowse(false);
                  event.stopPropagation();
                }
              }}
            >
              <div className="browser-top">
                <Icon name="globe" />
                <h2>Explorer</h2>
                <IconButton
                  icon="close"
                  label="Fermer l’explorateur"
                  onClick={() => setBrowse(false)}
                />
              </div>
              <div className="viewer-pickers">
                <Select
                  label="Langue de la source"
                  value={language}
                  options={[
                    { value: "all", label: "Toutes les langues" },
                    ...languages
                      .filter(
                        (value) =>
                          showAll ||
                          collected.some((entry) => entry.language === value),
                      )
                      .map((value) => ({
                        value,
                        label: languageNames.of(value) ?? value,
                      })),
                  ]}
                  onValueChange={(value) => {
                    const next = value ?? "all";
                    setLanguage(next);
                    const first = catalog.sources.find(
                      (entry) =>
                        (showAll || entry.status === "verified") &&
                        (next === "all" || entry.language === next),
                    );
                    if (first) chooseSource(first.id);
                  }}
                />
                <Select
                  label="Source"
                  value={source.id}
                  options={availableSources.map((entry) => ({
                    value: entry.id,
                    label: entry.title ?? entry.url,
                  }))}
                  onValueChange={(value) => {
                    if (value) chooseSource(value);
                  }}
                />
              </div>

              <div className="source-mosaic">
                {availableSources
                  .filter((entry) => entry.images.length)
                  .map((entry) => {
                    const picture = artworks(entry)[initialAsset(entry)];
                    return (
                      <button
                        key={entry.id}
                        className="source-tile"
                        onClick={() => chooseSource(entry.id)}
                        aria-pressed={entry.id === source.id}
                      >
                        <img src={picture?.url} alt="" loading="lazy" />
                        <span lang={entry.language ?? undefined}>
                          {entry.title}
                        </span>
                        <small>
                          {entry.language?.toUpperCase()} ·{" "}
                          {classLabels[entry.sourceClass]}
                        </small>
                      </button>
                    );
                  })}
              </div>
            </aside>
          ) : null}
        </>
      ) : null}
      <AnimePlayer open={videoOpen} onClose={() => setVideoOpen(false)} />
      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} />
      {controls && library ? (
        <LibraryPanel
          initialKind={library}
          onClose={() => {
            setLibrary(null);
            browseRef.current?.focus();
          }}
          onPreview={(isbn) => {
            setLibrary(null);
            void loadPreview(isbn);
          }}
        />
      ) : null}
      <main className="viewer-main">
        {controls ? (
          <section className="viewer-heading viewer-chrome" hidden={worldMode}>
            <div>
              <p className="viewer-eyebrow">
                {activeScene
                  ? `${activeScene.source.kind} · ${activeScene.source.scope}`
                  : mode === "preview"
                    ? `Extrait public · ${preview?.volume?.readingDirection ?? ""}`
                    : `${source.id} · ${source.operator} · ${statusLabels[source.status]}`}
              </p>
              <h1 lang={contentLanguage ?? undefined}>{title ?? source.url}</h1>
            </div>
            <Dialog
              trigger={
                <>
                  <Icon name="info" />
                  <span className="sr-only">Provenance</span>
                </>
              }
              title="Provenance du contenu"
              description="Métadonnées observées et URL de la source sélectionnée."
            >
              {activeScene ? (
                <div className="viewer-evidence">
                  <dl>
                    <dt>Contenu</dt>
                    <dd>{activeScene.title}</dd>
                    <dt>Source originale</dt>
                    <dd>
                      <a href={activeScene.source.url}>
                        {activeScene.source.url}
                      </a>
                    </dd>
                    <dt>Portée</dt>
                    <dd>{activeScene.source.scope}</dd>
                    <dt>Dimensions</dt>
                    <dd>
                      {activeScene.width} × {activeScene.height}
                    </dd>
                    <dt>SHA-256 source</dt>
                    <dd>
                      <code>{activeScene.source.sha256}</code>
                    </dd>
                    <dt>Composition</dt>
                    <dd>
                      Plans sourcés, masques alpha et perspective WebGPU.{" "}
                      {activeScene.layers.length} couches.
                    </dd>
                  </dl>
                </div>
              ) : (
                <div className="viewer-evidence">
                  <dl>
                    <dt>Classe</dt>
                    <dd>
                      {mode === "preview"
                        ? "Extrait éditeur public"
                        : classLabels[source.sourceClass]}
                    </dd>
                    <dt>Page source</dt>
                    <dd>
                      <a
                        href={
                          mode === "preview"
                            ? preview?.volume?.previewUrl
                            : (source.finalUrl ?? source.url)
                        }
                      >
                        {mode === "preview"
                          ? preview?.volume?.previewUrl
                          : (source.finalUrl ?? source.url)}
                      </a>
                    </dd>
                    <dt>Titre natif</dt>
                    <dd lang={contentLanguage ?? undefined}>
                      {title ?? "Absent de la collecte"}
                    </dd>
                    <dt>Description native</dt>
                    <dd lang={source.language ?? undefined}>
                      {mode === "sources"
                        ? (source.description ?? "Absente de la collecte")
                        : "Extrait public ; volume complet non disponible."}
                    </dd>
                    <dt>Fichier affiché</dt>
                    <dd>
                      {asset ? <a href={asset.url}>{asset.url}</a> : "Aucun"}
                    </dd>
                    <dt>Provenance du fichier</dt>
                    <dd>
                      {asset ? (
                        <a href={asset.sourceUrl}>{asset.sourceUrl}</a>
                      ) : (
                        "Absente"
                      )}
                    </dd>
                    <dt>Sélecteur / ordre</dt>
                    <dd>{asset?.selector ?? "Absent"}</dd>
                    <dt>Dimensions chargées</dt>
                    <dd>
                      {naturalSize
                        ? `${naturalSize.width} × ${naturalSize.height}`
                        : "Non chargées"}
                    </dd>
                    {mode === "sources" ? (
                      <>
                        <dt>Collecte HTML</dt>
                        <dd>{source.observedAt ?? "Non collectée"}</dd>
                        <dt>Empreinte HTML</dt>
                        <dd>
                          <code>{source.contentHash ?? "Absente"}</code>
                        </dd>
                      </>
                    ) : (
                      <>
                        <dt>Empreinte du fichier de l’extrait</dt>
                        <dd>
                          <code>{asset?.sha256 ?? "Absente"}</code>
                        </dd>
                      </>
                    )}
                  </dl>
                  {mode === "sources" ? (
                    <>
                      <h2>Observations CSS</h2>
                      <p>
                        Déclarations observées, sans calcul complet de la
                        cascade. Propriété manquante : valeur neutre du
                        navigateur.
                      </p>
                      {Object.entries(source.theme).length ? (
                        <dl>
                          {Object.entries(source.theme).map(
                            ([key, observation]) => (
                              <div key={key}>
                                <dt>{key}</dt>
                                <dd>
                                  <code>{observation.value}</code>
                                  <p>{observation.selector}</p>
                                  <a href={observation.stylesheetUrl}>
                                    {observation.stylesheetUrl}
                                  </a>
                                </dd>
                              </div>
                            ),
                          )}
                        </dl>
                      ) : (
                        <p>Aucune observation de thème applicable.</p>
                      )}
                      <label className="viewer-all">
                        <input
                          type="checkbox"
                          checked={showAll}
                          onChange={(event) => setShowAll(event.target.checked)}
                        />{" "}
                        Inclure les sources non collectées et indisponibles
                      </label>
                    </>
                  ) : (
                    <p>
                      <a href={preview?.volume?.epubUrl}>
                        Source EPUB de l’extrait
                      </a>
                    </p>
                  )}
                  <p>
                    Catalogue généré le{" "}
                    {new Date(catalog.generatedAt).toLocaleString("fr-FR")}. Une
                    image découverte dans l’HTML n’est pas automatiquement
                    vérifiée ni autorisée à la redistribution.
                  </p>
                </div>
              )}
            </Dialog>
          </section>
        ) : null}

        <section
          id="visual"
          tabIndex={0}
          aria-label={
            worldMode
              ? "Exploration de l’univers"
              : "Visionneuse du fichier source"
          }
          className={`viewer-stage ${actualSize ? "viewer-actual" : ""}`}
          onKeyDown={(event) => {
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.defaultPrevented
            )
              return;
            if (worldMode || event.target !== event.currentTarget) return;
            if (event.key === "ArrowRight" && assetIndex < assets.length - 1) {
              changeAsset(assetIndex + 1);
              event.preventDefault();
            }
            if (event.key === "ArrowLeft" && assetIndex > 0) {
              changeAsset(assetIndex - 1);
              event.preventDefault();
            }
          }}
        >
          {worldMode ? (
            <WorldSurface
              journey={journey}
              paused={videoOpen || searchOpen || !!library || browse}
              controls={controls}
              onScenes={() => {
                requestEpoch.current++;
                setWorldMode(false);
                setSceneMode(true);
                setMode("sources");
                setAssetIndex(0);
                setActualSize(false);
              }}
              scenesAvailable={scenes.length > 0}
              onRealm={setWorldRealm}
              onOpen={openExhibit}
              onRead={openPreviews}
              onVideo={() => setVideoOpen(true)}
            />
          ) : activeScene ? (
            <SceneSurface scene={activeScene} />
          ) : asset && gpuUrl && !actualSize ? (
            <GPUSurface
              url={gpuUrl}
              label={asset.alt || title || "Visuel source"}
              manga={mode === "preview"}
              immersive={!controls}
              paused={videoOpen || searchOpen || !!library || browse}
            />
          ) : null}
          {worldMode || activeScene ? null : asset && !imageError ? (
            <img
              key={asset.url}
              src={asset.url}
              alt={asset.alt}
              width={actualSize ? naturalSize?.width : asset.width}
              height={actualSize ? naturalSize?.height : asset.height}
              className="viewer-image"
              fetchPriority="high"
              onLoad={(event) =>
                setNaturalSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="viewer-empty viewer-chrome">
              <p>
                {imageError
                  ? "Ce fichier distant n’a pas pu être chargé."
                  : "Aucun visuel collecté pour cette source."}
              </p>
              {asset ? (
                <a href={asset.url}>Ouvrir l’URL du fichier</a>
              ) : (
                <a href={source.url}>Ouvrir la source</a>
              )}
            </div>
          )}
        </section>
        {controls ? (
          <footer className="viewer-bottom viewer-chrome" hidden={worldMode}>
            <div className="viewer-pagination">
              <IconButton
                icon="left"
                label="Précédent"
                disabled={assetIndex <= 0}
                onClick={() => changeAsset(assetIndex - 1)}
              />
              <span role="status">
                {assets.length ? assetIndex + 1 : 0} / {assets.length}
              </span>
              <IconButton
                icon="right"
                label="Suivant"
                disabled={assetIndex >= assets.length - 1}
                onClick={() => changeAsset(assetIndex + 1)}
              />
              {!sceneMode ? (
                <IconButton
                  icon={actualSize ? "fit" : "zoom"}
                  label={actualSize ? "Ajuster" : "Taille d’origine"}
                  disabled={!asset || imageError}
                  aria-pressed={actualSize}
                  onClick={() => setActualSize(!actualSize)}
                />
              ) : null}
              <span className="viewer-dimensions">
                {naturalSize
                  ? `${naturalSize.width} × ${naturalSize.height}`
                  : ""}
              </span>
            </div>
            {!sceneMode && mode === "preview" && volumes.length > 1 ? (
              <Select
                label="Extrait disponible"
                value={preview?.volume?.isbn13}
                options={volumes.map((volume) => ({
                  value: volume.isbn13,
                  label: volume.title,
                }))}
                onValueChange={(value) => {
                  if (value) loadPreview(value);
                }}
              />
            ) : null}
            <div
              hidden={!gallery}
              className="viewer-thumbnails"
              aria-label="Fichiers de la source"
            >
              {assets.map((item, index) => (
                <button
                  type="button"
                  key={`${item.url}-${index}`}
                  className="viewer-thumbnail"
                  aria-label={assetLabel(item)}
                  aria-pressed={index === assetIndex}
                  onClick={() => changeAsset(index)}
                >
                  <img src={item.url} alt="" loading="lazy" />
                  <span>{item.ordinal ?? index + 1}</span>
                </button>
              ))}
            </div>
            <p className="viewer-source-line">
              {asset ? (
                <a href={asset.sourceUrl}>{assetLabel(asset)}</a>
              ) : (
                source.url
              )}
              {activeScene
                ? ` · ${activeScene.source.kind} · ${activeScene.source.scope}`
                : mode === "preview"
                  ? " · Extrait public, pas le volume complet"
                  : ` · ${classLabels[source.sourceClass]} · ${source.language ?? "langue non déclarée"}`}
            </p>
          </footer>
        ) : null}
        {apiStatus === "error" || fullscreenError || sceneError ? (
          <p className="viewer-message viewer-chrome" role="status">
            {apiError || fullscreenError || sceneError}
          </p>
        ) : null}
      </main>
    </SourceThemeProvider>
  );
}
