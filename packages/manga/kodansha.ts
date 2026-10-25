import { mkdirSync, realpathSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { Archive } from "../archive/index.ts";
import { initManga } from "./index.ts";

export const KODANSHA_SOURCE = "https://www.kodansha.co.jp/titles/1000002520";
export const KODANSHA_CHAPTER =
  "https://pocket.shonenmagazine.com/title/00045/episode/458";
const DISCOVERY =
  "https://pocket.shonenmagazine.com/episode/13932016480029113100";
const CDN = "https://mgpk-cdn.magazinepocket.com",
  CACHE = resolve("data/manga/cache");
type Chapter = {
  url: string;
  title: string;
  author: string;
  episodeId: 458;
  titleId: 45;
  point: number;
  visible: boolean;
};
export type KodanshaManifest = {
  chapter: Chapter;
  pages: string[];
  scrambled: boolean;
  descriptorCount: number;
  direction: unknown;
  source: "Bun.WebView/public reader props";
  chapterComplete: false;
};
type Asset = {
  id: number;
  ordinal: number;
  source_url: string;
  cache_state: string;
  cache_path: string | null;
  sha256: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  extract_engine: string | null;
};
type ScreenshotGeometry = {
  ordinal: number;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  canvas: { width: number; height: number };
  uncovered: boolean;
  imageLoaded: boolean;
  itemCount: number;
};

export function parseKodanshaChapter(html: string): Chapter {
  if (html.length > 2 * 1024 * 1024)
    throw new Error("Page Kodansha trop volumineuse");
  const script =
    /<script\b[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      html,
    )?.[1];
  if (!script) throw new Error("Métadonnées publiques Nuxt absentes");
  const data: unknown = JSON.parse(script);
  if (!Array.isArray(data) || data.length > 20000)
    throw new Error("Métadonnées publiques Nuxt invalides");
  const value = (ref: unknown) =>
    typeof ref === "number" && ref >= 0 ? data[ref] : undefined;
  const objects = data.filter(
    (node): node is Record<string, unknown> =>
      !!node && typeof node === "object" && !Array.isArray(node),
  );
  const episode = objects.find(
    (node) =>
      value(node.title_id) === 45 &&
      value(node.episode_id) === 458 &&
      typeof value(node.episode_name) === "string",
  );
  const title = objects.find(
    (node) =>
      value(node.title_id) === 45 && value(node.title_name) === "FAIRY TAIL",
  );
  if (!episode || !title)
    throw new Error(
      "Le lecteur ne décrit pas le premier chapitre Fairy Tail attendu",
    );
  const point = value(episode.point),
    visible = value(episode.is_page_visible);
  if (typeof point !== "number")
    throw new Error("Tarification du chapitre absente");
  return {
    url: KODANSHA_CHAPTER,
    title: `FAIRY TAIL — ${value(episode.episode_name)}`,
    author:
      typeof value(title.author_text) === "string"
        ? (value(title.author_text) as string)
        : "",
    episodeId: 458,
    titleId: 45,
    point,
    visible: visible === 1,
  };
}
export function kodanshaPageUrl(address: string): string {
  const url = new URL(address);
  if (
    url.origin !== CDN ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/static\/web_titles\/45\/episodes\/458\/[a-f0-9]{64}\.jpg$/.test(
      url.pathname,
    )
  )
    throw new Error("Ressource hors du CDN et du chapitre observés");
  for (const key of url.searchParams.keys())
    if (!["Expires", "Signature", "Key-Pair-Id"].includes(key))
      throw new Error("Paramètre CDN non observé");
  return url.href;
}

const READER_STATE = String.raw`(()=>{const app=document.querySelector('#__nuxt')?.__vue_app__,found=[],seen=new Set;function visit(x,d){if(!x||typeof x!=='object'||d>75||seen.has(x)||seen.size>20000)return;seen.add(x);if(Array.isArray(x.page_list)&&x.title_id===45&&x.episode_id===458)found.push({pages:x.page_list,scrambled:!!x.scramble_seed,descriptorCount:x.descriptor_id_list?.length??0,direction:x.direction});if(Array.isArray(x))x.forEach(z=>visit(z,d+1));else for(const key of ['component','subTree','children','props','webViewer','web_viewer','data','response','suspense','activeBranch','ssContent','dynamicChildren'])visit(x[key],d+1)}visit(app?._container?._vnode,0);return {url:location.href,html:document.querySelector('#__NUXT_DATA__')?.outerHTML,manifest:found[0]??null}})()`;

function captureHistory(archive: Archive): Record<string, unknown>[] {
  const previous = archive.db
    .query<{ provenance_json: string | null }, [string]>(
      "SELECT provenance_json FROM manga_volumes WHERE book_url=?",
    )
    .get(KODANSHA_CHAPTER);
  try {
    const value = JSON.parse(previous?.provenance_json ?? "{}");
    return Array.isArray(value.captures)
      ? value.captures.filter(
          (capture: unknown) => capture && typeof capture === "object",
        )
      : [];
  } catch {
    return [];
  }
}

export function storeKodanshaManifest(
  archive: Archive,
  manifest: KodanshaManifest,
) {
  initManga(archive);
  if (
    manifest.chapter.url !== KODANSHA_CHAPTER ||
    manifest.chapter.point !== 0 ||
    !manifest.chapter.visible
  )
    throw new Error("Seul le chapitre public gratuit observé est accepté");
  if (
    manifest.pages.length < 1 ||
    manifest.pages.length > 500 ||
    manifest.descriptorCount !== 0
  )
    throw new Error(
      "Manifest de pages absent, excessif ou utilisant des descripteurs non pris en charge",
    );
  const pages = manifest.pages.map(kodanshaPageUrl);
  const previousCaptures = captureHistory(archive);
  return archive.db.transaction(() => {
    archive.db
      .query(
        "INSERT INTO manga_volumes(book_url,title,preview_url,language,scope,state,provenance_json,fetched_at) VALUES(?,?,?,'ja','preview','manifest_only',?,CURRENT_TIMESTAMP) ON CONFLICT(book_url) DO UPDATE SET title=excluded.title,preview_url=excluded.preview_url,language='ja',scope='preview',provenance_json=excluded.provenance_json,fetched_at=CURRENT_TIMESTAMP,last_error=NULL",
      )
      .run(
        KODANSHA_CHAPTER,
        manifest.chapter.title,
        KODANSHA_CHAPTER,
        JSON.stringify({
          publisher: KODANSHA_SOURCE,
          discoveredLink: DISCOVERY,
          manifest,
          variant: "public-reader-manifest",
          readableCachedPages: [],
          captures: previousCaptures,
          signedPageUrls: pages.every((url) =>
            new URL(url).searchParams.has("Signature"),
          ),
          volumeComplete: false,
          chapterComplete: false,
        }),
      );
    const volume = archive.db
      .query<{ id: number }, [string]>(
        "SELECT id FROM manga_volumes WHERE book_url=?",
      )
      .get(KODANSHA_CHAPTER)!;
    archive.db
      .query("DELETE FROM manga_pages WHERE volume_id=? AND ordinal>?")
      .run(volume.id, pages.length);
    archive.db
      .query(
        "INSERT OR REPLACE INTO manga_origins(origin,role,source_url) VALUES(?,?,?)",
      )
      .run(
        new URL(KODANSHA_CHAPTER).origin,
        "kodansha-public-reader",
        KODANSHA_SOURCE,
      );
    archive.db
      .query(
        "INSERT OR REPLACE INTO manga_origins(origin,role,source_url) VALUES(?,?,?)",
      )
      .run(CDN, "kodansha-page-manifest", KODANSHA_CHAPTER);
    for (const [index, url] of pages.entries()) {
      const ordinal = index + 1;
      archive.db
        .query(
          "INSERT INTO manga_pages(volume_id,ordinal,document_path,text) VALUES(?,?,?,?) ON CONFLICT(volume_id,ordinal) DO UPDATE SET document_path=excluded.document_path",
        )
        .run(volume.id, ordinal, `${KODANSHA_CHAPTER}#page-${ordinal}`, "");
      const page = archive.db
        .query<{ id: number }, [number, number]>(
          "SELECT id FROM manga_pages WHERE volume_id=? AND ordinal=?",
        )
        .get(volume.id, ordinal)!;
      archive.db
        .query(
          "INSERT INTO manga_assets(page_id,ordinal,entry_path,declared_mime,source_url,cache_state,cache_error) VALUES(?,1,?,'image/jpeg',?,'reader_only',?) ON CONFLICT(page_id,ordinal) DO UPDATE SET cache_state=CASE WHEN substr(manga_assets.source_url,1,instr(manga_assets.source_url||'?','?')-1)=substr(excluded.source_url,1,instr(excluded.source_url||'?','?')-1) THEN manga_assets.cache_state ELSE 'reader_only' END,source_url=excluded.source_url",
        )
        .run(
          page.id,
          `kodansha-reader/458/page-${ordinal}`,
          url,
          manifest.scrambled
            ? "CDN original obfusqué ; seule une capture normale du lecteur peut être proposée"
            : "Ressource observée dans le manifest, non acquise",
        );
    }
    return volume.id;
  })();
}

export function readableKodanshaScreenshot(
  geometry: ScreenshotGeometry,
): boolean {
  const { rect: r, viewport: v, canvas: c } = geometry;
  return (
    geometry.ordinal >= 1 &&
    geometry.ordinal <= 3 &&
    geometry.uncovered &&
    geometry.imageLoaded &&
    geometry.itemCount >= 82 &&
    c.width > 0 &&
    c.height > 0 &&
    [r.x, r.y, r.width, r.height, v.width, v.height].every(Number.isFinite) &&
    r.width >= 300 &&
    r.height >= 400 &&
    r.x >= -0.5 &&
    r.y >= -0.5 &&
    r.x + r.width <= v.width + 0.5 &&
    r.y + r.height <= v.height + 0.5 &&
    Math.abs(r.width / r.height - c.width / c.height) < 0.03
  );
}

function geometryScript(ordinal: number, sourceUrl: string) {
  return `(()=>{const items=[...document.querySelectorAll('.c-viewer__pages-item')],item=items[${ordinal}],canvas=item?.querySelector('.c-viewer__comic-item-image canvas');if(!items[0]?.querySelector('.c-viewer__first')||!canvas)return null;const r=canvas.getBoundingClientRect(),source=new URL(${JSON.stringify(sourceUrl)});function clear(x,y){let e=document.elementFromPoint(x,y);if(e&&canvas.parentElement.contains(e))return true;for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.opacity==='0'||s.visibility==='hidden')return true;}return false;}return {ordinal:${ordinal},rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},canvas:{width:canvas.width,height:canvas.height},imageLoaded:performance.getEntriesByType('resource').some(e=>{const u=new URL(e.name);return u.origin===source.origin&&u.pathname===source.pathname&&e.responseEnd>0}),uncovered:[[.1,.1],[.9,.1],[.5,.5],[.1,.9],[.9,.9]].every(([x,y])=>clear(r.x+r.width*x,r.y+r.height*y)),itemCount:items.length}})()`;
}

async function screenshotPage(
  archive: Archive,
  view: Bun.WebView,
  asset: Asset,
  geometry: ScreenshotGeometry,
) {
  if (!readableKodanshaScreenshot(geometry))
    throw new Error(
      "La page n’est pas entièrement visible, lisible et vérifiable dans le lecteur",
    );
  mkdirSync(CACHE, { recursive: true });
  const screenshot = resolve(
      CACHE,
      `.kodansha-view-${crypto.randomUUID()}.png`,
    ),
    crop = resolve(CACHE, `.kodansha-page-${crypto.randomUUID()}.png`);
  try {
    await Bun.write(screenshot, new Response(await view.screenshot()));
    const metadata = await new Bun.Image(screenshot).metadata();
    const sx = metadata.width / geometry.viewport.width,
      sy = metadata.height / geometry.viewport.height;
    if (Math.abs(sx - sy) > 0.02)
      throw new Error("Échelle du screenshot incohérente avec le viewport");
    const rect = {
      left: Math.max(0, Math.round(geometry.rect.x * sx)),
      top: Math.max(0, Math.round(geometry.rect.y * sy)),
      width: Math.round(geometry.rect.width * sx),
      height: Math.round(geometry.rect.height * sy),
    };
    await new Bun.Image(screenshot).extract(rect).png().write(crop);
    const image = await Bun.file(crop).bytes(),
      actual = await new Bun.Image(crop).metadata();
    if (
      actual.width < 300 ||
      actual.height < 400 ||
      image.length < 4096 ||
      image.length > 8 * 1024 * 1024
    )
      throw new Error("Capture de page hors des limites de lecture");
    const sha256 = new Bun.CryptoHasher("sha256").update(image).digest("hex"),
      path = resolve(CACHE, `${sha256}.png`);
    await Bun.write(path, image);
    const proof = {
      assetId: asset.id,
      ordinal: asset.ordinal,
      sha256,
      mime: "image/png",
      width: actual.width,
      height: actual.height,
      sourceUrl: asset.source_url,
      localUrl: `/cdn/manga/${asset.id}`,
      variant: "browser-rendered",
      extractEngine: "Bun.WebView browser screenshot",
      geometry,
      capturedAt: new Date().toISOString(),
      screenshotSha256: new Bun.CryptoHasher("sha256")
        .update(await Bun.file(screenshot).bytes())
        .digest("hex"),
    };
    archive.db.transaction(() => {
      archive.db
        .query(
          "UPDATE manga_assets SET cache_state='cached',sha256=?,mime='image/png',bytes=?,width=?,height=?,cache_path=?,extract_engine='Bun.WebView browser screenshot',native_error=NULL,cache_error=NULL WHERE id=?",
        )
        .run(sha256, image.length, actual.width, actual.height, path, asset.id);
      const volume = archive.db
        .query<{ id: number; provenance_json: string | null }, [number]>(
          "SELECT v.id,v.provenance_json FROM manga_volumes v JOIN manga_pages p ON p.volume_id=v.id JOIN manga_assets a ON a.page_id=p.id WHERE a.id=?",
        )
        .get(asset.id)!;
      const provenance = JSON.parse(volume.provenance_json ?? "{}");
      provenance.captures = [
        ...captureHistory(archive).filter(
          (previous) => previous.ordinal !== proof.ordinal,
        ),
        proof,
      ];
      provenance.readableCachedPages = archive.db
        .query<
          {
            id: number;
            ordinal: number;
            extract_engine: string;
            sha256: string;
          },
          [number]
        >(
          "SELECT a.id,p.ordinal,a.extract_engine,a.sha256 FROM manga_assets a JOIN manga_pages p ON p.id=a.page_id WHERE p.volume_id=? AND a.cache_state='cached' ORDER BY p.ordinal",
        )
        .all(volume.id);
      provenance.chapterComplete = false;
      provenance.volumeComplete = false;
      archive.db
        .query(
          "UPDATE manga_volumes SET state='ready',provenance_json=? WHERE id=?",
        )
        .run(JSON.stringify(provenance), volume.id);
    })();
    return proof;
  } finally {
    for (const path of [screenshot, crop])
      try {
        unlinkSync(path);
      } catch {
        /* own staging file */
      }
  }
}

export async function collectKodanshaChapter(
  archive: Archive,
  options: { cachePages?: number } = {},
) {
  const budget = options.cachePages ?? 3;
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 3)
    throw new Error(
      "cachePages: entier entre 0 et 3 pour les pages publiquement vérifiées",
    );
  initManga(archive);
  await using view = new Bun.WebView({
    backend: { type: "chrome", url: false },
    width: 1100,
    height: 1800,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const errors: { page?: number; error: string }[] = [];
  try {
    return await Promise.race([
      (async () => {
        await view.navigate(DISCOVERY);
        let observed:
          | {
              url: string;
              html?: string;
              manifest?: Omit<
                KodanshaManifest,
                "chapter" | "source" | "chapterComplete"
              > | null;
            }
          | undefined;
        for (let attempt = 0; attempt < 30; attempt++) {
          observed = (await view.evaluate(READER_STATE)) as typeof observed;
          if (observed?.manifest) break;
          await Bun.sleep(300);
        }
        if (
          observed?.url !== KODANSHA_CHAPTER ||
          !observed.html ||
          !observed.manifest
        )
          throw new Error(
            "Le manifest du lecteur public Kodansha ne s’est pas chargé",
          );
        const chapter = parseKodanshaChapter(observed.html),
          manifest: KodanshaManifest = {
            chapter,
            ...observed.manifest,
            source: "Bun.WebView/public reader props",
            chapterComplete: false,
          };
        const previousCaptures = captureHistory(archive);
        const volumeId = storeKodanshaManifest(archive, manifest);
        const captures = [];
        if (budget > 0) {
          await Bun.sleep(1200);
          // Keep optional consent ungranted; interact only with the normal public reader.
          if (
            await view.evaluate(
              "!!document.querySelector('.fc-cta-manage-options')",
            )
          ) {
            await view.click(".fc-cta-manage-options");
            await view.click(".fc-confirm-choices");
          }
          if (
            await view.evaluate(
              "(()=>{const r=document.querySelector('#onetrust-reject-all-handler')?.getBoundingClientRect();return !!r&&r.width>0&&r.height>0})()",
            )
          )
            await view.click("#onetrust-reject-all-handler");
          await Bun.sleep(1200);
          for (let ordinal = 1; ordinal <= budget; ordinal++) {
            try {
              if (ordinal === 2) {
                await view.press("ArrowLeft");
                await Bun.sleep(700);
              }
              const asset = archive.db
                .query<Asset, [number, number]>(
                  "SELECT a.*,p.ordinal FROM manga_assets a JOIN manga_pages p ON p.id=a.page_id WHERE p.volume_id=? AND p.ordinal=? AND a.ordinal=1",
                )
                .get(volumeId, ordinal)!;
              if (asset.cache_state === "cached" && asset.cache_path) {
                try {
                  realpathSync(asset.cache_path);
                  continue;
                } catch {
                  /* recapture a missing cached file */
                }
              }
              const geometry = (await view.evaluate(
                geometryScript(ordinal, asset.source_url),
              )) as ScreenshotGeometry | null;
              if (!geometry)
                throw new Error(
                  "Ordre de la page non vérifiable dans le DOM du lecteur",
                );
              captures.push(
                await screenshotPage(archive, view, asset, geometry),
              );
            } catch (e) {
              errors.push({ page: ordinal, error: String(e) });
            }
          }
        }
        const cached = archive.db
          .query<
            {
              id: number;
              ordinal: number;
              extract_engine: string;
              sha256: string;
            },
            [number]
          >(
            "SELECT a.id,p.ordinal,a.extract_engine,a.sha256 FROM manga_assets a JOIN manga_pages p ON p.id=a.page_id WHERE p.volume_id=? AND a.cache_state='cached' ORDER BY p.ordinal",
          )
          .all(volumeId);
        archive.db
          .query(
            "UPDATE manga_volumes SET state=?,provenance_json=? WHERE id=?",
          )
          .run(
            cached.length ? "ready" : "manifest_only",
            JSON.stringify({
              publisher: KODANSHA_SOURCE,
              discoveredLink: DISCOVERY,
              manifest,
              variant: "public-reader-manifest",
              readableCachedPages: cached,
              captures: [
                ...new Map(
                  [...previousCaptures, ...captures].map((capture) => [
                    capture.ordinal,
                    capture,
                  ]),
                ).values(),
              ].filter((capture) =>
                cached.some((asset) => asset.ordinal === capture.ordinal),
              ),
              signedPageUrls: manifest.pages.every((url) =>
                new URL(url).searchParams.has("Signature"),
              ),
              volumeComplete: false,
              chapterComplete: false,
            }),
            volumeId,
          );
        const report = {
          volumeId,
          chapterUrl: KODANSHA_CHAPTER,
          title: chapter.title,
          language: "ja",
          manifestPages: manifest.pages.length,
          cachedReadablePages: cached.length,
          capturedThisRun: captures,
          originalCdnObfuscated: manifest.scrambled,
          errors,
          scope: "preview",
          chapterComplete: false,
          volumeComplete: false,
        };
        mkdirSync("data/manga", { recursive: true });
        await Bun.write(
          "data/manga/kodansha-report.json",
          JSON.stringify(report, null, 2),
        );
        return report;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Lecteur public Kodansha : délai45s dépassé")),
          45000,
        );
      }),
    ]);
  } catch (e) {
    archive.db
      .query("UPDATE manga_volumes SET last_error=? WHERE book_url=?")
      .run(String(e), KODANSHA_CHAPTER);
    throw new Error(`Collecte Kodansha impossible : ${String(e)}`, {
      cause: e,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function cacheKodanshaAsset(archive: Archive, id: number) {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Identifiant de page invalide");
  initManga(archive);
  const asset = archive.db
    .query<Asset & { book_url: string }, [number]>(
      "SELECT a.*,p.ordinal,v.book_url FROM manga_assets a JOIN manga_pages p ON p.id=a.page_id JOIN manga_volumes v ON v.id=p.volume_id WHERE a.id=?",
    )
    .get(id);
  if (!asset || asset.book_url !== KODANSHA_CHAPTER || asset.ordinal > 3)
    throw new Error(
      "Seules les trois premières pages publiques vérifiées sont prises en charge",
    );
  const report = await collectKodanshaChapter(archive, {
    cachePages: asset.ordinal,
  });
  const cached = archive.db
    .query<Asset, [number]>(
      "SELECT * FROM manga_assets WHERE id=? AND cache_state='cached'",
    )
    .get(id);
  if (!cached)
    throw new Error(`Page non acquise : ${JSON.stringify(report.errors)}`);
  return {
    ...cached,
    ordinal: asset.ordinal,
    variant: "browser-rendered",
    local_url: `/cdn/manga/${id}`,
  };
}
