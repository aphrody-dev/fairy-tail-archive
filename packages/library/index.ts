import type { Archive } from "../archive/index.ts";

export type PageOptions = { limit?: number; offset?: number; q?: string };
const wikiHost = "lower(substr(d.url,9,instr(substr(d.url,9),'/')-1))";
const wikiPredicate = `d.url LIKE 'https://%' AND (${wikiHost} LIKE '%.wikipedia.org' OR ${wikiHost} LIKE '%.fandom.com' OR ${wikiHost} LIKE '%.wikia.com')`;
function table(archive: Archive, name: string) {
  return !!archive.db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    )
    .get(name);
}
function count(archive: Archive, name: string) {
  return table(archive, name)
    ? archive.db
        .query<{ n: number }, []>(`SELECT count(*) n FROM ${name}`)
        .get()!.n
    : 0;
}
function pagination(options: PageOptions) {
  const limit = options.limit ?? 20,
    offset = options.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 1000000
  )
    throw new Error("Pagination : limit de 1 à 100, offset de 0 à 1000000");
  if (
    options.q !== undefined &&
    (typeof options.q !== "string" || options.q.length > 256)
  )
    throw new Error("q : texte de 256 caractères maximum");
  return { limit, offset, q: options.q?.trim() ?? "" };
}
const like = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;
function language(lang?: string) {
  if (lang !== undefined && !["fr", "en", "ja", "und"].includes(lang))
    throw new Error("Langue non prise en charge");
  return lang ?? null;
}
function strings(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}
function origin(address: string) {
  try {
    return new URL(address).origin;
  } catch {
    return "local";
  }
}

/** SELECT-only overview. Indexed assets and verified playable files are different counts. */
export function libraryOverview(archive: Archive) {
  const groups: Record<string, unknown> = Object.create(null);
  for (const name of ["publisher_queue", "wiki_jobs", "fancaps_pages"])
    if (table(archive, name))
      groups[name] = archive.db
        .query(
          `SELECT state,count(*) n FROM ${name} GROUP BY state ORDER BY state`,
        )
        .all();
  const sourceExpression =
    "CASE WHEN url LIKE 'https://%' THEN 'https://' || substr(url,9,instr(substr(url,9),'/')-1) WHEN url LIKE 'http://%' THEN 'http://' || substr(url,8,instr(substr(url,8),'/')-1) ELSE 'local' END";
  return {
    coverage: {
      exhaustive: false,
      scope: "locally-indexed-sources",
      localFilesVerified: "only-on-paginated-anime-items",
      queues: groups,
    },
    counts: {
      ...archive.stats(),
      wikiDocuments: archive.db
        .query<{ n: number }, []>(
          `SELECT count(*) n FROM documents d WHERE ${wikiPredicate}`,
        )
        .get()!.n,
      cataloguePublications: count(archive, "catalog_books"),
      mangaPreviewVolumes: count(archive, "manga_volumes"),
      mangaPreviewPages: count(archive, "manga_pages"),
      mangaPreviewAssets: count(archive, "manga_assets"),
      cachedMangaPreviewAssets: table(archive, "manga_assets")
        ? archive.db
            .query<{ n: number }, []>(
              "SELECT count(*) n FROM manga_assets WHERE cache_state='cached'",
            )
            .get()!.n
        : 0,
      cachedMangaPreviewPages:
        table(archive, "manga_pages") && table(archive, "manga_assets")
          ? archive.db
              .query<{ n: number }, []>(
                "SELECT count(*) n FROM manga_pages p WHERE EXISTS(SELECT 1 FROM manga_assets a WHERE a.page_id=p.id) AND NOT EXISTS(SELECT 1 FROM manga_assets a WHERE a.page_id=p.id AND a.cache_state!='cached')",
              )
              .get()!.n
          : 0,
      mediaCatalogueItems: count(archive, "media_catalog"),
      linkedMediaItems: count(archive, "media_local_links"),
      localEpisodesIndexed: count(archive, "episodes"),
      fancapsThumbnails: count(archive, "fancaps_images"),
      cachedFancapsThumbnails: table(archive, "fancaps_images")
        ? archive.db
            .query<{ n: number }, []>(
              "SELECT count(*) n FROM fancaps_images WHERE cache_state='cached'",
            )
            .get()!.n
        : 0,
    },
    languages: archive.db
      .query(
        "SELECT language,count(*) documents FROM documents GROUP BY language ORDER BY language",
      )
      .all(),
    sources: archive.db
      .query(
        `SELECT ${sourceExpression} origin,count(*) documents FROM documents GROUP BY origin ORDER BY documents DESC,origin LIMIT 50`,
      )
      .all(),
    sourceSummaryLimit: 50,
    availability: {
      manga:
        "Catalogue metadata and any explicitly imported publisher preview pages; complete volumes are not implied.",
      anime:
        "Public episode metadata is distinct from local files; no remote playback acquisition.",
      fancaps: "Collected images are thumbnails, not full episode frames.",
    },
  };
}

