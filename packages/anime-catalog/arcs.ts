import type { Archive } from "../archive/index.ts";
import { aphrodyWeb } from "../crawler/wiki.ts";

export const arcSources = [
  {
    language: "fr",
    url: "https://fairy-tail.fandom.com/fr/wiki/Liste_des_Arcs",
    api: "https://fairy-tail.fandom.com/fr/api.php",
  },
  {
    language: "en",
    url: "https://fairytail.fandom.com/wiki/Story_Arcs",
    api: "https://fairytail.fandom.com/api.php",
  },
  {
    language: "ja",
    url: "https://ja.wikipedia.org/wiki/FAIRY_TAIL",
    api: "https://ja.wikipedia.org/w/api.php",
  },
] as const;
type Dossier = {
  url: string;
  revid?: number;
  wikitext?: string;
  markdown?: string;
};
export type AnimeArc = {
  id: string;
  title: string;
  language: string;
  sourceUrl: string;
  arcUrl: string | null;
  revision: number | null;
  sourceOrder: number;
  naming: string;
  rangeKind: string;
  rawRange: string;
  firstEpisode: number | null;
  lastEpisode: number | null;
  episodeNumbers: number[];
  episodeNamespace: string | null;
  declaredEpisodeCount: number | null;
  qualification: string;
  workId: null;
};
function state(a: Archive) {
  a.db.run(`CREATE TABLE IF NOT EXISTS anime_arcs(
 id TEXT PRIMARY KEY,title TEXT NOT NULL,language TEXT NOT NULL,source_url TEXT NOT NULL,arc_url TEXT,revision INTEGER,source_order INTEGER NOT NULL,
 naming TEXT NOT NULL,range_kind TEXT NOT NULL,raw_range TEXT NOT NULL,first_episode INTEGER,last_episode INTEGER,
 episode_numbers TEXT NOT NULL,episode_namespace TEXT,declared_episode_count INTEGER,qualification TEXT NOT NULL,work_id TEXT,fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
}
const integer = (value: string | undefined) =>
  value && /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
function identity(url: string, title: string) {
  return new Bun.CryptoHasher("sha256")
    .update(url + "\n" + title)
    .digest("hex")
    .slice(0, 24);
}
/** Parse explicit source episode links. Counts and manga volumes never imply anime episode ranges. */
export function parseAnimeArcs(dossier: Dossier, language: string): AnimeArc[] {
  const configured = arcSources.find(
    (s) => s.url === dossier.url && s.language === language,
  );
  if (!configured) throw new Error("Source d'arcs non configurée");
  const revision = Number.isSafeInteger(dossier.revid) ? dossier.revid! : null;
  if (language === "ja") {
    const text = dossier.markdown ?? "";
    const synopsis =
      text.split(/^## あらすじ\s*$/m)[1]?.split(/^## /m)[0] ?? "";
    return [
      ...synopsis.matchAll(/^([^\n]{1,120}編)（([^\n]+巻[^\n]*)）\s*$/gm),
    ].map((m, i) => ({
      id: identity(dossier.url, m[1]!),
      title: m[1]!,
      language,
      sourceUrl: dossier.url,
      arcUrl: null,
      revision,
      sourceOrder: i,
      naming: "source_heading",
      rangeKind: "manga_volumes",
      rawRange: m[2]!,
      firstEpisode: null,
      lastEpisode: null,
      episodeNumbers: [],
      episodeNamespace: null,
      declaredEpisodeCount: null,
      qualification: "manga_volume_range_only_no_anime_mapping",
      workId: null,
    }));
  }
  if (typeof dossier.wikitext !== "string")
    throw new Error("Wikitexte requis pour les plages d'épisodes");
  const sections = [...dossier.wikitext.matchAll(/^==([^=\n]+)==\s*$/gm)];
  const result: AnimeArc[] = [];
  for (let i = 0; i < sections.length; i++) {
    const heading = sections[i]!,
      section = dossier.wikitext.slice(
        heading.index! + heading[0].length,
        sections[i + 1]?.index ?? dossier.wikitext.length,
      );
    const link = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(heading[1]!);
    if (!link) continue;
    const title = (link[2] ?? link[1])!.trim();
    const rawRange =
      /^\|(?:Épisodes|Episodes)\s*=([\s\S]*?)(?=^\|[^\n=]+=|^\}\}|$(?![\s\S]))/m
        .exec(section)?.[1]
        ?.trim() ?? "";
    const declaredEpisodeCount = integer(
      /^\|(?:Total des Épisodes|Total Episodes)\s*=([^\n]*)/m.exec(
        section,
      )?.[1],
    );
    const episodeLinks = [
      ...rawRange.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g),
    ].map((m) => m[1]!.trim());
    const observed = episodeLinks.map((target) => {
      const m = /^(.*?)(?:Episode|Épisode)\s+(\d+)$/i.exec(target);
      return m
        ? { number: Number(m[2]), namespace: m[1]!.trim() || "Fairy Tail" }
        : null;
    });
    const namespaces = [
      ...new Set(observed.filter((v) => v !== null).map((v) => v.namespace)),
    ];
    const numbers = [
      ...new Set(observed.filter((v) => v !== null).map((v) => v.number)),
    ].sort((a, b) => a - b);
    const unparsed = observed.some((v) => v === null);
    const mixed = namespaces.length > 1;
    const mismatch =
      declaredEpisodeCount !== null && declaredEpisodeCount !== numbers.length;
    const contiguous =
      numbers.length > 0 &&
      numbers.at(-1)! - numbers[0]! + 1 === numbers.length;
    const qualification = [
      mixed ? "mixed_episode_numbering" : null,
      unparsed ? "unparsed_episode_links" : null,
      mismatch ? "declared_count_mismatch" : null,
      numbers.length
        ? contiguous
          ? "explicit_contiguous_episode_links"
          : "explicit_noncontiguous_episode_links"
        : "no_explicit_anime_episode_links",
    ]
      .filter(Boolean)
      .join(";");
    const valid = !mixed && !unparsed;
    const arcUrl = new URL(
      configured.language === "fr"
        ? "/fr/wiki/" + encodeURIComponent(link[1]!.replaceAll(" ", "_"))
        : "/wiki/" + encodeURIComponent(link[1]!.replaceAll(" ", "_")),
      configured.url,
    ).href;
    result.push({
      id: identity(dossier.url, title),
      title,
      language,
      sourceUrl: dossier.url,
      arcUrl,
      revision,
      sourceOrder: i,
      naming: heading[1]!.includes("*")
        ? "community_unofficial"
        : "source_label_not_officially_verified",
      rangeKind: numbers.length ? "anime_episode_links" : "unspecified",
      rawRange,
      firstEpisode: valid && numbers.length ? numbers[0]! : null,
      lastEpisode: valid && numbers.length ? numbers.at(-1)! : null,
      episodeNumbers: numbers,
      episodeNamespace: namespaces.length === 1 ? namespaces[0]! : null,
      declaredEpisodeCount,
      qualification,
      workId: null,
    });
  }
  return result;
}
export async function collectAnimeArcs(
  a: Archive,
  options: { maxPages?: number; run?: typeof aphrodyWeb } = {},
) {
  const maxPages = options.maxPages ?? 3;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 3)
    throw new Error("maxPages : entier entre 1 et 3");
  state(a);
  const report: {
    sources: {
      url: string;
      language: string;
      revision: number | null;
      arcs: number;
      origin: string;
    }[];
    errors: { url: string; error: string }[];
    arcs: number;
    complete: false;
  } = { sources: [], errors: [], arcs: 0, complete: false };
  for (const source of arcSources.slice(0, maxPages)) {
    try {
      let dossier: Dossier;
      let origin = "native_mediawiki";
      const existing =
        source.language === "ja"
          ? a.db
              .query<{ text: string }, [string]>(
                "SELECT text FROM documents WHERE url=?",
              )
              .get(source.url)
          : null;
      if (existing) {
        origin = "existing_wiki_corpus";
        const has = a.db
          .query("SELECT name FROM sqlite_master WHERE name='wiki_provenance'")
          .get();
        const revision = has
          ? a.db
              .query<{ revid: number }, [string]>(
                "SELECT revid FROM wiki_provenance WHERE url=?",
              )
              .get(source.url)?.revid
          : undefined;
        dossier = { url: source.url, markdown: existing.text, revid: revision };
      } else
        dossier = (await (options.run ?? aphrodyWeb)([
          "wiki-page",
          source.url,
          "--api-url",
          source.api,
          "--include-content",
          "--no-images",
          "--json",
        ])) as Dossier;
      if (dossier.url !== source.url)
        throw new Error("Origine/réponse wiki inattendue");
      const arcs = parseAnimeArcs(dossier, source.language);
      if (!arcs.length)
        throw new Error("Aucun arc qualifié dans la page source");
      // Source replacement is atomic; failed refreshes retain the previous qualified snapshot.
      a.db.transaction(() => {
        a.db.query("DELETE FROM anime_arcs WHERE source_url=?").run(source.url);
        for (const r of arcs)
          a.db
            .query(
              `INSERT INTO anime_arcs(id,title,language,source_url,arc_url,revision,source_order,naming,range_kind,raw_range,first_episode,last_episode,episode_numbers,episode_namespace,declared_episode_count,qualification,work_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
            )
            .run(
              r.id,
              r.title,
              r.language,
              r.sourceUrl,
              r.arcUrl,
              r.revision,
              r.sourceOrder,
              r.naming,
              r.rangeKind,
              r.rawRange,
              r.firstEpisode,
              r.lastEpisode,
              JSON.stringify(r.episodeNumbers),
              r.episodeNamespace,
              r.declaredEpisodeCount,
              r.qualification,
            );
      })();
      report.arcs += arcs.length;
      report.sources.push({
        url: source.url,
        language: source.language,
        revision: arcs[0]!.revision,
        arcs: arcs.length,
        origin,
      });
    } catch (error) {
      report.errors.push({ url: source.url, error: String(error) });
    }
  }
  return report;
}
export function listAnimeArcs(
  a: Archive,
  options: { lang?: string; limit?: number; offset?: number } = {},
) {
  const limit = options.limit ?? 100,
    offset = options.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000
  )
    throw new Error("Pagination invalide");
  if (options.lang !== undefined && !["fr", "en", "ja"].includes(options.lang))
    throw new Error("Langue invalide");
  const exists = a.db
    .query("SELECT name FROM sqlite_master WHERE name='anime_arcs'")
    .get();
  if (!exists) return [];
  return a.db
    .query<
      Omit<AnimeArc, "episodeNumbers"> & {
        episodeNumbers: string;
        fetchedAt: string;
      },
      (string | number | null)[]
    >(
      `SELECT id,title,language,source_url AS sourceUrl,arc_url AS arcUrl,revision,source_order AS sourceOrder,naming,range_kind AS rangeKind,raw_range AS rawRange,first_episode AS firstEpisode,last_episode AS lastEpisode,episode_numbers AS episodeNumbers,episode_namespace AS episodeNamespace,declared_episode_count AS declaredEpisodeCount,qualification,work_id AS workId,fetched_at AS fetchedAt FROM anime_arcs WHERE (? IS NULL OR language=?) ORDER BY language,source_order,id LIMIT ? OFFSET ?`,
    )
    .all(options.lang ?? null, options.lang ?? null, limit, offset)
    .map((row) => ({
      ...row,
      episodeNumbers: JSON.parse(String(row.episodeNumbers)) as number[],
    }));
}
