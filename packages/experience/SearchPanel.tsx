import { useEffect, useRef, useState } from "react";
import { Modal } from "../../apps/home/dialogs";
import { Icon } from "./icons";
type Hit = {
  id: number;
  title: string;
  url: string;
  language: string;
  text: string;
  score: number;
};
type Answer = {
  answer: string;
  sources: { id: number; title: string; url: string }[];
};
export function SearchPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) {
      request.current?.abort();
      setBusy(false);
      return;
    }
    const abort = new AbortController();
    void fetch("/library", { signal: abort.signal })
      .then((r) => r.json())
      .then((data: { languages: { language: string }[] }) => {
        if (!abort.signal.aborted)
          setLanguages(data.languages.map((item) => item.language));
      })
      .catch(() => {});
    return () => abort.abort();
  }, [open]);
  async function search(question = false) {
    if (!query.trim()) return;
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError("");
    setAnswer(null);
    const params = new URLSearchParams({ q: query.trim() });
    if (language) params.set("lang", language);
    try {
      const response = await fetch(
        `/${question ? "ask" : "search"}?${params}`,
        { signal: abort.signal },
      );
      if (!response.ok) throw new Error(`Recherche HTTP ${response.status}`);
      if (question) {
        const data: Answer = await response.json();
        if (!abort.signal.aborted) {
          setAnswer(data);
          setHits([]);
        }
      } else {
        const data: Hit[] = await response.json();
        if (!abort.signal.aborted)
          setHits(
            data.filter(
              (hit, index, all) =>
                all.findIndex((item) => item.url === hit.url) === index,
            ),
          );
      }
    } catch (reason) {
      if (!abort.signal.aborted) setError(String(reason));
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rechercher dans l’univers"
      id="unified-search"
    >
      <form
        className="wiki-search"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <div>
          <label htmlFor="unified-query">
            Personnage, histoire, manga, jeu…
          </label>
          <input
            id="unified-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher dans les sources indexées"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="unified-language">Langue</label>
          <select
            id="unified-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="">Toutes</option>
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {new Intl.DisplayNames(["fr"], { type: "language" }).of(lang) ??
                  lang}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy || !query.trim()}
          aria-label="Lancer la recherche"
        >
          <Icon name="search" />
        </button>
        <button
          type="button"
          disabled={busy || !query.trim()}
          onClick={() => void search(true)}
          aria-label="Obtenir une réponse sourcée"
        >
          <Icon name="compass" />
        </button>
      </form>
      {busy ? (
        <p role="status" className="reader-note">
          Recherche dans le corpus…
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {answer ? (
        <article className="search-answer">
          <h3>Réponse sourcée</h3>
          <p>{answer.answer}</p>
          <ol>
            {answer.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ol>
        </article>
      ) : null}
      <div className="unified-search-results">
        {hits.map((hit) => (
          <article key={hit.url}>
            <a href={hit.url} target="_blank" rel="noreferrer">
              <h3 lang={hit.language}>{hit.title}</h3>
            </a>
            <small>
              {new URL(hit.url).hostname} · {hit.language}
            </small>
            <p lang={hit.language}>
              {hit.text.slice(0, 700)}
              {hit.text.length > 700 ? "…" : ""}
            </p>
          </article>
        ))}
      </div>
    </Modal>
  );
}
