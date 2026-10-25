import { useEffect, useRef, useState } from "react";
import { Icon, IconButton } from "./icons";
import { AnimeWork } from "./AnimeWork";

export type LibraryKind = "manga" | "anime" | "wiki";
type Entry = {
  id?: number | string;
  workId?: string;
  episodeCount?: number;
  title: string;
  url: string;
  language?: string;
  isbn13?: string;
  summary?: string;
  episode?: number;
  provider?: string;
  availability?: { cachedPreviewPages?: number } | string;
  characters?: number;
  kind: LibraryKind;
};
type Page = { items: Entry[]; total: number; limit: number; offset: number };
const entryKey = (entry: Entry) =>
  `${entry.kind}:${entry.url}:${entry.id ?? entry.isbn13 ?? entry.episode ?? ""}`;
type Article = {
  id: number;
  title: string;
  url: string;
  text: string;
  characters: number;
  textOffset: number;
  language: string;
  revision: number | null;
};
function storedFavorites(): Entry[] {
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem("fairy.library.favorites") ?? "[]",
    );
    return Array.isArray(data)
      ? data.filter(
          (item): item is Entry =>
            !!item &&
            typeof item === "object" &&
            typeof item.title === "string" &&
            typeof item.url === "string" &&
            /^(manga|anime|wiki)$/.test(item.kind),
        )
      : [];
  } catch {
    return [];
  }
}
const routes = { manga: "manga/volumes", anime: "anime", wiki: "wiki" };
const labels = {
  manga: "Publications",
  anime: "Anime",
  wiki: "Communauté & wikis",
};
const glyphs = { manga: "book", anime: "film", wiki: "users" } as const;
function inlineMarkdown(text: string) {
  return text
    .split(/(!?\[[^\]]*\]\(https:\/\/[^)\s]+\)|\*\*[^*]+\*\*)/g)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      const link = /^(!?)\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/.exec(part);
      if (link)
        return link[1] ? (
          <img
            key={index}
            src={link[3]}
            alt={link[2]}
            loading="lazy"
            className="wiki-source-image"
          />
        ) : (
          <a key={index} href={link[3]} target="_blank" rel="noreferrer">
            {link[2]}
          </a>
        );
      return part;
    });
}
function WikiText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\s*\n/).map((block, index) => {
        const heading = /^#{1,6}\s+([^\n]+)(?:\n([\s\S]*))?$/.exec(block);
        if (heading)
          return (
            <section key={index}>
              <h4>{inlineMarkdown(heading[1]!)}</h4>
              {heading[2] ? <p>{inlineMarkdown(heading[2])}</p> : null}
            </section>
          );
        if (/^[-*_]{3,}$/.test(block.trim())) return <hr key={index} />;
        return <p key={index}>{inlineMarkdown(block)}</p>;
      })}
    </>
  );
}
export function LibraryPanel({
  initialKind,
  onClose,
  onPreview,
}: {
  initialKind: LibraryKind;
  onClose: () => void;
  onPreview: (isbn: string) => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [favorites, setFavorites] = useState(storedFavorites);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);
  const [work, setWork] = useState<Entry | null>(null);
  const [animeView, setAnimeView] = useState<"episodes" | "works" | "arcs">(
    "episodes",
  );
  const [articleSize, setArticleSize] = useState(16);
  const [reading, setReading] = useState(false);
  const [storageError, setStorageError] = useState("");
  const articleEpoch = useRef(0);
  function leaveArticle() {
    articleEpoch.current++;
    setReading(false);
    setArticle(null);
    setWork(null);
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const abort = new AbortController();
    articleEpoch.current++;
    setReading(false);
    setBusy(true);
    setError("");
    setPage(null);
    setArticle(null);
    const params = new URLSearchParams({ limit: "40", offset: String(offset) });
    if (search) params.set("q", search);
    const extra = kind === "anime" && animeView !== "episodes";
    const path = extra
      ? `/anime/${animeView === "works" ? "works" : "arcs"}?limit=100`
      : `/${routes[kind]}?${params}`;
    void fetch(path, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`API HTTP ${response.status}`);
        let data: Page;
        if (extra) {
          const raw: {
            id: string;
            title: string;
            url?: string;
            language: string;
            listed_episodes?: number;
            arcUrl?: string;
            sourceUrl?: string;
            rawRange?: string;
          }[] = await response.json();
          const items: Entry[] = raw
            .map((item) => ({
              id: item.id,
              title: item.title,
              url: item.url ?? item.arcUrl ?? item.sourceUrl!,
              language: item.language,
              kind: "anime" as const,
              provider:
                animeView === "works"
                  ? "Catalogue communautaire"
                  : "Wiki · arc",
              workId: animeView === "works" ? item.id : undefined,
              episodeCount: item.listed_episodes,
              summary:
                animeView === "works"
                  ? `${item.listed_episodes ?? 0} entrées de catalogue.`
                  : item.rawRange?.slice(0, 500),
            }))
            .filter((item) =>
              item.title
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
            );
          data = {
            items: items.slice(offset, offset + 40),
            total: items.length,
            limit: 40,
            offset,
          };
        } else data = await response.json();
        if (!abort.signal.aborted)
          setPage({
            ...data,
            items: data.items.map((item) => ({ ...item, kind })),
          });
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(String(reason));
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => {
      abort.abort();
    };
  }, [kind, offset, search, animeView]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "fairy.library.favorites",
        JSON.stringify(favorites),
      );
      setStorageError("");
    } catch {
      setStorageError(
        "Les favoris ne peuvent pas être enregistrés sur cet appareil.",
      );
    }
  }, [favorites]);
  useEffect(() => {
    setKind(initialKind);
    setOffset(0);
  }, [initialKind]);
  async function readArticle(entry: Entry, nextOffset = 0) {
    if (typeof entry.id !== "number" || reading) return;
    const epoch = ++articleEpoch.current;
    setReading(true);
    setError("");
    try {
      const response = await fetch(
        `/wiki/${entry.id}?maxCharacters=16000&offset=${nextOffset}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: Article = await response.json();
      if (epoch !== articleEpoch.current) return;
      setArticle((previous) =>
        nextOffset && previous?.id === data.id
          ? { ...data, text: previous.text + data.text }
          : data,
      );
    } catch (reason) {
      if (epoch === articleEpoch.current) setError(String(reason));
    } finally {
      if (epoch === articleEpoch.current) setReading(false);
    }
  }
  const entries = onlyFavorites
    ? favorites.filter(
        (entry) =>
          entry.kind === kind &&
          entry.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      )
    : (page?.items ?? []);
  function selectKind(value: LibraryKind) {
    leaveArticle();
    setKind(value);
    setOffset(0);
    setArticle(null);
  }
  return (
    <aside
      className="library-panel viewer-chrome"
      aria-label="Bibliothèque"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (work) setWork(null);
          else if (article) leaveArticle();
          else onClose();
          event.stopPropagation();
        }
      }}
    >
      <header className="library-top">
        <Icon name={glyphs[kind]} />
        <h2>{labels[kind]}</h2>
        <IconButton
          icon="close"
          label="Fermer la bibliothèque"
          onClick={onClose}
        />
      </header>
      <nav className="library-tabs" aria-label="Collections">
        {(["manga", "anime", "wiki"] as const).map((value) => (
          <IconButton
            key={value}
            icon={glyphs[value]}
            label={labels[value]}
            aria-pressed={kind === value}
            onClick={() => selectKind(value)}
          />
        ))}
        <IconButton
          icon="heart"
          label="Mes favoris"
          aria-pressed={onlyFavorites}
          onClick={() => setOnlyFavorites(!onlyFavorites)}
        />
      </nav>
      {kind === "anime" ? (
        <nav className="library-tabs" aria-label="Types de catalogue anime">
          <IconButton
            icon="film"
            label="Épisodes des diffuseurs"
            aria-pressed={animeView === "episodes"}
            onClick={() => {
              setAnimeView("episodes");
              setOffset(0);
              leaveArticle();
            }}
          />
          <IconButton
            icon="library"
            label="Séries VF et VOSTFR"
            aria-pressed={animeView === "works"}
            onClick={() => {
              setAnimeView("works");
              setOffset(0);
              leaveArticle();
            }}
          />
          <IconButton
            icon="compass"
            label="Arcs et sagas"
            aria-pressed={animeView === "arcs"}
            onClick={() => {
              setAnimeView("arcs");
              setOffset(0);
              leaveArticle();
            }}
          />
        </nav>
      ) : null}
      {work?.workId ? (
        <AnimeWork
          id={work.workId}
          title={work.title}
          total={work.episodeCount ?? 0}
          onBack={() => setWork(null)}
        />
      ) : article ? (
        <article className="wiki-reader">
          <div className="reader-tools">
            <IconButton
              icon="left"
              label="Retour aux articles"
              onClick={leaveArticle}
            />
            <IconButton
              icon="zoom"
              label="Agrandir le texte"
              disabled={articleSize >= 24}
              onClick={() => setArticleSize(Math.min(24, articleSize + 2))}
            />
            <IconButton
              icon="fit"
              label="Réduire le texte"
              disabled={articleSize <= 14}
              onClick={() => setArticleSize(Math.max(14, articleSize - 2))}
            />
          </div>
          <h3 lang={article.language}>{article.title}</h3>
          <a href={article.url} target="_blank" rel="noreferrer">
            {new URL(article.url).hostname} · {article.language} · Communauté
          </a>
          <div
            className="wiki-text"
            lang={article.language}
            style={{ fontSize: articleSize }}
          >
            <WikiText text={article.text} />
          </div>
          {article.text.length < article.characters ? (
            <button
              className="library-more"
              disabled={reading}
              onClick={() =>
                readArticle({ ...article, kind: "wiki" }, article.text.length)
              }
            >
              {reading ? "Chargement…" : "Lire la suite"}
            </button>
          ) : null}
        </article>
      ) : (
        <>
          <label className="library-search">
            <Icon name="search" />
            <input
              aria-label="Rechercher dans la collection"
              autoFocus
              placeholder="Natsu, Lucy, un tome, un épisode…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p className="library-count" role="status">
            {busy
              ? "Chargement…"
              : `${onlyFavorites ? entries.length : (page?.total ?? 0)} références · ${kind === "wiki" ? "sources communautaires" : kind === "anime" ? (animeView === "episodes" ? "catalogue et liens diffuseurs" : "catalogue communautaire · métadonnées") : "catalogue éditeur et extraits disponibles"}`}
          </p>
          <div className="library-results">
            {entries.map((entry) => {
              const saved = favorites.some(
                (item) => entryKey(item) === entryKey(entry),
              );
              const cached =
                typeof entry.availability === "object" &&
                (entry.availability.cachedPreviewPages ?? 0) > 0;
              return (
                <section
                  className="library-entry"
                  key={entry.url + String(entry.id ?? entry.episode ?? "")}
                >
                  <div className="library-glyph">
                    <Icon name={glyphs[kind]} />
                  </div>
                  <div className="library-entry-body">
                    <h3 lang={entry.language}>{entry.title}</h3>
                    <p>
                      {kind === "wiki"
                        ? `${entry.language ?? ""} · ${new URL(entry.url).hostname}`
                        : kind === "anime"
                          ? `${entry.provider ?? ""} · ${entry.episode ? `Épisode ${entry.episode}` : "Catalogue"}`
                          : (entry.isbn13 ?? "Éditeur")}
                    </p>
                    {entry.summary ? <p>{entry.summary}</p> : null}
                    {kind === "wiki" ? (
                      <button
                        className="library-read"
                        disabled={reading}
                        onClick={() => readArticle(entry)}
                      >
                        Lire l’article
                      </button>
                    ) : entry.workId ? (
                      <button
                        className="library-read"
                        onClick={() => setWork(entry)}
                      >
                        Parcourir les épisodes
                      </button>
                    ) : cached ? (
                      <button
                        className="library-read"
                        onClick={() => {
                          if (entry.isbn13) onPreview(entry.isbn13);
                        }}
                      >
                        Lire l’extrait public
                      </button>
                    ) : null}
                  </div>
                  <div className="library-entry-actions">
                    <IconButton
                      icon="heart"
                      label={
                        saved ? "Retirer des favoris" : "Ajouter aux favoris"
                      }
                      aria-pressed={saved}
                      onClick={() =>
                        setFavorites(
                          saved
                            ? favorites.filter(
                                (item) => entryKey(item) !== entryKey(entry),
                              )
                            : [...favorites, entry],
                        )
                      }
                    />
                    <a
                      href={entry.url}
                      className="library-external"
                      aria-label={`Ouvrir la source : ${entry.title}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="external" />
                    </a>
                  </div>
                </section>
              );
            })}
            {!busy && !entries.length ? (
              <p>Aucun contenu dans cette sélection.</p>
            ) : null}
          </div>
          {!onlyFavorites && page ? (
            <footer className="library-pages">
              <IconButton
                icon="left"
                label="Résultats précédents"
                disabled={offset === 0 || busy}
                onClick={() => setOffset(Math.max(0, offset - page.limit))}
              />
              <span>
                {Math.min(offset + 1, page.total)}–
                {Math.min(offset + page.items.length, page.total)} /{" "}
                {page.total}
              </span>
              <IconButton
                icon="right"
                label="Résultats suivants"
                disabled={offset + page.limit >= page.total || busy}
                onClick={() => setOffset(offset + page.limit)}
              />
            </footer>
          ) : null}
        </>
      )}
      {error || storageError ? (
        <p role="alert" className="library-error">
          {error || storageError}
        </p>
      ) : null}
    </aside>
  );
}