type Publication = {
  url: string;
  title: string;
  authors_json: string;
  isbn13: string | null;
  published_on: string | null;
  synopsis: string | null;
  source_catalog_url: string;
  fetched_at: string | null;
  details_fetched_at: string | null;
};
export function listMangaVolumes(archive: Archive, options: PageOptions = {}) {
  const { limit, offset, q } = pagination(options);
  const catalogue = table(archive, "catalog_books"),
    previews = table(archive, "manga_volumes"),
    pages = previews && table(archive, "manga_pages"),
    assets = pages && table(archive, "manga_assets");
  if (!catalogue && !previews)
    return {
      items: [],
      total: 0,
      limit,
      offset,
      coverage: "partial",
      queryMode: "literal-title-or-isbn",
    };
  const pattern = like(q);
  const where =
    "(?='' OR b.title LIKE ? ESCAPE '\\' OR b.isbn13 LIKE ? ESCAPE '\\')";
  const base = [
    ...(catalogue
      ? [
          "SELECT url,title,authors_json,isbn13,published_on,synopsis,source_catalog_url,fetched_at,details_fetched_at,1 AS in_catalogue FROM catalog_books",
        ]
      : []),
    ...(previews
      ? [
          `SELECT book_url AS url,title,'[]' AS authors_json,isbn13,NULL AS published_on,NULL AS synopsis,book_url AS source_catalog_url,NULL AS fetched_at,NULL AS details_fetched_at,0 AS in_catalogue FROM manga_volumes ${catalogue ? "WHERE NOT EXISTS (SELECT 1 FROM catalog_books b WHERE b.url=manga_volumes.book_url)" : ""}`,
        ]
      : []),
  ].join(" UNION ALL ");
  const join = previews ? "LEFT JOIN manga_volumes m ON m.book_url=b.url" : "";
  const previewColumns = previews
    ? `m.id AS preview_volume_id,m.preview_ean,m.preview_url,m.epub_url,m.scope AS preview_scope,m.state AS preview_state,${pages ? "(SELECT count(*) FROM manga_pages p WHERE p.volume_id=m.id)" : "0"} AS preview_pages,${assets ? "(SELECT count(*) FROM manga_pages p WHERE p.volume_id=m.id AND EXISTS(SELECT 1 FROM manga_assets a WHERE a.page_id=p.id) AND NOT EXISTS(SELECT 1 FROM manga_assets a WHERE a.page_id=p.id AND a.cache_state!='cached'))" : "0"} AS cached_preview_pages,${assets ? "(SELECT count(*) FROM manga_assets a JOIN manga_pages p ON p.id=a.page_id WHERE p.volume_id=m.id)" : "0"} AS preview_assets,${assets ? "(SELECT count(*) FROM manga_assets a JOIN manga_pages p ON p.id=a.page_id WHERE p.volume_id=m.id AND a.cache_state='cached')" : "0"} AS cached_preview_assets`
    : "NULL AS preview_volume_id,NULL AS preview_ean,NULL AS preview_url,NULL AS epub_url,NULL AS preview_scope,NULL AS preview_state,0 AS preview_pages,0 AS cached_preview_pages,0 AS preview_assets,0 AS cached_preview_assets";
  const rows = archive.db
    .query<
      Publication & {
        in_catalogue: number;
        preview_volume_id: number | null;
        preview_ean: string | null;
        preview_url: string | null;
        epub_url: string | null;
        preview_scope: string | null;
        preview_state: string | null;
        preview_pages: number;
        cached_preview_pages: number;
        preview_assets: number;
        cached_preview_assets: number;
      },
      [string, string, string, number, number]
    >(
      `WITH publications AS (${base}) SELECT b.*,${previewColumns} FROM publications b ${join} WHERE ${where} ORDER BY b.published_on DESC,b.url LIMIT ? OFFSET ?`,
    )
    .all(q, pattern, pattern, limit, offset);
  return {
    items: rows.map((row) => ({
      url: row.url,
      title: row.title,
      authors: strings(row.authors_json),
      isbn13: row.isbn13,
      publishedOn: row.published_on,
      synopsis: row.synopsis,
      sourceCatalogUrl: row.source_catalog_url,
      fetchedAt: row.fetched_at,
      detailsFetchedAt: row.details_fetched_at,
      previewVolumeId: row.preview_volume_id,
      previewEan: row.preview_ean,
      previewSourceUrl: row.preview_url,
      previewPackageSourceUrl: row.epub_url,
      publicationType: /\bchapitre\b/i.test(row.title)
        ? "chapter"
        : /\bt\d+\b/i.test(row.title)
          ? "volume"
          : /\bagenda\b/i.test(row.title)
            ? "merchandise"
            : "catalogue-item",
      availability: {
        catalogue: row.in_catalogue === 1,
        synopsis: row.synopsis !== null,
        previewPages: row.preview_pages,
        cachedPreviewPages: row.cached_preview_pages,
        previewAssets: row.preview_assets,
        cachedPreviewAssets: row.cached_preview_assets,
        previewScope: row.preview_scope,
        completeVolumeAvailable: false,
        previewStatus: row.preview_state ?? "not-collected",
      },
    })),
    total: archive.db
      .query<{ n: number }, [string, string, string]>(
        `WITH publications AS (${base}) SELECT count(*) n FROM publications b WHERE ${where}`,
      )
      .get(q, pattern, pattern)!.n,
    limit,
    offset,
    coverage: "partial",
    queryMode: "literal-title-or-isbn",
  };
}

