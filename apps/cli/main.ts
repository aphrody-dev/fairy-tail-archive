import { Archive } from "../../packages/archive/index.ts";
import {
  collectAnimeCatalog,
  animeCatalogStatus,
  listAnimeWorks,
  getAnimeWork,
} from "../../packages/anime-catalog/index.ts";
import {
  collectAnimeArcs,
  listAnimeArcs,
} from "../../packages/anime-catalog/arcs.ts";
import {
  syncOfficialAnimeEpisodes,
  syncFandomEpisodeGuide,
} from "../../packages/anime-catalog/official.ts";
import {
  mediaCapabilities,
  executeMediaConversion,
  planMediaConversion,
} from "../../packages/video/capabilities.ts";
import { mkdirSync } from "node:fs";
import { crawl } from "../../packages/crawler/index.ts";
import { crawlWeb, probeWeb } from "../../packages/crawler/web.ts";
import { sources } from "../../packages/crawler/sources.ts";
import {
  seedWiki,
  enumerateWiki,
  crawlWiki,
} from "../../packages/crawler/wiki.ts";
import {
  collectPublisher,
  publisherStatus,
} from "../../packages/crawler/publisher.ts";
import { ask } from "../../packages/rag/index.ts";
import { indexEpisode } from "../../packages/video/index.ts";
import { importStream } from "../../packages/streams/import.ts";
import { buildIndex, indexStatus } from "../../packages/search-index/index.ts";
import {
  nativeStatus,
  hybridSearch,
  exportCorpus,
} from "../../packages/native-ai/index.ts";
import { chunkWithShenron } from "../../packages/native-ai/shenron.ts";
import { buildScenes, sceneCatalog } from "../../packages/scene/index.ts";
import { koharuStatus } from "../../packages/scene/koharu.ts";
import {
  collectStreams,
  streamCatalog,
  probeHls,
  parseStreamKind,
} from "../../packages/streams/index.ts";
import { collectKodanshaChapter } from "../../packages/manga/kodansha.ts";
import {
  collectMangaPreviews,
  mangaStatus,
  cacheMangaPage,
} from "../../packages/manga/index.ts";
import {
  libraryOverview,
  listMangaVolumes,
  animeCatalog,
  wikiDocuments,
} from "../../packages/library/index.ts";
import {
  collectFancaps,
  fancapsStatus,
  cacheFancapsImage,
} from "../../packages/video/fancaps.ts";
import {
  catalogueVideoSources,
  mediaCatalog,
  linkLocalEpisode,
} from "../../packages/video/sources.ts";

