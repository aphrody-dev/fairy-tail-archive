import { mkdirSync, realpathSync, unlinkSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { Python } from "bun:python";
import type { Archive } from "../archive/index.ts";
import { aphrodyWeb } from "../crawler/wiki.ts";
import { publisherUrl, parsePublisherBook } from "../crawler/publisher.ts";

const ROOT = resolve("data/manga"),
  PACKAGES = resolve(ROOT, "epub"),
  CACHE = resolve(ROOT, "cache");
export const MANGA_PREVIEW_ORIGINS = [
  "https://www.liseuse-hachette.fr",
  "https://extraits.tea-ebook.com",
] as const;
type BookRow = {
  id: number;
  book_url: string;
  title: string;
  isbn13: string | null;
  preview_ean: string | null;
  preview_url: string | null;
  epub_url: string | null;
  package_path: string | null;
  package_sha256: string | null;
};
type AssetRow = {
  id: number;
  page_id: number;
  entry_path: string;
  source_url: string;
  cache_state: string;
  sha256: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  cache_path: string | null;
  extract_engine: string | null;
  native_error: string | null;
};
export type EpubPage = {
  ordinal: number;
  documentPath: string;
  text: string;
  assets: { entryPath: string; mediaType: string }[];
};
export type EpubManifest = {
  title: string;
  language: string;
  readingDirection: string;
  pages: EpubPage[];
  entries: number;
  uncompressedBytes: number;
  engine: string;
};

// CPython's standard library validates ZIP bounds and the EPUB XML tree. It is
// already hosted by bun:python; no zip/XML npm package or Python package is used.
const EPUB_HELPERS = String.raw`
import zipfile as _ft_zip, xml.etree.ElementTree as _ft_xml, posixpath as _ft_posix
import urllib.parse as _ft_url, base64 as _ft_b64, json as _ft_json

def _ft_epub_safe_name(name):
    if not name or name.startswith(('/', '\\')) or '\\' in name or ':' in name or '..' in name.split('/'):
        raise ValueError('Unsafe EPUB entry path')
    return name

def _ft_epub_infos(z):
    infos=z.infolist()
    if len(infos)>2048 or sum(i.file_size for i in infos)>67108864:
        raise ValueError('EPUB exceeds entry count or 64 MiB expanded bound')
    for i in infos:
        _ft_epub_safe_name(i.filename)
        if i.flag_bits & 1 or i.file_size>8388608 or i.file_size>max(1,i.compress_size)*200:
            raise ValueError('Encrypted or oversized EPUB entry')
    if 'META-INF/encryption.xml' in z.namelist():
        raise ValueError('Encrypted/obfuscated EPUB is outside public-preview support')
    return infos

def _ft_epub_read(z, name, limit=8388608):
    info=z.getinfo(_ft_epub_safe_name(name))
    if info.file_size>limit:
        raise ValueError('EPUB entry exceeds requested bound')
    with z.open(info) as source:
        data=source.read(limit+1)
    if len(data)>limit or len(data)!=info.file_size:
        raise ValueError('EPUB entry length mismatch')
    return data

def _ft_epub_xml(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('External XML declarations are unsupported')
    return _ft_xml.fromstring(data)

def _ft_epub_local(base, href):
    part=_ft_url.urlsplit(href)
    if part.scheme or part.netloc or part.query:
        raise ValueError('EPUB resource must be a local archive entry')
    return _ft_epub_safe_name(_ft_posix.normpath(_ft_posix.join(_ft_posix.dirname(base),_ft_url.unquote(part.path))))

def _ft_epub_inspect(payload):
    with _ft_zip.ZipFile(payload['path']) as z:
        infos=_ft_epub_infos(z)
        if _ft_epub_read(z,'mimetype',64).strip()!=b'application/epub+zip':
            raise ValueError('Not an EPUB package')
        container=_ft_epub_xml(_ft_epub_read(z,'META-INF/container.xml',1048576))
        root=container.find('.//{*}rootfile')
        if root is None:
            raise ValueError('EPUB rootfile missing')
        package_path=_ft_epub_safe_name(root.attrib['full-path'])
        package=_ft_epub_xml(_ft_epub_read(z,package_path,1048576))
        manifest={n.attrib['id']:{'path':_ft_epub_local(package_path,n.attrib['href']),'type':n.attrib.get('media-type','')} for n in package.findall('.//{*}manifest/{*}item')}
        media_types={v['path']:v['type'] for v in manifest.values()}
        spine=package.find('.//{*}spine')
        if spine is None:
            raise ValueError('EPUB spine missing')
        pages=[]
        for ref in spine.findall('{*}itemref'):
            item=manifest.get(ref.attrib.get('idref'))
            if not item or item['type'] not in ('application/xhtml+xml','text/html'):
                raise ValueError('Unsupported EPUB spine item')
            document=_ft_epub_xml(_ft_epub_read(z,item['path'],1048576))
            body=document.find('.//{*}body')
            assets=[]
            for image in document.iter():
                tag=image.tag.split('}')[-1]
                href=image.attrib.get('src') if tag=='img' else (image.attrib.get('{http://www.w3.org/1999/xlink}href') or image.attrib.get('href')) if tag=='image' else None
                if href:
                    path=_ft_epub_local(item['path'],href)
                    z.getinfo(path)
                    assets.append({'entryPath':path,'mediaType':media_types.get(path,'application/octet-stream')})
            if len(assets)>16:
                raise ValueError('EPUB page exceeds image bound')
            pages.append({'ordinal':len(pages)+1,'documentPath':item['path'],'text':' '.join(body.itertext()).strip() if body is not None else '', 'assets':assets})
        if not pages or len(pages)>500:
            raise ValueError('Preview spine outside 1..500 pages')
        title=package.find('.//{*}title')
        language=package.find('.//{*}language')
        return {'title':title.text if title is not None else '', 'language':language.text if language is not None else 'und','readingDirection':spine.attrib.get('page-progression-direction','default'),'pages':pages,'entries':len(infos),'uncompressedBytes':sum(i.file_size for i in infos),'engine':'bun:python/stdlib:zipfile+xml.etree.ElementTree'}

def _ft_epub_asset(payload):
    with _ft_zip.ZipFile(payload['path']) as z:
        _ft_epub_infos(z)
        return _ft_b64.b64encode(_ft_epub_read(z,payload['entry'])).decode('ascii')
`;

function pythonArgument(value: unknown): string {
  return `_ft_json.loads(${JSON.stringify(JSON.stringify(value))})`;
}
export async function inspectEpub(path: string): Promise<EpubManifest> {
  await using py = await Python.async();
  await py.run(EPUB_HELPERS);
  return await py.evalJSON<EpubManifest>(
    `_ft_epub_inspect(${pythonArgument({ path })})`,
  );
}

export function initManga(archive: Archive) {
  archive.db
    .run(`CREATE TABLE IF NOT EXISTS manga_volumes(id INTEGER PRIMARY KEY,book_url TEXT NOT NULL UNIQUE,title TEXT NOT NULL,isbn13 TEXT,preview_ean TEXT,preview_url TEXT,epub_url TEXT,language TEXT NOT NULL DEFAULT 'fr',reading_direction TEXT NOT NULL DEFAULT 'unknown',scope TEXT NOT NULL DEFAULT 'preview',state TEXT NOT NULL DEFAULT 'pending',last_error TEXT,package_path TEXT,package_sha256 TEXT,provenance_json TEXT,fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS manga_pages(id INTEGER PRIMARY KEY,volume_id INTEGER NOT NULL REFERENCES manga_volumes(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,document_path TEXT NOT NULL,text TEXT NOT NULL,UNIQUE(volume_id,ordinal));
    CREATE TABLE IF NOT EXISTS manga_assets(id INTEGER PRIMARY KEY,page_id INTEGER NOT NULL REFERENCES manga_pages(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,entry_path TEXT NOT NULL,declared_mime TEXT NOT NULL,source_url TEXT NOT NULL,cache_state TEXT NOT NULL DEFAULT 'pending',sha256 TEXT,mime TEXT,bytes INTEGER,width INTEGER,height INTEGER,cache_path TEXT,extract_engine TEXT,native_error TEXT,cache_error TEXT,UNIQUE(page_id,ordinal));
    CREATE TABLE IF NOT EXISTS manga_origins(origin TEXT NOT NULL,role TEXT NOT NULL,source_url TEXT NOT NULL,observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(origin,role));`);
  const exists = archive.db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_books'",
    )
    .get();
  if (exists)
    archive.db.run(
      "INSERT OR IGNORE INTO manga_volumes(book_url,title,isbn13) SELECT url,title,isbn13 FROM catalog_books WHERE lower(title) LIKE '%fairy%tail%'",
    );
}