/** Read the registered public preview spine; no EPUB retrieval, extraction or cache writes. */
export function readMangaPreview(
  archive: Archive,
  isbn: string | number,
  options: Pick<PageOptions, "limit" | "offset"> = {},
) {
  if (
    typeof isbn === "number"
      ? !Number.isSafeInteger(isbn) || isbn < 1
      : !/^\d{13}$/.test(isbn)
  )
    throw new Error(
      "ISBN : 13 chiffres, ou identifiant de volume positif requis",
    );
  const { limit, offset } = pagination(options);
  const empty = {
    volume: null,
    pages: [],
    total: 0,
    limit,
    offset,
    coverage: "partial",
    scope: "preview",
    completeVolumeAvailable: false,
    ordinalMeaning: "publisher-preview-spine-order",
  };
  if (!table(archive, "manga_volumes")) return empty;
  const row = archive.db
    .query<
      {
        id: number;
        book_url: string;
        title: string;
        isbn13: string;
        preview_ean: string | null;
        preview_url: string | null;
        epub_url: string | null;
        language: string;
        reading_direction: string;
        scope: string;
        state: string;
      },
      [string | number]
    >(
      `SELECT id,book_url,title,isbn13,preview_ean,preview_url,epub_url,language,reading_direction,scope,state FROM manga_volumes WHERE ${typeof isbn === "number" ? "id" : "isbn13"}=? ORDER BY id LIMIT 1`,
    )
    .get(isbn);
  if (!row) return empty;
  const volume = {
    id: row.id,
    bookUrl: row.book_url,
    title: row.title,
    isbn13: row.isbn13,
    previewEan: row.preview_ean,
    previewUrl: row.preview_url,
    epubUrl: row.epub_url,
    language: row.language,
    readingDirection: row.reading_direction,
    scope: row.scope,
    state: row.state,
  };
  if (!table(archive, "manga_pages"))
    return { ...empty, volume, scope: row.scope };
  const assetsPresent = table(archive, "manga_assets");
  const rows = archive.db
    .query<
      {
        id: number;
        ordinal: number;
        document_path: string;
        text: string;
        text_characters: number;
      },
      [number, number, number]
    >(
      "SELECT id,ordinal,document_path,substr(text,1,4000) AS text,length(text) AS text_characters FROM manga_pages WHERE volume_id=? ORDER BY ordinal LIMIT ? OFFSET ?",
    )
    .all(row.id, limit, offset);
  const pages = rows.map((page) => {
    const assets = assetsPresent
      ? archive.db
          .query<
            {
              id: number;
              page_id: number;
              ordinal: number;
              entry_path: string;
              declared_mime: string;
              source_url: string;
              cache_state: string;
              sha256: string | null;
              mime: string | null;
              bytes: number | null;
              width: number | null;
              height: number | null;
              extract_engine: string | null;
              native_error: string | null;
            },
            [number]
          >(
            "SELECT id,page_id,ordinal,entry_path,declared_mime,source_url,cache_state,sha256,mime,bytes,width,height,extract_engine,native_error FROM manga_assets WHERE page_id=? ORDER BY ordinal LIMIT 100",
          )
          .all(page.id)
          .map((asset) => ({
            id: asset.id,
            pageId: asset.page_id,
            ordinal: asset.ordinal,
            entryPath: asset.entry_path,
            declaredMime: asset.declared_mime,
            sourceUrl: asset.source_url,
            cacheState: asset.cache_state,
            sha256: asset.sha256,
            mime: asset.mime,
            bytes: asset.bytes,
            width: asset.width,
            height: asset.height,
            extractEngine: asset.extract_engine,
            nativeError: asset.native_error,
            localUrl:
              asset.cache_state === "cached" ? `/cdn/manga/${asset.id}` : null,
          }))
      : [];
    const assetTotal = assetsPresent
      ? archive.db
          .query<{ n: number }, [number]>(
            "SELECT count(*) n FROM manga_assets WHERE page_id=?",
          )
          .get(page.id)!.n
      : 0;
    return {
      id: page.id,
      ordinal: page.ordinal,
      documentPath: page.document_path,
      text: page.text,
      textCharacters: page.text_characters,
      textTruncated: page.text_characters > 4000,
      assets,
      assetTotal,
      assetsTruncated: assetTotal > 100,
    };
  });
  return {
    ...empty,
    volume,
    pages,
    total: archive.db
      .query<{ n: number }, [number]>(
        "SELECT count(*) n FROM manga_pages WHERE volume_id=?",
      )
      .get(row.id)!.n,
    scope: row.scope,
  };
}

