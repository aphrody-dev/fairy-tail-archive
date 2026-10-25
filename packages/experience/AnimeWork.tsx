import { useEffect, useState } from "react";
import { IconButton } from "./icons";
type Episode = {
  url: string;
  title: string;
  number: number | null;
  season: number | null;
};
export function AnimeWork({
  id,
  title,
  total,
  onBack,
}: {
  id: string;
  title: string;
  total: number;
  onBack: () => void;
}) {
  const [offset, setOffset] = useState(0),
    [episodes, setEpisodes] = useState<Episode[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    setError("");
    void fetch(
      `/anime/works/${encodeURIComponent(id)}?limit=50&offset=${offset}`,
      { signal: abort.signal },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`Catalogue HTTP ${r.status}`);
        const data: { episodes: Episode[] } = await r.json();
        if (!abort.signal.aborted) setEpisodes(data.episodes);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [id, offset]);
  return (
    <section className="wiki-reader">
      <div className="reader-tools">
        <IconButton icon="left" label="Retour aux séries" onClick={onBack} />
      </div>
      <h3>{title}</h3>
      <p className="reader-note">
        Catalogue communautaire · {total} entrées · liens sources, disponibilité
        vidéo non acquise.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {busy ? (
        <p role="status">Chargement…</p>
      ) : (
        <ol className="episode-catalog">
          {episodes.map((episode) => (
            <li key={episode.url}>
              <a href={episode.url} target="_blank" rel="noreferrer">
                {episode.title}
              </a>
            </li>
          ))}
        </ol>
      )}
      <footer className="library-pages">
        <IconButton
          icon="left"
          label="Épisodes précédents"
          disabled={busy || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        />
        <span>
          {offset + 1}–{offset + episodes.length} / {total}
        </span>
        <IconButton
          icon="right"
          label="Épisodes suivants"
          disabled={
            busy || offset + episodes.length >= total || episodes.length < 50
          }
          onClick={() => setOffset(offset + 50)}
        />
      </footer>
    </section>
  );
}
