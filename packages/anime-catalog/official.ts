import type { Archive } from "../archive/index.ts";

type Observation = {
  workKey: "fairy-tail" | "fairy-tail-100yq";
  source: string;
  key: string;
  number: number | null;
  title: string;
  summary: string;
  airDate: string | null;
  language: "ja";
};

const TOKYO = "https://www.tv-tokyo.co.jp/anime/";
const FINAL = "https://www.fairytail-tv.com/story/list.php";
const QUEST = "https://www.fairytail100yq.com/story/";
const decode = (value: string) =>
  value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();

async function page(url: string) {
  const origin = new URL(url).origin;
  if (
    !new Set([
      "https://www.tv-tokyo.co.jp",
      "https://www.fairytail-tv.com",
      "https://www.fairytail100yq.com",
    ]).has(origin)
  )
    throw new Error(`Official anime source outside allowlist: ${url}`);
  const response = await fetch(url, {
    redirect: "error",
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const html = await response.text();
  if (html.length > 4_000_000)
    throw new Error(`Official page exceeds size limit: ${url}`);
  return html;
}

function tvTokyo(html: string, source: string): Observation[] {
  const result: Observation[] = [];
  for (const [, block] of html.matchAll(
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
  )) {
    const title =
      /class=["']entrytit["'][^>]*>([\s\S]*?)<\//i.exec(block)?.[1] ?? "";
    const number = /第\s*(\d+)\s*話/.exec(title)?.[1];
    if (!number) continue;
    const dateText = decode(
      /class=["']entrydate["'][^>]*>([\s\S]*?)<\//i.exec(block)?.[1] ?? "",
    );
    result.push({
      workKey: "fairy-tail",
      source,
      key: `tv-tokyo:${number}`,
      number: Number(number),
      title: decode(title),
      summary: decode(
        /class=["']entrytxt["'][^>]*>([\s\S]*?)<\//i.exec(block)?.[1] ?? "",
      ),
      airDate: /\d{4}[./年-]\d{1,2}[./月-]\d{1,2}/.exec(dateText)?.[0] ?? null,
      language: "ja",
    });
  }
  if (result.length) return result;
  const markers = [
    ...html.matchAll(/class=["'](?:c_)?ttl["'][^>]*>([\s\S]*?)<\/div>/gi),
  ];
  for (let i = 0; i < markers.length; i++) {
    const match = markers[i]!;
    const block = html.slice(
      match.index!,
      markers[i + 1]?.index ?? html.length,
    );
    const number = /第\s*(\d+)\s*話/.exec(match[1]!)?.[1];
    if (!number) continue;
    const dateText = decode(
      /class=["']day["'][^>]*>([\s\S]*?)<\//i.exec(block)?.[1] ?? "",
    );
    result.push({
      workKey: "fairy-tail",
      source,
      key: `tv-tokyo:${number}`,
      number: Number(number),
      title: decode(match[1]!),
      summary: decode(
        /class=["'](?:c_)?txt["'][^>]*>([\s\S]*?)<\//i.exec(block)?.[1] ?? "",
      ),
      airDate: /\d{4}[./年-]\d{1,2}[./月-]\d{1,2}/.exec(dateText)?.[0] ?? null,
      language: "ja",
    });
  }
  return result;
}

function dvdEpisodes(html: string, source: string): Observation[] {
  const result: Observation[] = [];
  for (const match of html.matchAll(
    /(?:^|\n|\s)(\d+)話\s*[「「]([^」\n<]+)[」]/g,
  )) {
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number < 1 || number > 328) continue;
    result.push({
      workKey: "fairy-tail",
      source,
      key: `dvd:${number}`,
      number,
      title: `第${number}話 ${decode(match[2]!)}`,
      summary: "",
      airDate: null,
      language: "ja",
    });
  }
  return result;
}

function finalSeries(html: string): Observation[] {
  const result: Observation[] = [];
  const markers = [
    ...html.matchAll(
      /class=['"]story-item-ttl0['"][^>]*>\s*第\s*(\d+)\s*話[\s\S]*?<\/span>/gi,
    ),
  ];
  for (let i = 0; i < markers.length; i++) {
    const match = markers[i]!;
    const blockStart = html.lastIndexOf("story-item click hover", match.index!);
    const block = html.slice(
      Math.max(0, blockStart),
      markers[i + 1]?.index ?? html.length,
    );
    const href = /href=['"]([^'"]*detail\.php\?id=[^'"]+)/i.exec(block)?.[1];
    const number = match[1];
    if (!href || !number) continue;
    const title = /story-item-ttl1[^>]*>([\s\S]*?)<\//i.exec(block)?.[1] ?? "";
    const summary = /story-item-txt[^>]*>([\s\S]*?)<\//i.exec(block)?.[1] ?? "";
    result.push({
      workKey: "fairy-tail",
      source: new URL(href, FINAL).href,
      key: `final:${number}`,
      number: Number(number),
      title: `第${number}話 ${decode(title)}`,
      summary: decode(summary),
      airDate: null,
      language: "ja",
    });
  }
  return result;
}

function questListing(html: string): Observation[] {
  const result: Observation[] = [];
  for (const [, href, block] of html.matchAll(
    /<li class="contents__list__row"><a href="([^"]+)">([\s\S]*?)<\/a><\/li>/gi,
  )) {
    const number = /<p>\s*#(\d+)\s*<\/p>/i.exec(block)?.[1] ?? null;
    const title =
      /class="contents__list--title"[^>]*>([\s\S]*?)<\//i.exec(block)?.[1] ??
      "";
    if (!number && !/Lucy.s diary|総集編/i.test(title)) continue;
    result.push({
      workKey: "fairy-tail-100yq",
      source: new URL(href, QUEST).href,
      key: number ? `100yq:${number}` : `100yq:special:${decode(title)}`,
      number: number ? Number(number) : null,
      title: decode(title),
      summary: "",
      airDate: null,
      language: "ja",
    });
  }
  return result;
}

function questDetail(html: string) {
  const title = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "";
  const summary =
    /(?:class="story__text"|class="story_text"|class="text"|<h1[^>]*>[\s\S]*?<\/h1>)([\s\S]*?)(?:<\/main>|<footer)/i.exec(
      html,
    )?.[1] ?? "";
  return { title: decode(title), summary: decode(summary) };
}

function init(archive: Archive) {
  archive.db.run(`CREATE TABLE IF NOT EXISTS anime_official_episode_sources(
    source_url TEXT NOT NULL, work_key TEXT NOT NULL, item_key TEXT NOT NULL,
    episode_number INTEGER, title TEXT NOT NULL, summary TEXT NOT NULL,
    air_date TEXT, language TEXT NOT NULL, source_hash TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(source_url,work_key,item_key));`);
  archive.db.run(`CREATE TABLE IF NOT EXISTS anime_episode_wiki_sources(
    source_url TEXT NOT NULL, source_revision INTEGER NOT NULL, work_key TEXT NOT NULL,
    item_key TEXT NOT NULL, episode_number INTEGER NOT NULL, title_en TEXT NOT NULL,
    title_romaji TEXT NOT NULL, title_ja TEXT NOT NULL, air_date TEXT,
    arc_title TEXT NOT NULL, source_language TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(source_url,source_revision,item_key));`);
  archive.db.run(`CREATE TABLE IF NOT EXISTS anime_episode_source_matches(
    source_url TEXT NOT NULL, work_key TEXT NOT NULL, item_key TEXT NOT NULL,
    target_kind TEXT NOT NULL, target_key TEXT NOT NULL, episode_number INTEGER NOT NULL,
    match_method TEXT NOT NULL, evidence_json TEXT NOT NULL,
    PRIMARY KEY(source_url,work_key,item_key,target_kind,target_key));`);
}

export async function syncOfficialAnimeEpisodes(archive: Archive) {
  init(archive);
  const observations: Observation[] = [];
  const pages = [
    ...Array.from({ length: 6 }, (_, i) =>
      i === 0
        ? `${TOKYO}fairytail/episodes/`
        : `${TOKYO}fairytail/episodes/index_${i + 1}.html`,
    ),
    ...Array.from({ length: 9 }, (_, i) =>
      i === 0
        ? `${TOKYO}fairytail2015/episodes/`
        : `${TOKYO}fairytail2015/episodes/index_${i + 1}.html`,
    ),
    `${TOKYO}fairytail2016/episodes/index.html`,
  ];
  const fetchedPages: string[] = [];
  for (const url of pages) {
    const html = await page(url);
    fetchedPages.push(url);
    observations.push(...tvTokyo(html, url));
  }
  const finalHtml = await page(FINAL);
  fetchedPages.push(FINAL);
  observations.push(...finalSeries(finalHtml));

  const dvdUrl = `${TOKYO}info_dvd/fairytail.html`;
  const dvdHtml = await page(dvdUrl);
  fetchedPages.push(dvdUrl);
  observations.push(...dvdEpisodes(dvdHtml, dvdUrl));

  const questHtml = await page(QUEST);
  fetchedPages.push(QUEST);
  const quest = questListing(questHtml);
  for (let i = 0; i < quest.length; i++) {
    const item = quest[i]!;
    if (item.number !== null) {
      const detail = await page(item.source);
      fetchedPages.push(item.source);
      const parsed = questDetail(detail);
      if (parsed.summary) item.summary = parsed.summary;
      if (parsed.title) item.title = parsed.title;
    }
    observations.push(item);
  }

  const unique = new Map<string, Observation>();
  for (const item of observations)
    unique.set(`${item.source}|${item.workKey}|${item.key}`, item);
  const list = [...unique.values()];
  archive.db.transaction(() => {
    const put = archive.db
      .query(`INSERT INTO anime_official_episode_sources(source_url,work_key,item_key,episode_number,title,summary,air_date,language,source_hash,fetched_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_url,work_key,item_key) DO UPDATE SET episode_number=excluded.episode_number,title=excluded.title,summary=excluded.summary,air_date=excluded.air_date,language=excluded.language,source_hash=excluded.source_hash,fetched_at=excluded.fetched_at`);
    for (const item of list) {
      const hash = new Bun.CryptoHasher("sha256")
        .update(JSON.stringify(item))
        .digest("hex");
      put.run(
        item.source,
        item.workKey,
        item.key,
        item.number,
        item.title,
        item.summary,
        item.airDate,
        item.language,
        hash,
        new Date().toISOString(),
      );
    }
  })();
  const officialRows = archive.db
    .query<
      {
        source_url: string;
        work_key: string;
        item_key: string;
        episode_number: number;
        title: string;
      },
      []
    >(
      "SELECT source_url,work_key,item_key,episode_number,title FROM anime_official_episode_sources WHERE episode_number IS NOT NULL",
    )
    .all();
  const links: {
    source: string;
    work: string;
    item: string;
    kind: string;
    target: string;
    number: number;
    evidence: string;
  }[] = [];
  const wantedTitles = new Map<string, string[]>([
    ["fairy-tail", ["Fairy Tail", "Fairy Tail (VF)"]],
    [
      "fairy-tail-100yq",
      ["Fairy Tail: 100 Years Quest", "Fairy Tail: 100 Years Quest (VF)"],
    ],
  ]);
  for (const row of officialRows) {
    const titles = wantedTitles.get(row.work_key) ?? [];
    const episodes = archive.db
      .query<
        { url: string; title: string; workTitle: string },
        [number, ...string[]]
      >(
        `SELECT e.url,e.title,w.title workTitle FROM anime_episodes e JOIN anime_works w ON w.id=e.work_id WHERE e.number=? AND w.title IN (${titles.map(() => "?").join(",")})`,
      )
      .all(row.episode_number, ...titles);
    for (const target of episodes)
      links.push({
        source: row.source_url,
        work: row.work_key,
        item: row.item_key,
        kind: "anime_episodes",
        target: target.url,
        number: row.episode_number,
        evidence: JSON.stringify({
          officialTitle: row.title,
          catalogueTitle: target.title,
          catalogueWork: target.workTitle,
        }),
      });
    if (row.work_key === "fairy-tail") {
      const media = archive.db
        .query<{ provider: string; item_key: string; title: string }, [number]>(
          "SELECT provider,item_key,title FROM media_catalog WHERE episode_number=?",
        )
        .all(row.episode_number);
      for (const target of media)
        links.push({
          source: row.source_url,
          work: row.work_key,
          item: row.item_key,
          kind: "media_catalog",
          target: `${target.provider}:${target.item_key}`,
          number: row.episode_number,
          evidence: JSON.stringify({
            officialTitle: row.title,
            catalogueTitle: target.title,
            provider: target.provider,
          }),
        });
    }
    if (row.work_key === "fairy-tail") {
      for (const arc of archive.db
        .query<{ id: string; title: string; episode_numbers: string }, []>(
          "SELECT id,title,episode_numbers FROM anime_arcs WHERE range_kind='anime_episode_links'",
        )
        .all()) {
        const numbers = JSON.parse(arc.episode_numbers) as number[];
        if (numbers.includes(row.episode_number))
          links.push({
            source: row.source_url,
            work: row.work_key,
            item: row.item_key,
            kind: "anime_arcs",
            target: arc.id,
            number: row.episode_number,
            evidence: JSON.stringify({
              officialTitle: row.title,
              arcTitle: arc.title,
              match: "explicit episode number in source wiki",
            }),
          });
      }
    }
  }
  for (const media of archive.db
    .query<
      {
        provider: string;
        item_key: string;
        episode_number: number;
        title: string;
        url: string;
      },
      []
    >(
      "SELECT provider,item_key,episode_number,title,url FROM media_catalog WHERE episode_number IS NOT NULL",
    )
    .all()) {
    const titles = wantedTitles.get("fairy-tail")!;
    const episodes = archive.db
      .query<
        { url: string; title: string; workTitle: string },
        [number, ...string[]]
      >(
        `SELECT e.url,e.title,w.title workTitle FROM anime_episodes e JOIN anime_works w ON w.id=e.work_id WHERE e.number=? AND w.title IN (${titles.map(() => "?").join(",")})`,
      )
      .all(media.episode_number, ...titles);
    for (const target of episodes)
      links.push({
        source: media.url,
        work: "fairy-tail",
        item: `${media.provider}:${media.item_key}`,
        kind: "anime_episodes",
        target: target.url,
        number: media.episode_number,
        evidence: JSON.stringify({
          mediaTitle: media.title,
          catalogueTitle: target.title,
          provider: media.provider,
          catalogueWork: target.workTitle,
        }),
      });
  }
  archive.db.transaction(() => {
    archive.db
      .query(
        "DELETE FROM anime_episode_source_matches WHERE source_url IN (SELECT DISTINCT source_url FROM anime_official_episode_sources) OR source_url IN (SELECT url FROM media_catalog)",
      )
      .run();
    const put = archive.db.query(
      "INSERT OR IGNORE INTO anime_episode_source_matches(source_url,work_key,item_key,target_kind,target_key,episode_number,match_method,evidence_json) VALUES(?,?,?,?,?,?,?,?)",
    );
    for (const link of links)
      put.run(
        link.source,
        link.work,
        link.item,
        link.kind,
        link.target,
        link.number,
        "work_and_episode_number",
        link.evidence,
      );
  })();
  const counts = archive.db
    .query<
      {
        work_key: string;
        source_domains: number;
        observations: number;
        numbered: number;
        unique_numbers: number;
        first_number: number;
        last_number: number;
      },
      []
    >(
      "SELECT work_key,count(DISTINCT substr(source_url,instr(source_url,'://')+3, instr(substr(source_url,instr(source_url,'://')+3),'/')-1)) source_domains,count(*) observations,sum(episode_number IS NOT NULL) numbered,count(DISTINCT episode_number) unique_numbers,min(episode_number) first_number,max(episode_number) last_number FROM anime_official_episode_sources GROUP BY work_key ORDER BY work_key",
    )
    .all();
  const coverage = archive.db
    .query<{ work_key: string; episode_number: number }, []>(
      "SELECT DISTINCT work_key,episode_number FROM anime_official_episode_sources WHERE episode_number IS NOT NULL ORDER BY work_key,episode_number",
    )
    .all();
  const gaps: Record<string, number[]> = {};
  for (const workKey of ["fairy-tail", "fairy-tail-100yq"]) {
    const numbers = coverage
      .filter((row) => row.work_key === workKey)
      .map((row) => row.episode_number);
    const lo = workKey === "fairy-tail" ? 1 : 1;
    const hi = workKey === "fairy-tail" ? 328 : 25;
    const present = new Set(numbers);
    gaps[workKey] = Array.from(
      { length: hi - lo + 1 },
      (_, i) => lo + i,
    ).filter((n) => !present.has(n));
  }
  const matches = archive.db
    .query<{ target_kind: string; count: number }, []>(
      "SELECT target_kind,count(*) count FROM anime_episode_source_matches GROUP BY target_kind ORDER BY target_kind",
    )
    .all();
  const conflicts = archive.db
    .query<
      {
        work_key: string;
        episode_number: number;
        versions: number;
        titles: string;
      },
      []
    >(
      `SELECT work_key,episode_number,count(DISTINCT title) versions,group_concat(DISTINCT title) titles FROM anime_official_episode_sources WHERE episode_number IS NOT NULL GROUP BY work_key,episode_number HAVING count(DISTINCT title)>1 ORDER BY work_key,episode_number`,
    )
    .all();
  return {
    fetchedPages: fetchedPages.length,
    observations: list.length,
    counts,
    gaps,
    crossSourceMatches: matches,
    titleConflicts: conflicts,
    complete: false as const,
  };
}

function splitTemplateFields(value: string): string[] {
  const fields: string[] = [];
  let start = 0,
    braces = 0,
    links = 0;
  for (let i = 0; i < value.length; i++) {
    const pair = value.slice(i, i + 2);
    if (pair === "{{") {
      braces++;
      i++;
      continue;
    }
    if (pair === "}}") {
      braces = Math.max(0, braces - 1);
      i++;
      continue;
    }
    if (pair === "[[") {
      links++;
      i++;
      continue;
    }
    if (pair === "]]") {
      links = Math.max(0, links - 1);
      i++;
      continue;
    }
    if (value[i] === "|" && braces === 0 && links === 0) {
      fields.push(value.slice(start, i));
      start = i + 1;
    }
  }
  fields.push(value.slice(start));
  return fields;
}

function cleanWiki(value: string): string {
  return value
    .replace(/\{\{Ruby\|([^|{}]+)\|[^{}]*\}\}/gi, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'{2,5}/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function syncFandomEpisodeGuide(archive: Archive) {
  init(archive);
  const sourceUrl = "https://fairytail.fandom.com/wiki/Episodes";
  const api = new URL("https://fairytail.fandom.com/api.php");
  api.search = new URLSearchParams({
    action: "query",
    prop: "revisions",
    titles: "Episodes",
    rvprop: "ids|content",
    rvslots: "main",
    format: "json",
    formatversion: "2",
  }).toString();
  const response = await fetch(api, {
    redirect: "error",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Fandom API ${response.status}`);
  const payload = (await response.json()) as {
    query?: {
      pages?: {
        title: string;
        revisions?: {
          revid: number;
          slots?: { main?: { content?: string } };
        }[];
      }[];
    };
  };
  const pageData = payload.query?.pages?.find(
    (entry) => entry.title === "Episodes",
  );
  const revision = pageData?.revisions?.[0];
  const wikitext = revision?.slots?.main?.content;
  if (
    !Number.isSafeInteger(revision?.revid) ||
    typeof wikitext !== "string" ||
    wikitext.length > 4_000_000
  )
    throw new Error(
      "Fandom Episode List revision missing or outside size limit",
    );
  const rows: {
    number: number;
    en: string;
    romaji: string;
    ja: string;
    airDate: string | null;
    arc: string;
  }[] = [];
  let arc = "";
  const lines = wikitext.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^===\[\[([^\]|]+)(?:\|([^\]]+))?\]\]===/.exec(line);
    if (heading) arc = cleanWiki(heading[2] ?? heading[1]!);
    if (!line.startsWith("{{Episode|")) continue;
    let template = line,
      depth = 0;
    const updateDepth = (text: string) => {
      for (let j = 0; j < text.length - 1; j++) {
        const pair = text.slice(j, j + 2);
        if (pair === "{{") {
          depth++;
          j++;
        } else if (pair === "}}") {
          depth--;
          j++;
        }
      }
    };
    updateDepth(template);
    while (depth > 0 && i + 1 < lines.length) {
      template += `\n${lines[++i]!}`;
      updateDepth(lines[i]!);
    }
    if (depth !== 0 || !template.endsWith("}}")) continue;
    const fields = splitTemplateFields(template.slice("{{Episode|".length, -2));
    const number = Number(fields[0]);
    if (!Number.isSafeInteger(number) || number < 1 || number > 328) continue;
    const monthDay = cleanWiki(fields[4] ?? ""),
      year = Number(cleanWiki(fields[5] ?? ""));
    const date =
      monthDay && Number.isSafeInteger(year)
        ? new Date(`${monthDay}, ${year} UTC`)
        : null;
    rows.push({
      number,
      en: cleanWiki(fields[1] ?? ""),
      romaji: cleanWiki(fields[2] ?? ""),
      ja: cleanWiki(fields[3] ?? ""),
      airDate:
        date && Number.isFinite(date.getTime())
          ? date.toISOString().slice(0, 10)
          : null,
      arc,
    });
  }
  const deduped = [...new Map(rows.map((row) => [row.number, row])).values()];
  if (deduped.length < 300)
    throw new Error(
      `Fandom episode list unexpectedly short: ${deduped.length}`,
    );
  archive.db.transaction(() => {
    archive.db
      .query("DELETE FROM anime_episode_wiki_sources WHERE source_url=?")
      .run(sourceUrl);
    archive.db
      .query("DELETE FROM anime_episode_source_matches WHERE source_url=?")
      .run(sourceUrl);
    const put = archive.db.query(
      "INSERT INTO anime_episode_wiki_sources(source_url,source_revision,work_key,item_key,episode_number,title_en,title_romaji,title_ja,air_date,arc_title,source_language,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const match = archive.db.query(
      "INSERT OR IGNORE INTO anime_episode_source_matches(source_url,work_key,item_key,target_kind,target_key,episode_number,match_method,evidence_json) VALUES(?,?,?,?,?,?,?,?)",
    );
    for (const row of deduped) {
      const itemKey = `episode:${row.number}`;
      put.run(
        sourceUrl,
        revision!.revid,
        "fairy-tail",
        itemKey,
        row.number,
        row.en,
        row.romaji,
        row.ja,
        row.airDate,
        row.arc,
        "en",
        new Date().toISOString(),
      );
      const titles = ["Fairy Tail", "Fairy Tail (VF)"];
      const catalog = archive.db
        .query<
          { url: string; title: string; workTitle: string },
          [number, ...string[]]
        >(
          `SELECT e.url,e.title,w.title workTitle FROM anime_episodes e JOIN anime_works w ON w.id=e.work_id WHERE e.number=? AND w.title IN (${titles.map(() => "?").join(",")})`,
        )
        .all(row.number, ...titles);
      for (const target of catalog)
        match.run(
          sourceUrl,
          "fairy-tail",
          itemKey,
          "anime_episodes",
          target.url,
          row.number,
          "work_and_episode_number",
          JSON.stringify({
            fandomTitleEn: row.en,
            fandomTitleJa: row.ja,
            catalogueTitle: target.title,
            catalogueWork: target.workTitle,
          }),
        );
      if (row.arc) {
        const arcs = archive.db
          .query<{ id: string; title: string; episode_numbers: string }, []>(
            "SELECT id,title,episode_numbers FROM anime_arcs WHERE range_kind='anime_episode_links'",
          )
          .all();
        for (const target of arcs)
          if (
            (JSON.parse(target.episode_numbers) as number[]).includes(
              row.number,
            )
          )
            match.run(
              sourceUrl,
              "fairy-tail",
              itemKey,
              "anime_arcs",
              target.id,
              row.number,
              "fandom_arc_and_episode_number",
              JSON.stringify({
                fandomArc: row.arc,
                catalogueArc: target.title,
                episodeNumber: row.number,
              }),
            );
      }
    }
  })();
  const conflicts = archive.db
    .query<{ episode_number: number; titles: string }, [string]>(
      "SELECT episode_number,group_concat(title_en,' || ') titles FROM anime_episode_wiki_sources WHERE source_url=? GROUP BY episode_number HAVING count(DISTINCT title_en)>1",
    )
    .all(sourceUrl);
  const counts = archive.db
    .query<
      {
        observations: number;
        first_number: number;
        last_number: number;
        japanese_titles: number;
        aired_dates: number;
      },
      [string]
    >(
      "SELECT count(*) observations,min(episode_number) first_number,max(episode_number) last_number,sum(title_ja<>'') japanese_titles,sum(air_date IS NOT NULL) aired_dates FROM anime_episode_wiki_sources WHERE source_url=?",
    )
    .get(sourceUrl)!;
  const matches = archive.db
    .query<{ target_kind: string; count: number }, [string]>(
      "SELECT target_kind,count(*) count FROM anime_episode_source_matches WHERE source_url=? GROUP BY target_kind ORDER BY target_kind",
    )
    .all(sourceUrl);
  const found = new Set(deduped.map((row) => row.number));
  const missing = Array.from({ length: 328 }, (_, i) => i + 1).filter(
    (number) => !found.has(number),
  );
  return {
    sourceUrl,
    revision: revision!.revid,
    ...counts,
    missingEpisodes: missing,
    matches,
    conflicts,
    seasonMappings: "not_inferred_from_airing_order",
    complete: counts.observations === 328 && missing.length === 0,
  };
}