type AnimeRow = {
  provider: string;
  source_id: string;
  item_key: string;
  provider_id: string | null;
  title: string;
  url: string;
  episode_number: number | null;
  season_number: number | null;
  duration_seconds: number | null;
  summary: string;
  audio_languages: string;
  subtitle_languages: string;
  episode_id: string | null;
  local_path: string | null;
  frame_count: number;
  index_status: string | null;
};
export async function animeCatalog(
  archive: Archive,
  options: PageOptions & { provider?: string } = {},
) {
  const { limit, offset, q } = pagination(options),
    provider = options.provider ?? null;
  if (provider !== null && !["netflix", "youtube"].includes(provider))
    throw new Error("Fournisseur : netflix ou youtube");
  if (!table(archive, "media_catalog"))
    return {
      items: [],
      total: 0,
      limit,
      offset,
      coverage: "partial",
      localOnly: false,
    };
  const linked = table(archive, "media_local_links");
  const where =
    "(? IS NULL OR c.provider=?) AND (?='' OR c.title LIKE ? ESCAPE '\\')";
  const join = linked
    ? "LEFT JOIN media_local_links l ON l.provider=c.provider AND l.item_key=c.item_key LEFT JOIN episodes e ON e.id=l.episode_id"
    : "";
  const local = linked
    ? "e.id AS episode_id,e.path AS local_path,e.status AS index_status,(SELECT count(*) FROM frames f WHERE f.episode_id=e.id) AS frame_count"
    : "NULL AS episode_id,NULL AS local_path,NULL AS index_status,0 AS frame_count";
  const rows = archive.db
    .query<
      AnimeRow,
      [string | null, string | null, string, string, number, number]
    >(
      `SELECT c.*,${local} FROM media_catalog c ${join} WHERE ${where} ORDER BY c.provider,c.season_number,c.episode_number,c.item_key LIMIT ? OFFSET ?`,
    )
    .all(provider, provider, q, like(q), limit, offset);
  const items = [];
  for (const row of rows) {
    let localFileExists = false;
    if (row.local_path)
      try {
        localFileExists = await Bun.file(row.local_path).exists();
      } catch {
        /* an indexed path is not a verified local stream */
      }
    items.push({
      provider: row.provider,
      sourceId: row.source_id,
      itemKey: row.item_key,
      providerId: row.provider_id,
      title: row.title,
      url: row.url,
      episode: row.episode_number,
      season: row.season_number,
      durationSeconds: row.duration_seconds,
      summary: row.summary,
      audioLanguages: strings(row.audio_languages),
      subtitleLanguages: strings(row.subtitle_languages),
      localEpisodeId: row.episode_id,
      indexStatus: row.index_status,
      indexedFrames: row.frame_count,
      availability: localFileExists
        ? "local-file"
        : row.episode_id
          ? "indexed-file-missing"
          : "catalogue-only",
      localFileExists,
      localVideoUrl: localFileExists
        ? `/episodes/${row.episode_id}/video`
        : null,
      framesUrl:
        row.episode_id && row.frame_count > 0
          ? `/episodes/${row.episode_id}/frames`
          : null,
      remotePlaybackAcquired: false,
    });
  }
  return {
    items,
    total: archive.db
      .query<{ n: number }, [string | null, string | null, string, string]>(
        `SELECT count(*) n FROM media_catalog c WHERE ${where}`,
      )
      .get(provider, provider, q, like(q))!.n,
    limit,
    offset,
    coverage: "partial",
    localOnly: false,
  };
}