const [command, ...args] = Bun.argv.slice(2);
const archive = new Archive();
try {
  let result: unknown;
  switch (command) {
    case "anime-sync":
      result = await collectAnimeCatalog(archive, {
        maxPages: Number(args[0] ?? 20),
      });
      break;
    case "anime-catalog-status":
      result = animeCatalogStatus(archive);
      break;
    case "anime-works":
      result = listAnimeWorks(archive, {
        limit: Number(args[0] ?? 20),
        offset: Number(args[1] ?? 0),
      });
      break;
    case "anime-work":
      result = getAnimeWork(archive, args[0] ?? "", {
        limit: Number(args[1] ?? 100),
        offset: Number(args[2] ?? 0),
      });
      break;
    case "anime-arcs-sync":
      result = await collectAnimeArcs(archive, {
        maxPages: Number(args[0] ?? 3),
      });
      break;
    case "anime-official-sync":
      result = await syncOfficialAnimeEpisodes(archive);
      break;
    case "anime-wiki-episodes-sync":
      result = await syncFandomEpisodeGuide(archive);
      break;
    case "anime-arcs":
      result = listAnimeArcs(archive, { lang: args[0], limit: 100 });
      break;
    case "media-capabilities":
      result = mediaCapabilities();
      break;
    case "media-plan":
      result = await planMediaConversion(archive, args[0] ?? "", {
        operation: args[1] as "remux" | "hls" | "transcode" | undefined,
        format: args[2],
      });
      break;
    case "media-remux":
      result = await executeMediaConversion(archive, args[0] ?? "", {
        operation: "remux",
        format: "mp4",
      });
      break;
    case "index":
      result = {
        reindexed: archive.reindex(),
        index: await buildIndex(archive),
      };
      break;
    case "index-status":
      result = await indexStatus(archive);
      break;
    case "native-status":
      result = await nativeStatus();
      break;
    case "scene-build":
      result = await buildScenes(archive, { maxSources: Number(args[0] ?? 8) });
      break;
    case "streams-sync":
      result = await collectStreams(archive, {
        maxVideos: Number(args[0] ?? 20),
      });
      break;
    case "streams":
      result = streamCatalog(archive, {
        provider: args[0],
        kind: parseStreamKind(args[1]),
      });
      break;
    case "stream-probe-hls":
      if (!args[0]) throw new Error("stream-probe-hls <registered-id-or-url>");
      result = await probeHls(
        archive,
        /^[0-9]+$/.test(args[0]) ? Number(args[0]) : args[0],
      );
      break;
    case "stream-import":
      if (!args[0] || !/^[1-9][0-9]*$/.test(args[0]))
        throw new Error("stream-import <registered-public-mp4-id>");
      result = await importStream(archive, Number(args[0]));
      break;
    case "manga-kodansha":
      result = await collectKodanshaChapter(archive, {
        cachePages: Number(args[0] ?? 3),
      });
      break;
    case "scene-status":
      result = { scenes: sceneCatalog(archive), koharu: await koharuStatus() };
      break;
    case "native-search":
      result = await hybridSearch(archive, args.join(" "));
      break;
    case "native-export":
      result = await exportCorpus(
        archive,
        args[0] ?? "data/exports/fairy-tail.jsonl",
      );
      break;
    case "native-chunk":
      if (!args[0]) throw new Error("native-chunk <markdown-file>");
      result = await chunkWithShenron(await Bun.file(args[0]).text());
      break;
    case "manga-import":
      result = await collectMangaPreviews(archive, {
        maxBooks: Number(args[0] ?? 3),
        cachePages: Number(args[1] ?? 3),
      });
      break;
    case "manga-status":
      result = mangaStatus(archive, { isbn: args[0] });
      break;
    case "manga-cache":
      result = await cacheMangaPage(archive, Number(args[0]));
      break;
    case "library":
      result = libraryOverview(archive);
      break;
    case "manga":
      result = listMangaVolumes(archive, { q: args.join(" ") });
      break;
    case "anime":
      result = await animeCatalog(archive, { q: args.join(" ") });
      break;
    case "wiki-documents":
      result = wikiDocuments(archive, { q: args.join(" ") });
      break;
    case "setup": {
      mkdirSync("data/media", { recursive: true });
      const books = publisherStatus(archive),
        videos = mediaCatalog(archive),
        fancaps = fancapsStatus(archive);
      archive.reindex();
      const index = await buildIndex(archive);
      result = {
        stats: archive.stats(),
        books,
        videos: videos.sources,
        videoItems: videos.items.length,
        fancaps,
        index,
      };
      break;
    }
    case "init":
      mkdirSync("data/media", { recursive: true });
      result = archive.stats();
      break;
    case "stats":
      result = archive.stats();
      break;
    case "coverage":
      result = {
        stats: archive.stats(),
        languages: archive.db
          .query(
            "SELECT language, count(*) documents FROM documents GROUP BY language",
          )
          .all(),
      };
      break;
    case "import": {
      if (!args[0]) throw new Error("import <documents.json>");
      const docs = await Bun.file(args[0]).json();
      if (!Array.isArray(docs)) throw new Error("Un tableau JSON est requis");
      for (const doc of docs) {
        if (
          !doc ||
          ![doc.url, doc.title, doc.text].every((v) => typeof v === "string")
        )
          throw new Error("Document: url, title, text requis");
        archive.ingest(doc.url, doc.title, doc.text);
      }
      result = archive.stats();
      break;
    }
    case "search":
      result = archive.search(args.join(" "));
      break;
    case "sources":
      result = sources;
      break;
    case "video-sources":
      result = await catalogueVideoSources(archive, {
        youtubePages: Number(args[0] ?? 5),
      });
      break;
    case "video-catalog":
      result = mediaCatalog(archive);
      break;
    case "link-video": {
      if (!args[0] || !args[1] || !args[2])
        throw new Error("link-video <provider> <item-key> <episode-id>");
      result = linkLocalEpisode(archive, args[0], args[1], args[2]);
      break;
    }
    case "wiki-seed":
      result = await seedWiki(archive);
      break;
    case "wiki-crawl":
      result = await crawlWiki(archive, {
        maxPages: Number(args[0] ?? 50),
        sourceIds: args[1] ? [args[1]] : undefined,
      });
      break;
    case "pika":
      result = await collectPublisher(archive, {
        maxRequests: Number(args[0] ?? 25),
      });
      break;
    case "fancaps":
      result = await collectFancaps(archive, {
        maxPages: Number(args[0] ?? 5),
        cacheImages: Number(args[1] ?? 4),
      });
      break;
    case "fancaps-status":
      result = fancapsStatus(archive);
      break;
    case "fancaps-cache":
      result = await cacheFancapsImage(archive, Number(args[0]));
      break;
    case "pika-status":
      result = publisherStatus(archive);
      break;
    case "wiki-query": {
      const id = args[0];
      if (!id || !args[1])
        throw new Error("wiki-query <source> <requête> [limite=20]");
      result = await seedWiki(archive, {
        sourceIds: [id],
        queries: { [id]: [args[1]] },
        searchLimit: Number(args[2] ?? 20),
      });
      break;
    }
    case "wiki":
      result = await enumerateWiki(
        archive,
        args[0] ?? "fandom-fr",
        Number(args[1] ?? 200),
        args[2],
      );
      break;
    case "web":
      result = await crawlWeb(archive, Number(args[0] ?? 100), args[1]);
      break;
    case "probe":
      if (!args[0]) throw new Error("probe <URL>");
      result = await probeWeb(args[0]);
      break;
    case "ask":
      {
        const language = args.find((value) => value.startsWith("--lang="));
        result = await ask(
          archive,
          args.filter((value) => value !== language).join(" "),
          language?.slice(7),
        );
      }
      break;
    case "crawl":
      result = await crawl(archive, {
        maxPages: Number(args[0] ?? 20),
        host: args[1],
      });
      break;
    case "episode": {
      if (!args[0]) throw new Error("episode <fichier.mp4>");
      result = await indexEpisode(archive, args[0]);
      break;
    }
    case "episodes": {
      const results = [];
      for await (const file of new Bun.Glob("**/*.mp4").scan("data/media"))
        results.push(await indexEpisode(archive, `data/media/${file}`));
      result = results;
      break;
    }
    default:
      result = {
        usage: [
          "init",
          "setup",
          "index",
          "index-status",
          "native-status",
          "native-search <query>",
          "native-export [file.jsonl]",
          "native-chunk <file.md>",
          "library",
          "anime-sync [pages=20]",
          "anime-catalog-status",
          "anime-works [limit=20] [offset=0]",
          "anime-work <id> [limit=100] [offset=0]",
          "anime-arcs-sync [sources=3]",
          "anime-official-sync",
          "anime-wiki-episodes-sync",
          "anime-arcs [fr|en|ja]",
          "media-capabilities",
          "media-plan <episode-id> [remux|hls|transcode] [format]",
          "media-remux <episode-id>",
          "manga [query]",
          "anime [query]",
          "wiki-documents [query]",
          "manga-import [books=3] [pages à cacher=3]",
          "manga-kodansha",
          "streams-sync [videos=20]",
          "streams [provider]",
          "stream-import <registered-public-mp4-id>",
          "stream-probe-hls <registered-observed-url>",
          "coverage",
          "scene-build [sources=8]",
          "scene-status",
          "manga-status [isbn]",
          "manga-cache <asset-id>",
          "stats",
          "wiki-seed",
          "wiki-crawl [budget=50] [source]",
          "pika [budget=25]",
          "pika-status",
          "fancaps [pages=5] [images à cacher=4]",
          "fancaps-status",
          "fancaps-cache <id>",
          "wiki-query <source> <requête> [limite=20]",
          "wiki <fandom-fr|fandom-en|wikipedia-ja> [budget=200] [préfixe]",
          "sources",
          "video-sources [pages YouTube=5]",
          "video-catalog",
          "link-video <provider> <item-key> <episode-id>",
          "web [budget=100] [source-id]",
          "probe <URL>",
          "import <documents.json>",
          "crawl [maxPages=20] [fairytail.fandom.com[/fr]]",
          "search <texte>",
          "ask <question>",
          "episode <data/media/episode.mp4>",
          "episodes",
        ],
      };
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  archive.close();
}
