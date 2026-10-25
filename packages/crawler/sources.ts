export type Source = {
  id: string;
  language: "fr" | "en" | "ja";
  seeds: string[];
  pathPrefix: string;
  topicPath?: boolean;
};
export const sources: Source[] = [
  {
    id: "wikipedia-fr",
    language: "fr",
    seeds: ["https://fr.wikipedia.org/wiki/Fairy_Tail"],
    pathPrefix: "/wiki/",
    topicPath: true,
  },
  {
    id: "wikipedia-en",
    language: "en",
    seeds: ["https://en.wikipedia.org/wiki/Fairy_Tail"],
    pathPrefix: "/wiki/",
    topicPath: true,
  },
  {
    id: "wikipedia-ja",
    language: "ja",
    seeds: ["https://ja.wikipedia.org/wiki/FAIRY_TAIL"],
    pathPrefix: "/wiki/",
    topicPath: true,
  },
  {
    id: "fandom-en",
    language: "en",
    seeds: ["https://fairytail.fandom.com/wiki/Main_Page"],
    pathPrefix: "/wiki/",
  },
  {
    id: "fandom-fr",
    language: "fr",
    seeds: [
      "https://fairy-tail.fandom.com/fr/wiki/Fairy_Tail_%28S%C3%A9rie%29",
    ],
    pathPrefix: "/fr/wiki/",
  },
  {
    id: "anime-ja",
    language: "ja",
    seeds: ["https://www.tv-tokyo.co.jp/anime/fairytail/sp/story/index.html"],
    pathPrefix: "/anime/fairytail/",
  },
  {
    id: "game-ja",
    language: "ja",
    seeds: ["https://fairytailgame.com/2/jp/introduction.html"],
    pathPrefix: "/2/jp/",
  },
  {
    id: "game-en",
    language: "en",
    seeds: ["https://fairytailgame.com/2/us/"],
    pathPrefix: "/2/us/",
  },
  {
    id: "game-fr",
    language: "fr",
    seeds: ["https://fairytailgame.com/2/fr/"],
    pathPrefix: "/2/fr/",
  },
  {
    id: "manual-ja",
    language: "ja",
    seeds: ["https://www.gamecity.ne.jp/manual/fairytail/jp/3100.html"],
    pathPrefix: "/manual/fairytail/jp/",
  },
];

export function inScope(source: Source, address: string): boolean {
  try {
    const url = new URL(address),
      origin = new URL(source.seeds[0]!).origin;
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith(source.pathPrefix)) return false;
    if (/\.(png|jpg|jpeg|gif|svg|pdf|mp4|zip)$/i.test(path)) return false;
    if (path.slice(source.pathPrefix.length).includes(":")) return false;
    return !source.topicPath || /fairy[ _-]?tail/i.test(path);
  } catch {
    return false;
  }
}