type WikiSummary = {
  id: number;
  url: string;
  title: string;
  language: string;
  fetched_at: string;
  characters: number;
  revid: number | null;
  page_id: number | null;
  imported_at: string | null;
};
function provenance(archive: Archive) {
  return table(archive, "wiki_provenance")
    ? {
        join: "LEFT JOIN wiki_provenance p ON p.url=d.url",
        columns: "p.revid,p.page_id,p.imported_at",
      }
    : {
        join: "",
        columns: "NULL AS revid,NULL AS page_id,NULL AS imported_at",
      };
}
function summary(row: WikiSummary) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    language: row.language,
    origin: origin(row.url),
    fetchedAt: row.fetched_at,
    characters: row.characters,
    revision: row.revid,
    pageId: row.page_id,
    importedAt: row.imported_at,
  };
}
export function wikiDocuments(
  archive: Archive,
  options: PageOptions & { lang?: string } = {},
) {
  const { limit, offset, q } = pagination(options),
    lang = language(options.lang),
    source = provenance(archive);
  const bindings: (string | number | null)[] = [lang, lang];
  let where = `${wikiPredicate} AND (? IS NULL OR d.language=?)`;
  if (q) {
    const urls = [
      ...new Set(archive.search(q, 50, options.lang).map((hit) => hit.url)),
    ];
    if (!urls.length)
      return {
        items: [],
        total: 0,
        totalIsExact: false,
        searchWindow: 50,
        limit,
        offset,
        coverage: "partial",
      };
    where += ` AND d.url IN (${urls.map(() => "?").join(",")})`;
    bindings.push(...urls);
  }
  const rows = archive.db
    .query<WikiSummary, (string | number | null)[]>(
      `SELECT d.id,d.url,d.title,d.language,d.fetched_at,length(d.text) AS characters,${source.columns} FROM documents d ${source.join} WHERE ${where} ORDER BY d.title,d.id LIMIT ? OFFSET ?`,
    )
    .all(...bindings, limit, offset);
  return {
    items: rows.map(summary),
    total: archive.db
      .query<{ n: number }, (string | number | null)[]>(
        `SELECT count(*) n FROM documents d WHERE ${where}`,
      )
      .get(...bindings)!.n,
    totalIsExact: !q,
    searchWindow: q ? 50 : null,
    limit,
    offset,
    coverage: "partial",
  };
}

export function getWikiDocument(
  archive: Archive,
  id: number,
  options: { offset?: number; maxCharacters?: number } = {},
) {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Identifiant de document invalide");
  const offset = options.offset ?? 0,
    maxCharacters = options.maxCharacters ?? 16000;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000000 ||
    !Number.isSafeInteger(maxCharacters) ||
    maxCharacters < 1 ||
    maxCharacters > 100000
  )
    throw new Error("Fenêtre de texte invalide");
  const source = provenance(archive);
  const row = archive.db
    .query<WikiSummary & { text: string }, [number, number, number]>(
      `SELECT d.id,d.url,d.title,d.language,d.fetched_at,length(d.text) AS characters,substr(d.text,?,?) AS text,${source.columns} FROM documents d ${source.join} WHERE d.id=? AND ${wikiPredicate}`,
    )
    .get(offset + 1, maxCharacters, id);
  return row
    ? {
        ...summary(row),
        text: row.text,
        textOffset: offset,
        maxCharacters,
        truncated: offset > 0 || offset + maxCharacters < row.characters,
        sourceFormat: "original-imported-document",
        coverage: "partial",
      }
    : null;
}
