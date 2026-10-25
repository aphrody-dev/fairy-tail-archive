import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Scene } from "./scene.ts";
import { json } from "./scene.ts";

export function Icon({
  name,
  className = "",
}: {
  name:
    | "arrow"
    | "search"
    | "close"
    | "pause"
    | "play"
    | "reset"
    | "expand"
    | "chevron"
    | "source";
  className?: string;
}) {
  const paths = {
    arrow: (
      <>
        <path d="M4 12h15M13 5l7 7-7 7" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7z" />,
    reset: (
      <>
        <path d="M20 10a8 8 0 1 1-3-5M17 1v5h5" />
      </>
    ),
    expand: (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
      </>
    ),
    chevron: <path d="m6 9 6 6 6-6" />,
    source: (
      <>
        <path d="M10 6H5v14h14v-5M13 3h8v8M21 3l-11 11" />
      </>
    ),
  };
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function Modal({
  open,
  onClose,
  title,
  id,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && !ref.current?.open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      ref.current?.showModal();
    }
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`home-dialog ${className}`}
      aria-labelledby={`${id}-title`}
      onClose={() => {
        onClose();
        if (returnFocus.current?.isConnected)
          returnFocus.current.focus({ preventScroll: true });
      }}
    >
      <header className="dialog-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={() => ref.current?.close()}
          aria-label={`Fermer ${title}`}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

type ReaderAsset = {
  id: number;
  localUrl: string | null;
  sourceUrl: string;
  width: number | null;
  height: number | null;
};
type ReaderPage = {
  id: number;
  ordinal: number;
  text: string;
  assets: ReaderAsset[];
};
type Preview = {
  volume: {
    title: string;
    isbn13: string;
    readingDirection: string;
    previewUrl: string | null;
  } | null;
  pages: ReaderPage[];
  total: number;
  scope: string;
};
type VolumePage = {
  total: number;
  items: {
    title: string;
    isbn13: string | null;
    availability: { previewPages: number };
  }[];
};
export function MangaReader({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [page, setPage] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    (async () => {
      let isbn: string | null = null;
      for (let offset = 0; offset < 1000; offset += 100) {
        const books = await json<VolumePage>(
          `/manga/volumes?limit=100&offset=${offset}`,
          controller.signal,
        );
        isbn =
          books.items.find(
            (book) => book.availability.previewPages > 0 && book.isbn13,
          )?.isbn13 ?? null;
        if (isbn || offset + 100 >= books.total) break;
      }
      if (!isbn)
        throw new Error(
          "Aucun extrait de manga n’est encore disponible dans la bibliothèque locale.",
        );
      const result = await json<Preview>(
        `/manga/volumes/${isbn}/pages?limit=100`,
        controller.signal,
      );
      if (!result.volume || !result.pages.length)
        throw new Error("Cet extrait ne contient pas encore de page lisible.");
      setPreview(result);
      setPage(0);
    })()
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open]);
  const current = preview?.pages[page],
    rtl = preview?.volume?.readingDirection === "rtl";
  const step = (direction: number) =>
    setPage((value) =>
      Math.max(
        0,
        Math.min((preview?.pages.length ?? 1) - 1, value + direction),
      ),
    );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={preview?.volume?.title ?? "Lire le manga"}
      id="manga-reader"
      className="reader-dialog"
    >
      <div
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            step(rtl ? 1 : -1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            step(rtl ? -1 : 1);
          }
        }}
      >
        <p className="reader-note">
          Extrait public de l’éditeur. L’ordre suit les pages de cet extrait.
        </p>
        {loading ? (
          <p role="status">Ouverture de l’extrait…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : current ? (
          <>
            <div className="reader-page">
              {current.assets
                .filter((asset) => asset.localUrl)
                .map((asset) => (
                  <img
                    key={asset.id}
                    src={asset.localUrl!}
                    alt={`Vue ${current.ordinal} de l’extrait ${preview?.volume?.title}`}
                    width={asset.width ?? undefined}
                    height={asset.height ?? undefined}
                  />
                ))}
              {!current.assets.some((asset) => asset.localUrl) ? (
                <p>
                  {current.text ||
                    "Cette page n’est pas encore présente dans le cache local."}
                </p>
              ) : null}
            </div>
            <div className="reader-controls">
              <button
                type="button"
                className="text-button"
                disabled={page === 0}
                onClick={() => step(-1)}
              >
                <Icon name="arrow" className="back-arrow" />
                Précédente
              </button>
              <span aria-live="polite">
                Vue {current.ordinal} / {preview?.total}
              </span>
              <button
                type="button"
                className="text-button"
                disabled={page === (preview?.pages.length ?? 1) - 1}
                onClick={() => step(1)}
              >
                Suivante
                <Icon name="arrow" />
              </button>
            </div>
            <div className="page-strip" aria-label="Pages de l’extrait">
              {preview?.pages.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={index === page}
                  aria-label={`Ouvrir la vue ${entry.ordinal}`}
                  onClick={() => setPage(index)}
                >
                  {entry.ordinal}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {preview?.volume?.previewUrl ? (
          <a
            className="source-link"
            href={preview.volume.previewUrl}
            target="_blank"
            rel="noreferrer"
          >
            Extrait chez l’éditeur
            <Icon name="source" />
          </a>
        ) : null}
      </div>
    </Modal>
  );
}

type WikiRow = { id: number; title: string; url: string; language: string };
type WikiDocument = WikiRow & {
  text: string;
  truncated: boolean;
  revision: number | null;
};
export function WikiExplorer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("Natsu"),
    [language, setLanguage] = useState("fr"),
    [rows, setRows] = useState<WikiRow[]>([]),
    [document, setDocument] = useState<WikiDocument | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const search = useCallback(
    async (signal?: AbortSignal) => {
      setError("");
      setLoading(true);
      try {
        const result = await json<{ items: WikiRow[] }>(
          `/wiki?q=${encodeURIComponent(query)}&lang=${language}&limit=8`,
          signal,
        );
        setRows(result.items);
        setDocument(null);
      } catch (error) {
        if (!signal?.aborted) setError(String(error));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [query, language],
  );
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void search(controller.signal), 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Explorer le wiki"
      id="wiki-explorer"
    >
      <form
        className="wiki-search"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <div>
          <label htmlFor="wiki-query">Personnage, lieu ou guilde</label>
          <input
            id="wiki-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={256}
            required
          />
        </div>
        <div>
          <label htmlFor="wiki-language">Langue</label>
          <select
            id="wiki-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </div>
        <button type="submit" className="primary-action">
          Rechercher
          <Icon name="search" />
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {loading ? (
        <p role="status">Recherche dans les documents locaux…</p>
      ) : !rows.length ? (
        <p>Aucun document correspondant dans cette langue.</p>
      ) : (
        <ul className="wiki-results">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => {
                  setError("");
                  void json<WikiDocument>(`/wiki/${row.id}`)
                    .then(setDocument)
                    .catch((error) => setError(String(error)));
                }}
              >
                {row.title}
                <Icon name="arrow" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {document ? (
        <article className="wiki-document">
          <h3>{document.title}</h3>
          <p lang={document.language} className="wiki-prose">
            {document.text
              .replace(/\[([^\]]+)\]\([^\s)]+\)/g, "$1")
              .replace(/[*#_]/g, "")}
          </p>
          {document.truncated ? (
            <p className="reader-note">
              Le document se poursuit sur sa page source.
            </p>
          ) : null}
          <a
            className="source-link"
            href={document.url}
            target="_blank"
            rel="noreferrer"
          >
            Lire la source
            {document.revision ? ` · révision ${document.revision}` : ""}
            <Icon name="source" />
          </a>
        </article>
      ) : null}
    </Modal>
  );
}

export function SourceDialog({
  open,
  onClose,
  scene,
  counts,
}: {
  open: boolean;
  onClose: () => void;
  scene: Scene | null;
  counts: Record<string, number> | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="La guilde, côté sources"
      id="scene-sources"
    >
      <p>
        Une bibliothèque locale de pages, d’images et de documents sourcés. La
        collecte reste partielle.
      </p>
      {counts ? (
        <dl className="coverage-list">
          <div>
            <dt>Documents indexés</dt>
            <dd>{counts.documents?.toLocaleString("fr-FR") ?? 0}</dd>
          </div>
          <div>
            <dt>Pages d’extraits</dt>
            <dd>{counts.mangaPreviewPages?.toLocaleString("fr-FR") ?? 0}</dd>
          </div>
          <div>
            <dt>Miniatures d’anime en cache</dt>
            <dd>
              {counts.cachedFancapsThumbnails?.toLocaleString("fr-FR") ?? 0}
            </dd>
          </div>
        </dl>
      ) : null}
      {scene ? (
        <>
          <h3>{scene.title}</h3>
          <dl className="source-details">
            <div>
              <dt>Source</dt>
              <dd>
                {scene.source.scope === "preview"
                  ? "Extrait public de manga"
                  : scene.source.scope === "thumbnail"
                    ? "Miniature d’un épisode"
                    : "Image issue d’une vidéo locale"}
              </dd>
            </div>
            <div>
              <dt>Relief</dt>
              <dd>
                Plans texturés en 2,5D. La caméra est en 3D ; aucun modèle de
                profondeur n’est utilisé.
              </dd>
            </div>
            <div>
              <dt>Traitement</dt>
              <dd>{scene.analysis.engine}</dd>
            </div>
          </dl>
          <div className="source-actions">
            <a
              className="source-link"
              href={scene.source.originalUrl ?? scene.assets.texture.url}
              target="_blank"
              rel="noreferrer"
            >
              Ouvrir l’image source
              <Icon name="source" />
            </a>
            <a
              className="source-link"
              href={scene.source.url}
              target="_blank"
              rel="noreferrer"
            >
              Provenance
              <Icon name="source" />
            </a>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
