import { test, expect } from "bun:test";
import { Archive } from "../packages/archive/index.ts";
import {
  collectPublisher,
  parsePublisherBook,
  parsePublisherListing,
  publisherUrl,
  publisherSeed,
} from "../packages/crawler/publisher.ts";

const book = "/livre/fairy-tail-100-years-quest-t18-9782811694920/";
const card = `### [Fairy Tail - 100 Years Quest T18](${book})\n\n[Hiro Mashima](${book})\n\n[05/03/2025](${book})`;
test("Pika cards preserve authors, ISBN and dates without following unrelated links", () => {
  const parsed = parsePublisherListing(
    `${card}\n[2](/livres-fairy-tail/2/)\n[Contact](/contactez-nous/)`,
  );
  expect(parsed.books[0]?.authors).toEqual(["Hiro Mashima"]);
  expect(parsed.books[0]?.isbn13).toBe("9782811694920");
  expect(parsed.books[0]?.publishedOn).toBe("2025-03-05");
  expect(parsed.listings).toEqual(["https://www.pika.fr/livres-fairy-tail/2/"]);
  expect(publisherUrl("https://evil.test/livre/fairy-tail-test/")).toBe(null);
  expect(publisherUrl("/livre/another-series-9782811694920/")).toBe(null);
});

test("Pika detail summary stops before recommendations and does not invent missing fields", () => {
  const detail = parsePublisherBook(
    "# Fairy Tail T18\n\nSortie le 5 mars 2025\n\nRésumé\n\nNatsu affronte un nouveau dragon.\n\n![Couverture](/cover.png)\n\n## Vous pourriez aimer...\nUn autre livre.",
    `https://www.pika.fr${book}`,
  );
  expect(detail.synopsis).toBe("Natsu affronte un nouveau dragon.");
  expect(detail.publishedOn).toBe("2025-03-05");
  expect(
    parsePublisherBook(
      "# Fairy Tail T24\n\nSortie le 7 avril 2027",
      `https://www.pika.fr${book}`,
    ).synopsis,
  ).toBe(null);
});

test("Pika queue prioritizes pagination, checkpoints and resumes book details", async () => {
  const a = new Archive(":memory:");
  const seen: string[] = [];
  const second = "https://www.pika.fr/livres-fairy-tail/2/";
  const fetcher = async (url: string) => {
    seen.push(url);
    return {
      url,
      transport: { status: 200, final_url: url },
      body:
        url === publisherSeed
          ? `${card}\n[2](/livres-fairy-tail/2/)`
          : url === second
            ? card
            : "# Fairy Tail - 100 Years Quest T18\n\nRésumé\n\nNatsu visite un château mystérieux.",
    };
  };
  try {
    const first = await collectPublisher(a, {
      maxRequests: 2,
      fetcher,
      saveRaw: false,
    });
    expect(first.books).toBe(1);
    expect(seen).toEqual([publisherSeed, second]);
    const next = await collectPublisher(a, {
      maxRequests: 2,
      fetcher,
      saveRaw: false,
    });
    expect(next.attempted).toBe(1);
    expect(next.withSynopsis).toBe(1);
    expect(a.stats().documents).toBe(1);
    expect(a.search("château")[0]?.url).toBe(`https://www.pika.fr${book}`);
    expect(
      a.db
        .query<{ source_catalog_url: string }, []>(
          "SELECT source_catalog_url FROM catalog_books",
        )
        .get()!.source_catalog_url,
    ).toBe(publisherSeed);
  } finally {
    a.close();
  }
});

test("Pika failed pages remain explicit and can be retried without accepting a challenge", async () => {
  const a = new Archive(":memory:");
  try {
    const failed = await collectPublisher(a, {
      maxRequests: 1,
      saveRaw: false,
      fetcher: async (url) => ({
        url,
        transport: { status: 403, final_url: url },
        body: "Forbidden",
      }),
    });
    expect(failed.errors).toHaveLength(1);
    expect(failed.books).toBe(0);
    const retry = await collectPublisher(a, {
      maxRequests: 1,
      retryFailed: true,
      saveRaw: false,
      fetcher: async (url) => ({
        url,
        transport: { status: 200, final_url: url },
        body: card,
      }),
    });
    expect(retry.books).toBe(1);
    let rejected = false;
    try {
      parsePublisherBook(
        "# Access denied\nCloudflare challenge",
        `https://www.pika.fr${book}`,
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  } finally {
    a.close();
  }
});