export function publicPreviewLink(
  body: string,
): { url: string; ean: string } | null {
  const match =
    /\[[^\]\n]*(?:Feuilleter|extrait)[^\]\n]*\]\((https:\/\/www\.liseuse-hachette\.fr\/ean\/(97[89]\d{10}))\)/i.exec(
      body,
    );
  return match ? { url: match[1]!, ean: match[2]! } : null;
}
function packageUrl(value: string, ean: string): string {
  const url = new URL(value);
  if (
    url.origin !== MANGA_PREVIEW_ORIGINS[1] ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !new RegExp(`^/Hachette/[0-9]/[0-9]{2}/${ean}\\.epub$`).test(url.pathname)
  )
    throw new Error("Package hors du CDN d'aperçus observé");
  return url.href;
}
async function readerPackage(preview: { url: string; ean: string }) {
  await using view = new Bun.WebView({
    backend: { type: "chrome", url: false },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await view.navigate(preview.url);
        const config = (await view.evaluate(
          "({url:location.href,epubUrl:window.readerConfig?.epubUrl,epubId:window.readerConfig?.epubId})",
        )) as { url?: string; epubUrl?: string; epubId?: string };
        if (
          !config.url ||
          new URL(config.url).origin !== MANGA_PREVIEW_ORIGINS[0] ||
          typeof config.epubUrl !== "string"
        )
          throw new Error("Configuration publique de la liseuse absente");
        return {
          url: packageUrl(config.epubUrl, preview.ean),
          readerUrl: config.url,
          epubId: config.epubId ?? null,
          discovery: "Bun.WebView/public readerConfig",
        };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Liseuse publique: délai25s dépassé")),
          25000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function downloadEpub(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (
    !response.ok ||
    !response.body ||
    !/(?:epub\+zip|octet-stream|zip)/i.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new Error(
      `Package EPUB public indisponible: HTTP ${response.status}`,
    );
  if (Number(response.headers.get("content-length")) > 32 * 1024 * 1024)
    throw new Error("Package public supérieur à32Mio");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 32 * 1024 * 1024)
      throw new Error("Package public supérieur à32Mio");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function storeMangaManifest(
  archive: Archive,
  volumeId: number,
  manifest: EpubManifest,
  source: {
    previewUrl: string;
    previewEan: string;
    epubUrl: string;
    packagePath: string;
    packageHash: string;
    provenance: Record<string, unknown>;
  },
) {
  initManga(archive);
  const volume = archive.db
    .query<BookRow, [number]>("SELECT * FROM manga_volumes WHERE id=?")
    .get(volumeId);
  if (
    !volume ||
    !publisherUrl(volume.book_url) ||
    !/fairy[\s-]*tail/i.test(volume.title)
  )
    throw new Error("Volume non issu du catalogue Pika Fairy Tail");
  const preview = publicPreviewLink(`[Feuilleter](${source.previewUrl})`);
  if (!preview || preview.ean !== source.previewEan)
    throw new Error("Lien d'extrait Pika invalide");
  packageUrl(source.epubUrl, source.previewEan);
  archive.db.transaction(() => {
    if (volume.package_sha256 && volume.package_sha256 !== source.packageHash)
      archive.db
        .query("DELETE FROM manga_pages WHERE volume_id=?")
        .run(volumeId);
    archive.db
      .query(
        "UPDATE manga_volumes SET preview_ean=?,preview_url=?,epub_url=?,language=?,reading_direction=?,state='ready',last_error=NULL,package_path=?,package_sha256=?,provenance_json=?,fetched_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(
        source.previewEan,
        source.previewUrl,
        source.epubUrl,
        manifest.language,
        manifest.readingDirection,
        source.packagePath,
        source.packageHash,
        JSON.stringify({
          ...source.provenance,
          manifestEngine: manifest.engine,
          entries: manifest.entries,
          uncompressedBytes: manifest.uncompressedBytes,
          scope: "public preview; not a complete volume",
        }),
        volumeId,
      );
    for (const [origin, role] of [
      [MANGA_PREVIEW_ORIGINS[0], "public_reader"],
      [MANGA_PREVIEW_ORIGINS[1], "public_preview_package"],
    ])
      archive.db
        .query(
          "INSERT OR IGNORE INTO manga_origins(origin,role,source_url) VALUES(?,?,?)",
        )
        .run(origin!, role!, volume.book_url);
    for (const page of manifest.pages) {
      archive.db
        .query(
          "INSERT INTO manga_pages(volume_id,ordinal,document_path,text) VALUES(?,?,?,?) ON CONFLICT(volume_id,ordinal) DO UPDATE SET document_path=excluded.document_path,text=excluded.text",
        )
        .run(volumeId, page.ordinal, page.documentPath, page.text);
      const row = archive.db
        .query<{ id: number }, [number, number]>(
          "SELECT id FROM manga_pages WHERE volume_id=? AND ordinal=?",
        )
        .get(volumeId, page.ordinal)!;
      for (let i = 0; i < page.assets.length; i++) {
        const asset = page.assets[i]!;
        archive.db
          .query(
            "INSERT INTO manga_assets(page_id,ordinal,entry_path,declared_mime,source_url) VALUES(?,?,?,?,?) ON CONFLICT(page_id,ordinal) DO UPDATE SET entry_path=excluded.entry_path,declared_mime=excluded.declared_mime,source_url=excluded.source_url",
          )
          .run(row.id, i + 1, asset.entryPath, asset.mediaType, source.epubUrl);
      }
    }
  })();
  const readable = manifest.pages.map((p) => p.text).filter(Boolean);
  archive.ingest(
    source.previewUrl,
    `${volume.title} — extrait public`,
    [
      `${manifest.pages.length} pages dans l'extrait public ${source.previewEan}. Source éditeur : ${volume.book_url}`,
      ...readable,
    ].join("\n\n"),
    manifest.language,
  );
}

function owned(path: string, root: string): string {
  const candidate = realpathSync(path),
    suffix = relative(realpathSync(root), candidate);
  if (
    !suffix ||
    suffix === ".." ||
    suffix.startsWith("../") ||
    suffix.startsWith("..\\") ||
    isAbsolute(suffix)
  )
    throw new Error("Chemin hors du cache manga");
  return candidate;
}
function positive(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Identifiant manga invalide");
}

export async function cacheMangaPage(archive: Archive, id: number) {
  positive(id);
  initManga(archive);
  const asset = archive.db
    .query<
      AssetRow & { package_path: string; package_sha256: string },
      [number]
    >(
      "SELECT a.*,v.package_path,v.package_sha256 FROM manga_assets a JOIN manga_pages p ON p.id=a.page_id JOIN manga_volumes v ON v.id=p.volume_id WHERE a.id=? AND v.state='ready'",
    )
    .get(id);
  if (!asset) throw new Error("Image absente d'un extrait public catalogué");
  if (asset.cache_state === "cached" && asset.cache_path) {
    try {
      if (Bun.file(owned(asset.cache_path, CACHE)).size === asset.bytes)
        return {
          id,
          sha256: asset.sha256,
          local_url: `/cdn/manga/${id}`,
          extract_engine: asset.extract_engine,
          native_error: asset.native_error,
        };
    } catch {
      /*repair missing cache*/
    }
  }
  const packagePath = owned(asset.package_path, PACKAGES);
  const bytes = await Bun.file(packagePath).bytes();
  if (
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
    asset.package_sha256
  )
    throw new Error("Empreinte du package EPUB modifiée");
  mkdirSync(CACHE, { recursive: true });
  const staging = resolve(CACHE, `asset-${id}.staging`);
  let extractEngine = "Bun.Archive",
    nativeError: string | null = null;
  try {
    let image: Uint8Array;
    try {
      const files = await new Bun.Archive(bytes).files(asset.entry_path),
        entry = files.get(asset.entry_path);
      if (!entry || entry.size > 8 * 1024 * 1024)
        throw new Error("Entrée d'image EPUB absente ou trop volumineuse");
      image = new Uint8Array(await entry.arrayBuffer());
    } catch (error) {
      nativeError = String(error);
      extractEngine = "bun:python/stdlib:zipfile";
      await using py = await Python.async();
      await py.run(EPUB_HELPERS);
      const base64 = await py.evalJSON<string>(
        `_ft_epub_asset(${pythonArgument({ path: packagePath, entry: asset.entry_path })})`,
      );
      image = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    }
    if (image.byteLength < 1 || image.byteLength > 8 * 1024 * 1024)
      throw new Error("Image hors de la borne1octet–8Mio");
    await Bun.write(staging, image);
    const metadata = await new Bun.Image(staging).metadata();
    const formats: Record<string, { extension: string; mime: string }> = {
      jpeg: { extension: "jpg", mime: "image/jpeg" },
      jpg: { extension: "jpg", mime: "image/jpeg" },
      png: { extension: "png", mime: "image/png" },
      webp: { extension: "webp", mime: "image/webp" },
    };
    const format = formats[metadata.format];
    if (
      !format ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      metadata.width * metadata.height > 40000000
    )
      throw new Error("Format ou dimensions de page non supportés");
    const hash = new Bun.CryptoHasher("sha256").update(image).digest("hex"),
      path = resolve(CACHE, `${hash}.${format.extension}`);
    await Bun.write(path, image);
    archive.db
      .query(
        "UPDATE manga_assets SET cache_state='cached',sha256=?,mime=?,bytes=?,width=?,height=?,cache_path=?,extract_engine=?,native_error=?,cache_error=NULL WHERE id=?",
      )
      .run(
        hash,
        format.mime,
        image.byteLength,
        metadata.width,
        metadata.height,
        path,
        extractEngine,
        nativeError,
        id,
      );
    return {
      id,
      sha256: hash,
      mime: format.mime,
      bytes: image.byteLength,
      width: metadata.width,
      height: metadata.height,
      extract_engine: extractEngine,
      native_error: nativeError,
      local_url: `/cdn/manga/${id}`,
    };
  } catch (error) {
    archive.db
      .query(
        "UPDATE manga_assets SET cache_state='failed',cache_error=?,extract_engine=?,native_error=? WHERE id=?",
      )
      .run(String(error), extractEngine, nativeError, id);
    throw error;
  } finally {
    try {
      unlinkSync(staging);
    } catch {
      /*not written or already removed*/
    }
  }
}

export function mangaStatus(
  archive: Archive,
  options: {
    isbn?: string;
    volumeId?: number;
    offset?: number;
    limit?: number;
  } = {},
) {
  initManga(archive);
  const offset = options.offset ?? 0,
    limit = options.limit ?? 50;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new Error("Pagination manga invalide");
  if (options.isbn !== undefined && !/^97[89]\d{10}$/.test(options.isbn))
    throw new Error("ISBN invalide");
  if (options.volumeId !== undefined) positive(options.volumeId);
  const count = (sql: string) =>
    archive.db.query<{ n: number }, []>(sql).get()!.n;
  const volumes = archive.db
    .query(
      "SELECT id,book_url,title,isbn13,preview_ean,preview_url,epub_url,language,reading_direction,scope,state,last_error,package_sha256,provenance_json,fetched_at FROM manga_volumes WHERE (? IS NULL OR isbn13=? OR preview_ean=?) AND (? IS NULL OR id=?) ORDER BY title LIMIT ? OFFSET ?",
    )
    .all(
      options.isbn ?? null,
      options.isbn ?? null,
      options.isbn ?? null,
      options.volumeId ?? null,
      options.volumeId ?? null,
      limit,
      offset,
    );
  const pageRows = archive.db
    .query<
      {
        id: number;
        volume_id: number;
        ordinal: number;
        document_path: string;
        text: string;
      },
      (string | number | null)[]
    >(
      "SELECT p.* FROM manga_pages p JOIN manga_volumes v ON v.id=p.volume_id WHERE (? IS NULL OR v.isbn13=? OR v.preview_ean=?) AND (? IS NULL OR v.id=?) ORDER BY v.title,p.ordinal LIMIT ? OFFSET ?",
    )
    .all(
      options.isbn ?? null,
      options.isbn ?? null,
      options.isbn ?? null,
      options.volumeId ?? null,
      options.volumeId ?? null,
      limit,
      offset,
    );
  const pages = pageRows.map((page) => ({
    ...page,
    assets: archive.db
      .query<
        Omit<AssetRow, "cache_path" | "page_id"> & {
          ordinal: number;
          declared_mime: string;
          cache_error: string | null;
        },
        [number]
      >(
        "SELECT id,ordinal,entry_path,declared_mime,source_url,cache_state,sha256,mime,bytes,width,height,extract_engine,native_error,cache_error FROM manga_assets WHERE page_id=? ORDER BY ordinal",
      )
      .all(page.id)
      .map((asset) => ({
        ...asset,
        local_url:
          asset.cache_state === "cached" ? `/cdn/manga/${asset.id}` : null,
      })),
  }));
  return {
    counts: {
      volumes: count("SELECT count(*) n FROM manga_volumes"),
      readyVolumes: count(
        "SELECT count(*) n FROM manga_volumes WHERE state='ready'",
      ),
      pages: count("SELECT count(*) n FROM manga_pages"),
      assets: count("SELECT count(*) n FROM manga_assets"),
      cachedAssets: count(
        "SELECT count(*) n FROM manga_assets WHERE cache_state='cached'",
      ),
    },
    volumes,
    pages,
    origins: archive.db
      .query("SELECT * FROM manga_origins ORDER BY origin,role")
      .all(),
    scope: "preview",
    exhaustive: false,
  };
}
export function listMangaPages(
  archive: Archive,
  isbn: string,
  offset = 0,
  limit = 50,
) {
  return mangaStatus(archive, { isbn, offset, limit }).pages;
}

function cachedResponse(
  path: string,
  root: string,
  mime: string,
  hash: string,
  headers?: Headers,
) {
  try {
    const file = Bun.file(owned(path, root)),
      etag = `"${hash}"`,
      responseHeaders = {
        "Content-Type": mime,
        ETag: etag,
        // Numeric asset IDs can be reused after a preview manifest replacement.
        "Cache-Control": "public, no-cache",
        "X-Content-Type-Options": "nosniff",
      };
    if (
      headers
        ?.get("if-none-match")
        ?.split(",")
        .map((v) => v.trim())
        .some((v) => v === etag || v === `W/${etag}` || v === "*")
    )
      return new Response(null, { status: 304, headers: responseHeaders });
    return new Response(file, {
      headers: { ...responseHeaders, "Content-Length": String(file.size) },
    });
  } catch {
    return Response.json(
      { error: "Fichier absent du cache manga" },
      { status: 404 },
    );
  }
}
export function mangaImageResponse(
  archive: Archive,
  id: number,
  headers?: Headers,
): Response {
  if (!Number.isSafeInteger(id) || id < 1)
    return Response.json({ error: "Identifiant invalide" }, { status: 400 });
  initManga(archive);
  const row = archive.db
    .query<AssetRow, [number]>(
      "SELECT * FROM manga_assets WHERE id=? AND cache_state='cached'",
    )
    .get(id);
  if (!row?.cache_path || !row.mime || !row.sha256)
    return Response.json(
      { error: "Image non présente dans le cache manga" },
      { status: 404 },
    );
  return cachedResponse(row.cache_path, CACHE, row.mime, row.sha256, headers);
}
export function mangaPackageResponse(
  archive: Archive,
  isbn: string,
  headers?: Headers,
): Response {
  if (!/^97[89]\d{10}$/.test(isbn))
    return Response.json({ error: "ISBN invalide" }, { status: 400 });
  initManga(archive);
  const volume = archive.db
    .query<BookRow, [string, string]>(
      "SELECT * FROM manga_volumes WHERE (isbn13=? OR preview_ean=?) AND state='ready' ORDER BY id LIMIT 1",
    )
    .get(isbn, isbn);
  if (!volume?.package_path || !volume.package_sha256)
    return Response.json(
      { error: "Extrait EPUB absent du cache" },
      { status: 404 },
    );
  return cachedResponse(
    volume.package_path,
    PACKAGES,
    "application/epub+zip",
    volume.package_sha256,
    headers,
  );
}

export async function collectMangaPreviews(
  archive: Archive,
  options: {
    maxBooks?: number;
    cachePages?: number;
    retryFailed?: boolean;
    signal?: AbortSignal;
  } = {},
) {
  initManga(archive);
  mkdirSync(PACKAGES, { recursive: true });
  const budget = options.maxBooks ?? 3,
    cacheBudget = options.cachePages ?? 3;
  if (
    !Number.isSafeInteger(budget) ||
    budget < 0 ||
    budget > 100 ||
    !Number.isSafeInteger(cacheBudget) ||
    cacheBudget < 0 ||
    cacheBudget > 1000
  )
    throw new Error("Budgets manga invalides");
  if (options.retryFailed)
    archive.db.run(
      "UPDATE manga_volumes SET state='pending' WHERE state='failed'; UPDATE manga_assets SET cache_state='pending' WHERE cache_state='failed'",
    );
  const books = archive.db
    .query<BookRow, [number]>(
      "SELECT * FROM manga_volumes WHERE state='pending' ORDER BY CASE WHEN title LIKE 'Fairy Tail T%' THEN 0 ELSE 1 END,title LIMIT ?",
    )
    .all(budget);
  let processedBooks = 0,
    cachedAssets = 0;
  const errors: { source: string; error: string }[] = [];
  for (const book of books) {
    options.signal?.throwIfAborted();
    try {
      if (!publisherUrl(book.book_url))
        throw new Error("Livre hors du catalogue Pika Fairy Tail");
      const fetched = (await aphrodyWeb(
        ["fetch", book.book_url, "--json"],
        45000,
      )) as {
        body?: string;
        transport?: { status?: number; final_url?: string };
        truncated?: boolean;
      };
      if (
        typeof fetched.body !== "string" ||
        fetched.truncated ||
        fetched.transport?.status !== 200 ||
        publisherUrl(fetched.transport.final_url ?? "") !== book.book_url
      )
        throw new Error("Fiche Pika publique invalide");
      const detail = parsePublisherBook(fetched.body, book.book_url),
        preview = publicPreviewLink(fetched.body);
      archive.ingest(
        book.book_url,
        detail.title,
        [detail.title, detail.synopsis ?? ""].join("\n\n"),
        "fr",
      );
      if (!preview) {
        archive.db
          .query(
            "UPDATE manga_volumes SET state='no_preview',last_error=NULL,fetched_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .run(book.id);
        processedBooks++;
        continue;
      }
      const reader = await readerPackage(preview),
        bytes = await downloadEpub(reader.url),
        hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        path = resolve(PACKAGES, `${hash}.epub`);
      await Bun.write(path, bytes);
      const manifest = await inspectEpub(path);
      storeMangaManifest(archive, book.id, manifest, {
        previewUrl: preview.url,
        previewEan: preview.ean,
        epubUrl: reader.url,
        packagePath: path,
        packageHash: hash,
        provenance: {
          publisher: book.book_url,
          publisherTransport: fetched.transport,
          reader,
          packageBytes: bytes.byteLength,
        },
      });
      processedBooks++;
    } catch (error) {
      archive.db
        .query(
          "UPDATE manga_volumes SET state='failed',last_error=? WHERE id=?",
        )
        .run(String(error), book.id);
      errors.push({ source: book.book_url, error: String(error) });
    }
    await Bun.sleep(1000);
  }
  const assets = archive.db
    .query<{ id: number }, [number]>(
      "SELECT a.id FROM manga_assets a JOIN manga_pages p ON p.id=a.page_id JOIN manga_volumes v ON v.id=p.volume_id WHERE a.cache_state='pending' AND v.state='ready' ORDER BY v.id,p.ordinal,a.ordinal LIMIT ?",
    )
    .all(cacheBudget);
  for (const asset of assets) {
    options.signal?.throwIfAborted();
    try {
      await cacheMangaPage(archive, asset.id);
      cachedAssets++;
    } catch (error) {
      errors.push({ source: `manga-asset:${asset.id}`, error: String(error) });
    }
  }
  const report = {
    processedBooks,
    cachedAssets,
    errors,
    status: mangaStatus(archive),
    scope: "preview",
    exhaustive: false,
  };
  await Bun.write(
    resolve(ROOT, "report.json"),
    JSON.stringify(report, null, 2),
  );
  return report;
}
